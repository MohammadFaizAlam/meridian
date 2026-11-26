import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  Pause,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import type {
  AlgorithmType,
  InstrumentOption,
  IntervalType,
  RangeType,
  RewardModeType,
  RunConfig,
  RunStatus,
  SplitInfo,
} from '../types/trading';
import { formatShortDate } from '../utils/format';

interface ConfigRailProps {
  config: RunConfig;
  instruments: InstrumentOption[];
  split: SplitInfo | null;
  activeStatus: RunStatus | null;
  isMarketLoading: boolean;
  onConfigChange: (patch: Partial<RunConfig>) => void;
  onRefreshMarket: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const ALGORITHMS: { id: AlgorithmType; label: string; subtitle: string; hint: string }[] = [
  {
    id: 'DQN',
    label: 'DQN',
    subtitle: 'Value learner',
    hint: 'Scores buy, sell, and hold moves to pick the highest expected payoff.',
  },
  {
    id: 'PPO',
    label: 'PPO',
    subtitle: 'Steady learner',
    hint: 'Adjusts its trading habits gradually for smooth, stable learning.',
  },
  {
    id: 'A2C',
    label: 'A2C',
    subtitle: 'Dual learner',
    hint: 'Uses one model to trade and a second to judge each move.',
  },
  {
    id: 'Q-Learning',
    label: 'Q-Learning',
    subtitle: 'Rule table',
    hint: 'Maps market patterns directly to simple buy, sell, or hold rules.',
  },
];

export function ConfigRail({
  config,
  instruments,
  split,
  activeStatus,
  isMarketLoading,
  onConfigChange,
  onRefreshMarket,
  onStart,
  onPause,
  onResume,
  onStop,
}: ConfigRailProps) {
  const [customTicker, setCustomTicker] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isRunning = activeStatus === 'running';
  const isPaused = activeStatus === 'paused';
  const isLocked = isRunning || isPaused;

  const handleCustomTicker = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = customTicker.trim().toUpperCase();
    if (!cleaned) return;
    onConfigChange({ symbol: cleaned });
    setCustomTicker('');
  };

  const feePct = Number((config.feeBps / 100).toFixed(2));
  const slippagePct = Number((config.slippageBps / 100).toFixed(2));
  const trainPct = Math.round(config.splitRatio * 100);
  const testPct = 100 - trainPct;

  const glassShellCls =
    'overflow-hidden rounded-2xl border border-white/75 bg-white/56 shadow-[0_12px_36px_-10px_rgba(22,36,54,0.12),inset_0_1px_0_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.11] dark:bg-[#0D121C]/74 dark:shadow-[0_22px_54px_-14px_rgba(0,0,0,0.68),inset_0_1px_0_0_rgba(255,255,255,0.10)]';

  const fieldCls =
    'mt-2 h-10 w-full rounded-xl border border-[#162436]/[0.12] bg-white/72 px-3.5 text-[13px] text-[#162436] outline-none transition-colors focus:border-[#1A3350] disabled:opacity-50 dark:border-white/[0.12] dark:bg-[#090D14]/88 dark:text-[#F4F7FB] dark:focus:border-[#AFC3DF]';

  const labelCls = 'block text-[13px] font-medium text-[#1E3148] dark:text-[#D9E2EE]';
  const helperCls = 'mt-2 text-xs leading-relaxed text-[#4D6078] dark:text-[#8E9DB2]';

