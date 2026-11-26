"""Realistic trading environment with action masking and institutional metrics."""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple


ACTION_HOLD = 0
ACTION_BUY = 1
ACTION_SELL = 2

ACTION_NAMES = {
    ACTION_HOLD: "Hold",
    ACTION_BUY: "Buy",
    ACTION_SELL: "Sell",
}


@dataclass
class EnvConfig:
    initial_capital: float = 10000.0
    fee_bps: float = 10.0
    slippage_bps: float = 5.0
    position_fraction: float = 1.0
    reward_mode: str = "log_return"
    annualization_factor: float = 252.0


@dataclass
class TradeRecord:
    step: int
    timestamp: int
    date: str
    side: str
    market_price: float
    fill_price: float
    quantity: float
    notional: float
    fee: float
    slippage_cost: float
    realized_pnl: Optional[float]
    return_pct: Optional[float]
    equity_after: float


@dataclass
class StepPoint:
    step: int
    timestamp: int
    date: str
    price: float
    equity: float
    benchmark_equity: float
    cash: float
    position: float
    action: int
    drawdown_pct: float


def valid_mask_from_state(state: List[float]) -> List[bool]:
    """Infer legal actions directly from portfolio position ratio in state."""
    pos_ratio = state[-4] if len(state) >= 4 else 0.0
    holding = pos_ratio > 0.05
    return [True, not holding, holding]


