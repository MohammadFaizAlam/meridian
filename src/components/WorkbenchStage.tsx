import { AlertCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import type {
  AlgorithmType,
  EquityPoint,
  ForecastResponse,
  MarketDataResponse,
  RunDetail,
  RunSummary,
} from '../types/trading';
import {
  formatCurrency,
  formatPct,
  formatPrice,
  formatRatio,
  formatShortDate,
  formatSignedPct,
} from '../utils/format';
import { PriceTradeChart } from './charts/PriceTradeChart';
import { EquityCurveChart } from './charts/EquityCurveChart';
import { RewardChart } from './charts/RewardChart';
import { PortfolioMetalCard } from './PortfolioMetalCard';

interface WorkbenchStageProps {
  market: MarketDataResponse | null;
  marketLoading: boolean;
  marketError: string | null;
  forecast: ForecastResponse | null;
  showForecastOverlay: boolean;
  activeRun: RunDetail | null;
  recentRuns: RunSummary[];
  initialCapital: number;
  selectedAlgorithm: AlgorithmType;
  theme: 'dark' | 'light';
  onToggleForecastOverlay: () => void;
  onRetryMarket: () => void;
  onSelectRun: (runId: string) => void;
  onOpenBacktest: (runId: string) => void;
}

function riskScoreLabel(sharpe: number | null | undefined): string {
  if (sharpe === null || sharpe === undefined || !Number.isFinite(sharpe)) return '';
  if (sharpe >= 1.5) return 'Strong';
  if (sharpe >= 0.75) return 'Solid';
  if (sharpe >= 0) return 'Modest';
  return 'Negative';
}

function drawdownSeverityLabel(ddPct: number | null | undefined): string {
  if (ddPct === null || ddPct === undefined || !Number.isFinite(ddPct)) return '';
  const abs = Math.abs(ddPct);
  if (abs <= 5) return 'Low';
  if (abs <= 15) return 'Moderate';
  return 'High';
}

// Compact inline sparkline comparing strategy equity against buy-and-hold
function MiniEquitySparkline({
  curve,
  isGain,
}: {
  curve: EquityPoint[];
  isGain: boolean;
}) {
  if (curve.length < 2) return null;

  const w = 104;
  const h = 30;
  const padY = 3;

  // Sample up to 48 points to keep SVG lightweight
  const step = Math.max(1, Math.floor(curve.length / 48));
  const pts: EquityPoint[] = [];
  for (let i = 0; i < curve.length; i += step) pts.push(curve[i]);
  if (pts[pts.length - 1] !== curve[curve.length - 1]) pts.push(curve[curve.length - 1]);

  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of pts) {
    if (p.equity < minV) minV = p.equity;
    if (p.equity > maxV) maxV = p.equity;
    if (p.benchmark_equity < minV) minV = p.benchmark_equity;
    if (p.benchmark_equity > maxV) maxV = p.benchmark_equity;
  }
  const span = Math.max(maxV - minV, 1e-6);
  const xAt = (i: number) => (i / Math.max(pts.length - 1, 1)) * w;
  const yAt = (v: number) => padY + ((maxV - v) / span) * (h - padY * 2);

  const stratD = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.equity).toFixed(1)}`)
    .join(' ');
  const benchD = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.benchmark_equity).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <path
        d={benchD}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.1}
        strokeDasharray="2.5 2.5"
        className="text-[#6B7E94]/65 dark:text-[#667085]/75"
      />
      <path
        d={stratD}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isGain ? 'text-[#0E8554] dark:text-[#22C58B]' : 'text-[#C73B33] dark:text-[#F0645C]'}
      />
    </svg>
  );
}

export function WorkbenchStage({
  market,
  marketLoading,
  marketError,
  forecast,
  showForecastOverlay,
  activeRun,
  recentRuns,
  initialCapital,
  selectedAlgorithm,
  theme,
  onToggleForecastOverlay,
  onRetryMarket,
  onSelectRun,
  onOpenBacktest,
}: WorkbenchStageProps) {
  const trainMetrics = activeRun?.trainTrace?.metrics || null;
  const latestEp = activeRun?.episodes[activeRun.episodes.length - 1] || null;
  const progressPct =
    activeRun && activeRun.config.episodes > 0
      ? Math.min(100, (activeRun.episodes.length / activeRun.config.episodes) * 100)
      : 0;

  const matchingRun =
    activeRun && market && activeRun.config.symbol === market.meta.symbol ? activeRun : null;
  const activeCurve = matchingRun?.trainTrace?.equityCurve || activeRun?.trainTrace?.equityCurve || [];

  const netDollarChange = trainMetrics
    ? trainMetrics.finalEquity - trainMetrics.initialCapital
    : null;
  const ddDepth = trainMetrics ? Math.min(100, Math.abs(trainMetrics.maxDrawdownPct) * 2.5) : 0;
  const winBarPct =
    trainMetrics?.winRatePct !== null && trainMetrics?.winRatePct !== undefined
      ? Math.max(0, Math.min(100, trainMetrics.winRatePct))
      : null;
  const totalCosts = trainMetrics
    ? trainMetrics.totalFeesPaid + trainMetrics.totalSlippagePaid
    : null;

  const rangePosPct =
    market && market.summary.periodHigh > market.summary.periodLow
      ? Math.max(
          0,
          Math.min(
            100,
            ((market.summary.lastClose - market.summary.periodLow) /
              (market.summary.periodHigh - market.summary.periodLow)) *
              100,
          ),
        )
      : null;

  const cardBalance = trainMetrics ? trainMetrics.finalEquity : initialCapital;
  const cardSymbol = market?.meta.symbol || activeRun?.config.symbol || 'AAPL';
  const cardCurrency = market?.meta.currency || 'USD';
  const cardAlgorithm = activeRun?.config.algorithm || selectedAlgorithm;
  const cardProgress = activeRun
    ? `${activeRun.episodes.length}/${activeRun.config.episodes} PASS`
    : 'STANDBY';

  const glassCardCls =
    'overflow-hidden rounded-2xl border border-white/75 bg-white/56 shadow-[0_12px_36px_-10px_rgba(22,36,54,0.12),inset_0_1px_0_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.11] dark:bg-[#0D121C]/74 dark:shadow-[0_22px_54px_-14px_rgba(0,0,0,0.68),inset_0_1px_0_0_rgba(255,255,255,0.10)]';

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      {/* Instrument header and unified portfolio tearsheet with embedded metal card */}
      <section aria-label="Portfolio and market overview" className={`relative ${glassCardCls}`}>
        {marketError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-4 px-6 py-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C73B33] dark:text-[#F0645C]" />
              <div>
                <p className="text-sm font-medium text-[#162436] dark:text-white">
                  Unable to load market data
                </p>
                <p className="mt-1 text-xs text-[#4D6078] dark:text-[#8A94A6]">{marketError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRetryMarket}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#162436]/[0.12] bg-white/75 px-3.5 py-2 text-xs font-medium text-[#162436] transition-colors hover:bg-white dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        ) : marketLoading && !market ? (
          <div className="animate-pulse space-y-4 px-6 py-6">
            <div className="flex items-baseline justify-between gap-4">
              <div className="h-7 w-44 rounded-lg bg-[#162436]/[0.08] dark:bg-white/[0.08]" />
              <div className="h-7 w-32 rounded-lg bg-[#162436]/[0.08] dark:bg-white/[0.08]" />
            </div>
            <div className="grid grid-cols-1 gap-6 border-t border-[#162436]/[0.08] pt-6 md:grid-cols-12 dark:border-white/[0.07]">
              <div className="space-y-2 md:col-span-5">
                <div className="h-4 w-28 rounded bg-[#162436]/[0.06] dark:bg-white/[0.06]" />
                <div className="h-9 w-40 rounded bg-[#162436]/[0.08] dark:bg-white/[0.08]" />
              </div>
              <div className="grid grid-cols-2 gap-4 md:col-span-7">
                <div className="h-14 rounded bg-[#162436]/[0.05] dark:bg-white/[0.05]" />
                <div className="h-14 rounded bg-[#162436]/[0.05] dark:bg-white/[0.05]" />
              </div>
            </div>
          </div>
        ) : market ? (
          <div>
            {/* Top quote ribbon */}
            <div className="flex flex-col gap-4 border-b border-[#162436]/[0.09] px-5 py-5 sm:px-7 lg:flex-row lg:items-center lg:justify-between dark:border-white/[0.08]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <h1 className="text-[26px] font-semibold leading-none tracking-tight text-[#162436] dark:text-white">
                    {market.meta.symbol}
                  </h1>
                  <span className="truncate text-sm font-medium text-[#43566E] dark:text-[#9AA5B8]">
                    {market.meta.name}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-[#5B6E86] dark:text-[#7D889B]">
                  {market.meta.exchange} · {market.meta.source}
                  {market.meta.cached ? ' · Cached' : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-7 gap-y-3 lg:justify-end">
                {/* Period price range locator */}
                {rangePosPct !== null && (
                  <div className="hidden min-w-[156px] flex-col gap-1.5 sm:flex">
                    <div className="flex items-center justify-between font-mono text-[10px] text-[#5B6E86] tabular-nums dark:text-[#7D889B]">
                      <span>Low {formatPrice(market.summary.periodLow)}</span>
                      <span>High {formatPrice(market.summary.periodHigh)}</span>
                    </div>
                    <div className="relative h-1 w-full rounded-full bg-[#162436]/[0.12] dark:bg-white/[0.12]">
                      <div
                        className="absolute top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-xs bg-[#1A3350] dark:bg-[#E8EDF5]"
                        style={{ left: `${rangePosPct}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono tabular-nums">
                  <span className="text-2xl font-semibold tracking-tight text-[#162436] dark:text-white">
                    {formatPrice(market.summary.lastClose)}
                    <span className="ml-1.5 text-[11px] font-normal text-[#5B6E86] dark:text-[#8A94A6]">
                      {market.meta.currency}
                    </span>
                  </span>
                  <div className="flex items-center gap-3 text-xs">
                    <span
                      className={`font-medium ${
                        market.summary.lastChangePct >= 0
                          ? 'text-[#0E8554] dark:text-[#22C58B]'
                          : 'text-[#C73B33] dark:text-[#F0645C]'
                      }`}
                    >
                      Last {formatSignedPct(market.summary.lastChangePct)}
                    </span>
                    <span className="text-[#4D6078] dark:text-[#8A94A6]">
                      Total {formatSignedPct(market.summary.periodReturnPct)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Portfolio valuation + right-edge peeking metal card inside the main glass card */}
            <div className="relative overflow-hidden">
              <div className="flex flex-col md:min-h-[196px] md:flex-row md:items-stretch lg:min-h-[210px]">
                {/* Left anchor: portfolio valuation and benchmark spread (reserved clear space, never overlapped) */}
                <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-between gap-5 px-5 pt-6 pb-4 sm:px-7 md:py-6 md:pr-[222px] lg:pr-[242px] xl:pr-[252px]">
                  <div>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-medium text-[#43566E] dark:text-[#98A6BA]">
                        Portfolio Balance
                      </span>
                      <span className="font-mono text-[11px] text-[#5B6E86] tabular-nums whitespace-nowrap dark:text-[#7E8FA5]">
                        {activeRun
                          ? `${activeRun.config.algorithm} · Pass ${activeRun.episodes.length}/${activeRun.config.episodes}`
                          : 'Not trained yet'}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
                      <motion.div
                        key={trainMetrics ? trainMetrics.finalEquity : 'idle'}
                        initial={{ opacity: 0.72 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.16 }}
                        className="font-mono text-[32px] font-semibold leading-none tracking-tight text-[#162436] tabular-nums sm:text-[36px] dark:text-white"
                      >
                        {trainMetrics
                          ? formatCurrency(trainMetrics.finalEquity, market.meta.currency)
                          : '—'}
                      </motion.div>

                      {activeCurve.length > 1 && netDollarChange !== null && (
                        <div className="flex items-center gap-2.5">
                          <MiniEquitySparkline curve={activeCurve} isGain={netDollarChange >= 0} />
                          <span className="hidden font-mono text-[10px] text-[#5B6E86] sm:inline dark:text-[#7E8FA5]">
                            vs. Hold
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Net return and benchmark comparison */}
                  {netDollarChange !== null && trainMetrics ? (
                    <div className="space-y-2 border-t border-[#162436]/[0.07] pt-3.5 dark:border-white/[0.06]">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-xs tabular-nums">
                        <span
                          className={
                            netDollarChange >= 0
                              ? 'font-semibold text-[#0E8554] dark:text-[#22C58B]'
                              : 'font-semibold text-[#C73B33] dark:text-[#F0645C]'
                          }
                        >
                          {netDollarChange >= 0 ? '+' : ''}
                          {formatCurrency(netDollarChange, market.meta.currency)} (
                          {formatSignedPct(trainMetrics.totalReturnPct)})
                        </span>
                        <span className="text-[#4D6078] dark:text-[#8E9DB2]">
                          vs. Hold{' '}
                          <strong
                            className={
                              trainMetrics.alphaPct >= 0
                                ? 'font-medium text-[#0E8554] dark:text-[#22C58B]'
                                : 'font-medium text-[#C73B33] dark:text-[#F0645C]'
                            }
                          >
                            {formatSignedPct(trainMetrics.alphaPct)}
                          </strong>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#5B6E86] tabular-nums dark:text-[#7E8FA5]">
                        <span>Start {formatCurrency(trainMetrics.initialCapital, market.meta.currency)}</span>
                        <span>
                          Buy &amp; Hold{' '}
                          {formatCurrency(trainMetrics.benchmarkFinalEquity, market.meta.currency)} (
                          {formatSignedPct(trainMetrics.benchmarkReturnPct)})
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="border-t border-[#162436]/[0.07] pt-3.5 text-xs leading-relaxed text-[#5B6E86] dark:border-white/[0.06] dark:text-[#7E8FA5]">
                      Run training from Setup to see portfolio profit, risk score, and trade performance
                      against Buy &amp; Hold.
                    </div>
                  )}
                </div>

                {/* Peeking tilted metal card anchored inside the right edge; only the far right tail is clipped */}
                <div className="relative h-[178px] overflow-hidden md:pointer-events-auto md:absolute md:inset-y-0 md:right-0 md:h-auto md:w-[218px] lg:w-[238px] xl:w-[248px]">
                  <div className="absolute top-1/2 -right-[34px] -translate-y-1/2 md:-right-[38px] lg:-right-[40px] xl:-right-[36px]">
                    <PortfolioMetalCard
                      balance={cardBalance}
                      currency={cardCurrency}
                      returnPct={trainMetrics ? trainMetrics.totalReturnPct : null}
                      symbol={cardSymbol}
                      algorithm={cardAlgorithm}
                      runId={activeRun?.id || null}
                      progressLabel={cardProgress}
                      isTrained={Boolean(trainMetrics)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Hairline-divided 4-metric financial ledger strip inside the same card */}
            <div className="grid grid-cols-1 divide-y divide-[#162436]/[0.08] border-t border-[#162436]/[0.09] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 dark:divide-white/[0.07] dark:border-white/[0.08]">
              {/* Risk Score */}
              <div className="flex flex-col justify-between gap-2 px-5 py-4.5 sm:border-r sm:border-b sm:border-[#162436]/[0.08] sm:px-6 sm:py-5 xl:border-b-0 dark:sm:border-white/[0.07]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[#43566E] dark:text-[#98A6BA]">
                    Risk Score
                  </span>
                  {trainMetrics && (
                    <span className="font-mono text-[11px] text-[#5B6E86] dark:text-[#7E8FA5]">
                      {riskScoreLabel(trainMetrics.sharpeRatio)}
                    </span>
                  )}
                </div>
                <div className="font-mono text-[22px] font-semibold leading-tight tracking-tight text-[#162436] tabular-nums dark:text-white">
                  {formatRatio(trainMetrics?.sharpeRatio)}
                </div>
                <div className="font-mono text-[11px] text-[#5B6E86] tabular-nums dark:text-[#7E8FA5]">
                  {trainMetrics ? (
                    <>
                      Downside {formatRatio(trainMetrics.sortinoRatio)} · Vol{' '}
                      {formatPct(trainMetrics.annualizedVolatilityPct, 1)}
                    </>
                  ) : (
                    <span className="font-sans">Return earned per unit of risk</span>
                  )}
                </div>
              </div>

              {/* Biggest Drop */}
              <div className="flex flex-col justify-between gap-2 px-5 py-4.5 sm:border-b sm:border-[#162436]/[0.08] sm:px-6 sm:py-5 xl:border-r xl:border-b-0 dark:sm:border-white/[0.07]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[#43566E] dark:text-[#98A6BA]">
                    Biggest Drop
                  </span>
                  {trainMetrics && (
                    <span className="font-mono text-[11px] text-[#5B6E86] dark:text-[#7E8FA5]">
                      {drawdownSeverityLabel(trainMetrics.maxDrawdownPct)}
                    </span>
                  )}
                </div>
                <div
                  className={`font-mono text-[22px] font-semibold leading-tight tracking-tight tabular-nums ${
                    trainMetrics && trainMetrics.maxDrawdownPct < -0.5
                      ? 'text-[#C73B33] dark:text-[#F0645C]'
                      : 'text-[#162436] dark:text-white'
                  }`}
                >
                  {formatSignedPct(trainMetrics?.maxDrawdownPct)}
                </div>
                {trainMetrics ? (
                  <div className="space-y-1.5">
                    <div className="h-[3px] w-full overflow-hidden rounded-full bg-[#162436]/[0.1] dark:bg-white/[0.09]">
                      <motion.div
                        className="h-full rounded-full bg-[#C73B33] dark:bg-[#F0645C]"
                        initial={{ width: 0 }}
                        animate={{ width: `${ddDepth}%` }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                    <div className="font-mono text-[11px] text-[#5B6E86] tabular-nums dark:text-[#7E8FA5]">
                      Recovery {formatRatio(trainMetrics.calmarRatio)}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-[#5B6E86] dark:text-[#7E8FA5]">
                    Largest dip from a prior peak
                  </div>
                )}
              </div>

              {/* Winning Trades */}
              <div className="flex flex-col justify-between gap-2 px-5 py-4.5 sm:border-r sm:border-[#162436]/[0.08] sm:px-6 sm:py-5 dark:sm:border-white/[0.07]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[#43566E] dark:text-[#98A6BA]">
                    Winning Trades
                  </span>
                  {trainMetrics && (
                    <span className="font-mono text-[11px] text-[#5B6E86] tabular-nums dark:text-[#7E8FA5]">
                      {trainMetrics.closedRoundTrips} closed
                    </span>
                  )}
                </div>
                <div className="font-mono text-[22px] font-semibold leading-tight tracking-tight text-[#162436] tabular-nums dark:text-white">
                  {formatPct(trainMetrics?.winRatePct, 1)}
                </div>
                {trainMetrics ? (
                  <div className="space-y-1.5">
                    {winBarPct !== null && (
                      <div className="h-[3px] w-full overflow-hidden rounded-full bg-[#C73B33]/30 dark:bg-[#F0645C]/30">
                        <motion.div
                          className="h-full rounded-full bg-[#0E8554] dark:bg-[#22C58B]"
                          initial={{ width: 0 }}
                          animate={{ width: `${winBarPct}%` }}
                          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                    )}
                    <div className="font-mono text-[11px] text-[#5B6E86] tabular-nums dark:text-[#7E8FA5]">
                      Gain / loss {formatRatio(trainMetrics.profitFactor)}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-[#5B6E86] dark:text-[#7E8FA5]">
                    Share of closed trades that profited
                  </div>
                )}
              </div>

              {/* Trades & Execution Costs */}
              <div className="flex flex-col justify-between gap-2 px-5 py-4.5 sm:px-6 sm:py-5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[#43566E] dark:text-[#98A6BA]">
                    Trades
                  </span>
                  {trainMetrics && (
                    <span className="font-mono text-[11px] text-[#5B6E86] tabular-nums dark:text-[#7E8FA5]">
                      In market {formatPct(trainMetrics.exposurePct, 0)}
                    </span>
                  )}
                </div>
                <div className="font-mono text-[22px] font-semibold leading-tight tracking-tight text-[#162436] tabular-nums dark:text-white">
                  {trainMetrics ? trainMetrics.totalTrades : '—'}
                </div>
                <div className="font-mono text-[11px] text-[#5B6E86] tabular-nums dark:text-[#7E8FA5]">
                  {totalCosts !== null ? (
                    <>Fees &amp; slip {formatCurrency(totalCosts, market.meta.currency)}</>
                  ) : (
                    <span className="font-sans">Total orders, fees &amp; price slip</span>
                  )}
                </div>
              </div>
            </div>

            {/* Active run footer band */}
            {activeRun && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#162436]/[0.09] bg-[#162436]/[0.02] px-5 py-3 text-xs sm:px-7 dark:border-white/[0.08] dark:bg-white/[0.015]">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[#43566E] dark:text-[#98A2B3]">
                  <span className="inline-flex items-center gap-2 font-medium capitalize text-[#162436] dark:text-white">
                    {activeRun.status === 'running' && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[#0E8554] dark:bg-[#22C58B]" />
                    )}
                    {activeRun.status}
                  </span>
                  {latestEp && (
                    <span className="font-mono tabular-nums">
                      Pass {latestEp.episode}/{latestEp.totalEpisodes} · Score{' '}
                      {latestEp.totalReward.toFixed(2)}
                    </span>
                  )}
                  {activeRun.split.bestEpisode && (
                    <span className="font-mono text-[#0E8554] tabular-nums dark:text-[#22C58B]">
                      Best model: Pass {activeRun.split.bestEpisode}
                      {typeof activeRun.split.validationSharpe === 'number'
                        ? ` (Check ${activeRun.split.validationSharpe.toFixed(2)})`
                        : ''}
                    </span>
                  )}
                  {activeRun.errorMessage && (
                    <span className="text-[#C73B33] dark:text-[#F0645C]">
                      {activeRun.errorMessage}
                    </span>
                  )}
                </div>

                {activeRun.hasWeights &&
                  (activeRun.status === 'completed' || activeRun.status === 'stopped') && (
                    <button
                      type="button"
                      onClick={() => onOpenBacktest(activeRun.id)}
                      className="inline-flex items-center gap-1.5 font-medium text-[#1A3350] underline underline-offset-4 transition-colors hover:text-[#0E8554] whitespace-nowrap shrink-0 dark:text-white dark:hover:text-[#22C58B]"
                    >
                      Test on new data <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
              </div>
            )}
          </div>
        ) : null}

        {activeRun && (activeRun.status === 'running' || activeRun.status === 'paused') && (
          <div className="h-[2px] w-full bg-[#162436]/[0.08] dark:bg-white/[0.08]">
            <motion.div
              className="h-full bg-[#0E8554] dark:bg-[#22C58B]"
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        )}
      </section>

      {/* Interactive price chart */}
      <div className={glassCardCls}>
        {market && !marketError ? (
          <PriceTradeChart
            bars={market.bars}
            split={market.split}
            trades={matchingRun?.trainTrace?.trades || []}
            mode="full"
            symbol={market.meta.symbol}
            currency={market.meta.currency}
            height={390}
            theme={theme}
            forecast={forecast?.trajectory || null}
            showForecast={showForecastOverlay}
            onToggleForecast={onToggleForecastOverlay}
            supportLevel={showForecastOverlay ? forecast?.keyLevels.support ?? null : null}
            resistanceLevel={showForecastOverlay ? forecast?.keyLevels.resistance ?? null : null}
          />
        ) : (
          <div className="flex h-[340px] items-center justify-center px-6 text-center text-xs text-[#4D6078] dark:text-[#8A94A6]">
            {marketLoading
              ? 'Loading historical prices...'
              : 'Pick a valid symbol to inspect prices.'}
          </div>
        )}
      </div>

      {/* Portfolio growth and learning progress */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className={`min-w-0 xl:col-span-7 ${glassCardCls}`}>
          <EquityCurveChart
            curve={matchingRun?.trainTrace?.equityCurve || activeRun?.trainTrace?.equityCurve || []}
            title="Portfolio vs. Buy & Hold"
            subtitle={
              activeRun
                ? `Training dates (${formatShortDate(activeRun.split.trainStart)} – ${formatShortDate(activeRun.split.trainEnd)})`
                : 'Training period'
            }
            currency={market?.meta.currency || 'USD'}
            height={268}
            theme={theme}
          />
        </div>
        <div className={`min-w-0 xl:col-span-5 ${glassCardCls}`}>
          <RewardChart episodes={activeRun?.episodes || []} height={268} theme={theme} />
        </div>
      </div>

      {/* Recent runs */}
      {recentRuns.length > 0 && (
        <div className={glassCardCls}>
          <div className="flex items-center justify-between border-b border-[#162436]/[0.08] px-6 py-4 dark:border-white/[0.07]">
            <h2 className="text-xs font-semibold tracking-[0.04em] uppercase text-[#43566E] dark:text-[#98A2B3]">
              Recent Runs
            </h2>
            <span className="font-mono text-xs text-[#4D6078] dark:text-[#8A94A6]">
              {recentRuns.length} saved
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-left text-xs">
              <thead>
                <tr className="border-b border-[#162436]/[0.08] bg-white/35 text-[#4D6078] dark:border-white/[0.07] dark:bg-white/[0.02] dark:text-[#8A94A6]">
                  <th className="px-5 py-3 font-medium">Strategy</th>
                  <th className="px-5 py-3 font-medium">Asset</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Train Return</th>
                  <th className="px-5 py-3 text-right font-medium">Risk Score</th>
                  <th className="px-5 py-3 text-right font-medium">New Data Test</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#162436]/[0.06] dark:divide-white/[0.06]">
                {recentRuns.slice(0, 6).map((r) => {
                  const selected = activeRun?.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => onSelectRun(r.id)}
                      className={`cursor-pointer transition-colors ${
                        selected
                          ? 'bg-[#1A3350]/[0.07] dark:bg-white/[0.07]'
                          : 'hover:bg-white/45 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      <td className="px-5 py-3.5 font-medium text-[#162436] dark:text-white">
                        {r.config.algorithm}
                        <span className="ml-2 font-mono text-[11px] font-normal text-[#4D6078] dark:text-[#8A94A6]">
                          {r.completedEpisodes}/{r.config.episodes}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[#162436] dark:text-[#ECEFF4]">
                        {r.config.symbol} · {r.config.interval}
                      </td>
                      <td className="px-5 py-3.5 capitalize text-[#43566E] dark:text-[#98A2B3]">
                        {r.status}
                      </td>
                      <td
                        className={`px-5 py-3.5 text-right font-mono tabular-nums ${
                          r.trainMetrics
                            ? r.trainMetrics.totalReturnPct >= 0
                              ? 'text-[#0E8554] dark:text-[#22C58B]'
                              : 'text-[#C73B33] dark:text-[#F0645C]'
                            : 'text-[#6B7E94]'
                        }`}
                      >
                        {formatSignedPct(r.trainMetrics?.totalReturnPct)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-[#162436] tabular-nums dark:text-[#ECEFF4]">
                        {formatRatio(r.trainMetrics?.sharpeRatio)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                        {r.testMetrics ? (
                          <span
                            className={
                              r.testMetrics.totalReturnPct >= 0
                                ? 'text-[#0E8554] dark:text-[#22C58B]'
                                : 'text-[#C73B33] dark:text-[#F0645C]'
                            }
                          >
                            {formatSignedPct(r.testMetrics.totalReturnPct)}
                          </span>
                        ) : (
                          <span className="text-[#6B7E94] dark:text-[#667085]">Not tested</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
