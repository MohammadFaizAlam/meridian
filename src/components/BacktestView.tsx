import { useState } from 'react';
import { ArrowRight, Play, ShieldCheck } from 'lucide-react';
import type { BacktestResult, InstrumentOption, RunDetail, RunSummary } from '../types/trading';
import {
  formatCurrency,
  formatPct,
  formatRatio,
  formatShortDate,
  formatSignedPct,
} from '../utils/format';
import { PriceTradeChart } from './charts/PriceTradeChart';
import { EquityCurveChart } from './charts/EquityCurveChart';

interface BacktestViewProps {
  runs: RunSummary[];
  selectedRun: RunDetail | null;
  instruments: InstrumentOption[];
  isRunningBacktest: boolean;
  backtestError: string | null;
  transferResult: BacktestResult | null;
  theme: 'dark' | 'light';
  onSelectRun: (runId: string) => void;
  onRunBacktest: (runId: string, overrideSymbol?: string) => void;
  onGoToWorkbench: () => void;
}

export function BacktestView({
  runs,
  selectedRun,
  instruments,
  isRunningBacktest,
  backtestError,
  transferResult,
  theme,
  onSelectRun,
  onRunBacktest,
  onGoToWorkbench,
}: BacktestViewProps) {
  const [transferSymbol, setTransferSymbol] = useState<string>('');
  const trainableRuns = runs.filter((r) => r.hasWeights);

  const activeBacktest =
    transferResult && selectedRun && transferResult.symbol === transferSymbol
      ? transferResult
      : selectedRun?.backtest || null;

  const glassCardCls =
    'overflow-hidden rounded-2xl border border-white/75 bg-white/56 shadow-[0_12px_36px_-10px_rgba(22,36,54,0.12),inset_0_1px_0_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.11] dark:bg-[#0D121C]/74 dark:shadow-[0_22px_54px_-14px_rgba(0,0,0,0.68),inset_0_1px_0_0_rgba(255,255,255,0.10)]';

  const selectCls =
    'mt-1 w-full sm:w-auto rounded-xl border border-[#162436]/[0.12] bg-white/72 px-3 py-2 text-xs font-medium text-[#162436] outline-none focus:border-[#1A3350] dark:border-white/[0.12] dark:bg-[#090D14]/90 dark:text-[#F4F7FB] dark:focus:border-[#AFC3DF]';

  if (trainableRuns.length === 0) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
        <div className={`${glassCardCls} flex min-h-[460px] flex-col items-center justify-center px-6 text-center`}>
          <h2 className="text-lg font-semibold text-[#162436] dark:text-white">
            No trained strategies yet
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[#43566E] dark:text-[#98A2B3]">
            Train a strategy in the Train tab first, then come here to test it on newer prices it has never seen.
          </p>
          <button
            type="button"
            onClick={onGoToWorkbench}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#1A3350] px-4 py-2.5 text-xs font-medium text-white shadow-[0_8px_20px_-6px_rgba(26,51,80,0.45)] transition-colors hover:bg-[#234366] dark:bg-[#ECEFF4] dark:text-[#0B0E14] dark:hover:bg-white"
          >
            Go to Train <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const trainM = selectedRun?.trainTrace?.metrics || null;
  const testM = activeBacktest?.metrics || null;

  const metricRows: {
    label: string;
    train: string;
    test: string;
    testHighlight?: 'pos' | 'neg' | 'neutral';
  }[] = [
    {
      label: 'Total Return',
      train: formatSignedPct(trainM?.totalReturnPct),
      test: formatSignedPct(testM?.totalReturnPct),
      testHighlight:
        testM && testM.totalReturnPct > 0 ? 'pos' : testM && testM.totalReturnPct < 0 ? 'neg' : 'neutral',
    },
    {
      label: 'Buy & Hold Return',
      train: formatSignedPct(trainM?.benchmarkReturnPct),
      test: formatSignedPct(testM?.benchmarkReturnPct),
    },
    {
      label: 'Beat Market By',
      train: formatSignedPct(trainM?.alphaPct),
      test: formatSignedPct(testM?.alphaPct),
      testHighlight:
        testM && testM.alphaPct > 0 ? 'pos' : testM && testM.alphaPct < 0 ? 'neg' : 'neutral',
    },
    {
      label: 'Risk Score (Sharpe)',
      train: formatRatio(trainM?.sharpeRatio),
      test: formatRatio(testM?.sharpeRatio),
    },
    {
      label: 'Downside Score',
      train: formatRatio(trainM?.sortinoRatio),
      test: formatRatio(testM?.sortinoRatio),
    },
    {
      label: 'Biggest Drop',
      train: formatSignedPct(trainM?.maxDrawdownPct),
      test: formatSignedPct(testM?.maxDrawdownPct),
      testHighlight: testM && testM.maxDrawdownPct < -0.5 ? 'neg' : 'neutral',
    },
    {
      label: 'Winning Trades',
      train: formatPct(trainM?.winRatePct, 1),
      test: formatPct(testM?.winRatePct, 1),
    },
    {
      label: 'Gain / Loss Ratio',
      train: formatRatio(trainM?.profitFactor),
      test: formatRatio(testM?.profitFactor),
    },
    {
      label: 'Trades (Completed)',
      train: trainM ? `${trainM.totalTrades} (${trainM.closedRoundTrips})` : '—',
      test: testM ? `${testM.totalTrades} (${testM.closedRoundTrips})` : '—',
    },
    {
      label: 'Fees + Price Slip',
      train: trainM ? formatCurrency(trainM.totalFeesPaid + trainM.totalSlippagePaid) : '—',
      test: testM ? formatCurrency(testM.totalFeesPaid + testM.totalSlippagePaid) : '—',
    },
    {
      label: 'Time in Market',
      train: formatPct(trainM?.exposurePct, 1),
      test: formatPct(testM?.exposurePct, 1),
    },
  ];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8">
      {/* Header controls */}
      <div className={`${glassCardCls} p-5 sm:p-6`}>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#162436] dark:text-white">
              New Data Test
            </h1>
            <p className="mt-1 text-sm text-[#43566E] dark:text-[#98A2B3]">
              Runs your trained strategy on newer prices it never saw during training.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="w-full sm:w-auto">
              <label htmlFor="backtest-run-select" className="block text-xs text-[#43566E] dark:text-[#98A2B3]">
                Saved Strategy
              </label>
              <select
                id="backtest-run-select"
                value={selectedRun?.id || ''}
                onChange={(e) => {
                  setTransferSymbol('');
                  onSelectRun(e.target.value);
                }}
                className={selectCls}
              >
                {trainableRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.config.algorithm} · {r.config.symbol} ({r.completedEpisodes} passes ·{' '}
                    {r.trainMetrics ? formatSignedPct(r.trainMetrics.totalReturnPct) : '—'})
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full sm:w-auto">
              <label htmlFor="transfer-symbol-select" className="block text-xs text-[#43566E] dark:text-[#98A2B3]">
                Test Market
              </label>
              <select
                id="transfer-symbol-select"
                value={transferSymbol}
                onChange={(e) => setTransferSymbol(e.target.value)}
                className={selectCls}
              >
                <option value="">
                  Same asset ({selectedRun?.config.symbol || 'Same asset'} new dates)
                </option>
                {instruments
                  .filter((i) => i.symbol !== selectedRun?.config.symbol)
                  .map((i) => (
                    <option key={i.symbol} value={i.symbol}>
                      Try on {i.symbol} instead
                    </option>
                  ))}
              </select>
            </div>

            <button
              type="button"
              disabled={!selectedRun || isRunningBacktest}
              onClick={() =>
                selectedRun && onRunBacktest(selectedRun.id, transferSymbol || undefined)
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1A3350] px-4 py-2 text-xs font-medium text-white shadow-[0_8px_20px_-6px_rgba(26,51,80,0.45)] transition-colors hover:bg-[#234366] disabled:opacity-45 whitespace-nowrap shrink-0 dark:bg-[#ECEFF4] dark:text-[#0B0E14] dark:shadow-xs dark:hover:bg-white"
            >
              <Play className="h-3.5 w-3.5" />
              {isRunningBacktest ? 'Testing...' : 'Run Test'}
            </button>
          </div>
        </div>

        {/* Date separation strip */}
        {selectedRun && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#162436]/[0.08] pt-4 text-xs dark:border-white/[0.07]">
            <div className="flex items-center gap-2 text-[#162436] dark:text-white">
              <ShieldCheck className="h-4 w-4 text-[#0E8554] dark:text-[#22C58B]" />
              <span className="font-medium">Train and test dates never overlap</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-[#43566E] tabular-nums dark:text-[#98A2B3]">
              <span>
                Trained: {formatShortDate(selectedRun.split.trainStart)} –{' '}
                {formatShortDate(selectedRun.split.trainEnd)} ({selectedRun.split.trainBars} pts)
              </span>
              <span className="text-[#9A6312] dark:text-[#E5A94C]">
                New Data: {formatShortDate(selectedRun.split.testStart)} –{' '}
                {formatShortDate(selectedRun.split.testEnd)} ({selectedRun.split.testBars} pts)
              </span>
            </div>
          </div>
        )}
      </div>

      {backtestError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-[#C73B33]/30 bg-[#C73B33]/10 px-4 py-3 text-xs text-[#A32B24] dark:text-[#F59B95]"
        >
          {backtestError}
        </div>
      )}

      {!activeBacktest ? (
        <div className={`${glassCardCls} mt-6 flex min-h-[340px] flex-col items-center justify-center px-6 text-center`}>
          <p className="text-sm font-semibold text-[#162436] dark:text-white">
            Not tested on new data yet
          </p>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[#43566E] dark:text-[#98A2B3]">
            Click Run Test to check how your {selectedRun?.config.algorithm} strategy handles{' '}
            {selectedRun?.split.testBars} newer price points starting{' '}
            {selectedRun ? formatShortDate(selectedRun.split.testStart) : '—'}.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="min-w-0 space-y-6 xl:col-span-7">
            <div className={glassCardCls}>
              <PriceTradeChart
                bars={activeBacktest.bars}
                split={null}
                trades={activeBacktest.trades}
                mode="test-only"
                symbol={`${activeBacktest.symbol} (New Data)`}
                height={310}
                theme={theme}
              />
            </div>

            <div className={glassCardCls}>
              <EquityCurveChart
                curve={activeBacktest.equityCurve}
                title="New Data Balance vs. Buy & Hold"
                subtitle={`${formatShortDate(activeBacktest.testStart)} – ${formatShortDate(activeBacktest.testEnd)}`}
                height={245}
                theme={theme}
              />
            </div>
          </div>

          <div className="min-w-0 xl:col-span-5">
            <div className={glassCardCls}>
              <div className="border-b border-[#162436]/[0.08] px-5 py-4 dark:border-white/[0.07]">
                <h2 className="text-sm font-semibold text-[#162436] dark:text-white">
                  Training vs. New Data
                </h2>
                <p className="mt-0.5 text-xs text-[#4D6078] dark:text-[#8B95A5]">
                  {activeBacktest.isTransferTest
                    ? `Cross-market check on ${activeBacktest.symbol} vs. ${selectedRun?.config.symbol} training`
                    : `Same-asset check on ${activeBacktest.symbol}`}
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[340px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#162436]/[0.08] bg-white/35 text-[#4D6078] dark:border-white/[0.07] dark:bg-white/[0.02] dark:text-[#8B95A5]">
                      <th className="px-5 py-2.5 font-medium">Measure</th>
                      <th className="px-4 py-2.5 text-right font-medium">Training</th>
                      <th className="px-5 py-2.5 text-right font-medium text-[#162436] dark:text-white">
                        New Data
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#162436]/[0.06] dark:divide-white/[0.06]">
                    {metricRows.map((row) => (
                      <tr key={row.label} className="hover:bg-white/40 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-2.5 text-[#31455C] dark:text-[#C9D2E0]">{row.label}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-[#4D6078] tabular-nums dark:text-[#8B95A5]">
                          {row.train}
                        </td>
                        <td
                          className={`px-5 py-2.5 text-right font-mono font-medium tabular-nums ${
                            row.testHighlight === 'pos'
                              ? 'text-[#0E8554] dark:text-[#22C58B]'
                              : row.testHighlight === 'neg'
                                ? 'text-[#C73B33] dark:text-[#F0645C]'
                                : 'text-[#162436] dark:text-white'
                          }`}
                        >
                          {row.test}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
