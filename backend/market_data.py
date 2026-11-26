"""Real market data ingestion, SQLite caching, and causal technical indicators."""

from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
CACHE_DB_PATH = os.path.join(CACHE_DIR, "market_cache.sqlite")
CACHE_VERSION = "v2"

_HOST_LOCKS: Dict[str, threading.Lock] = {}
_HOST_LAST_REQ: Dict[str, float] = {}
_HOST_MIN_SPACING = 0.35

CURATED_INSTRUMENTS = [
    {"symbol": "AAPL", "name": "Apple Inc.", "assetClass": "Equity", "source": "yahoo"},
    {"symbol": "MSFT", "name": "Microsoft Corp.", "assetClass": "Equity", "source": "yahoo"},
    {"symbol": "NVDA", "name": "NVIDIA Corp.", "assetClass": "Equity", "source": "yahoo"},
    {"symbol": "SPY", "name": "SPDR S&P 500 ETF", "assetClass": "ETF", "source": "yahoo"},
    {"symbol": "QQQ", "name": "Invesco QQQ Trust", "assetClass": "ETF", "source": "yahoo"},
    {"symbol": "GLD", "name": "SPDR Gold Shares", "assetClass": "Commodity", "source": "yahoo"},
    {"symbol": "TLT", "name": "iShares 20+ Year Treasury", "assetClass": "Fixed Income", "source": "yahoo"},
    {"symbol": "BTC-USD", "name": "Bitcoin / USD", "assetClass": "Crypto", "source": "binance"},
    {"symbol": "ETH-USD", "name": "Ethereum / USD", "assetClass": "Crypto", "source": "binance"},
    {"symbol": "SOL-USD", "name": "Solana / USD", "assetClass": "Crypto", "source": "binance"},
]

BINANCE_SYMBOL_MAP = {
    "BTC-USD": "BTCUSDT",
    "ETH-USD": "ETHUSDT",
    "SOL-USD": "SOLUSDT",
    "ADA-USD": "ADAUSDT",
    "AVAX-USD": "AVAXUSDT",
    "LINK-USD": "LINKUSDT",
    "DOGE-USD": "DOGEUSDT",
    "XRP-USD": "XRPUSDT",
}

ALLOWED_RANGES = {"6mo", "1y", "2y", "5y"}
ALLOWED_INTERVALS = {"1d", "1h"}
SYMBOL_REGEX = re.compile(r"^[A-Z0-9.\-^=]{1,15}$")


@dataclass
class OHLCVBar:
    timestamp: int
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    sma10: Optional[float] = None
    sma30: Optional[float] = None
    ema12: Optional[float] = None
    ema26: Optional[float] = None
    ema50: Optional[float] = None
    rsi14: Optional[float] = None
    volatility20: Optional[float] = None
    macd: Optional[float] = None
    macd_hist: Optional[float] = None
    bb_z: Optional[float] = None
    bb_width: Optional[float] = None
    atr14: Optional[float] = None
    adx14: Optional[float] = None
    plus_di: Optional[float] = None
    minus_di: Optional[float] = None
    donchian_pos: Optional[float] = None
    obv_slope: Optional[float] = None


