import { Download } from 'lucide-react';
import type { RunDetail, RunSummary } from '../types/trading';
import { buildTradesCsv, formatCurrency, formatPrice, formatSignedPct } from '../utils/format';

interface LedgerViewProps {
  runs: RunSummary[];
  selectedRun: RunDetail | null;
  split: 'train' | 'test';
  sideFilter: 'ALL' | 'BUY' | 'SELL';
  onSplitChange: (split: 'train' | 'test') => void;
  onSideFilterChange: (side: 'ALL' | 'BUY' | 'SELL') => void;
  onSelectRun: (runId: string) => void;
}

export function LedgerView({
  runs,
  selectedRun,
  split,
  sideFilter,
  onSplitChange,
  onSideFilterChange,
  onSelectRun,
}: LedgerViewProps) {
  const activeTrace =
    split === 'test' ? selectedRun?.backtest || null : selectedRun?.trainTrace || null;
  const allTrades = activeTrace?.trades || [];
  const filteredTrades =
    sideFilter === 'ALL' ? allTrades : allTrades.filter((t) => t.side === sideFilter);

  const handleDownloadCsv = () => {
    if (!filteredTrades.length || !selectedRun) return;
    const csv = buildTradesCsv(filteredTrades);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meridian-${selectedRun.config.symbol}-${selectedRun.config.algorithm}-${split}-ledger.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const glassCardCls =
    'overflow-hidden rounded-2xl border border-white/75 bg-white/56 shadow-[0_12px_36px_-10px_rgba(22,36,54,0.12),inset_0_1px_0_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.11] dark:bg-[#0D121C]/74 dark:shadow-[0_22px_54px_-14px_rgba(0,0,0,0.68),inset_0_1px_0_0_rgba(255,255,255,0.10)]';

  if (runs.length === 0) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
        <div className={`${glassCardCls} flex min-h-[460px] flex-col items-center justify-center px-6 text-center`}>
          <h2 className="text-lg font-semibold text-[#162436] dark:text-white">No trades yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[#43566E] dark:text-[#98A6BA]">
            Every simulated buy and sell order, fee, and profit or loss will show up here once you run a strategy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8">
      <div className={`${glassCardCls} p-5 sm:p-6`}>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#162436] dark:text-white">
              Trade History
            </h1>
            <p className="mt-1 text-sm text-[#43566E] dark:text-[#98A6BA]">
              Every simulated buy and sell order with exact prices, fees, and profit.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label htmlFor="ledger-run-select" className="sr-only">
              Select run for trade history
            </label>
            <select
              id="ledger-run-select"
              value={selectedRun?.id || ''}
              onChange={(e) => onSelectRun(e.target.value)}
              className="rounded-xl border border-[#162436]/[0.12] bg-white/72 px-3 py-2 text-xs font-medium text-[#162436] outline-none focus:border-[#1A3350] dark:border-white/[0.12] dark:bg-[#0B1018]/90 dark:text-[#F4F7FB]"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.config.algorithm} · {r.config.symbol} ({r.status})
                </option>
              ))}
            </select>

            <div className="flex items-center rounded-xl border border-[#162436]/[0.1] bg-white/50 p-0.5 text-xs dark:border-white/[0.1] dark:bg-white/[0.04]">
              <button
                type="button"
                onClick={() => onSplitChange('train')}
                className={`rounded-lg px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                  split === 'train'
                    ? 'bg-white text-[#162436] shadow-xs dark:bg-white/[0.14] dark:text-white'
                    : 'text-[#4D6078] hover:text-[#162436] dark:text-[#8E9DB2] dark:hover:text-white'
                }`}
              >
                Training
              </button>
              <button
                type="button"
                onClick={() => onSplitChange('test')}
                className={`rounded-lg px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                  split === 'test'
                    ? 'bg-white text-[#162436] shadow-xs dark:bg-white/[0.14] dark:text-white'
                    : 'text-[#4D6078] hover:text-[#162436] dark:text-[#8E9DB2] dark:hover:text-white'
                }`}
              >
                New Data
              </button>
            </div>

            <div className="flex items-center rounded-xl border border-[#162436]/[0.1] bg-white/50 p-0.5 text-xs dark:border-white/[0.1] dark:bg-white/[0.04]">
              {(['ALL', 'BUY', 'SELL'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSideFilterChange(s)}
                  className={`rounded-lg px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                    sideFilter === s
                      ? 'bg-white text-[#162436] shadow-xs dark:bg-white/[0.14] dark:text-white'
                      : 'text-[#4D6078] hover:text-[#162436] dark:text-[#8E9DB2] dark:hover:text-white'
                  }`}
                >
                  {s === 'ALL' ? 'All' : s === 'BUY' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={filteredTrades.length === 0}
              onClick={handleDownloadCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#162436]/[0.12] bg-white/75 px-3.5 py-2 text-xs font-medium text-[#162436] transition-colors hover:bg-white disabled:opacity-40 whitespace-nowrap shrink-0 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.11]"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
        </div>

        {activeTrace && (
          <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-[#162436]/[0.08] pt-4 font-mono text-xs text-[#4D6078] tabular-nums dark:border-white/[0.08] dark:text-[#8E9DB2]">
            <span>
              Trades: <strong className="text-[#162436] dark:text-white">{activeTrace.trades.length}</strong>
            </span>
            <span>
              Completed:{' '}
              <strong className="text-[#162436] dark:text-white">
                {activeTrace.metrics.closedRoundTrips}
              </strong>
            </span>
            <span>
              Fees:{' '}
              <strong className="text-[#162436] dark:text-white">
                {formatCurrency(activeTrace.metrics.totalFeesPaid)}
              </strong>
            </span>
            <span>
              Price Slip:{' '}
              <strong className="text-[#162436] dark:text-white">
                {formatCurrency(activeTrace.metrics.totalSlippagePaid)}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Table */}
      <div className={`${glassCardCls} mt-5`}>
        {filteredTrades.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-[#4D6078] dark:text-[#8E9DB2]">
            {split === 'test' && !selectedRun?.backtest
              ? 'This run has not been tested on new data yet.'
              : 'No trades match this filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="border-b border-[#162436]/[0.08] bg-white/35 text-[#4D6078] dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-[#8E9DB2]">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 text-right font-medium">Market</th>
                  <th className="px-4 py-2.5 text-right font-medium">Fill</th>
                  <th className="px-4 py-2.5 text-right font-medium">Shares</th>
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                  <th className="px-4 py-2.5 text-right font-medium">Fee</th>
                  <th className="px-4 py-2.5 text-right font-medium">Slip</th>
                  <th className="px-4 py-2.5 text-right font-medium">Profit / Loss</th>
                  <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#162436]/[0.06] font-mono tabular-nums dark:divide-white/[0.06]">
                {filteredTrades.map((t, idx) => (
                  <tr key={`${t.step}-${t.side}-${idx}`} className="hover:bg-white/45 dark:hover:bg-white/[0.04]">
                    <td className="px-4 py-2.5 text-[#31455C] dark:text-[#C5D0DF]">{t.date}</td>
                    <td
                      className={`px-4 py-2.5 font-semibold ${
                        t.side === 'BUY'
                          ? 'text-[#0E8554] dark:text-[#22C58B]'
                          : 'text-[#C73B33] dark:text-[#F0645C]'
                      }`}
                    >
                      {t.side}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#4D6078] dark:text-[#8E9DB2]">
                      {formatPrice(t.market_price)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#162436] dark:text-white">
                      {formatPrice(t.fill_price)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#31455C] dark:text-[#C5D0DF]">
                      {t.quantity.toFixed(4)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#31455C] dark:text-[#C5D0DF]">
                      {formatCurrency(t.notional)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#4D6078] dark:text-[#8E9DB2]">
                      {formatCurrency(t.fee)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#4D6078] dark:text-[#8E9DB2]">
                      {formatCurrency(t.slippage_cost)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right ${
                        t.realized_pnl === null
                          ? 'text-[#6B7E94]'
                          : t.realized_pnl >= 0
                            ? 'text-[#0E8554] dark:text-[#22C58B]'
                            : 'text-[#C73B33] dark:text-[#F0645C]'
                      }`}
                    >
                      {t.realized_pnl !== null
                        ? `${formatCurrency(t.realized_pnl)} (${formatSignedPct(t.return_pct)})`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-[#162436] dark:text-white">
                      {formatCurrency(t.equity_after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