class TradingEnvironment:
    """Single-asset simulator with fees, slippage, action masking, and risk rewards."""

    def __init__(
        self,
        bars: List[Dict[str, Any]],
        scaled_features: List[List[float]],
        config: EnvConfig,
        warmup_bars: int = 0,
    ):
        if len(bars) != len(scaled_features):
            raise ValueError("bars and scaled_features must have identical length.")
        if len(bars) < 5:
            raise ValueError("Environment requires at least 5 bars.")

        self.bars = bars
        self.scaled_features = scaled_features
        self.config = config
        self.start_idx = min(max(0, warmup_bars), max(0, len(bars) - 5))
        self.end_idx = len(bars) - 1
        # Market features + [pos_ratio, unrealized_pnl, drawdown, holding_duration]
        self.state_dim = len(scaled_features[0]) + 4
        self.action_dim = 3

        self.reset()

    def reset(self) -> List[float]:
        self.idx = self.start_idx
        self.cash = float(self.config.initial_capital)
        self.shares = 0.0
        self.avg_entry_price = 0.0
        self.peak_equity = float(self.config.initial_capital)
        self.prev_equity = float(self.config.initial_capital)
        self.total_fees = 0.0
        self.total_slippage = 0.0
        self.trades: List[TradeRecord] = []
        self.equity_curve: List[StepPoint] = []
        self.step_returns: List[float] = []
        self.bars_in_market = 0
        self.bars_held = 0

        # Online moments for differential Sharpe reward
        self._ema_ret = 0.0
        self._ema_sq = 1e-6

        first_price = float(self.bars[self.start_idx]["close"])
        fee_rate = self.config.fee_bps / 10000.0
        slip_rate = self.config.slippage_bps / 10000.0
        bench_fill = first_price * (1.0 + slip_rate)
        self.bench_shares = (self.config.initial_capital / (1.0 + fee_rate)) / max(bench_fill, 1e-9)

        self._record_point(action=ACTION_HOLD)
        return self._get_state()

    def valid_action_mask(self) -> List[bool]:
        can_buy = self.shares <= 1e-12 and self.cash > max(1.0, self.config.initial_capital * 0.01)
        can_sell = self.shares > 1e-12
        return [True, can_buy, can_sell]

    def _current_equity(self, price: float) -> float:
        return self.cash + self.shares * price

    def _get_state(self) -> List[float]:
        bar = self.bars[self.idx]
        price = float(bar["close"])
        equity = self._current_equity(price)
        pos_ratio = (self.shares * price) / max(equity, 1e-9)
        if self.shares > 1e-12 and self.avg_entry_price > 0:
            unrealized = max(-1.0, min(1.0, (price - self.avg_entry_price) / self.avg_entry_price))
        else:
            unrealized = 0.0
        dd = (self.peak_equity - equity) / max(self.peak_equity, 1e-9)
        held_norm = min(1.0, self.bars_held / 30.0)
        return list(self.scaled_features[self.idx]) + [
            pos_ratio,
            unrealized * 5.0,
            min(1.0, dd * 4.0),
            held_norm,
        ]

    def _record_point(self, action: int) -> None:
        bar = self.bars[self.idx]
        price = float(bar["close"])
        equity = self._current_equity(price)
        if equity > self.peak_equity:
            self.peak_equity = equity
        dd_pct = ((equity - self.peak_equity) / max(self.peak_equity, 1e-9)) * 100.0
        bench_eq = self.bench_shares * price
        self.equity_curve.append(
            StepPoint(
                step=self.idx - self.start_idx,
                timestamp=int(bar["timestamp"]),
                date=str(bar["date"]),
                price=price,
                equity=equity,
                benchmark_equity=bench_eq,
                cash=self.cash,
                position=self.shares,
                action=action,
                drawdown_pct=dd_pct,
            )
        )

    def step(self, action: int) -> Tuple[List[float], float, bool, Dict[str, Any]]:
        if action not in (ACTION_HOLD, ACTION_BUY, ACTION_SELL):
            action = ACTION_HOLD

        bar = self.bars[self.idx]
        price = float(bar["close"])
        fee_rate = self.config.fee_bps / 10000.0
        slip_rate = self.config.slippage_bps / 10000.0

        executed_action = ACTION_HOLD
        equity_before = self._current_equity(price)
        realized_trade_ret = 0.0

        if action == ACTION_BUY and self.cash > max(1.0, self.config.initial_capital * 0.01):
            target_deploy = min(self.cash, equity_before * self.config.position_fraction)
            if target_deploy > 1.0 and self.shares <= 1e-12:
                fill_price = price * (1.0 + slip_rate)
                qty = target_deploy / (fill_price * (1.0 + fee_rate))
                notional = qty * fill_price
                fee = notional * fee_rate
                slippage_cost = qty * (fill_price - price)

                self.cash = max(0.0, self.cash - (notional + fee))
                self.shares += qty
                self.avg_entry_price = fill_price
                self.bars_held = 0
                self.total_fees += fee
                self.total_slippage += slippage_cost
                executed_action = ACTION_BUY

                self.trades.append(
                    TradeRecord(
                        step=self.idx - self.start_idx,
                        timestamp=int(bar["timestamp"]),
                        date=str(bar["date"]),
                        side="BUY",
                        market_price=price,
                        fill_price=fill_price,
                        quantity=qty,
                        notional=notional,
                        fee=fee,
                        slippage_cost=slippage_cost,
                        realized_pnl=None,
                        return_pct=None,
                        equity_after=self._current_equity(price),
                    )
                )

        elif action == ACTION_SELL and self.shares > 1e-12:
            fill_price = price * (1.0 - slip_rate)
            qty = self.shares
            notional = qty * fill_price
            fee = notional * fee_rate
            slippage_cost = qty * (price - fill_price)
            entry_cost = qty * self.avg_entry_price * (1.0 + fee_rate)
            net_proceeds = notional - fee
            realized_pnl = net_proceeds - entry_cost
            ret_pct = (realized_pnl / max(entry_cost, 1e-9)) * 100.0
            realized_trade_ret = realized_pnl / max(equity_before, 1e-9)

            self.cash += net_proceeds
            self.shares = 0.0
            self.avg_entry_price = 0.0
            self.bars_held = 0
            self.total_fees += fee
            self.total_slippage += slippage_cost
            executed_action = ACTION_SELL

            self.trades.append(
                TradeRecord(
                    step=self.idx - self.start_idx,
                    timestamp=int(bar["timestamp"]),
                    date=str(bar["date"]),
                    side="SELL",
                    market_price=price,
                    fill_price=fill_price,
                    quantity=qty,
                    notional=notional,
                    fee=fee,
                    slippage_cost=slippage_cost,
                    realized_pnl=realized_pnl,
                    return_pct=ret_pct,
                    equity_after=self._current_equity(price),
                )
            )

        self.idx += 1
        done = self.idx >= self.end_idx
        next_price = float(self.bars[self.idx]["close"])
        new_equity = self._current_equity(next_price)

        if self.shares > 1e-12:
            self.bars_in_market += 1
            self.bars_held += 1

        step_ret = (new_equity - self.prev_equity) / max(self.prev_equity, 1e-9)
        log_ret = math.log(max(new_equity, 1e-9) / max(self.prev_equity, 1e-9))
        mkt_log_ret = math.log(max(next_price, 1e-9) / max(price, 1e-9))
        self.step_returns.append(step_ret)

        if new_equity > self.peak_equity:
            self.peak_equity = new_equity
        dd_frac = (self.peak_equity - new_equity) / max(self.peak_equity, 1e-9)

        # Update exponential return variance for risk-adjusted shaping
        alpha_ema = 0.08
        prev_ema_ret = self._ema_ret
        prev_ema_sq = self._ema_sq
        self._ema_ret = (1.0 - alpha_ema) * self._ema_ret + alpha_ema * log_ret
        self._ema_sq = (1.0 - alpha_ema) * self._ema_sq + alpha_ema * (log_ret * log_ret)
        downside_pen = (min(0.0, log_ret) ** 2) * 18.0

        # Active alpha component rewards dodging drops and riding uptrends
        excess_ret = log_ret - 0.35 * mkt_log_ret
        close_bonus = 0.12 * realized_trade_ret if executed_action == ACTION_SELL else 0.0

        if self.config.reward_mode == "risk_adjusted":
            var_est = max(1e-6, prev_ema_sq - prev_ema_ret * prev_ema_ret)
            diff_sharpe = (log_ret - 0.5 * prev_ema_ret) / math.sqrt(var_est)
            reward = (0.45 * log_ret + 0.25 * excess_ret - downside_pen) * 100.0 + 0.08 * max(-3.0, min(3.0, diff_sharpe))
        elif self.config.reward_mode == "drawdown_penalized":
            dd_pen = 0.35 * dd_frac * (abs(min(0.0, log_ret)) + 0.008)
            reward = (0.85 * log_ret + 0.15 * excess_ret - dd_pen - downside_pen) * 100.0
        else:
            reward = (0.75 * log_ret + 0.25 * excess_ret + close_bonus) * 100.0

        reward = max(-10.0, min(10.0, reward))
        self.prev_equity = new_equity
        self._record_point(action=executed_action)

        next_state = self._get_state()
        info = {
            "equity": new_equity,
            "executedAction": executed_action,
            "stepReturn": step_ret,
            "validMask": self.valid_action_mask(),
        }
        return next_state, reward, done, info

    def compute_metrics(self) -> Dict[str, Any]:
        """Compute exact institutional performance metrics from the episode."""
        initial = float(self.config.initial_capital)
        if not self.equity_curve:
            return {}

        final_eq = self.equity_curve[-1].equity
        final_bench = self.equity_curve[-1].benchmark_equity
        total_return_pct = ((final_eq - initial) / initial) * 100.0
        benchmark_return_pct = ((final_bench - initial) / initial) * 100.0
        alpha_pct = total_return_pct - benchmark_return_pct
        max_dd_pct = min((pt.drawdown_pct for pt in self.equity_curve), default=0.0)

        rets = self.step_returns
        n_steps = len(rets)
        ann = float(self.config.annualization_factor)

        if n_steps >= 2:
            mean_r = sum(rets) / n_steps
            var_r = sum((r - mean_r) ** 2 for r in rets) / (n_steps - 1)
            std_r = math.sqrt(max(var_r, 0.0))
            ann_vol_pct = std_r * math.sqrt(ann) * 100.0
            sharpe = (mean_r / std_r) * math.sqrt(ann) if std_r > 1e-10 else 0.0

            downside = [min(0.0, r) ** 2 for r in rets]
            downside_dev = math.sqrt(sum(downside) / n_steps)
            sortino = (mean_r / downside_dev) * math.sqrt(ann) if downside_dev > 1e-10 else 0.0

            years = max(n_steps / ann, 1e-6)
            cagr_pct = ((final_eq / initial) ** (1.0 / years) - 1.0) * 100.0 if final_eq > 0 else -100.0
            calmar = (cagr_pct / abs(max_dd_pct)) if abs(max_dd_pct) > 1e-6 else 0.0
        else:
            ann_vol_pct = 0.0
            sharpe = 0.0
            sortino = 0.0
            cagr_pct = total_return_pct
            calmar = 0.0

        closed_trades = [t for t in self.trades if t.side == "SELL" and t.realized_pnl is not None]
        wins = [t for t in closed_trades if (t.realized_pnl or 0.0) > 0]
        losses = [t for t in closed_trades if (t.realized_pnl or 0.0) <= 0]

        win_rate_pct = (len(wins) / len(closed_trades) * 100.0) if closed_trades else None
        gross_profit = sum(t.realized_pnl or 0.0 for t in wins)
        gross_loss = abs(sum(t.realized_pnl or 0.0 for t in losses))
        if gross_loss > 1e-9:
            profit_factor: Optional[float] = gross_profit / gross_loss
        elif gross_profit > 0:
            profit_factor = 99.0
        else:
            profit_factor = None

        exposure_pct = (self.bars_in_market / max(1, n_steps)) * 100.0

        return {
            "initialCapital": round(initial, 2),
            "finalEquity": round(final_eq, 2),
            "benchmarkFinalEquity": round(final_bench, 2),
            "totalReturnPct": round(total_return_pct, 2),
            "benchmarkReturnPct": round(benchmark_return_pct, 2),
            "alphaPct": round(alpha_pct, 2),
            "cagrPct": round(max(-100.0, min(9999.0, cagr_pct)), 2),
            "maxDrawdownPct": round(max_dd_pct, 2),
            "annualizedVolatilityPct": round(ann_vol_pct, 2),
            "sharpeRatio": round(max(-20.0, min(20.0, sharpe)), 3),
            "sortinoRatio": round(max(-20.0, min(20.0, sortino)), 3),
            "calmarRatio": round(max(-20.0, min(20.0, calmar)), 3),
            "winRatePct": round(win_rate_pct, 2) if win_rate_pct is not None else None,
            "profitFactor": round(profit_factor, 2) if profit_factor is not None else None,
            "totalTrades": len(self.trades),
            "closedRoundTrips": len(closed_trades),
            "totalFeesPaid": round(self.total_fees, 2),
            "totalSlippagePaid": round(self.total_slippage, 2),
            "exposurePct": round(exposure_pct, 1),
        }

    def export_trace(self) -> Dict[str, Any]:
        return {
            "metrics": self.compute_metrics(),
            "equityCurve": [asdict(pt) for pt in self.equity_curve],
            "trades": [asdict(t) for t in self.trades],
        }
