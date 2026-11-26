import { Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { RunDetail, RunSummary } from '../types/trading';
import { formatPct, formatRatio, formatShortDate, formatSignedPct } from '../utils/format';
import {
  COMPARE_PALETTE_DARK,
  COMPARE_PALETTE_LIGHT,
  ComparisonChart,
} from './charts/ComparisonChart';

interface CompareViewProps {
  runs: RunSummary[];
  comparedIds: string[];
  comparedDetails: RunDetail[];
  splitMode: 'test' | 'train';
  theme: 'dark' | 'light';
  onSplitModeChange: (mode: 'test' | 'train') => void;
  onToggleCompareId: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
  onOpenBacktest: (runId: string) => void;
}

const RANK_STYLES = {
  1: {
    tier: '1ST · GOLD',
    short: '#1',
    stripCls: 'bg-gradient-to-r from-[#9E7524] via-[#F2D17B] to-[#AE812A]',
    sideStripCls: 'bg-gradient-to-b from-[#F2D17B] via-[#C6963B] to-[#8F681D]',
    textCls: 'text-[#8F6516] dark:text-[#ECC76D]',
  },
  2: {
    tier: '2ND · SILVER',
    short: '#2',
    stripCls: 'bg-gradient-to-r from-[#778495] via-[#E4EBF5] to-[#8895A7]',
    sideStripCls: 'bg-gradient-to-b from-[#E6EDF7] via-[#A9B5C6] to-[#6E7B8D]',
    textCls: 'text-[#4B5B70] dark:text-[#D5DFEC]',
  },
  3: {
    tier: '3RD · BRONZE',
    short: '#3',
    stripCls: 'bg-gradient-to-r from-[#874B27] via-[#DFA075] to-[#985730]',
    sideStripCls: 'bg-gradient-to-b from-[#DFA075] via-[#B46F43] to-[#7C4422]',
    textCls: 'text-[#854924] dark:text-[#DF9C70]',
  },
} as const;

export function CompareView({
  runs,
  comparedIds,
  comparedDetails,
  splitMode,
  theme,
  onSplitModeChange,
  onToggleCompareId,
  onDeleteRun,
  onOpenBacktest,
}: CompareViewProps) {
  const palette = theme === 'dark' ? COMPARE_PALETTE_DARK : COMPARE_PALETTE_LIGHT;
  const glassCardCls =
    'overflow-hidden rounded-2xl border border-white/75 bg-white/56 shadow-[0_12px_36px_-10px_rgba(22,36,54,0.12),inset_0_1px_0_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.11] dark:bg-[#0D121C]/74 dark:shadow-[0_22px_54px_-14px_rgba(0,0,0,0.68),inset_0_1px_0_0_rgba(255,255,255,0.10)]';

  if (runs.length === 0) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
        <div className={`${glassCardCls} flex min-h-[460px] flex-col items-center justify-center px-6 text-center`}>
          <h2 className="text-lg font-semibold text-[#162436] dark:text-white">No saved runs yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[#43566E] dark:text-[#98A6BA]">
            Train two or more strategies with different settings to compare their returns and drops side by side.
          </p>
        </div>
      </div>
    );
  }

  const metricsFor = (run: RunDetail) =>
    splitMode === 'test' ? run.backtest?.metrics || null : run.trainTrace?.metrics || null;

  const summaryMetricsFor = (run: RunSummary) =>
    splitMode === 'test' ? run.testMetrics : run.trainMetrics;

  // Rank runs strictly by real return (tie-broken by risk score) for the selected split
  const rankedRuns = runs
    .map((run) => ({ run, metrics: summaryMetricsFor(run) }))
    .filter((entry): entry is { run: RunSummary; metrics: NonNullable<RunSummary['trainMetrics']> } => entry.metrics !== null)
    .sort((a, b) => {
      if (b.metrics.totalReturnPct !== a.metrics.totalReturnPct) {
        return b.metrics.totalReturnPct - a.metrics.totalReturnPct;
      }
      return b.metrics.sharpeRatio - a.metrics.sharpeRatio;
    });

  const topThree = rankedRuns.slice(0, 3);
  const rankByRunId = new Map<string, 1 | 2 | 3>();
  topThree.forEach((entry, index) => {
    rankByRunId.set(entry.run.id, (index + 1) as 1 | 2 | 3);
  });

  const bestReturn = Math.max(
    ...comparedDetails.map((r) => metricsFor(r)?.totalReturnPct ?? -Infinity),
  );
  const bestSharpe = Math.max(
    ...comparedDetails.map((r) => metricsFor(r)?.sharpeRatio ?? -Infinity),
  );

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8">
      <div className={`${glassCardCls} flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-end sm:p-6`}>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#162436] dark:text-white">
            Compare Runs
          </h1>
          <p className="mt-1 text-sm text-[#43566E] dark:text-[#98A6BA]">
            Pick up to 5 runs to compare growth from a shared starting point of 100.
          </p>
        </div>

        <div className="relative flex items-center self-start rounded-xl border border-[#162436]/[0.1] bg-white/50 p-1 text-xs sm:self-auto dark:border-white/[0.1] dark:bg-white/[0.04]">
          {(['test', 'train'] as const).map((m) => {
            const active = splitMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onSplitModeChange(m)}
                className={`relative z-10 rounded-lg px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-[#162436] dark:text-white'
                    : 'text-[#4D6078] hover:text-[#162436] dark:text-[#8E9DB2] dark:hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="compare-split-pill"
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0 -z-10 rounded-lg bg-white shadow-xs dark:bg-white/[0.14]"
                  />
                )}
                {m === 'test' ? 'New Data' : 'Training'}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <ComparisonChart runs={comparedDetails} splitMode={splitMode} theme={theme} />
      </div>

      {/* Gold / Silver / Bronze ranked strategy strips */}
      {topThree.length > 0 && (
        <section aria-label="Top ranked strategies" className="mt-6">
          <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
            <h2 className="text-xs font-semibold tracking-[0.06em] uppercase text-[#43566E] dark:text-[#98A6BA]">
              Top Ranked · {splitMode === 'test' ? 'New Data' : 'Training'}
            </h2>
            <span className="font-mono text-[11px] text-[#5B6E86] dark:text-[#7E8FA5]">
              Ranked by return
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {topThree.map(({ run, metrics }, idx) => {
              const rank = (idx + 1) as 1 | 2 | 3;
              const style = RANK_STYLES[rank];
              const isSelected = comparedIds.includes(run.id);

              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onToggleCompareId(run.id)}
                  className={`${glassCardCls} group relative flex flex-col text-left transition-all hover:border-white/95 dark:hover:border-white/[0.2] ${
                    isSelected ? 'ring-1 ring-[#1A3350]/25 dark:ring-white/20' : ''
                  }`}
                >
                  {/* Brushed metallic rank strip */}
                  <div aria-hidden="true" className={`h-[3.5px] w-full ${style.stripCls}`} />

                  <div className="flex flex-1 flex-col justify-between p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className={`font-mono text-[10px] font-semibold tracking-[0.14em] ${style.textCls}`}>
                          {style.tier}
                        </div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-[#162436] dark:text-white">
                            {run.config.algorithm}
                          </span>
                          <span className="font-mono text-xs text-[#4D6078] dark:text-[#8E9DB2]">
                            {run.config.symbol} · {run.config.interval}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`font-mono text-lg font-semibold leading-none tabular-nums ${
                          metrics.totalReturnPct >= 0
                            ? 'text-[#0E8554] dark:text-[#22C58B]'
                            : 'text-[#C73B33] dark:text-[#F0645C]'
                        }`}
                      >
                        {formatSignedPct(metrics.totalReturnPct)}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[#162436]/[0.08] pt-3 font-mono text-[11px] tabular-nums dark:border-white/[0.08]">
                      <div>
                        <div className="font-sans text-[10px] text-[#5B6E86] dark:text-[#7E8FA5]">
                          vs. Hold
                        </div>
                        <div
                          className={`mt-0.5 font-medium ${
                            metrics.alphaPct >= 0
                              ? 'text-[#0E8554] dark:text-[#22C58B]'
                              : 'text-[#C73B33] dark:text-[#F0645C]'
                          }`}
                        >
                          {formatSignedPct(metrics.alphaPct)}
                        </div>
                      </div>
                      <div>
                        <div className="font-sans text-[10px] text-[#5B6E86] dark:text-[#7E8FA5]">
                          Risk Score
                        </div>
                        <div className="mt-0.5 font-medium text-[#162436] dark:text-white">
                          {formatRatio(metrics.sharpeRatio)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-sans text-[10px] text-[#5B6E86] dark:text-[#7E8FA5]">
                          Drop
                        </div>
                        <div className="mt-0.5 font-medium text-[#C73B33] dark:text-[#F0645C]">
                          {formatSignedPct(metrics.maxDrawdownPct)}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Runs table */}
      <div className={`${glassCardCls} mt-6`}>
        <div className="border-b border-[#162436]/[0.08] px-5 py-4 dark:border-white/[0.08]">
          <h2 className="text-sm font-semibold text-[#162436] dark:text-white">
            Saved Runs ({runs.length}) · {splitMode === 'test' ? 'New Data' : 'Training'}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead>
              <tr className="border-b border-[#162436]/[0.08] bg-white/35 text-[#4D6078] dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-[#8E9DB2]">
                <th className="px-4 py-2.5 font-medium">Show</th>
                <th className="px-4 py-2.5 font-medium">Strategy</th>
                <th className="px-4 py-2.5 font-medium">Asset</th>
                <th className="px-4 py-2.5 font-medium">Dates</th>
                <th className="px-4 py-2.5 text-right font-medium">Return</th>
                <th className="px-4 py-2.5 text-right font-medium">vs. Hold</th>
                <th className="px-4 py-2.5 text-right font-medium">Risk Score</th>
                <th className="px-4 py-2.5 text-right font-medium">Biggest Drop</th>
                <th className="px-4 py-2.5 text-right font-medium">Win %</th>
                <th className="px-4 py-2.5 text-right font-medium">Trades</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#162436]/[0.06] dark:divide-white/[0.06]">
              {runs.map((run) => {
                const selectedIdx = comparedIds.indexOf(run.id);
                const isSelected = selectedIdx !== -1;
                const m = summaryMetricsFor(run);
                const rank = rankByRunId.get(run.id) || null;
                const rankStyle = rank ? RANK_STYLES[rank] : null;
                const isBestRet =
                  isSelected && m !== null && Number.isFinite(bestReturn) && m.totalReturnPct === bestReturn;
                const isBestSh =
                  isSelected && m !== null && Number.isFinite(bestSharpe) && m.sharpeRatio === bestSharpe;

                return (
                  <tr
                    key={run.id}
                    className={`transition-colors ${
                      isSelected
                        ? 'bg-[#1A3350]/[0.06] dark:bg-white/[0.06]'
                        : 'hover:bg-white/40 dark:hover:bg-white/[0.035]'
                    }`}
                  >
                    <td className="relative px-4 py-3">
                      {rankStyle && (
                        <span
                          aria-hidden="true"
                          className={`absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-full ${rankStyle.sideStripCls}`}
                        />
                      )}
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleCompareId(run.id)}
                          aria-label={`Select ${run.config.algorithm} on ${run.config.symbol} for comparison`}
                          className="h-3.5 w-3.5 accent-[#1A3350] dark:accent-[#ECEFF4]"
                        />
                        {isSelected && (
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: palette[selectedIdx % palette.length] }}
                          />
                        )}
                      </label>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#162436] dark:text-white">
                          {run.config.algorithm}
                        </span>
                        {rankStyle && (
                          <span className={`font-mono text-[10px] font-semibold tracking-wider ${rankStyle.textCls}`}>
                            {rankStyle.short}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-[#4D6078] dark:text-[#8E9DB2]">
                        {run.completedEpisodes}/{run.config.episodes} passes · {(run.config.feeBps / 100).toFixed(2)}% fee
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-[#162436] dark:text-[#F4F7FB]">
                      {run.config.symbol}
                      <span className="ml-1.5 font-normal text-[#4D6078] dark:text-[#8E9DB2]">
                        {run.config.interval}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-[#4D6078] tabular-nums dark:text-[#8E9DB2]">
                      {splitMode === 'test'
                        ? `${formatShortDate(run.split.testStart)} – ${formatShortDate(run.split.testEnd)}`
                        : `${formatShortDate(run.split.trainStart)} – ${formatShortDate(run.split.trainEnd)}`}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono tabular-nums ${
                        m
                          ? m.totalReturnPct >= 0
                            ? 'text-[#0E8554] dark:text-[#22C58B]'
                            : 'text-[#C73B33] dark:text-[#F0645C]'
                          : 'text-[#6B7E94]'
                      } ${isBestRet ? 'font-semibold underline underline-offset-4' : ''}`}
                    >
                      {formatSignedPct(m?.totalReturnPct)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[#31455C] tabular-nums dark:text-[#C5D0DF]">
                      {formatSignedPct(m?.alphaPct)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-[#162436] tabular-nums dark:text-white ${
                        isBestSh ? 'font-semibold underline underline-offset-4' : ''
                      }`}
                    >
                      {formatRatio(m?.sharpeRatio)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[#C73B33] tabular-nums dark:text-[#F0645C]">
                      {formatSignedPct(m?.maxDrawdownPct)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[#31455C] tabular-nums dark:text-[#C5D0DF]">
                      {formatPct(m?.winRatePct, 1)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[#31455C] tabular-nums dark:text-[#C5D0DF]">
                      {m ? m.totalTrades : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-3">
                        {!run.hasBacktest && run.hasWeights && (
                          <button
                            type="button"
                            onClick={() => onOpenBacktest(run.id)}
                            className="text-xs font-medium text-[#1A3350] underline underline-offset-4 hover:text-[#0E8554] dark:text-white dark:hover:text-[#22C58B]"
                          >
                            Test
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteRun(run.id)}
                          aria-label={`Delete run ${run.config.algorithm} ${run.config.symbol}`}
                          className="text-[#6B7E94] transition-colors hover:text-[#C73B33] dark:hover:text-[#F0645C]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
