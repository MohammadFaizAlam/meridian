import { AlertCircle, ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import type { ForecastResponse, MarketDataResponse } from '../types/trading';
import { formatPct, formatPrice, formatSignedPct } from '../utils/format';
import { PriceTradeChart } from './charts/PriceTradeChart';

interface ForecastViewProps {
  market: MarketDataResponse | null;
  forecast: ForecastResponse | null;
  loading: boolean;
  error: string | null;
  theme: 'dark' | 'light';
  onRetry: () => void;
  onGoToWorkbench: () => void;
}

function scoreTone(score: number): string {
  if (score >= 0.12) return 'text-[#0E8554] dark:text-[#22C58B]';
  if (score <= -0.12) return 'text-[#C73B33] dark:text-[#F0645C]';
  return 'text-[#5E6470] dark:text-[#98A2B3]';
}

function scoreMeterPct(score: number): number {
  return Math.max(4, Math.min(96, ((score + 1) / 2) * 100));
}

export function ForecastView({
  market,
  forecast,
  loading,
  error,
  theme,
  onRetry,
  onGoToWorkbench,
}: ForecastViewProps) {
  const glassCardCls =
    'overflow-hidden rounded-2xl border border-white/75 bg-white/56 shadow-[0_12px_36px_-10px_rgba(22,36,54,0.12),inset_0_1px_0_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.11] dark:bg-[#0D121C]/74 dark:shadow-[0_22px_54px_-14px_rgba(0,0,0,0.68),inset_0_1px_0_0_rgba(255,255,255,0.10)]';

  if (error) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
        <div role="alert" className={`${glassCardCls} flex flex-wrap items-center justify-between gap-4 p-6`}>
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C73B33] dark:text-[#F0645C]" />
            <div>
              <p className="text-sm font-semibold text-[#162436] dark:text-white">
                Unable to load forecast
              </p>
              <p className="mt-1 text-xs text-[#4D6078] dark:text-[#8A94A6]">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#162436]/[0.12] bg-white/75 px-3.5 py-2 text-xs font-medium text-[#162436] transition-colors hover:bg-white dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      </div>
    );
  }

  if ((loading && !forecast) || !forecast || !market) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
        <div className={`${glassCardCls} animate-pulse space-y-4 p-8`}>
          <div className="h-6 w-56 rounded-lg bg-[#162436]/[0.08] dark:bg-white/[0.08]" />
          <div className="h-4 w-80 rounded-lg bg-[#162436]/[0.06] dark:bg-white/[0.05]" />
          <div className="h-[260px] w-full rounded-xl bg-[#162436]/[0.05] dark:bg-white/[0.04]" />
        </div>
      </div>
    );
  }

  const h5 = forecast.horizons.find((h) => h.horizonBars === 5) || forecast.horizons[0];

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-5 sm:px-6 sm:py-6">
      {/* Outlook summary and targets */}
      <div className={`${glassCardCls} p-6 sm:p-7`}>
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-[#162436] dark:text-white">
                {forecast.symbol} Forecast
              </h1>
              <span className={`text-base font-semibold ${scoreTone(forecast.compositeScore)}`}>
                {forecast.outlook}
              </span>
            </div>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[#43566E] dark:text-[#98A2B3]">
              Combines recent price trends, chart patterns, and your trained model as of {forecast.asOfDate}. Shaded bands show the typical 80% price range.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs tabular-nums">
            <div>
              <div className="text-[11px] text-[#4D6078] dark:text-[#8A94A6]">Last Price</div>
              <div className="mt-0.5 text-base font-semibold text-[#162436] dark:text-white">
                {formatPrice(forecast.lastClose)} {forecast.currency}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#4D6078] dark:text-[#8A94A6]">Market Trend</div>
              <div className="mt-0.5 text-sm font-medium text-[#162436] dark:text-white">
                {forecast.regime.label}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#4D6078] dark:text-[#8A94A6]">Trend Strength</div>
              <div className="mt-0.5 text-sm font-medium text-[#162436] dark:text-white">
                {forecast.regime.adx14}
              </div>
            </div>
          </div>
        </div>

        {/* Multi-step price targets */}
        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-[#162436]/[0.08] pt-6 md:grid-cols-3 dark:border-white/[0.07]">
          {forecast.horizons.map((h) => {
            const up = h.expectedReturnPct >= 0;
            return (
              <div
                key={h.horizonBars}
                className="rounded-xl border border-[#162436]/[0.08] bg-white/45 p-4 dark:border-white/[0.07] dark:bg-white/[0.025]"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#1E3148] dark:text-[#C9D2E0]">
                    {h.label} outlook
                  </span>
                  <span className="font-mono text-[11px] text-[#4D6078] dark:text-[#8A94A6]">
                    {h.targetDate}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3 font-mono tabular-nums">
                  <span className="text-xl font-semibold text-[#162436] dark:text-white">
                    {formatPrice(h.projectedPrice)}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      up ? 'text-[#0E8554] dark:text-[#22C58B]' : 'text-[#C73B33] dark:text-[#F0645C]'
                    }`}
                  >
                    {formatSignedPct(h.expectedReturnPct)}
                  </span>
                </div>
                <div className="mt-2 font-mono text-[11px] text-[#4D6078] tabular-nums dark:text-[#8A94A6]">
                  Likely range: {formatPrice(h.lowBand)} – {formatPrice(h.highBand)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Projected price chart */}
      <div className={glassCardCls}>
        <PriceTradeChart
          bars={market.bars}
          split={null}
          trades={[]}
          mode="full"
          symbol={`${forecast.symbol} Forecast`}
          currency={forecast.currency}
          height={380}
          theme={theme}
          forecast={forecast.trajectory}
          showForecast={true}
          supportLevel={forecast.keyLevels.support}
          resistanceLevel={forecast.keyLevels.resistance}
        />
      </div>

      {/* Signals, drivers, and past accuracy */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Detected chart signals */}
        <div className={`xl:col-span-7 ${glassCardCls}`}>
          <div className="flex items-center justify-between border-b border-[#162436]/[0.08] px-6 py-4 dark:border-white/[0.07]">
            <div>
              <h2 className="text-sm font-semibold text-[#162436] dark:text-white">
                Detected Signals
              </h2>
              <p className="mt-0.5 text-xs text-[#4D6078] dark:text-[#8A94A6]">
                Active patterns found in recent price swings and volume.
              </p>
            </div>
            <span className="font-mono text-xs text-[#4D6078] tabular-nums dark:text-[#8A94A6]">
              {forecast.patterns.length} active
            </span>
          </div>

          <div className="divide-y divide-[#162436]/[0.06] dark:divide-white/[0.06]">
            {forecast.patterns.length === 0 ? (
              <div className="px-6 py-10 text-center text-xs text-[#4D6078] dark:text-[#8A94A6]">
                Price movement is calm right now with no major breakout or reversal signal.
              </div>
            ) : (
              forecast.patterns.map((p, idx) => (
                <div key={`${p.name}-${idx}`} className="flex flex-col gap-1.5 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-[13px] font-semibold text-[#162436] dark:text-white">
                        {p.name}
                      </span>
                      <span className="font-mono text-[11px] text-[#4D6078] dark:text-[#8A94A6]">
                        {p.category}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[#43566E] dark:text-[#98A2B3]">
                      {p.evidence}
                    </p>
                  </div>
                  <div className="shrink-0 font-mono text-xs font-medium capitalize tabular-nums sm:text-right">
                    <span
                      className={
                        p.bias === 'bullish'
                          ? 'text-[#0E8554] dark:text-[#22C58B]'
                          : p.bias === 'bearish'
                            ? 'text-[#C73B33] dark:text-[#F0645C]'
                            : 'text-[#4D6078] dark:text-[#8A94A6]'
                      }
                    >
                      {p.bias === 'bullish' ? 'Upward' : p.bias === 'bearish' ? 'Downward' : 'Neutral'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Key price levels */}
          <div className="grid grid-cols-2 gap-4 border-t border-[#162436]/[0.08] bg-white/35 px-6 py-4 font-mono text-xs tabular-nums sm:grid-cols-4 dark:border-white/[0.07] dark:bg-white/[0.02]">
            <div>
              <div className="font-sans text-[11px] text-[#4D6078] dark:text-[#8A94A6]">Support Floor</div>
              <div className="mt-0.5 font-semibold text-[#0E8554] dark:text-[#22C58B]">
                {formatPrice(forecast.keyLevels.support)}
              </div>
              <div className="text-[10px] text-[#4D6078] dark:text-[#8A94A6]">
                {formatSignedPct(forecast.keyLevels.supportDistancePct)}
              </div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-[#4D6078] dark:text-[#8A94A6]">Resistance Cap</div>
              <div className="mt-0.5 font-semibold text-[#C73B33] dark:text-[#F0645C]">
                {formatPrice(forecast.keyLevels.resistance)}
              </div>
              <div className="text-[10px] text-[#4D6078] dark:text-[#8A94A6]">
                {formatSignedPct(forecast.keyLevels.resistanceDistancePct)}
              </div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-[#4D6078] dark:text-[#8A94A6]">Typical Move</div>
              <div className="mt-0.5 font-semibold text-[#162436] dark:text-white">
                {formatPrice(forecast.keyLevels.atrMove)}
              </div>
              <div className="text-[10px] text-[#4D6078] dark:text-[#8A94A6]">
                {forecast.regime.atrPct}% per step
              </div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-[#4D6078] dark:text-[#8A94A6]">Momentum</div>
              <div className="mt-0.5 font-semibold text-[#162436] dark:text-white">
                {forecast.regime.rsi14 !== null ? forecast.regime.rsi14.toFixed(1) : '—'}
              </div>
              <div className="text-[10px] text-[#4D6078] dark:text-[#8A94A6]">
                Range pos {forecast.regime.donchianPct}%
              </div>
            </div>
          </div>
        </div>

        {/* Outlook drivers and accuracy check */}
        <div className="flex flex-col gap-6 xl:col-span-5">
          <div className={`${glassCardCls} p-6`}>
            <h2 className="text-sm font-semibold text-[#162436] dark:text-white">
              What Drives This Outlook
            </h2>
            <p className="mt-0.5 text-xs text-[#4D6078] dark:text-[#8A94A6]">
              Scores run from -1.0 (downward) to +1.0 (upward).
            </p>

            <div className="mt-5 space-y-4">
              {[
                {
                  label: 'Price Trend Model',
                  score: forecast.components.statisticalScore,
                  detail: h5 ? `5-step estimate: ${formatSignedPct(h5.expectedReturnPct)}` : 'Multi-step price trend',
                },
                {
                  label: 'Chart Signals',
                  score: forecast.components.patternScore,
                  detail: `${forecast.patterns.length} active signal(s)`,
                },
                ...(forecast.components.rlScore !== null && forecast.rlSignal
                  ? [
                      {
                        label: `Your ${forecast.rlSignal.algorithm} Model`,
                        score: forecast.components.rlScore,
                        detail: `${forecast.rlSignal.stance} · Buy ${forecast.rlSignal.buyProb}% / Sell ${forecast.rlSignal.sellProb}%`,
                      },
                    ]
                  : []),
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium text-[#1E3148] dark:text-[#D1DAE7]">{item.label}</span>
                    <span className={`font-mono font-semibold tabular-nums ${scoreTone(item.score)}`}>
                      {item.score >= 0 ? '+' : ''}
                      {item.score.toFixed(2)}
                    </span>
                  </div>
                  <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#162436]/[0.09] dark:bg-white/[0.08]">
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[#162436]/25 dark:bg-white/25" />
                    <motion.div
                      initial={{ left: '50%' }}
                      animate={{ left: `${scoreMeterPct(item.score)}%` }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1A3350] dark:bg-white"
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-[#4D6078] dark:text-[#8A94A6]">{item.detail}</div>
                </div>
              ))}
            </div>

            {!forecast.rlSignal && (
              <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[#162436]/[0.08] bg-white/45 px-4 py-3 text-xs dark:border-white/[0.07] dark:bg-white/[0.025]">
                <span className="text-[#43566E] dark:text-[#98A2B3]">
                  Train a strategy on {forecast.symbol} to add its live signal here.
                </span>
                <button
                  type="button"
                  onClick={onGoToWorkbench}
                  className="inline-flex shrink-0 items-center gap-1 font-medium text-[#1A3350] underline underline-offset-4 dark:text-white"
                >
                  Train <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Historical accuracy check */}
          <div className={`${glassCardCls} p-6`}>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#0E8554] dark:text-[#22C58B]" />
              <h2 className="text-sm font-semibold text-[#162436] dark:text-white">
                Past Forecast Accuracy
              </h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[#4D6078] dark:text-[#8A94A6]">
              Checked across {forecast.audit.samplesEvaluated} past {forecast.audit.horizonBars}-step windows of {forecast.symbol} using only earlier data.
            </p>

            <div className="mt-5 grid grid-cols-3 gap-4 border-t border-[#162436]/[0.08] pt-4 font-mono tabular-nums dark:border-white/[0.07]">
              <div>
                <div className="font-sans text-[11px] text-[#4D6078] dark:text-[#8A94A6]">
                  Right Direction
                </div>
                <div className="mt-1 text-lg font-semibold text-[#162436] dark:text-white">
                  {formatPct(forecast.audit.directionalAccuracyPct, 1)}
                </div>
              </div>
              <div>
                <div className="font-sans text-[11px] text-[#4D6078] dark:text-[#8A94A6]">
                  Avg Price Miss
                </div>
                <div className="mt-1 text-lg font-semibold text-[#162436] dark:text-white">
                  {formatPct(forecast.audit.meanAbsErrorPct, 2)}
                </div>
              </div>
              <div>
                <div className="font-sans text-[11px] text-[#4D6078] dark:text-[#8A94A6]">
                  Always-Up Rate
                </div>
                <div className="mt-1 text-lg font-semibold text-[#43566E] dark:text-[#98A2B3]">
                  {formatPct(forecast.audit.baselineUpPct, 1)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
