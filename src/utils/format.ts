import type { EquityPoint, TradeRecord } from '../types/trading';

export function formatCurrency(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : 4;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : 4;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatSignedPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function computeRollingAverage(values: number[], windowSize: number): number[] {
  if (values.length === 0) return [];
  const w = Math.max(1, Math.floor(windowSize));
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= w) {
      sum -= values[i - w];
    }
    const denom = Math.min(i + 1, w);
    out.push(sum / denom);
  }
  return out;
}

export interface NormalizedSeriesPoint {
  index: number;
  date: string;
  value: number; // Base 100
}

/**
 * Re-indexes an equity curve to Base 100 at its opening bar so runs with
 * different initial capitals can be compared cleanly side by side.
 */
export function normalizeEquitySeries(curve: EquityPoint[]): NormalizedSeriesPoint[] {
  if (!curve.length) return [];
  const base = curve[0].equity > 0 ? curve[0].equity : 1;
  return curve.map((pt, idx) => ({
    index: idx,
    date: pt.date,
    value: (pt.equity / base) * 100,
  }));
}

export function buildTradesCsv(trades: TradeRecord[]): string {
  const header = [
    'Step',
    'Date',
    'Side',
    'MarketPrice',
    'FillPrice',
    'Quantity',
    'Notional',
    'Fee',
    'SlippageCost',
    'RealizedPnL',
    'ReturnPct',
    'EquityAfter',
  ];
  const rows = trades.map((t) => [
    t.step,
    t.date,
    t.side,
    t.market_price.toFixed(6),
    t.fill_price.toFixed(6),
    t.quantity.toFixed(6),
    t.notional.toFixed(2),
    t.fee.toFixed(4),
    t.slippage_cost.toFixed(4),
    t.realized_pnl !== null ? t.realized_pnl.toFixed(2) : '',
    t.return_pct !== null ? t.return_pct.toFixed(2) : '',
    t.equity_after.toFixed(2),
  ]);
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function formatShortDate(dateStr: string): string {
  if (!dateStr) return '—';
  // Accepts YYYY-MM-DD or YYYY-MM-DD HH:MM
  const parts = dateStr.split(' ');
  const ymd = parts[0].split('-');
  if (ymd.length !== 3) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mIdx = Number(ymd[1]) - 1;
  const m = months[mIdx] || ymd[1];
  const day = Number(ymd[2]);
  const yr = ymd[0].slice(2);
  return parts[1] ? `${m} ${day} ${parts[1]}` : `${m} ${day}, '${yr}`;
}
