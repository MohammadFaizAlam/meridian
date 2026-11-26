import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCurrency,
  formatSignedPct,
  formatRatio,
  formatVolume,
  computeRollingAverage,
  normalizeEquitySeries,
  buildTradesCsv,
  formatShortDate,
} from './format';
import type { EquityPoint, TradeRecord } from '../types/trading';

test('honest empty value formatting returns em-dash for null/undefined/NaN', () => {
  assert.equal(formatCurrency(null), '—');
  assert.equal(formatCurrency(undefined), '—');
  assert.equal(formatCurrency(Number.NaN), '—');
  assert.equal(formatSignedPct(null), '—');
  assert.equal(formatRatio(undefined), '—');
});

test('formats currency, signed percentages, and compact volume accurately', () => {
  assert.equal(formatCurrency(12450.5), '$12,450.50');
  assert.equal(formatSignedPct(8.425), '+8.43%');
  assert.equal(formatSignedPct(-3.1), '-3.10%');
  assert.equal(formatSignedPct(0), '0.00%');
  assert.equal(formatVolume(54_320_000), '54.32M');
  assert.equal(formatVolume(1_250_000_000), '1.25B');
  assert.equal(formatShortDate('2026-03-09'), "Mar 9, '26");
});

test('rolling average calculates exact sliding mean', () => {
  const avg = computeRollingAverage([2, 4, 6, 8, 10], 3);
  assert.deepEqual(avg, [2, 3, 4, 6, 8]);
});

test('normalizeEquitySeries re-indexes curves to base 100', () => {
  const curve: EquityPoint[] = [
    { step: 0, timestamp: 1, date: '2026-01-01', price: 100, equity: 20000, benchmark_equity: 20000, cash: 20000, position: 0, action: 0, drawdown_pct: 0 },
    { step: 1, timestamp: 2, date: '2026-01-02', price: 110, equity: 22000, benchmark_equity: 22000, cash: 0, position: 200, action: 1, drawdown_pct: 0 },
    { step: 2, timestamp: 3, date: '2026-01-03', price: 90, equity: 18000, benchmark_equity: 18000, cash: 0, position: 200, action: 0, drawdown_pct: -18.18 },
  ];
  const norm = normalizeEquitySeries(curve);
  assert.equal(norm.length, 3);
  assert.ok(Math.abs(norm[0].value - 100) < 1e-9);
  assert.ok(Math.abs(norm[1].value - 110) < 1e-9);
  assert.ok(Math.abs(norm[2].value - 90) < 1e-9);
});

test('buildTradesCsv produces valid RFC-style CSV rows', () => {
  const trades: TradeRecord[] = [
    {
      step: 5,
      timestamp: 1700000000,
      date: '2026-02-10',
      side: 'BUY',
      market_price: 200,
      fill_price: 200.1,
      quantity: 49.925,
      notional: 9990,
      fee: 9.99,
      slippage_cost: 4.9925,
      realized_pnl: null,
      return_pct: null,
      equity_after: 9985,
    },
  ];
  const csv = buildTradesCsv(trades);
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('Step,Date,Side,'));
  assert.ok(lines[1].includes('2026-02-10,BUY,200.000000,200.100000'));
});
