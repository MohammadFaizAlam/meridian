"""Unit tests for the upgraded RL engine, action masking, and price forecaster."""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agents import create_agent, deserialize_agent
from environment import ACTION_BUY, ACTION_HOLD, ACTION_SELL, EnvConfig, TradingEnvironment
from forecaster import build_market_forecast
from market_data import (
    MarketDataError,
    OHLCVBar,
    build_feature_matrix,
    compute_indicators,
    fit_feature_scaler,
    transform_features,
    validate_symbol,
)


def _make_sample_bars(n: int = 160):
    bars = []
    price = 100.0
    for i in range(n):
        delta = math.sin(i * 0.22) * 1.8 + 0.14
        o = price
        c = max(10.0, price + delta)
        h = max(o, c) + 0.75
        l = min(o, c) - 0.75
        bars.append(
            OHLCVBar(
                timestamp=1700000000 + i * 86400,
                date=f"2025-{(i // 28) % 12 + 1:02d}-{(i % 28) + 1:02d}",
                open=o,
                high=h,
                low=l,
                close=c,
                volume=1_000_000.0 + (i % 7) * 80_000.0,
            )
        )
        price = c
    compute_indicators(bars)
    return bars


class TestMarketAndEnvironment(unittest.TestCase):
    def test_symbol_validation(self):
        self.assertEqual(validate_symbol(" aapl "), "AAPL")
        self.assertEqual(validate_symbol("btc-usd"), "BTC-USD")
        with self.assertRaises(MarketDataError):
            validate_symbol("AAPL; rm -rf /")
        with self.assertRaises(MarketDataError):
            validate_symbol("")

    def test_no_leakage_16dim_scaler(self):
        bars = _make_sample_bars(100)
        raw = build_feature_matrix(bars)
        self.assertEqual(len(raw[0]), 16)
        train_raw, test_raw = raw[:70], raw[70:]
        means, stds = fit_feature_scaler(train_raw)
        train_scaled = transform_features(train_raw, means, stds)
        test_scaled = transform_features(test_raw, means, stds)

        col0_mean = sum(r[0] for r in train_scaled) / len(train_scaled)
        self.assertAlmostEqual(col0_mean, 0.0, places=2)
        self.assertEqual(len(test_scaled), 30)
        for row in test_scaled:
            for v in row:
                self.assertGreaterEqual(v, -4.0)
                self.assertLessEqual(v, 4.0)

    def test_fee_slippage_and_action_masking(self):
        bars = _make_sample_bars(40)
        bar_dicts = [b.__dict__ for b in bars]
        raw = build_feature_matrix(bars)
        means, stds = fit_feature_scaler(raw)
        scaled = transform_features(raw, means, stds)

        cfg = EnvConfig(initial_capital=10000.0, fee_bps=10.0, slippage_bps=5.0)
        env = TradingEnvironment(bar_dicts, scaled, cfg, warmup_bars=0)
        env.reset()

        # Flat state allows Hold and Buy, blocks Sell
        self.assertEqual(env.valid_action_mask(), [True, True, False])

        _, _, _, info = env.step(ACTION_BUY)
        self.assertEqual(info["executedAction"], ACTION_BUY)
        self.assertEqual(env.valid_action_mask(), [True, False, True])

        buy_trade = env.trades[0]
        expected_fill = bar_dicts[0]["close"] * 1.0005
        self.assertAlmostEqual(buy_trade.fill_price, expected_fill, places=6)
        self.assertAlmostEqual(buy_trade.notional + buy_trade.fee + env.cash, 10000.0, places=4)

        for _ in range(3):
            env.step(ACTION_HOLD)
        env.step(ACTION_SELL)
        self.assertEqual(env.valid_action_mask(), [True, True, False])
        self.assertAlmostEqual(env.shares, 0.0, places=9)

    def test_all_four_agents_train_mask_and_signal(self):
        bars = _make_sample_bars(90)
        bar_dicts = [b.__dict__ for b in bars]
        raw = build_feature_matrix(bars)
        train_raw, test_raw = raw[:65], raw[65:]
        means, stds = fit_feature_scaler(train_raw)
        train_scaled = transform_features(train_raw, means, stds)
        test_scaled = transform_features(test_raw, means, stds)

        cfg = EnvConfig(initial_capital=10000.0, fee_bps=10.0, slippage_bps=5.0)

        for algo in ("DQN", "PPO", "A2C", "Q-Learning"):
            env = TradingEnvironment(bar_dicts[:65], train_scaled, cfg, warmup_bars=10)
            agent = create_agent(algo, env.state_dim, 0.003, 0.96, 0.7, seed=7)

            for ep in range(1, 4):
                s = env.reset()
                done = False
                while not done:
                    mask = env.valid_action_mask()
                    a = agent.select_action(s, greedy=False, valid_mask=mask)
                    self.assertTrue(mask[a])
                    ns, r, done, _ = env.step(a)
                    agent.observe(s, a, r, ns, done)
                    s = ns
                agent.end_episode(progress=ep / 3.0)

            weights = agent.serialize()
            self.assertEqual(weights["version"], 2)
            restored = deserialize_agent(weights)

            sig = restored.predict_signal(s, valid_mask=[True, True, True])
            prob_sum = sig["holdProb"] + sig["buyProb"] + sig["sellProb"]
            self.assertAlmostEqual(prob_sum, 1.0, places=2)

            test_env = TradingEnvironment(bar_dicts[65:], test_scaled, cfg, warmup_bars=0)
            ts = test_env.reset()
            done = False
            while not done:
                tmask = test_env.valid_action_mask()
                ta = restored.select_action(ts, greedy=True, valid_mask=tmask)
                self.assertTrue(tmask[ta])
                ts, _, done, _ = test_env.step(ta)
            self.assertGreater(test_env.compute_metrics()["finalEquity"], 0.0)

    def test_forecaster_walk_forward_and_bands(self):
        bars = _make_sample_bars(180)
        market = {
            "meta": {
                "symbol": "TEST",
                "currency": "USD",
                "interval": "1d",
                "range": "1y",
                "corporateEvents": [],
            },
            "bars": [b.__dict__ for b in bars],
        }
        fc = build_market_forecast(market)
        self.assertEqual(len(fc["trajectory"]), 10)
        self.assertEqual(len(fc["horizons"]), 3)
        for pt in fc["trajectory"]:
            self.assertLessEqual(pt["lowerBand"], pt["projectedPrice"])
            self.assertLessEqual(pt["projectedPrice"], pt["upperBand"])
        self.assertGreater(fc["audit"]["samplesEvaluated"], 20)
        self.assertIsNotNone(fc["audit"]["directionalAccuracyPct"])
        self.assertIsNotNone(fc["audit"]["meanAbsErrorPct"])


if __name__ == "__main__":
    unittest.main()
