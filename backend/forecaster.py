"""Quantitative price forecaster, chart pattern detector, and walk-forward accuracy auditor."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from agents import deserialize_agent
from market_data import (
    OHLCVBar,
    build_feature_matrix,
    fit_feature_scaler,
    transform_features,
)

# Compact collinearity-safe feature indices for Ridge forecasting
_FORECAST_FEAT_IDX = [0, 2, 4, 5, 6, 7, 8, 9, 11, 13, 14]
_FORECAST_CACHE: Dict[str, Dict[str, Any]] = {}
_MAX_CACHE_ENTRIES = 48


def _solve_linear_system(a_mat: List[List[float]], b_vec: List[float]) -> List[float]:
    """Solve Ax = b using Gaussian elimination with partial pivoting."""
    n = len(b_vec)
    aug = [list(a_mat[i]) + [b_vec[i]] for i in range(n)]

    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-12:
            return [0.0] * n
        aug[col], aug[pivot] = aug[pivot], aug[col]

        pv = aug[col][col]
        for c in range(col, n + 1):
            aug[col][c] /= pv

        for r in range(n):
            if r == col:
                continue
            factor = aug[r][col]
            if factor == 0.0:
                continue
            for c in range(col, n + 1):
                aug[r][c] -= factor * aug[col][c]

    return [aug[i][n] for i in range(n)]


def _fit_ridge(
    x_rows: List[List[float]], y_vals: List[float], l2_lambda: float = 18.0
) -> List[float]:
    """Fit L2-regularized linear model with unpenalized intercept."""
    n = len(x_rows)
    if n < 12:
        return [0.0] * (len(x_rows[0]) + 1 if x_rows else 1)

    d = len(x_rows[0]) + 1
    xtx = [[0.0] * d for _ in range(d)]
    xty = [0.0] * d

    # Mild exponential recency weighting favors recent market dynamics
    for idx in range(n):
        recency_w = 0.55 + 0.45 * ((idx + 1) / n)
        row = [1.0] + x_rows[idx]
        y = y_vals[idx]
        for i in range(d):
            ri = row[i] * recency_w
            xty[i] += ri * y
            for j in range(i, d):
                xtx[i][j] += ri * row[j]

    for i in range(d):
        for j in range(i):
            xtx[i][j] = xtx[j][i]
        # Regularize feature slopes, not intercept
        xtx[i][i] += 1e-4 if i == 0 else l2_lambda

    return _solve_linear_system(xtx, xty)


def _predict_ridge(weights: List[float], x_row: List[float]) -> float:
    val = weights[0]
    for i, x in enumerate(x_row):
        val += weights[i + 1] * x
    return val


def _extract_forecast_row(raw_row: List[float]) -> List[float]:
    return [raw_row[i] for i in _FORECAST_FEAT_IDX]


def _classify_regime(bars: List[OHLCVBar]) -> Dict[str, Any]:
    last = bars[-1]
    adx = last.adx14 if last.adx14 is not None else 18.0
    pdi = last.plus_di if last.plus_di is not None else 20.0
    mdi = last.minus_di if last.minus_di is not None else 20.0
    ema12 = last.ema12 or last.close
    ema26 = last.ema26 or last.close
    ema50 = last.ema50 or last.close

    vols = [b.volatility20 for b in bars[-120:] if b.volatility20 is not None]
    cur_vol = last.volatility20 or 0.015
    vol_pct_rank = (
        sum(1 for v in vols if v <= cur_vol) / len(vols) * 100.0 if vols else 50.0
    )

    bull_stack = last.close > ema12 > ema26 > ema50
    bear_stack = last.close < ema12 < ema26 < ema50
    up_bias = (pdi >= mdi) and (ema12 >= ema26)
    dn_bias = (mdi > pdi) and (ema12 < ema26)

    if vol_pct_rank >= 85.0 and adx < 22.0:
        label = "High-Volatility Chop"
        bias = "neutral"
    elif adx >= 25.0 and (bull_stack or up_bias):
        label = "Strong Uptrend"
        bias = "bullish"
    elif adx >= 25.0 and (bear_stack or dn_bias):
        label = "Strong Downtrend"
        bias = "bearish"
    elif adx >= 18.0 and up_bias:
        label = "Uptrend"
        bias = "bullish"
    elif adx >= 18.0 and dn_bias:
        label = "Downtrend"
        bias = "bearish"
    else:
        label = "Range-Bound"
        bias = "neutral"

    return {
        "label": label,
        "bias": bias,
        "adx14": round(adx, 1),
        "rsi14": round(last.rsi14, 1) if last.rsi14 is not None else None,
        "atrPct": round((last.atr14 or cur_vol) * 100.0, 2),
        "volatilityPercentile": round(vol_pct_rank, 1),
        "donchianPct": round((last.donchian_pos or 0.5) * 100.0, 1),
    }


def _compute_key_levels(bars: List[OHLCVBar]) -> Dict[str, Any]:
    last = bars[-1]
    c = last.close
    w20 = bars[-20:] if len(bars) >= 20 else bars
    w50 = bars[-50:] if len(bars) >= 50 else bars

    low20 = min(b.low for b in w20)
    high20 = max(b.high for b in w20)
    low50 = min(b.low for b in w50)
    high50 = max(b.high for b in w50)

    # Pick closest meaningful support below price and resistance above price
    sup_candidates = [lvl for lvl in (low20, last.ema50 or low20, low50) if lvl <= c * 0.999]
    res_candidates = [lvl for lvl in (high20, high50, last.ema50 or high20) if lvl >= c * 1.001]

    support = max(sup_candidates) if sup_candidates else low50
    resistance = min(res_candidates) if res_candidates else high50
    atr_abs = (last.atr14 or last.volatility20 or 0.015) * c

    return {
        "support": round(support, 4),
        "supportDistancePct": round(((support - c) / c) * 100.0, 2),
        "resistance": round(resistance, 4),
        "resistanceDistancePct": round(((resistance - c) / c) * 100.0, 2),
        "high20": round(high20, 4),
        "low20": round(low20, 4),
        "atrMove": round(atr_abs, 4),
    }


def _detect_patterns_and_events(
    bars: List[OHLCVBar], corporate_events: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], float]:
    """Detect active chart patterns and structural events from recent bars."""
    signals: List[Dict[str, Any]] = []
    if len(bars) < 30:
        return signals, 0.0

    last = bars[-1]
    prev = bars[-2]
    avg_vol20 = sum(b.volume for b in bars[-21:-1]) / 20.0
    rel_vol = last.volume / max(avg_vol20, 1.0)

    # 1. 20-step high breakout or low breakdown
    prior20_hi = max(b.high for b in bars[-21:-1])
    prior20_lo = min(b.low for b in bars[-21:-1])
    if last.close > prior20_hi:
        strength = min(1.0, 0.55 + 0.25 * min(rel_vol, 2.0))
        signals.append({
            "name": "20-Day High Breakout",
            "category": "Breakout",
            "bias": "bullish",
            "strength": round(strength, 2),
            "evidence": f"Closed at {last.close:.2f}, above the recent high of {prior20_hi:.2f} with {rel_vol:.1f}x normal volume.",
        })
    elif last.close < prior20_lo:
        strength = min(1.0, 0.55 + 0.25 * min(rel_vol, 2.0))
        signals.append({
            "name": "20-Day Low Breakdown",
            "category": "Breakdown",
            "bias": "bearish",
            "strength": round(strength, 2),
            "evidence": f"Closed at {last.close:.2f}, below the recent low of {prior20_lo:.2f} with {rel_vol:.1f}x normal volume.",
        })

    # 2. Tight range squeeze
    bbws = [b.bb_width for b in bars[-100:] if b.bb_width is not None]
    if last.bb_width is not None and len(bbws) >= 25:
        rank = sum(1 for v in bbws if v <= last.bb_width) / len(bbws)
        if rank <= 0.18:
            signals.append({
                "name": "Quiet Range Squeeze",
                "category": "Volatility",
                "bias": "neutral",
                "strength": round(1.0 - rank, 2),
                "evidence": f"Price swings narrowed to {last.bb_width * 100:.1f}%, tighter than {100 - int(rank * 100)}% of recent sessions.",
            })

    # 3. Heavy volume surge
    if rel_vol >= 1.75:
        up_day = last.close >= last.open
        signals.append({
            "name": "Heavy Buying Volume" if up_day else "Heavy Selling Volume",
            "category": "Volume",
            "bias": "bullish" if up_day else "bearish",
            "strength": round(min(1.0, (rel_vol - 1.0) / 1.8), 2),
            "evidence": f"Trading volume hit {rel_vol:.1f}x the recent average on a {'rising' if up_day else 'falling'} session.",
        })

    # 4. Short vs medium trend crossover or alignment
    if last.ema12 is not None and last.ema26 is not None:
        cross_idx = None
        cross_dir = None
        for back in range(1, min(6, len(bars))):
            b_cur = bars[-back]
            b_prev = bars[-back - 1]
            if None in (b_cur.ema12, b_cur.ema26, b_prev.ema12, b_prev.ema26):
                continue
            if b_prev.ema12 <= b_prev.ema26 and b_cur.ema12 > b_cur.ema26:
                cross_idx = back
                cross_dir = "bullish"
                break
            if b_prev.ema12 >= b_prev.ema26 and b_cur.ema12 < b_cur.ema26:
                cross_idx = back
                cross_dir = "bearish"
                break

        if cross_idx is not None and cross_dir is not None:
            signals.append({
                "name": "Upward Trend Cross" if cross_dir == "bullish" else "Downward Trend Cross",
                "category": "Momentum",
                "bias": cross_dir,
                "strength": 0.72,
                "evidence": f"Short-term average moved {'above' if cross_dir == 'bullish' else 'below'} the medium-term average {cross_idx - 1} step(s) ago.",
            })
        elif last.ema50 is not None:
            if last.close > last.ema12 > last.ema26 > last.ema50:
                signals.append({
                    "name": "Steady Uptrend",
                    "category": "Trend",
                    "bias": "bullish",
                    "strength": 0.68,
                    "evidence": f"Price ({last.close:.2f}) stays cleanly above its rising short, medium, and 50-step ({last.ema50:.2f}) averages.",
                })
            elif last.close < last.ema12 < last.ema26 < last.ema50:
                signals.append({
                    "name": "Steady Downtrend",
                    "category": "Trend",
                    "bias": "bearish",
                    "strength": 0.68,
                    "evidence": f"Price ({last.close:.2f}) trades below its falling short, medium, and 50-step ({last.ema50:.2f}) averages.",
                })

    # 5. Momentum shift over last 15 steps
    win15 = bars[-15:]
    rsi_vals = [b.rsi14 for b in win15 if b.rsi14 is not None]
    if len(rsi_vals) >= 12 and last.rsi14 is not None:
        early_slice = win15[:8]
        late_slice = win15[8:]
        e_low_bar = min(early_slice, key=lambda b: b.close)
        l_low_bar = min(late_slice, key=lambda b: b.close)
        e_hi_bar = max(early_slice, key=lambda b: b.close)
        l_hi_bar = max(late_slice, key=lambda b: b.close)

        if (
            e_low_bar.rsi14 is not None
            and l_low_bar.rsi14 is not None
            and l_low_bar.close < e_low_bar.close * 0.992
            and l_low_bar.rsi14 > e_low_bar.rsi14 + 4.0
            and last.rsi14 < 48.0
        ):
            signals.append({
                "name": "Upward Momentum Shift",
                "category": "Reversal",
                "bias": "bullish",
                "strength": 0.74,
                "evidence": f"Price dipped to {l_low_bar.close:.2f} while buying momentum strengthened ({e_low_bar.rsi14:.0f} to {l_low_bar.rsi14:.0f}).",
            })
        elif (
            e_hi_bar.rsi14 is not None
            and l_hi_bar.rsi14 is not None
            and l_hi_bar.close > e_hi_bar.close * 1.008
            and l_hi_bar.rsi14 < e_hi_bar.rsi14 - 4.0
            and last.rsi14 > 52.0
        ):
            signals.append({
                "name": "Downward Momentum Shift",
                "category": "Reversal",
                "bias": "bearish",
                "strength": 0.74,
                "evidence": f"Price reached {l_hi_bar.close:.2f} while buying momentum faded ({e_hi_bar.rsi14:.0f} down to {l_hi_bar.rsi14:.0f}).",
            })

    # 6. Reversal candle or strong wick rejection
    prev_body = prev.close - prev.open
    cur_body = last.close - last.open
    cur_range = max(last.high - last.low, last.close * 1e-5)
    lower_wick = min(last.open, last.close) - last.low
    upper_wick = last.high - max(last.open, last.close)

    if prev_body < 0 and cur_body > 0 and last.open <= prev.close and last.close >= prev.open and abs(cur_body) > abs(prev_body) * 1.05:
        signals.append({
            "name": "Strong Upward Reversal",
            "category": "Price Action",
            "bias": "bullish",
            "strength": 0.65,
            "evidence": f"Latest rising session fully erased the prior drop ({prev.open:.2f} to {prev.close:.2f}).",
        })
    elif prev_body > 0 and cur_body < 0 and last.open >= prev.close and last.close <= prev.open and abs(cur_body) > abs(prev_body) * 1.05:
        signals.append({
            "name": "Strong Downward Reversal",
            "category": "Price Action",
            "bias": "bearish",
            "strength": 0.65,
            "evidence": f"Latest falling session fully erased the prior gain ({prev.open:.2f} to {prev.close:.2f}).",
        })
    elif lower_wick / cur_range >= 0.58 and abs(cur_body) / cur_range <= 0.30:
        signals.append({
            "name": "Dip Buying Bounce",
            "category": "Price Action",
            "bias": "bullish",
            "strength": 0.54,
            "evidence": f"Buyers pushed price back up from the session low ({int((lower_wick / cur_range) * 100)}% lower tail).",
        })
    elif upper_wick / cur_range >= 0.58 and abs(cur_body) / cur_range <= 0.30:
        signals.append({
            "name": "High Price Pullback",
            "category": "Price Action",
            "bias": "bearish",
            "strength": 0.54,
            "evidence": f"Sellers pushed price back down from the session high ({int((upper_wick / cur_range) * 100)}% upper tail).",
        })

    # 7. Price stretched far from 20-step average
    if last.bb_z is not None:
        if last.bb_z >= 2.0 and (last.rsi14 or 50.0) >= 68.0:
            signals.append({
                "name": "Price Stretched High",
                "category": "Pullback Risk",
                "bias": "bearish",
                "strength": round(min(0.85, (last.bb_z - 1.5) * 0.45), 2),
                "evidence": f"Trading well above its 20-step average with high momentum ({last.rsi14:.0f}).",
            })
        elif last.bb_z <= -2.0 and (last.rsi14 or 50.0) <= 32.0:
            signals.append({
                "name": "Price Stretched Low",
                "category": "Bounce Potential",
                "bias": "bullish",
                "strength": round(min(0.85, (abs(last.bb_z) - 1.5) * 0.45), 2),
                "evidence": f"Trading well below its 20-step average with oversold momentum ({last.rsi14:.0f}).",
            })

    # 8. Recent corporate event (dividends or stock splits)
    if corporate_events:
        latest_ts = last.timestamp
        cutoff_ts = latest_ts - 45 * 86400
        recent_corp = [ev for ev in corporate_events if ev.get("timestamp", 0) >= cutoff_ts]
        if recent_corp:
            ev = recent_corp[-1]
            signals.append({
                "name": ev["label"],
                "category": "Company Event",
                "bias": "neutral",
                "strength": 0.4,
                "evidence": f"Recorded on {ev['date']} in market data.",
            })

    # Aggregate directional pattern score in [-1, 1]
    signed_sum = 0.0
    weight_sum = 0.0
    for sig in signals:
        if sig["bias"] == "bullish":
            signed_sum += sig["strength"]
            weight_sum += sig["strength"]
        elif sig["bias"] == "bearish":
            signed_sum -= sig["strength"]
            weight_sum += sig["strength"]
    pattern_score = max(-1.0, min(1.0, signed_sum / max(1.2, weight_sum)))
    return signals, pattern_score


def _walk_forward_audit(
    bars: List[OHLCVBar],
    raw_features: List[List[float]],
    horizon: int = 5,
) -> Dict[str, Any]:
    """Run rolling zero-leakage walk-forward evaluation on past bars."""
    n = len(bars)
    start_idx = 30
    if n < start_idx + horizon + 45:
        return {
            "horizonBars": horizon,
            "samplesEvaluated": 0,
            "directionalAccuracyPct": None,
            "meanAbsErrorPct": None,
            "baselineUpPct": None,
            "residualStd": None,
        }

    # Evaluate across the most recent 25% of bars in 3 strictly causal folds
    eval_total = min(120, max(24, (n - start_idx - horizon) // 4))
    eval_start = n - horizon - eval_total
    fold_size = max(8, eval_total // 3)

    correct = 0
    up_count = 0
    abs_errs: List[float] = []
    sq_resids: List[float] = []
    total = 0

    for fold_begin in range(eval_start, n - horizon, fold_size):
        fold_end = min(n - horizon, fold_begin + fold_size)
        fit_end = fold_begin - horizon
        if fit_end <= start_idx + 15:
            continue

        x_train_raw = [_extract_forecast_row(raw_features[i]) for i in range(start_idx, fit_end)]
        y_train = [
            math.log(max(bars[i + horizon].close, 1e-9) / max(bars[i].close, 1e-9))
            for i in range(start_idx, fit_end)
        ]
        means, stds = fit_feature_scaler(x_train_raw)
        x_train = transform_features(x_train_raw, means, stds)
        w = _fit_ridge(x_train, y_train, l2_lambda=24.0)

        for t in range(fold_begin, fold_end):
            x_t = transform_features([_extract_forecast_row(raw_features[t])], means, stds)[0]
            pred_ret = _predict_ridge(w, x_t)
            actual_ret = math.log(max(bars[t + horizon].close, 1e-9) / max(bars[t].close, 1e-9))

            if (pred_ret >= 0.0 and actual_ret >= 0.0) or (pred_ret < 0.0 and actual_ret < 0.0):
                correct += 1
            if actual_ret >= 0.0:
                up_count += 1

            pred_price = bars[t].close * math.exp(max(-0.35, min(0.35, pred_ret)))
            actual_price = bars[t + horizon].close
            abs_errs.append(abs(pred_price - actual_price) / max(actual_price, 1e-9) * 100.0)
            sq_resids.append((actual_ret - pred_ret) ** 2)
            total += 1

    if total == 0:
        return {
            "horizonBars": horizon,
            "samplesEvaluated": 0,
            "directionalAccuracyPct": None,
            "meanAbsErrorPct": None,
            "baselineUpPct": None,
            "residualStd": None,
        }

    resid_std = math.sqrt(sum(sq_resids) / total)
    return {
        "horizonBars": horizon,
        "samplesEvaluated": total,
        "directionalAccuracyPct": round((correct / total) * 100.0, 1),
        "meanAbsErrorPct": round(sum(abs_errs) / total, 2),
        "baselineUpPct": round((up_count / total) * 100.0, 1),
        "residualStd": round(resid_std, 5),
    }


def _next_step_label(last_ts: int, step: int, interval: str) -> Tuple[int, str]:
    delta = 3600 * step if interval == "1h" else 86400 * step
    ts = last_ts + delta
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    label = dt.strftime("%Y-%m-%d %H:%M") if interval == "1h" else dt.strftime("%Y-%m-%d")
    return ts, label


def build_market_forecast(
    market: Dict[str, Any],
    agent_weights: Optional[Dict[str, Any]] = None,
    agent_scaler: Optional[Dict[str, Any]] = None,
    run_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Compute multi-horizon statistical price forecast, pattern events, and RL policy fusion."""
    bars_dicts = market["bars"]
    if len(bars_dicts) < 40:
        raise ValueError("Need at least 40 historical bars to compute a forecast.")

    meta = market["meta"]
    run_key = f"{run_meta.get('id', 'none')}:{run_meta.get('updatedAt', '')}" if run_meta else "none"
    cache_key = f"{meta['symbol']}|{meta['interval']}|{meta['range']}|{bars_dicts[-1]['timestamp']}|{run_key}"
    if cache_key in _FORECAST_CACHE:
        return _FORECAST_CACHE[cache_key]

    valid_fields = set(OHLCVBar.__dataclass_fields__.keys())
    bars = [OHLCVBar(**{k: v for k, v in b.items() if k in valid_fields}) for b in bars_dicts]
    raw_features = build_feature_matrix(bars)

    n = len(bars)
    start_idx = 30 if n > 65 else 5
    last_bar = bars[-1]
    last_close = last_bar.close
    step_vol = last_bar.volatility20 or last_bar.atr14 or 0.015

    # Fit regularized multi-horizon Ridge models strictly on historical pairs
    horizons = (1, 3, 5, 10)
    pred_log_rets: Dict[int, float] = {}
    horizon_sigma: Dict[int, float] = {}

    for h in horizons:
        end_i = n - h
        if end_i <= start_idx + 15:
            pred_log_rets[h] = 0.0
            horizon_sigma[h] = step_vol * math.sqrt(h)
            continue

        x_train_raw = [_extract_forecast_row(raw_features[i]) for i in range(start_idx, end_i)]
        y_train = [
            math.log(max(bars[i + h].close, 1e-9) / max(bars[i].close, 1e-9))
            for i in range(start_idx, end_i)
        ]
        means, stds = fit_feature_scaler(x_train_raw)
        x_train = transform_features(x_train_raw, means, stds)
        w = _fit_ridge(x_train, y_train, l2_lambda=24.0)

        x_last = transform_features([_extract_forecast_row(raw_features[-1])], means, stds)[0]
        raw_pred = _predict_ridge(w, x_last)

        # Bound projection realistically within +/- 2.5 volatility units
        cap = max(0.02, 2.2 * step_vol * math.sqrt(h))
        pred_log_rets[h] = max(-cap, min(cap, raw_pred))

        # Measure in-sample residual dispersion blended with realized volatility
        resids = [(_predict_ridge(w, x_train[k]) - y_train[k]) ** 2 for k in range(len(x_train))]
        rmse = math.sqrt(sum(resids) / max(1, len(resids)))
        horizon_sigma[h] = 0.55 * rmse + 0.45 * (step_vol * math.sqrt(h))

    # Walk-forward historical accuracy audit on 5-bar horizon
    audit = _walk_forward_audit(bars, raw_features, horizon=5)
    if audit["residualStd"]:
        # Calibrate 5-bar cone width using actual out-of-sample residual error
        horizon_sigma[5] = 0.65 * audit["residualStd"] + 0.35 * horizon_sigma[5]

    regime = _classify_regime(bars)
    key_levels = _compute_key_levels(bars)
    patterns, pattern_score = _detect_patterns_and_events(bars, meta.get("corporateEvents") or [])

    # Extract trained RL agent policy conviction on the latest market state
    rl_signal: Optional[Dict[str, Any]] = None
    rl_score: Optional[float] = None
    if agent_weights and agent_scaler and run_meta:
        means_rl = agent_scaler.get("means") or []
        stds_rl = agent_scaler.get("stds") or []
        if len(means_rl) == len(raw_features[-1]) and len(stds_rl) == len(raw_features[-1]):
            try:
                agent = deserialize_agent(agent_weights)
                norm_last = transform_features([raw_features[-1]], means_rl, stds_rl)[0]
                # Evaluate both flat (entry) and holding (exit) policy states
                flat_state = norm_last + [0.0, 0.0, 0.0, 0.0]
                held_state = norm_last + [1.0, 0.0, 0.0, 0.25]
                sig_flat = agent.predict_signal(flat_state, valid_mask=[True, True, False])
                sig_held = agent.predict_signal(held_state, valid_mask=[True, False, True])

                buy_prob = float(sig_flat["buyProb"])
                sell_prob = float(sig_held["sellProb"])
                hold_prob = max(0.0, 1.0 - max(buy_prob, sell_prob))
                net = buy_prob - sell_prob
                rl_score = max(-1.0, min(1.0, net * 1.4))

                if buy_prob >= 0.55 and buy_prob > sell_prob:
                    stance = "Buy"
                elif sell_prob >= 0.55 and sell_prob > buy_prob:
                    stance = "Sell / Defensive"
                else:
                    stance = "Hold / Neutral"

                rl_signal = {
                    "runId": run_meta["id"],
                    "algorithm": run_meta["algorithm"],
                    "symbol": run_meta["symbol"],
                    "stance": stance,
                    "buyProb": round(buy_prob * 100.0, 1),
                    "holdProb": round(hold_prob * 100.0, 1),
                    "sellProb": round(sell_prob * 100.0, 1),
                    "netScore": round(rl_score, 3),
                }
            except Exception:
                rl_signal = None
                rl_score = None

    # Normalize statistical 5-bar signal into [-1, 1]
    stat_z = pred_log_rets[5] / max(horizon_sigma[5], 1e-4)
    stat_score = math.tanh(stat_z * 1.15)

    # Composite trend score fusing real mathematical components
    if rl_score is not None:
        composite_score = 0.50 * stat_score + 0.25 * pattern_score + 0.25 * rl_score
    else:
        composite_score = 0.65 * stat_score + 0.35 * pattern_score
    composite_score = max(-1.0, min(1.0, composite_score))

    if composite_score >= 0.30:
        outlook = "Bullish"
    elif composite_score >= 0.10:
        outlook = "Moderately Bullish"
    elif composite_score <= -0.30:
        outlook = "Bearish"
    elif composite_score <= -0.10:
        outlook = "Moderately Bearish"
    else:
        outlook = "Neutral"

    # Build smooth 10-step projected path with 80% volatility cone (1.28 sigma)
    anchor_steps = [0, 1, 3, 5, 10]
    anchor_rets = [0.0, pred_log_rets[1], pred_log_rets[3], pred_log_rets[5], pred_log_rets[10]]
    anchor_sigs = [0.0, horizon_sigma[1], horizon_sigma[3], horizon_sigma[5], horizon_sigma[10]]

    def _interp(step_k: int, xs: List[int], ys: List[float]) -> float:
        for i in range(len(xs) - 1):
            if xs[i] <= step_k <= xs[i + 1]:
                t = (step_k - xs[i]) / (xs[i + 1] - xs[i])
                return ys[i] + t * (ys[i + 1] - ys[i])
        return ys[-1]

    trajectory: List[Dict[str, Any]] = []
    for k in range(1, 11):
        # Gentle structural nudge keeps trajectory faithful to Ridge math
        lr_k = _interp(k, anchor_steps, anchor_rets)
        sig_k = _interp(k, anchor_steps, anchor_sigs)
        proj = last_close * math.exp(lr_k)
        hi = last_close * math.exp(lr_k + 1.28 * sig_k)
        lo = last_close * math.exp(lr_k - 1.28 * sig_k)
        ts_k, date_k = _next_step_label(last_bar.timestamp, k, meta["interval"])
        trajectory.append({
            "step": k,
            "timestamp": ts_k,
            "date": date_k,
            "projectedPrice": round(proj, 4),
            "upperBand": round(hi, 4),
            "lowerBand": round(lo, 4),
            "expectedReturnPct": round((proj / last_close - 1.0) * 100.0, 2),
        })

    horizons_summary = []
    for h in (1, 5, 10):
        pt = trajectory[h - 1]
        horizons_summary.append({
            "horizonBars": h,
            "label": f"+{h} {'hour' if meta['interval'] == '1h' else 'day'}{'s' if h > 1 else ''}",
            "targetDate": pt["date"],
            "projectedPrice": pt["projectedPrice"],
            "expectedReturnPct": pt["expectedReturnPct"],
            "lowBand": pt["lowerBand"],
            "highBand": pt["upperBand"],
        })

    result = {
        "symbol": meta["symbol"],
        "currency": meta["currency"],
        "interval": meta["interval"],
        "asOfDate": last_bar.date,
        "lastClose": round(last_close, 4),
        "outlook": outlook,
        "compositeScore": round(composite_score, 3),
        "components": {
            "statisticalScore": round(stat_score, 3),
            "patternScore": round(pattern_score, 3),
            "rlScore": round(rl_score, 3) if rl_score is not None else None,
        },
        "regime": regime,
        "keyLevels": key_levels,
        "horizons": horizons_summary,
        "trajectory": trajectory,
        "patterns": patterns,
        "rlSignal": rl_signal,
        "audit": audit,
    }

    if len(_FORECAST_CACHE) >= _MAX_CACHE_ENTRIES:
        _FORECAST_CACHE.clear()
    _FORECAST_CACHE[cache_key] = result
    return result