  const marketSection = (
    <section className="p-6 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold tracking-[0.04em] uppercase text-[#43566E] dark:text-[#98A2B3]">
            Market
          </h2>
        </div>
        <button
          type="button"
          onClick={onRefreshMarket}
          disabled={isMarketLoading || isLocked}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[#43566E] transition-colors hover:bg-[#162436]/[0.06] hover:text-[#162436] disabled:opacity-40 dark:text-[#98A2B3] dark:hover:bg-white/[0.06] dark:hover:text-white"
          aria-label="Refresh market data"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isMarketLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="instrument-select" className={labelCls}>
            Asset
          </label>
          <select
            id="instrument-select"
            value={instruments.some((i) => i.symbol === config.symbol) ? config.symbol : '__custom__'}
            disabled={isLocked}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                onConfigChange({ symbol: e.target.value });
              }
            }}
            className={`${fieldCls} font-medium`}
          >
            {instruments.map((inst) => (
              <option key={inst.symbol} value={inst.symbol}>
                {inst.symbol} — {inst.name} ({inst.assetClass})
              </option>
            ))}
            {!instruments.some((i) => i.symbol === config.symbol) && (
              <option value="__custom__">{config.symbol} — Custom Symbol</option>
            )}
          </select>

          <form onSubmit={handleCustomTicker} className="mt-3 flex gap-2">
            <label htmlFor="custom-ticker-input" className="sr-only">
              Search another ticker symbol
            </label>
            <input
              id="custom-ticker-input"
              type="text"
              value={customTicker}
              disabled={isLocked}
              onChange={(e) => setCustomTicker(e.target.value)}
              placeholder="Or type ticker (TSLA, AMD...)"
              className="h-10 min-w-0 flex-1 rounded-xl border border-[#162436]/[0.12] bg-white/72 px-3.5 font-mono text-[13px] text-[#162436] placeholder:font-sans placeholder:text-[#6B7E94] outline-none transition-colors focus:border-[#1A3350] disabled:opacity-50 dark:border-white/[0.11] dark:bg-[#0D1119]/85 dark:text-[#ECEFF4] dark:placeholder:text-[#667085] dark:focus:border-[#9FB2CC]"
            />
            <button
              type="submit"
              disabled={isLocked || !customTicker.trim()}
              aria-label="Load custom symbol"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#162436]/[0.12] bg-white/72 text-[#162436] transition-colors hover:bg-white dark:border-white/[0.11] dark:bg-[#0D1119]/85 dark:text-[#ECEFF4] dark:hover:bg-white/[0.08] disabled:opacity-40"
            >
              <Search className="h-4 w-4" />
            </button>
          </form>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="interval-select" className={labelCls}>
              Price Step
            </label>
            <select
              id="interval-select"
              value={config.interval}
              disabled={isLocked}
              onChange={(e) => onConfigChange({ interval: e.target.value as IntervalType })}
              className={fieldCls}
            >
              <option value="1d">Daily</option>
              <option value="1h">Hourly</option>
            </select>
          </div>
          <div>
            <label htmlFor="range-select" className={labelCls}>
              History
            </label>
            <select
              id="range-select"
              value={config.range}
              disabled={isLocked}
              onChange={(e) => onConfigChange({ range: e.target.value as RangeType })}
              className={fieldCls}
            >
              <option value="6mo">6 months</option>
              <option value="1y">1 year</option>
              <option value="2y">2 years</option>
              <option value="5y">5 years</option>
            </select>
          </div>
        </div>

        {/* Train vs Test split */}
        <div className="rounded-xl border border-[#162436]/[0.08] bg-white/45 p-4 dark:border-white/[0.07] dark:bg-white/[0.025]">
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <label htmlFor="split-slider" className="font-medium text-[#1E3148] dark:text-[#D1DAE7]">
              Train / Test Split
            </label>
            <span className="font-mono text-xs font-semibold text-[#162436] tabular-nums dark:text-white">
              {trainPct}% / {testPct}%
            </span>
          </div>

          <input
            id="split-slider"
            type="range"
            min={0.55}
            max={0.85}
            step={0.05}
            value={config.splitRatio}
            disabled={isLocked}
            onChange={(e) => onConfigChange({ splitRatio: Number(e.target.value) })}
            className="quant-slider mt-3.5"
          />

          <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-[#162436]/[0.09] dark:bg-white/[0.08]">
            <div
              className="h-full bg-[#1A3350]/80 transition-all duration-200 dark:bg-[#ECEFF4]/80"
              style={{ width: `${trainPct}%` }}
            />
            <div
              className="h-full bg-[#C88424] transition-all duration-200 dark:bg-[#E5A94C]"
              style={{ width: `${testPct}%` }}
            />
          </div>

          {split ? (
            <div className="mt-2.5 flex items-center justify-between gap-2 font-mono text-[11px] text-[#4D6078] tabular-nums dark:text-[#8A94A6]">
              <span>Train: {split.trainBars} pts ({formatShortDate(split.trainEnd)})</span>
              <span className="font-medium text-[#9A6312] dark:text-[#E5A94C]">
                Test: {split.testBars} pts
              </span>
            </div>
          ) : (
            <p className={helperCls}>
              Older data trains the model; newer data stays locked for final testing.
            </p>
          )}
        </div>
      </div>
    </section>
  );

  const accountSection = (
    <section className="p-6 sm:p-6">
      <h2 className="mb-5 text-xs font-semibold tracking-[0.04em] uppercase text-[#43566E] dark:text-[#98A2B3]">
        Account & Costs
      </h2>

      <div className="space-y-5">
        <div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="capital-input" className={labelCls}>
                Starting Cash ($)
              </label>
              <input
                id="capital-input"
                type="number"
                min={500}
                max={10000000}
                step={1000}
                value={config.initialCapital}
                disabled={isLocked}
                onChange={(e) =>
                  onConfigChange({ initialCapital: Math.max(500, Number(e.target.value) || 10000) })
                }
                className={`${fieldCls} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="pos-frac-select" className={labelCls}>
                Order Size
              </label>
              <select
                id="pos-frac-select"
                value={config.positionFraction}
                disabled={isLocked}
                onChange={(e) => onConfigChange({ positionFraction: Number(e.target.value) })}
                className={fieldCls}
              >
                <option value={0.25}>25% of cash</option>
                <option value={0.5}>50% of cash</option>
                <option value={0.75}>75% of cash</option>
                <option value={1}>100% (all-in)</option>
              </select>
            </div>
          </div>
          <p className={helperCls}>
            How much available cash is used on each buy order.
          </p>
        </div>

        <div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fee-input" className={labelCls}>
                Trade Fee (%)
              </label>
              <input
                id="fee-input"
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={feePct}
                disabled={isLocked}
                onChange={(e) =>
                  onConfigChange({
                    feeBps: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)),
                  })
                }
                className={`${fieldCls} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="slippage-input" className={labelCls}>
                Price Slip (%)
              </label>
              <input
                id="slippage-input"
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={slippagePct}
                disabled={isLocked}
                onChange={(e) =>
                  onConfigChange({
                    slippageBps: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)),
                  })
                }
                className={`${fieldCls} font-mono tabular-nums`}
              />
            </div>
          </div>
          <p className={helperCls}>
            Simulates broker fees and small price shifts when orders execute.
          </p>
        </div>

        <div>
          <label htmlFor="reward-select" className={labelCls}>
            Goal
          </label>
          <select
            id="reward-select"
            value={config.rewardMode}
            disabled={isLocked}
            onChange={(e) => onConfigChange({ rewardMode: e.target.value as RewardModeType })}
            className={fieldCls}
          >
            <option value="log_return">Maximize profit</option>
            <option value="risk_adjusted">Steady growth (less risk)</option>
            <option value="drawdown_penalized">Limit big drops</option>
          </select>
        </div>
      </div>
    </section>
  );

  const strategySection = (
    <section className="p-6 sm:p-6 md:col-span-2 lg:col-span-1">
      <h2 className="mb-5 text-xs font-semibold tracking-[0.04em] uppercase text-[#43566E] dark:text-[#98A2B3]">
        Strategy
      </h2>

      <div className="space-y-5">
        <div>
          <div
            className="grid grid-cols-2 gap-2.5 md:grid-cols-4 lg:grid-cols-2"
            role="group"
            aria-label="Learning method"
          >
            {ALGORITHMS.map((alg) => {
              const active = config.algorithm === alg.id;
              return (
                <button
                  key={alg.id}
                  type="button"
                  disabled={isLocked}
                  onClick={() => onConfigChange({ algorithm: alg.id })}
                  className={`flex flex-col rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                    active
                      ? 'border-[#1A3350] bg-[#1A3350] text-white shadow-xs dark:border-[#ECEFF4] dark:bg-[#ECEFF4] dark:text-[#0B0E14]'
                      : 'border-[#162436]/[0.1] bg-white/62 text-[#162436] hover:border-[#1A3350]/30 hover:bg-white/85 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-[#ECEFF4] dark:hover:border-white/[0.18] dark:hover:bg-white/[0.07]'
                  } disabled:opacity-50`}
                >
                  <span className="text-[13px] font-semibold tracking-tight whitespace-nowrap">
                    {alg.label}
                  </span>
                  <span
                    className={`mt-0.5 text-[11px] whitespace-nowrap ${
                      active
                        ? 'text-white/80 dark:text-[#0B0E14]/70'
                        : 'text-[#4D6078] dark:text-[#8A94A6]'
                    }`}
                  >
                    {alg.subtitle}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[#4D6078] dark:text-[#8A94A6]">
            {ALGORITHMS.find((a) => a.id === config.algorithm)?.hint}
          </p>
        </div>

        <div className="rounded-xl border border-[#162436]/[0.08] bg-white/45 p-4 dark:border-white/[0.07] dark:bg-white/[0.025]">
          <div className="flex items-center justify-between text-[13px]">
            <label htmlFor="episodes-slider" className="font-medium text-[#1E3148] dark:text-[#D1DAE7]">
              Training Passes
            </label>
            <span className="font-mono text-xs font-semibold text-[#162436] tabular-nums dark:text-white">
              {config.episodes} passes
            </span>
          </div>
          <input
            id="episodes-slider"
            type="range"
            min={10}
            max={120}
            step={5}
            value={config.episodes}
            disabled={isLocked}
            onChange={(e) => onConfigChange({ episodes: Number(e.target.value) })}
            className="quant-slider mt-3.5"
          />
          <p className="mt-2.5 text-xs text-[#4D6078] dark:text-[#8A94A6]">
            Full passes through past data before locking the best model.
          </p>
        </div>

        {/* Optional fine-tuning controls */}
        <div className="border-t border-[#162436]/[0.08] pt-4 dark:border-white/[0.07]">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="flex w-full items-center justify-between rounded-lg py-1 text-[13px] font-medium text-[#43566E] transition-colors hover:text-[#162436] dark:text-[#98A2B3] dark:hover:text-white"
          >
            <span>Fine-Tuning</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
            />
          </button>

          <AnimatePresence initial={false}>
            {showAdvanced && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-4 grid grid-cols-2 gap-4 pt-0.5 md:grid-cols-4 lg:grid-cols-2">
                  <div>
                    <label
                      htmlFor="lr-select"
                      className="block text-xs font-medium text-[#43566E] dark:text-[#98A2B3]"
                    >
                      Learning Speed
                    </label>
                    <select
                      id="lr-select"
                      value={config.learningRate}
                      disabled={isLocked}
                      onChange={(e) => onConfigChange({ learningRate: Number(e.target.value) })}
                      className={`${fieldCls} font-mono`}
                    >
                      <option value={0.0005}>0.0005 (Slow)</option>
                      <option value={0.001}>0.0010</option>
                      <option value={0.0025}>0.0025 (Balanced)</option>
                      <option value={0.005}>0.0050</option>
                      <option value={0.01}>0.0100 (Fast)</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="gamma-input"
                      className="block text-xs font-medium text-[#43566E] dark:text-[#98A2B3]"
                    >
                      Future Focus
                    </label>
                    <input
                      id="gamma-input"
                      type="number"
                      min={0.8}
                      max={0.995}
                      step={0.01}
                      value={config.gamma}
                      disabled={isLocked}
                      onChange={(e) =>
                        onConfigChange({
                          gamma: Math.min(0.995, Math.max(0.8, Number(e.target.value) || 0.97)),
                        })
                      }
                      className={`${fieldCls} font-mono tabular-nums`}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="exploration-input"
                      className="block text-xs font-medium text-[#43566E] dark:text-[#98A2B3]"
                    >
                      Try New Moves
                    </label>
                    <input
                      id="exploration-input"
                      type="number"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={config.exploration}
                      disabled={isLocked}
                      onChange={(e) =>
                        onConfigChange({
                          exploration: Math.min(1.0, Math.max(0.1, Number(e.target.value) || 0.85)),
                        })
                      }
                      className={`${fieldCls} font-mono tabular-nums`}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="seed-input"
                      className="block text-xs font-medium text-[#43566E] dark:text-[#98A2B3]"
                    >
                      Seed
                    </label>
                    <input
                      id="seed-input"
                      type="number"
                      min={0}
                      max={99999}
                      value={config.seed}
                      disabled={isLocked}
                      onChange={(e) =>
                        onConfigChange({ seed: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className={`${fieldCls} font-mono tabular-nums`}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );

  const actionControls = (
    <div className="flex items-center gap-2.5">
      {!isRunning && !isPaused ? (
        <button
          type="button"
          onClick={onStart}
          disabled={isMarketLoading}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1A3350] px-5 text-[13px] font-medium text-white shadow-[0_8px_20px_-6px_rgba(26,51,80,0.45)] transition-all hover:bg-[#234366] active:scale-[0.99] disabled:opacity-45 whitespace-nowrap dark:bg-[#ECEFF4] dark:text-[#0B0E14] dark:shadow-xs dark:hover:bg-white"
        >
          <Play className="h-4 w-4" />
          Start Training
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={isPaused ? onResume : onPause}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#1A3350] bg-transparent px-4 text-[13px] font-medium text-[#1A3350] transition-colors hover:bg-[#1A3350]/[0.06] whitespace-nowrap dark:border-[#ECEFF4] dark:text-[#ECEFF4] dark:hover:bg-white/[0.08]"
          >
            {isPaused ? (
              <>
                <Play className="h-4 w-4" /> Resume
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" /> Pause
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-[#C73B33] bg-transparent px-4 text-[13px] font-medium text-[#C73B33] transition-colors hover:bg-[#C73B33]/10 whitespace-nowrap dark:border-[#F0645C] dark:text-[#F0645C]"
          >
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
        </>
      )}
    </div>
  );

  return (
    <aside className="w-full shrink-0 lg:w-[368px] xl:w-[392px]">
      {/* Mobile and tablet collapsible setup */}
      <div className={`${glassShellCls} lg:hidden`}>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/30 dark:hover:bg-white/[0.02]"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/80 bg-white/65 text-[#1A3350] shadow-xs dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-[#C9D2E0]">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#162436] dark:text-[#ECEFF4]">
                Setup
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-[#4D6078] dark:text-[#8A94A6]">
                {config.symbol} · {config.algorithm} · {config.episodes} passes · {feePct}% fee
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[#43566E] dark:text-[#98A2B3]">
            <span className="hidden sm:inline">{mobileOpen ? 'Hide' : 'Edit'}</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${mobileOpen ? 'rotate-180' : ''}`}
            />
          </div>
        </button>

        <AnimatePresence initial={false}>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden border-t border-[#162436]/[0.08] dark:border-white/[0.07]"
            >
              <div className="grid grid-cols-1 divide-y divide-[#162436]/[0.08] md:grid-cols-2 md:divide-x md:divide-y md:divide-[#162436]/[0.08] dark:divide-white/[0.07] dark:md:divide-white/[0.07]">
                {marketSection}
                {accountSection}
                {strategySection}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="border-t border-[#162436]/[0.08] px-5 py-4 dark:border-white/[0.07]">
          {actionControls}
        </div>
      </div>

      {/* Desktop setup panel */}
      <div className={`hidden ${glassShellCls} lg:block`}>
        <div className="border-b border-[#162436]/[0.08] px-6 py-5 dark:border-white/[0.07]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/80 bg-white/65 text-[#1A3350] shadow-xs dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-[#C9D2E0]">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-[#162436] dark:text-white">
                Setup
              </h2>
              <p className="mt-0.5 text-xs text-[#4D6078] dark:text-[#8A94A6]">
                Pick a market, costs, and strategy
              </p>
            </div>
          </div>
        </div>

        <div className="divide-y divide-[#162436]/[0.08] dark:divide-white/[0.07]">
          {marketSection}
          {accountSection}
          {strategySection}
          <div className="p-6">{actionControls}</div>
        </div>
      </div>
    </aside>
  );
}
