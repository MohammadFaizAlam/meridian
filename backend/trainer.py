"""Training orchestrator with internal validation checkpointing, SSE streaming, and backtesting."""

from __future__ import annotations

import json
import os
import queue
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from agents import create_agent, deserialize_agent
from environment import EnvConfig, TradingEnvironment
from market_data import (
    OHLCVBar,
    build_feature_matrix,
    fetch_market_data,
    fit_feature_scaler,
    transform_features,
)

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
RUNS_DB_PATH = os.path.join(CACHE_DIR, "runs.sqlite")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _init_runs_db() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with sqlite3.connect(RUNS_DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                status TEXT NOT NULL,
                config_json TEXT NOT NULL,
                split_json TEXT NOT NULL,
                scaler_json TEXT NOT NULL,
                episodes_json TEXT NOT NULL,
                train_trace_json TEXT,
                agent_weights_json TEXT,
                backtest_json TEXT,
                error_message TEXT
            )
            """
        )
        conn.commit()


def _validation_score(metrics: Dict[str, Any]) -> float:
    """Rank validation checkpoints by Sharpe, alpha, and drawdown control."""
    sharpe = float(metrics.get("sharpeRatio", 0.0))
    alpha = float(metrics.get("alphaPct", 0.0))
    dd = abs(float(metrics.get("maxDrawdownPct", 0.0)))
    trades = int(metrics.get("totalTrades", 0))
    bench = float(metrics.get("benchmarkReturnPct", 0.0))

    # Avoid degenerate zero-trade policy during rising validation markets
    inactivity_pen = 0.65 if (trades == 0 and bench > 2.0) else 0.0
    dd_pen = max(0.0, dd - 12.0) * 0.05
    return 0.65 * max(-3.0, min(5.0, sharpe)) + 0.35 * max(-3.0, min(3.0, alpha / 10.0)) - dd_pen - inactivity_pen


@dataclass
class RunConfig:
    symbol: str = "AAPL"
    interval: str = "1d"
    range: str = "2y"
    splitRatio: float = 0.75
    algorithm: str = "DQN"
    episodes: int = 35
    learningRate: float = 0.0025
    gamma: float = 0.97
    exploration: float = 0.85
    initialCapital: float = 10000.0
    feeBps: float = 10.0
    slippageBps: float = 5.0
    positionFraction: float = 1.0
    rewardMode: str = "log_return"
    seed: int = 42


@dataclass
class ActiveJob:
    run_id: str
    config: RunConfig
    status: str = "queued"
    created_at: str = field(default_factory=_utc_now_iso)
    updated_at: str = field(default_factory=_utc_now_iso)
    split_info: Dict[str, Any] = field(default_factory=dict)
    scaler: Dict[str, Any] = field(default_factory=dict)
    episodes_history: List[Dict[str, Any]] = field(default_factory=list)
    train_trace: Optional[Dict[str, Any]] = None
    agent_weights: Optional[Dict[str, Any]] = None
    backtest_result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None

    pause_event: threading.Event = field(default_factory=threading.Event, repr=False)
    stop_event: threading.Event = field(default_factory=threading.Event, repr=False)
    subscribers: List[queue.Queue] = field(default_factory=list, repr=False)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def __post_init__(self) -> None:
        self.pause_event.set()


class TrainingManager:
    def __init__(self) -> None:
        _init_runs_db()
        self._jobs: Dict[str, ActiveJob] = {}
        self._global_lock = threading.Lock()
        self._load_persisted_runs()

    def _load_persisted_runs(self) -> None:
        with sqlite3.connect(RUNS_DB_PATH) as conn:
            rows = conn.execute(
                """
                SELECT id, created_at, updated_at, status, config_json, split_json,
                       scaler_json, episodes_json, train_trace_json, agent_weights_json,
                       backtest_json, error_message
                FROM runs ORDER BY created_at DESC LIMIT 60
                """
            ).fetchall()
        for row in rows:
            status = "stopped" if row[3] in ("running", "paused", "queued") else row[3]
            cfg_dict = json.loads(row[4])
            cfg = RunConfig(**{k: v for k, v in cfg_dict.items() if k in RunConfig.__dataclass_fields__})
            job = ActiveJob(
                run_id=row[0],
                config=cfg,
                created_at=row[1],
                updated_at=row[2],
                status=status,
                split_info=json.loads(row[5]),
                scaler=json.loads(row[6]),
                episodes_history=json.loads(row[7]),
                train_trace=json.loads(row[8]) if row[8] else None,
                agent_weights=json.loads(row[9]) if row[9] else None,
                backtest_result=json.loads(row[10]) if row[10] else None,
                error_message=row[11],
            )
            self._jobs[job.run_id] = job

    def _persist_job(self, job: ActiveJob) -> None:
        with job.lock:
            job.updated_at = _utc_now_iso()
            payload = (
                job.run_id,
                job.created_at,
                job.updated_at,
                job.status,
                json.dumps(asdict(job.config)),
                json.dumps(job.split_info),
                json.dumps(job.scaler),
                json.dumps(job.episodes_history),
                json.dumps(job.train_trace) if job.train_trace is not None else None,
                json.dumps(job.agent_weights) if job.agent_weights is not None else None,
                json.dumps(job.backtest_result) if job.backtest_result is not None else None,
                job.error_message,
            )
        with sqlite3.connect(RUNS_DB_PATH) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO runs (
                    id, created_at, updated_at, status, config_json, split_json,
                    scaler_json, episodes_json, train_trace_json, agent_weights_json,
                    backtest_json, error_message
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                payload,
            )
            conn.commit()

    def _emit(self, job: ActiveJob, event_type: str, data: Dict[str, Any]) -> None:
        message = {"event": event_type, "data": data}
        with job.lock:
            dead: List[queue.Queue] = []
            for q in job.subscribers:
                try:
                    q.put_nowait(message)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                job.subscribers.remove(q)

    def subscribe(self, run_id: str) -> queue.Queue:
        job = self._jobs.get(run_id)
        if not job:
            raise KeyError(f"Run '{run_id}' not found.")
        q: queue.Queue = queue.Queue(maxsize=256)
        with job.lock:
            job.subscribers.append(q)
        return q

    def unsubscribe(self, run_id: str, q: queue.Queue) -> None:
        job = self._jobs.get(run_id)
        if not job:
            return
        with job.lock:
            if q in job.subscribers:
                job.subscribers.remove(q)

    def get_agent_context(
        self, run_id: Optional[str], symbol: str
    ) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        """Return saved weights and scaler for the requested run or latest matching symbol run."""
        job: Optional[ActiveJob] = None
        if run_id and run_id in self._jobs:
            cand = self._jobs[run_id]
            if cand.agent_weights and cand.scaler:
                job = cand
        if job is None:
            with self._global_lock:
                candidates = [
                    j for j in self._jobs.values()
                    if j.config.symbol == symbol
                    and j.agent_weights
                    and j.scaler
                    and j.agent_weights.get("version") == 2
                ]
            if candidates:
                candidates.sort(key=lambda j: j.updated_at, reverse=True)
                job = candidates[0]

        if job is None or not job.agent_weights or not job.scaler:
            return None, None, None

        with job.lock:
            return (
                job.agent_weights,
                job.scaler,
                {
                    "id": job.run_id,
                    "algorithm": job.config.algorithm,
                    "symbol": job.config.symbol,
                    "updatedAt": job.updated_at,
                },
            )

    def start_run(self, raw_params: Dict[str, Any]) -> Dict[str, Any]:
        symbol = str(raw_params.get("symbol", "AAPL")).strip().upper()
        interval = str(raw_params.get("interval", "1d"))
        range_str = str(raw_params.get("range", "2y"))
        split_ratio = max(0.50, min(0.90, float(raw_params.get("splitRatio", 0.75))))
        algorithm = str(raw_params.get("algorithm", "DQN"))
        if algorithm.upper() not in ("DQN", "PPO", "A2C", "Q-LEARNING"):
            raise ValueError(f"Unsupported algorithm '{algorithm}'. Choose DQN, PPO, A2C, or Q-Learning.")

        episodes = max(5, min(200, int(raw_params.get("episodes", 35))))
        lr = max(0.0001, min(0.2, float(raw_params.get("learningRate", 0.0025))))
        gamma = max(0.50, min(0.999, float(raw_params.get("gamma", 0.97))))
        exploration = max(0.05, min(1.0, float(raw_params.get("exploration", 0.85))))
        initial_capital = max(100.0, min(10_000_000.0, float(raw_params.get("initialCapital", 10000.0))))
        fee_bps = max(0.0, min(500.0, float(raw_params.get("feeBps", 10.0))))
        slippage_bps = max(0.0, min(500.0, float(raw_params.get("slippageBps", 5.0))))
        pos_frac = max(0.10, min(1.0, float(raw_params.get("positionFraction", 1.0))))
        reward_mode = str(raw_params.get("rewardMode", "log_return"))
        if reward_mode not in ("log_return", "risk_adjusted", "drawdown_penalized"):
            reward_mode = "log_return"
        seed = int(raw_params.get("seed", 42))

        market = fetch_market_data(symbol=symbol, interval=interval, range_str=range_str, split_ratio=split_ratio)

        cfg = RunConfig(
            symbol=market["meta"]["symbol"],
            interval=market["meta"]["interval"],
            range=market["meta"]["range"],
            splitRatio=market["split"]["ratio"],
            algorithm=algorithm,
            episodes=episodes,
            learningRate=lr,
            gamma=gamma,
            exploration=exploration,
            initialCapital=initial_capital,
            feeBps=fee_bps,
            slippageBps=slippage_bps,
            positionFraction=pos_frac,
            rewardMode=reward_mode,
            seed=seed,
        )

        run_id = f"run_{uuid.uuid4().hex[:10]}"
        job = ActiveJob(
            run_id=run_id,
            config=cfg,
            status="running",
            split_info=market["split"],
        )

        with self._global_lock:
            self._jobs[run_id] = job
        self._persist_job(job)

        worker = threading.Thread(
            target=self._run_training_loop,
            args=(job, market),
            daemon=True,
            name=f"rl-{run_id}",
        )
        worker.start()
        return self.serialize_run_summary(job)

    def _run_training_loop(self, job: ActiveJob, market: Dict[str, Any]) -> None:
        try:
            bars_dicts: List[Dict[str, Any]] = market["bars"]
            valid_fields = set(OHLCVBar.__dataclass_fields__.keys())
            bars_objs = [
                OHLCVBar(**{k: v for k, v in b.items() if k in valid_fields}) for b in bars_dicts
            ]
            split_idx = int(market["split"]["splitIndex"])

            # Keep unseen test slice strictly isolated from training and scaling
            train_bars = bars_dicts[:split_idx]
            all_raw_features = build_feature_matrix(bars_objs)
            train_raw_features = all_raw_features[:split_idx]

            # Carve internal validation tail inside train_bars to prevent lucky overfitting
            use_internal_val = len(train_bars) >= 110
            val_split = int(round(len(train_bars) * 0.82)) if use_internal_val else len(train_bars)

            means, stds = fit_feature_scaler(train_raw_features[:val_split])
            train_scaled = transform_features(train_raw_features, means, stds)

            with job.lock:
                job.scaler = {"means": means, "stds": stds}

            ann_factor = float(market["meta"].get("annualizationFactor", 252.0))
            env_cfg = EnvConfig(
                initial_capital=job.config.initialCapital,
                fee_bps=job.config.feeBps,
                slippage_bps=job.config.slippageBps,
                position_fraction=job.config.positionFraction,
                reward_mode=job.config.rewardMode,
                annualization_factor=ann_factor,
            )

            warmup = 29 if val_split > 65 else 0
            fit_env = TradingEnvironment(
                train_bars[:val_split], train_scaled[:val_split], env_cfg, warmup_bars=warmup
            )
            val_env = (
                TradingEnvironment(train_bars[val_split:], train_scaled[val_split:], env_cfg, warmup_bars=0)
                if use_internal_val
                else None
            )

            agent = create_agent(
                algorithm=job.config.algorithm,
                state_dim=fit_env.state_dim,
                learning_rate=job.config.learningRate,
                gamma=job.config.gamma,
                exploration=job.config.exploration,
                seed=job.config.seed,
            )

            best_score = -1e9
            best_weights: Optional[Dict[str, Any]] = None
            best_episode = 0
            best_val_sharpe: Optional[float] = None

            self._emit(
                job,
                "status",
                {"runId": job.run_id, "status": "running", "totalEpisodes": job.config.episodes},
            )

            for ep in range(1, job.config.episodes + 1):
                if job.stop_event.is_set():
                    break
                while not job.pause_event.is_set():
                    if job.stop_event.is_set():
                        break
                    time.sleep(0.08)
                if job.stop_event.is_set():
                    break

                state = fit_env.reset()
                ep_reward = 0.0
                done = False

                while not done:
                    if job.stop_event.is_set():
                        break
                    while not job.pause_event.is_set():
                        if job.stop_event.is_set():
                            break
                        time.sleep(0.08)
                    if job.stop_event.is_set():
                        break

                    mask = fit_env.valid_action_mask()
                    action = agent.select_action(state, greedy=False, valid_mask=mask)
                    next_state, reward, done, _ = fit_env.step(action)
                    agent.observe(state, action, reward, next_state, done)
                    state = next_state
                    ep_reward += reward

                if job.stop_event.is_set():
                    break

                progress = ep / max(1, job.config.episodes)
                agent_stats = agent.end_episode(progress=progress)
                trace = fit_env.export_trace()
                metrics = trace["metrics"]

                # Evaluate deterministic policy on internal validation slice to pick best checkpoint
                if val_env is not None:
                    vs = val_env.reset()
                    vdone = False
                    while not vdone:
                        va = agent.select_action(vs, greedy=True, valid_mask=val_env.valid_action_mask())
                        vs, _, vdone, _ = val_env.step(va)
                    val_metrics = val_env.compute_metrics()
                    cand_score = _validation_score(val_metrics)
                    cand_sharpe = float(val_metrics.get("sharpeRatio", 0.0))
                else:
                    cand_score = _validation_score(metrics)
                    cand_sharpe = float(metrics.get("sharpeRatio", 0.0))

                if cand_score >= best_score or best_weights is None:
                    best_score = cand_score
                    best_weights = agent.serialize()
                    best_episode = ep
                    best_val_sharpe = round(cand_sharpe, 3)

                ep_record = {
                    "episode": ep,
                    "totalEpisodes": job.config.episodes,
                    "totalReward": round(ep_reward, 3),
                    "finalEquity": metrics["finalEquity"],
                    "totalReturnPct": metrics["totalReturnPct"],
                    "benchmarkReturnPct": metrics["benchmarkReturnPct"],
                    "sharpeRatio": metrics["sharpeRatio"],
                    "maxDrawdownPct": metrics["maxDrawdownPct"],
                    "winRatePct": metrics["winRatePct"],
                    "totalTrades": metrics["totalTrades"],
                    "validationSharpe": round(cand_sharpe, 3),
                    "bestEpisode": best_episode,
                    **agent_stats,
                }

                with job.lock:
                    job.episodes_history.append(ep_record)
                    job.train_trace = trace
                    job.agent_weights = best_weights
                    job.split_info["bestEpisode"] = best_episode
                    if best_val_sharpe is not None:
                        job.split_info["validationSharpe"] = best_val_sharpe

                self._emit(
                    job,
                    "episode",
                    {
                        "runId": job.run_id,
                        "episodeSummary": ep_record,
                        "trainTrace": trace,
                    },
                )

                if ep % 5 == 0 or ep == job.config.episodes:
                    self._persist_job(job)

                time.sleep(0.025)

            # Evaluate the best validation-selected checkpoint deterministically across train_bars
            if job.episodes_history and best_weights is not None:
                best_agent = deserialize_agent(best_weights)
                greedy_env = TradingEnvironment(train_bars, train_scaled, env_cfg, warmup_bars=warmup)
                s = greedy_env.reset()
                d = False
                while not d:
                    a = best_agent.select_action(s, greedy=True, valid_mask=greedy_env.valid_action_mask())
                    s, _, d, _ = greedy_env.step(a)
                greedy_trace = greedy_env.export_trace()
                with job.lock:
                    job.train_trace = greedy_trace
                    job.agent_weights = best_weights
                    job.split_info["bestEpisode"] = best_episode
                    if best_val_sharpe is not None:
                        job.split_info["validationSharpe"] = best_val_sharpe

            final_status = "stopped" if job.stop_event.is_set() else "completed"
            with job.lock:
                job.status = final_status
            self._persist_job(job)

            self._emit(
                job,
                "done",
                {
                    "runId": job.run_id,
                    "status": final_status,
                    "run": self.serialize_run_detail(job),
                },
            )
        except Exception as exc:
            with job.lock:
                job.status = "error"
                job.error_message = str(exc)
            self._persist_job(job)
            self._emit(
                job,
                "error",
                {"runId": job.run_id, "status": "error", "error": str(exc)},
            )

    def pause_run(self, run_id: str) -> Dict[str, Any]:
        job = self._jobs.get(run_id)
        if not job:
            raise KeyError(f"Run '{run_id}' not found.")
        with job.lock:
            if job.status == "running":
                job.pause_event.clear()
                job.status = "paused"
        self._persist_job(job)
        self._emit(job, "status", {"runId": run_id, "status": job.status})
        return self.serialize_run_summary(job)

    def resume_run(self, run_id: str) -> Dict[str, Any]:
        job = self._jobs.get(run_id)
        if not job:
            raise KeyError(f"Run '{run_id}' not found.")
        with job.lock:
            if job.status == "paused":
                job.status = "running"
                job.pause_event.set()
        self._persist_job(job)
        self._emit(job, "status", {"runId": run_id, "status": job.status})
        return self.serialize_run_summary(job)

    def stop_run(self, run_id: str) -> Dict[str, Any]:
        job = self._jobs.get(run_id)
        if not job:
            raise KeyError(f"Run '{run_id}' not found.")
        with job.lock:
            if job.status in ("running", "paused", "queued"):
                job.stop_event.set()
                job.pause_event.set()
                job.status = "stopped"
        self._persist_job(job)
        self._emit(job, "status", {"runId": run_id, "status": job.status})
        return self.serialize_run_summary(job)

    def _restore_job_from_payload(
        self, run_id: str, fallback_run: Dict[str, Any]
    ) -> Optional[ActiveJob]:
        if not isinstance(fallback_run, dict):
            return None
        checkpoint = fallback_run.get("checkpoint")
        if not isinstance(checkpoint, dict):
            return None
        weights = checkpoint.get("agentWeights")
        scaler = checkpoint.get("scaler")
        cfg_dict = fallback_run.get("config")
        if (
            not isinstance(weights, dict)
            or weights.get("version") != 2
            or not isinstance(scaler, dict)
            or not isinstance(cfg_dict, dict)
        ):
            return None

        cfg = RunConfig(**{k: v for k, v in cfg_dict.items() if k in RunConfig.__dataclass_fields__})
        episodes_raw = fallback_run.get("episodes")
        episodes = episodes_raw if isinstance(episodes_raw, list) else []
        split_raw = fallback_run.get("split")
        split_info = split_raw if isinstance(split_raw, dict) else {}
        train_trace = fallback_run.get("trainTrace") if isinstance(fallback_run.get("trainTrace"), dict) else None
        status = str(fallback_run.get("status") or "completed")
        if status in ("running", "paused", "queued"):
            status = "completed"

        job = ActiveJob(
            run_id=run_id,
            config=cfg,
            status=status,
            created_at=str(fallback_run.get("createdAt") or _utc_now_iso()),
            updated_at=str(fallback_run.get("updatedAt") or _utc_now_iso()),
            split_info=split_info,
            scaler=scaler,
            episodes_history=episodes,
            train_trace=train_trace,
            agent_weights=weights,
            backtest_result=None,
            error_message=None,
        )
        with self._global_lock:
            self._jobs[run_id] = job
        self._persist_job(job)
        return job

    def run_backtest(
        self,
        run_id: str,
        override_symbol: Optional[str] = None,
        fallback_run: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Evaluate saved best checkpoint deterministically on strictly unseen test data."""
        job = self._jobs.get(run_id)
        if not job and fallback_run:
            job = self._restore_job_from_payload(run_id, fallback_run)
        if not job:
            raise KeyError(f"Run '{run_id}' not found.")
        if not job.agent_weights or not job.scaler:
            raise ValueError("This run has no trained policy weights yet. Complete at least one round first.")
        if job.agent_weights.get("version") != 2:
            raise ValueError("This run was trained on an older engine version. Train a new run to backtest.")

        target_symbol = (override_symbol or job.config.symbol).strip().upper()
        market = fetch_market_data(
            symbol=target_symbol,
            interval=job.config.interval,
            range_str=job.config.range,
            split_ratio=job.config.splitRatio,
        )

        bars_dicts = market["bars"]
        valid_fields = set(OHLCVBar.__dataclass_fields__.keys())
        bars_objs = [
            OHLCVBar(**{k: v for k, v in b.items() if k in valid_fields}) for b in bars_dicts
        ]
        split_idx = int(market["split"]["splitIndex"])

        test_bars = bars_dicts[split_idx:]
        all_raw_features = build_feature_matrix(bars_objs)
        test_raw_features = all_raw_features[split_idx:]

        if len(job.scaler["means"]) != len(test_raw_features[0]):
            raise ValueError("Feature dimensions changed after engine upgrade. Start a new training run.")

        test_scaled = transform_features(
            test_raw_features,
            job.scaler["means"],
            job.scaler["stds"],
        )

        ann_factor = float(market["meta"].get("annualizationFactor", 252.0))
        env_cfg = EnvConfig(
            initial_capital=job.config.initialCapital,
            fee_bps=job.config.feeBps,
            slippage_bps=job.config.slippageBps,
            position_fraction=job.config.positionFraction,
            reward_mode=job.config.rewardMode,
            annualization_factor=ann_factor,
        )

        env = TradingEnvironment(test_bars, test_scaled, env_cfg, warmup_bars=0)
        agent = deserialize_agent(job.agent_weights)

        state = env.reset()
        done = False
        while not done:
            action = agent.select_action(state, greedy=True, valid_mask=env.valid_action_mask())
            state, _, done, _ = env.step(action)

        trace = env.export_trace()
        result = {
            "evaluatedAt": _utc_now_iso(),
            "symbol": market["meta"]["symbol"],
            "isTransferTest": market["meta"]["symbol"] != job.config.symbol,
            "testStart": test_bars[0]["date"],
            "testEnd": test_bars[-1]["date"],
            "testBars": len(test_bars),
            "bars": test_bars,
            **trace,
        }

        if not result["isTransferTest"]:
            with job.lock:
                job.backtest_result = result
            self._persist_job(job)

        return result

    def delete_run(self, run_id: str) -> bool:
        with self._global_lock:
            job = self._jobs.pop(run_id, None)
        if job:
            job.stop_event.set()
            job.pause_event.set()
        with sqlite3.connect(RUNS_DB_PATH) as conn:
            cur = conn.execute("DELETE FROM runs WHERE id = ?", (run_id,))
            conn.commit()
            return cur.rowcount > 0 or job is not None

    def list_runs(self) -> List[Dict[str, Any]]:
        with self._global_lock:
            jobs = list(self._jobs.values())
        jobs.sort(key=lambda j: j.created_at, reverse=True)
        return [self.serialize_run_summary(j) for j in jobs]

    def get_run(self, run_id: str) -> Dict[str, Any]:
        job = self._jobs.get(run_id)
        if not job:
            raise KeyError(f"Run '{run_id}' not found.")
        return self.serialize_run_detail(job)

    def serialize_run_summary(self, job: ActiveJob) -> Dict[str, Any]:
        with job.lock:
            latest_ep = job.episodes_history[-1] if job.episodes_history else None
            train_metrics = job.train_trace["metrics"] if job.train_trace else None
            test_metrics = job.backtest_result["metrics"] if job.backtest_result else None
            return {
                "id": job.run_id,
                "createdAt": job.created_at,
                "updatedAt": job.updated_at,
                "status": job.status,
                "config": asdict(job.config),
                "split": job.split_info,
                "completedEpisodes": len(job.episodes_history),
                "latestEpisode": latest_ep,
                "trainMetrics": train_metrics,
                "testMetrics": test_metrics,
                "hasWeights": job.agent_weights is not None and job.agent_weights.get("version") == 2,
                "hasBacktest": job.backtest_result is not None,
                "errorMessage": job.error_message,
            }

    def serialize_run_detail(self, job: ActiveJob) -> Dict[str, Any]:
        summary = self.serialize_run_summary(job)
        with job.lock:
            checkpoint = (
                {
                    "scaler": job.scaler,
                    "agentWeights": job.agent_weights,
                }
                if (job.agent_weights is not None and job.agent_weights.get("version") == 2 and job.scaler)
                else None
            )
            return {
                **summary,
                "episodes": list(job.episodes_history),
                "trainTrace": job.train_trace,
                "backtest": job.backtest_result,
                "checkpoint": checkpoint,
            }