class MarketDataError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _init_cache_db() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS market_cache (
                cache_key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                fetched_at REAL NOT NULL,
                source TEXT NOT NULL
            )
            """
        )
        conn.commit()


def _rate_limited_get(url: str, host_key: str, timeout: float = 10.0) -> bytes:
    if host_key not in _HOST_LOCKS:
        _HOST_LOCKS[host_key] = threading.Lock()
    with _HOST_LOCKS[host_key]:
        now = time.monotonic()
        last = _HOST_LAST_REQ.get(host_key, 0.0)
        wait = _HOST_MIN_SPACING - (now - last)
        if wait > 0:
            time.sleep(wait)
        _HOST_LAST_REQ[host_key] = time.monotonic()

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) MeridianQuant/2.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def validate_symbol(raw_symbol: str) -> str:
    symbol = (raw_symbol or "").strip().upper()
    if not symbol or not SYMBOL_REGEX.match(symbol):
        raise MarketDataError(
            "Invalid ticker symbol. Use standard symbols like AAPL, SPY, or BTC-USD.",
            status_code=400,
        )
    return symbol


def _range_to_days(range_str: str) -> int:
    mapping = {"6mo": 185, "1y": 365, "2y": 730, "5y": 1825}
    return mapping.get(range_str, 730)


def _fetch_binance(symbol: str, interval: str, range_str: str) -> Tuple[List[OHLCVBar], Dict[str, Any]]:
    pair = BINANCE_SYMBOL_MAP.get(symbol)
    if not pair:
        raise MarketDataError(f"{symbol} is not mapped for Binance.", 404)

    days = _range_to_days(range_str)
    if interval == "1h":
        limit = min(1000, max(240, days * 24))
        binance_interval = "1h"
    else:
        limit = min(1000, max(120, days))
        binance_interval = "1d"

    url = (
        f"https://api.binance.com/api/v3/klines?"
        f"symbol={urllib.parse.quote(pair)}&interval={binance_interval}&limit={limit}"
    )
    raw = _rate_limited_get(url, "api.binance.com")
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, list) or len(data) < 40:
        raise MarketDataError(f"Insufficient historical bars returned by Binance for {symbol}.", 502)

    bars: List[OHLCVBar] = []
    for row in data:
        ts = int(row[0] // 1000)
        o, h, l, c, v = float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])
        if c <= 0 or math.isnan(c):
            continue
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        date_str = dt.strftime("%Y-%m-%d %H:%M") if interval == "1h" else dt.strftime("%Y-%m-%d")
        bars.append(OHLCVBar(timestamp=ts, date=date_str, open=o, high=h, low=l, close=c, volume=v))

    name = next((i["name"] for i in CURATED_INSTRUMENTS if i["symbol"] == symbol), symbol)
    meta = {
        "symbol": symbol,
        "name": name,
        "currency": "USD",
        "exchange": "Binance Spot",
        "source": "Binance Public Market API",
        "interval": interval,
        "range": range_str,
        "annualizationFactor": 365 * 24 if interval == "1h" else 365,
        "corporateEvents": [],
    }
    return bars, meta


def _fetch_coinbase(symbol: str, interval: str, range_str: str) -> Tuple[List[OHLCVBar], Dict[str, Any]]:
    granularity = 3600 if interval == "1h" else 86400
    url = (
        f"https://api.exchange.coinbase.com/products/"
        f"{urllib.parse.quote(symbol)}/candles?granularity={granularity}"
    )
    raw = _rate_limited_get(url, "api.exchange.coinbase.com")
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, list) or len(data) < 40:
        raise MarketDataError(f"Insufficient candles returned by Coinbase for {symbol}.", 502)

    data.sort(key=lambda r: r[0])
    bars: List[OHLCVBar] = []
    for row in data:
        ts = int(row[0])
        l, h, o, c, v = float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])
        if c <= 0 or math.isnan(c):
            continue
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        date_str = dt.strftime("%Y-%m-%d %H:%M") if interval == "1h" else dt.strftime("%Y-%m-%d")
        bars.append(OHLCVBar(timestamp=ts, date=date_str, open=o, high=h, low=l, close=c, volume=v))

    name = next((i["name"] for i in CURATED_INSTRUMENTS if i["symbol"] == symbol), symbol)
    meta = {
        "symbol": symbol,
        "name": name,
        "currency": "USD",
        "exchange": "Coinbase Exchange",
        "source": "Coinbase Exchange Public API",
        "interval": interval,
        "range": range_str,
        "annualizationFactor": 365 * 24 if interval == "1h" else 365,
        "corporateEvents": [],
    }
    return bars, meta


def _fetch_yahoo(symbol: str, interval: str, range_str: str) -> Tuple[List[OHLCVBar], Dict[str, Any]]:
    yf_range = "6mo" if (interval == "1h" and range_str in ("2y", "5y")) else range_str
    hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
    last_err: Optional[Exception] = None
    payload = None

    for host in hosts:
        url = (
            f"https://{host}/v8/finance/chart/{urllib.parse.quote(symbol)}"
            f"?range={urllib.parse.quote(yf_range)}&interval={urllib.parse.quote(interval)}"
            f"&includePrePost=false&events=div,splits"
        )
        try:
            raw = _rate_limited_get(url, host)
            payload = json.loads(raw.decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise MarketDataError(f"Ticker '{symbol}' was not found on Yahoo Finance.", 404)
            last_err = e
        except Exception as e:
            last_err = e

    if payload is None:
        raise MarketDataError(f"Upstream Yahoo Finance request failed: {last_err}", 502)

    chart = payload.get("chart") or {}
    if chart.get("error"):
        desc = chart["error"].get("description") or f"Symbol '{symbol}' not found."
        raise MarketDataError(desc, 404)

    results = chart.get("result") or []
    if not results:
        raise MarketDataError(f"No historical data returned for '{symbol}'.", 404)

    result = results[0]
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    bars: List[OHLCVBar] = []
    for i, ts in enumerate(timestamps):
        if i >= len(closes):
            break
        c = closes[i]
        o = opens[i] if i < len(opens) else c
        h = highs[i] if i < len(highs) else c
        l = lows[i] if i < len(lows) else c
        v = volumes[i] if i < len(volumes) else 0.0
        if c is None or o is None or h is None or l is None:
            continue
        c_f, o_f, h_f, l_f = float(c), float(o), float(h), float(l)
        v_f = float(v) if v is not None else 0.0
        if c_f <= 0 or math.isnan(c_f):
            continue
        dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        date_str = dt.strftime("%Y-%m-%d %H:%M") if interval == "1h" else dt.strftime("%Y-%m-%d")
        bars.append(
            OHLCVBar(
                timestamp=int(ts),
                date=date_str,
                open=o_f,
                high=h_f,
                low=l_f,
                close=c_f,
                volume=max(0.0, v_f),
            )
        )

    if len(bars) < 40:
        raise MarketDataError(
            f"Only {len(bars)} valid bars returned for '{symbol}'. Need at least 40 bars.",
            422,
        )

    # Extract real dividend and split events from chart payload
    corp_events: List[Dict[str, Any]] = []
    events_raw = result.get("events") or {}
    for ev_ts, ev in (events_raw.get("dividends") or {}).items():
        try:
            ts_int = int(ev.get("date", ev_ts))
            amt = float(ev.get("amount", 0.0))
            if amt > 0:
                corp_events.append({
                    "type": "dividend",
                    "timestamp": ts_int,
                    "date": datetime.fromtimestamp(ts_int, tz=timezone.utc).strftime("%Y-%m-%d"),
                    "label": f"Dividend ${amt:.2f}",
                })
        except Exception:
            pass
    for ev_ts, ev in (events_raw.get("splits") or {}).items():
        try:
            ts_int = int(ev.get("date", ev_ts))
            ratio = str(ev.get("splitRatio") or "")
            if ratio:
                corp_events.append({
                    "type": "split",
                    "timestamp": ts_int,
                    "date": datetime.fromtimestamp(ts_int, tz=timezone.utc).strftime("%Y-%m-%d"),
                    "label": f"Stock split {ratio}",
                })
        except Exception:
            pass
    corp_events.sort(key=lambda x: x["timestamp"])

    meta_raw = result.get("meta") or {}
    is_crypto = symbol.endswith("-USD") or meta_raw.get("instrumentType") == "CRYPTOCURRENCY"
    ann_factor = (365 * 24 if is_crypto else 252 * 6.5) if interval == "1h" else (365 if is_crypto else 252)

    curated_name = next((i["name"] for i in CURATED_INSTRUMENTS if i["symbol"] == symbol), None)
    meta = {
        "symbol": symbol,
        "name": meta_raw.get("shortName") or meta_raw.get("longName") or curated_name or symbol,
        "currency": meta_raw.get("currency") or "USD",
        "exchange": meta_raw.get("exchangeName") or "Market",
        "source": "Yahoo Finance Chart API",
        "interval": interval,
        "range": yf_range,
        "annualizationFactor": ann_factor,
        "corporateEvents": corp_events[-8:],
    }
    return bars, meta


def compute_indicators(bars: List[OHLCVBar]) -> List[OHLCVBar]:
    """Compute strictly causal technical indicators on OHLCV bars."""
    n = len(bars)
    if n == 0:
        return bars
    closes = [b.close for b in bars]
    highs = [b.high for b in bars]
    lows = [b.low for b in bars]

    # Moving averages and EMAs
    k12, k26, k50, k9 = 2.0 / 13.0, 2.0 / 27.0, 2.0 / 51.0, 2.0 / 10.0
    ema12 = closes[0]
    ema26 = closes[0]
    ema50 = closes[0]
    macd_sig = 0.0

    for i in range(n):
        c = closes[i]
        if i >= 9:
            bars[i].sma10 = sum(closes[i - 9 : i + 1]) / 10.0
        if i >= 29:
            bars[i].sma30 = sum(closes[i - 29 : i + 1]) / 30.0

        ema12 = c * k12 + ema12 * (1.0 - k12)
        ema26 = c * k26 + ema26 * (1.0 - k26)
        ema50 = c * k50 + ema50 * (1.0 - k50)
        bars[i].ema12 = ema12
        bars[i].ema26 = ema26
        bars[i].ema50 = ema50

        raw_macd = (ema12 - ema26) / max(c, 1e-9)
        macd_sig = raw_macd * k9 + macd_sig * (1.0 - k9) if i > 0 else raw_macd
        if i >= 25:
            bars[i].macd = raw_macd
            bars[i].macd_hist = raw_macd - macd_sig

    # Wilder RSI(14)
    gains = [0.0] * n
    losses = [0.0] * n
    for i in range(1, n):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            gains[i] = diff
        else:
            losses[i] = -diff

    avg_gain = 0.0
    avg_loss = 0.0
    for i in range(1, n):
        if i < 14:
            avg_gain += gains[i]
            avg_loss += losses[i]
        elif i == 14:
            avg_gain = (avg_gain + gains[i]) / 14.0
            avg_loss = (avg_loss + losses[i]) / 14.0
            rs = avg_gain / avg_loss if avg_loss > 1e-12 else 100.0
            bars[i].rsi14 = 100.0 - (100.0 / (1.0 + rs))
        else:
            avg_gain = (avg_gain * 13.0 + gains[i]) / 14.0
            avg_loss = (avg_loss * 13.0 + losses[i]) / 14.0
            rs = avg_gain / avg_loss if avg_loss > 1e-12 else 100.0
            bars[i].rsi14 = 100.0 - (100.0 / (1.0 + rs))

    # Wilder ATR(14) and ADX(14)
    tr_list = [highs[0] - lows[0]]
    pdm_list = [0.0]
    mdm_list = [0.0]
    for i in range(1, n):
        prev_c = closes[i - 1]
        tr = max(highs[i] - lows[i], abs(highs[i] - prev_c), abs(lows[i] - prev_c))
        up_move = highs[i] - highs[i - 1]
        dn_move = lows[i - 1] - lows[i]
        pdm = up_move if (up_move > dn_move and up_move > 0.0) else 0.0
        mdm = dn_move if (dn_move > up_move and dn_move > 0.0) else 0.0
        tr_list.append(tr)
        pdm_list.append(pdm)
        mdm_list.append(mdm)

    sm_tr = 0.0
    sm_pdm = 0.0
    sm_mdm = 0.0
    dx_vals: List[float] = []
    adx_val = 0.0
    for i in range(n):
        if i < 14:
            sm_tr += tr_list[i]
            sm_pdm += pdm_list[i]
            sm_mdm += mdm_list[i]
            if i == 13:
                atr = sm_tr / 14.0
                bars[i].atr14 = atr / max(closes[i], 1e-9)
                pdi = 100.0 * (sm_pdm / max(sm_tr, 1e-9))
                mdi = 100.0 * (sm_mdm / max(sm_tr, 1e-9))
                bars[i].plus_di = pdi
                bars[i].minus_di = mdi
                dx = 100.0 * abs(pdi - mdi) / max(pdi + mdi, 1e-9)
                dx_vals.append(dx)
        else:
            sm_tr = sm_tr - (sm_tr / 14.0) + tr_list[i]
            sm_pdm = sm_pdm - (sm_pdm / 14.0) + pdm_list[i]
            sm_mdm = sm_mdm - (sm_mdm / 14.0) + mdm_list[i]
            atr = sm_tr / 14.0
            bars[i].atr14 = atr / max(closes[i], 1e-9)
            pdi = 100.0 * (sm_pdm / max(sm_tr, 1e-9))
            mdi = 100.0 * (sm_mdm / max(sm_tr, 1e-9))
            bars[i].plus_di = pdi
            bars[i].minus_di = mdi
            dx = 100.0 * abs(pdi - mdi) / max(pdi + mdi, 1e-9)
            dx_vals.append(dx)
            if len(dx_vals) == 14:
                adx_val = sum(dx_vals) / 14.0
                bars[i].adx14 = adx_val
            elif len(dx_vals) > 14:
                adx_val = (adx_val * 13.0 + dx) / 14.0
                bars[i].adx14 = adx_val

    # Volatility, Bollinger bands, Donchian channel, and OBV slope
    log_rets = [0.0] * n
    obv = [0.0] * n
    for i in range(1, n):
        log_rets[i] = math.log(max(closes[i], 1e-9) / max(closes[i - 1], 1e-9))
        if closes[i] > closes[i - 1]:
            obv[i] = obv[i - 1] + bars[i].volume
        elif closes[i] < closes[i - 1]:
            obv[i] = obv[i - 1] - bars[i].volume
        else:
            obv[i] = obv[i - 1]

    for i in range(n):
        if i >= 19:
            w_rets = log_rets[i - 19 : i + 1]
            mean_r = sum(w_rets) / 20.0
            var_r = sum((r - mean_r) ** 2 for r in w_rets) / 20.0
            bars[i].volatility20 = math.sqrt(max(var_r, 0.0))

            w_c = closes[i - 19 : i + 1]
            mean_c = sum(w_c) / 20.0
            std_c = math.sqrt(sum((c - mean_c) ** 2 for c in w_c) / 20.0)
            bars[i].bb_z = (closes[i] - mean_c) / std_c if std_c > 1e-9 else 0.0
            bars[i].bb_width = (4.0 * std_c) / max(mean_c, 1e-9)

            hi20 = max(highs[i - 19 : i + 1])
            lo20 = min(lows[i - 19 : i + 1])
            span = hi20 - lo20
            bars[i].donchian_pos = (closes[i] - lo20) / span if span > 1e-9 else 0.5

        if i >= 10:
            avg_v = sum(bars[j].volume for j in range(i - 9, i + 1)) / 10.0
            obv_delta = obv[i] - obv[i - 10]
            bars[i].obv_slope = max(-3.0, min(3.0, obv_delta / max(avg_v * 10.0, 1.0)))

    return bars


def build_feature_matrix(bars: List[OHLCVBar]) -> List[List[float]]:
    """Build 16-dimensional strictly causal feature vectors for RL and forecasting."""
    features: List[List[float]] = []
    vol_window: List[float] = []
    bbw_window: List[float] = []

    for i, b in enumerate(bars):
        c = max(b.close, 1e-9)
        c1 = max(bars[i - 1].close, 1e-9) if i >= 1 else c
        c3 = max(bars[i - 3].close, 1e-9) if i >= 3 else bars[0].close
        c5 = max(bars[i - 5].close, 1e-9) if i >= 5 else bars[0].close
        c10 = max(bars[i - 10].close, 1e-9) if i >= 10 else bars[0].close
        c20 = max(bars[i - 20].close, 1e-9) if i >= 20 else bars[0].close

        ret1 = math.log(c / c1)
        ret3 = math.log(c / c3)
        ret5 = math.log(c / c5)
        ret10 = math.log(c / c10)
        ret20 = math.log(c / c20)

        ema12 = b.ema12 if b.ema12 is not None else c
        ema26 = b.ema26 if b.ema26 is not None else c
        ema50 = b.ema50 if b.ema50 is not None else c
        ema_fast_slow = (ema12 - ema26) / c
        ema_med_trend = (c - ema50) / max(ema50, 1e-9)

        macd_hist = (b.macd_hist * 100.0) if b.macd_hist is not None else 0.0
        rsi_norm = ((b.rsi14 - 50.0) / 50.0) if b.rsi14 is not None else 0.0

        # Signed trend strength using ADX and directional index spread
        adx = b.adx14 if b.adx14 is not None else 15.0
        di_dir = 1.0 if ((b.plus_di or 0.0) >= (b.minus_di or 0.0)) else -1.0
        adx_signed = (min(adx, 60.0) / 50.0) * di_dir

        atr_pct = b.atr14 if b.atr14 is not None else (b.volatility20 or 0.015)
        bb_z = max(-3.0, min(3.0, b.bb_z)) if b.bb_z is not None else 0.0

        bbw = b.bb_width if b.bb_width is not None else 0.06
        bbw_window.append(bbw)
        if len(bbw_window) > 50:
            bbw_window.pop(0)
        avg_bbw = sum(bbw_window) / len(bbw_window)
        bb_width_rel = max(-2.5, min(2.5, math.log((bbw + 1e-5) / (avg_bbw + 1e-5))))

        donchian_centered = ((b.donchian_pos - 0.5) * 2.0) if b.donchian_pos is not None else 0.0

        vol_window.append(b.volume)
        if len(vol_window) > 20:
            vol_window.pop(0)
        avg_vol = sum(vol_window) / len(vol_window) if vol_window else 1.0
        vol_ratio = max(-3.0, min(3.0, math.log((b.volume + 1.0) / (avg_vol + 1.0))))

        hl_range = max(b.high - b.low, c * 1e-5)
        candle_body = max(-1.0, min(1.0, (b.close - b.open) / hl_range))

        features.append([
            ret1,
            ret3,
            ret5,
            ret10,
            ret20,
            ema_fast_slow,
            ema_med_trend,
            macd_hist,
            rsi_norm,
            adx_signed,
            atr_pct,
            bb_z,
            bb_width_rel,
            donchian_centered,
            vol_ratio,
            candle_body,
        ])
    return features


def fit_feature_scaler(train_features: List[List[float]]) -> Tuple[List[float], List[float]]:
    """Fit z-score stats strictly on training bars."""
    if not train_features:
        return [], []
    dims = len(train_features[0])
    n = len(train_features)
    means = [sum(row[d] for row in train_features) / n for d in range(dims)]
    stds = []
    for d in range(dims):
        var = sum((row[d] - means[d]) ** 2 for row in train_features) / max(1, n)
        std = math.sqrt(var)
        stds.append(std if std > 1e-8 else 1.0)
    return means, stds


def transform_features(
    features: List[List[float]], means: List[float], stds: List[float]
) -> List[List[float]]:
    out: List[List[float]] = []
    for row in features:
        norm = [max(-4.0, min(4.0, (row[d] - means[d]) / stds[d])) for d in range(len(row))]
        out.append(norm)
    return out


def fetch_market_data(
    symbol: str,
    interval: str = "1d",
    range_str: str = "2y",
    split_ratio: float = 0.75,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Fetch real OHLCV data with SQLite cache, indicators, and train/test split."""
    _init_cache_db()
    sym = validate_symbol(symbol)
    if interval not in ALLOWED_INTERVALS:
        interval = "1d"
    if range_str not in ALLOWED_RANGES:
        range_str = "2y"
    split_ratio = max(0.50, min(0.90, float(split_ratio)))

    cache_key = f"{CACHE_VERSION}|{sym}|{interval}|{range_str}"
    ttl = 900.0 if interval == "1h" else 14400.0
    now = time.time()

    cached_bars: Optional[List[OHLCVBar]] = None
    meta: Optional[Dict[str, Any]] = None
    from_cache = False
    fetched_at = now

    if not force_refresh:
        with sqlite3.connect(CACHE_DB_PATH) as conn:
            row = conn.execute(
                "SELECT payload, fetched_at FROM market_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
            if row and (now - float(row[1])) < ttl:
                stored = json.loads(row[0])
                valid_fields = set(OHLCVBar.__dataclass_fields__.keys())
                cached_bars = [
                    OHLCVBar(**{k: v for k, v in b.items() if k in valid_fields})
                    for b in stored["bars"]
                ]
                meta = stored["meta"]
                fetched_at = float(row[1])
                from_cache = True

    if cached_bars is None or meta is None:
        errors: List[str] = []
        if sym in BINANCE_SYMBOL_MAP:
            fetchers = [
                ("binance", _fetch_binance),
                ("coinbase", _fetch_coinbase),
                ("yahoo", _fetch_yahoo),
            ]
        else:
            fetchers = [("yahoo", _fetch_yahoo)]

        for name, fn in fetchers:
            try:
                cached_bars, meta = fn(sym, interval, range_str)
                break
            except MarketDataError as e:
                errors.append(f"{name}: {e}")
                if e.status_code == 404 and len(fetchers) == 1:
                    raise
            except Exception as e:
                errors.append(f"{name}: {e}")

        if cached_bars is None or meta is None:
            raise MarketDataError(
                f"Unable to load market data for {sym}. " + " | ".join(errors),
                status_code=502,
            )

        cached_bars = compute_indicators(cached_bars)
        fetched_at = time.time()
        with sqlite3.connect(CACHE_DB_PATH) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO market_cache (cache_key, payload, fetched_at, source)
                VALUES (?, ?, ?, ?)
                """,
                (
                    cache_key,
                    json.dumps({"bars": [asdict(b) for b in cached_bars], "meta": meta}),
                    fetched_at,
                    meta["source"],
                ),
            )
            conn.commit()

    n = len(cached_bars)
    split_idx = max(35, min(n - 15, int(round(n * split_ratio))))

    first_bar = cached_bars[0]
    last_bar = cached_bars[-1]
    prev_close = cached_bars[-2].close if n >= 2 else last_bar.close
    period_return = ((last_bar.close - first_bar.close) / first_bar.close) * 100.0
    last_change_pct = ((last_bar.close - prev_close) / prev_close) * 100.0

    split_info = {
        "ratio": round(split_idx / n, 4),
        "splitIndex": split_idx,
        "totalBars": n,
        "trainBars": split_idx,
        "testBars": n - split_idx,
        "trainStart": cached_bars[0].date,
        "trainEnd": cached_bars[split_idx - 1].date,
        "testStart": cached_bars[split_idx].date,
        "testEnd": cached_bars[-1].date,
    }

    summary = {
        "lastClose": last_bar.close,
        "lastDate": last_bar.date,
        "lastChangePct": last_change_pct,
        "periodReturnPct": period_return,
        "periodHigh": max(b.high for b in cached_bars),
        "periodLow": min(b.low for b in cached_bars),
        "avgVolume": sum(b.volume for b in cached_bars) / n,
    }

    return {
        "meta": {
            **meta,
            "cached": from_cache,
            "fetchedAt": datetime.fromtimestamp(fetched_at, tz=timezone.utc).isoformat(),
        },
        "summary": summary,
        "split": split_info,
        "bars": [asdict(b) for b in cached_bars],
    }
