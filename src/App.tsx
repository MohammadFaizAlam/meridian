import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CandlestickChart,
  FlaskConical,
  GitCompareArrows,
  Moon,
  ReceiptText,
  Sun,
  TrendingUp,
} from 'lucide-react';
import {
  deleteTrainingRun,
  executeBacktest,
  fetchForecast,
  fetchInstruments,
  fetchMarketData,
  fetchRunDetail,
  fetchRuns,
  getApiUrl,
  pauseTrainingRun,
  resumeTrainingRun,
  startTrainingRun,
  stopTrainingRun,
} from './api/client';
import type {
  BacktestResult,
  EpisodeSummary,
  ForecastResponse,
  InstrumentOption,
  MarketDataResponse,
  RunDetail,
  RunSummary,
  TracePayload,
  WorkspaceTab,
} from './types/trading';
import { usePersistedUiState } from './hooks/usePersistedUiState';
import { SilkCanvas } from './components/SilkCanvas';
import { ConfigRail } from './components/ConfigRail';
import { WorkbenchStage } from './components/WorkbenchStage';
import { ForecastView } from './components/ForecastView';
import { BacktestView } from './components/BacktestView';
import { CompareView } from './components/CompareView';
import { LedgerView } from './components/LedgerView';

const NAV_TABS: {
  id: WorkspaceTab;
  label: string;
  title: string;
  Icon: typeof CandlestickChart;
}[] = [
  { id: 'workbench', label: 'Train', title: 'Train — Market & Strategy', Icon: CandlestickChart },
  { id: 'forecast', label: 'Forecast', title: 'Forecast — Price Outlook & Signals', Icon: TrendingUp },
  { id: 'backtest', label: 'Test', title: 'Test — Check on New Data', Icon: FlaskConical },
  { id: 'compare', label: 'Compare', title: 'Compare — Side-by-Side Runs', Icon: GitCompareArrows },
  { id: 'ledger', label: 'Trades', title: 'Trades — Buy & Sell History', Icon: ReceiptText },
];

function getInitialTheme(): 'dark' | 'light' {
  if (typeof document !== 'undefined') {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  }
  return 'dark';
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);
  const {
    uiState,
    setTab,
    patchConfig,
    setActiveRunId,
    setCompareSplit,
    setComparedIds,
    setLedgerSplit,
    setLedgerSideFilter,
    setShowForecastOverlay,
  } = usePersistedUiState();

  const {
    tab,
    config,
    activeRunId,
    compareSplit,
    comparedIds,
    ledgerSplit,
    ledgerSideFilter,
    showForecastOverlay,
  } = uiState;

  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [market, setMarket] = useState<MarketDataResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);

  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [transferResult, setTransferResult] = useState<BacktestResult | null>(null);
  const [comparedDetails, setComparedDetails] = useState<RunDetail[]>([]);

  const streamRef = useRef<EventSource | null>(null);
  const restoredRunOnceRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('meridian-theme', theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const closeStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
  }, []);

  const refreshRunsList = useCallback(async () => {
    try {
      const list = await fetchRuns();
      setRuns(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const attachStream = useCallback(
    (runId: string) => {
      closeStream();
      const es = new EventSource(getApiUrl(`/api/runs/${encodeURIComponent(runId)}/stream`));
      streamRef.current = es;

      es.addEventListener('snapshot', (ev: MessageEvent) => {
        try {
          const detail = JSON.parse(ev.data) as RunDetail;
          setActiveRun(detail);
        } catch {}
      });

      es.addEventListener('status', (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data) as { status: RunDetail['status'] };
          setActiveRun((prev) =>
            prev && prev.id === runId ? { ...prev, status: payload.status } : prev,
          );
        } catch {}
      });

      es.addEventListener('episode', (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data) as {
            runId: string;
            episodeSummary: EpisodeSummary;
            trainTrace: TracePayload;
          };
          setActiveRun((prev) => {
            if (!prev || prev.id !== payload.runId) return prev;
            const nextEps = [...prev.episodes, payload.episodeSummary];
            return {
              ...prev,
              completedEpisodes: nextEps.length,
              latestEpisode: payload.episodeSummary,
              episodes: nextEps,
              trainTrace: payload.trainTrace,
              trainMetrics: payload.trainTrace.metrics,
              hasWeights: true,
              split: {
                ...prev.split,
                bestEpisode: payload.episodeSummary.bestEpisode ?? prev.split.bestEpisode,
                validationSharpe:
                  payload.episodeSummary.validationSharpe ?? prev.split.validationSharpe,
              },
            };
          });
        } catch {}
      });

      es.addEventListener('done', (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data) as { run: RunDetail };
          if (payload.run) setActiveRun(payload.run);
        } catch {}
        closeStream();
        refreshRunsList();
      });

      es.addEventListener('error', (ev: MessageEvent) => {
        if (ev.data) {
          try {
            const payload = JSON.parse(ev.data) as { error?: string };
            if (payload.error) setActionError(payload.error);
          } catch {}
        }
        closeStream();
        refreshRunsList();
      });
    },
    [closeStream, refreshRunsList],
  );

  const handleSelectRun = useCallback(
    async (runId: string) => {
      setActionError(null);
      setBacktestError(null);
      setTransferResult(null);
      setActiveRunId(runId);
      try {
        const detail = await fetchRunDetail(runId);
        setActiveRun(detail);
        if (detail.status === 'running' || detail.status === 'paused') {
          attachStream(runId);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Unable to load run.');
      }
    },
    [attachStream, setActiveRunId],
  );

  // Boot instruments, runs, and restore persisted run selection
  useEffect(() => {
    let mounted = true;
    fetchInstruments()
      .then((list) => {
        if (mounted) setInstruments(list);
      })
      .catch(() => {});

    refreshRunsList().then((list) => {
      if (!mounted || list.length === 0) return;
      const validIds = new Set(list.map((r) => r.id));

      setComparedIds((prev) => {
        const kept = prev.filter((id) => validIds.has(id));
        return kept.length > 0 ? kept : list.slice(0, 3).map((r) => r.id);
      });

      if (!restoredRunOnceRef.current && activeRunId && validIds.has(activeRunId)) {
        restoredRunOnceRef.current = true;
        handleSelectRun(activeRunId);
      }
    });

    return () => {
      mounted = false;
      closeStream();
    };
  }, [activeRunId, closeStream, handleSelectRun, refreshRunsList, setComparedIds]);

  const loadMarket = useCallback(
    async (forceRefresh = false) => {
      setMarketLoading(true);
      setMarketError(null);
      try {
        const data = await fetchMarketData({
          symbol: config.symbol,
          interval: config.interval,
          range: config.range,
          splitRatio: config.splitRatio,
          refresh: forceRefresh,
        });
        setMarket(data);
      } catch (err) {
        setMarketError(err instanceof Error ? err.message : 'Failed to fetch market data.');
      } finally {
        setMarketLoading(false);
      }
    },
    [config.symbol, config.interval, config.range, config.splitRatio],
  );

  useEffect(() => {
    loadMarket(false);
  }, [loadMarket]);

  // Keep forecast synced with active market and trained policy
  const forecastRunId =
    activeRun &&
    activeRun.hasWeights &&
    activeRun.config.symbol === config.symbol &&
    activeRun.status !== 'running'
      ? activeRun.id
      : null;

  const loadForecast = useCallback(async () => {
    setForecastLoading(true);
    setForecastError(null);
    try {
      const data = await fetchForecast({
        symbol: config.symbol,
        interval: config.interval,
        range: config.range,
        splitRatio: config.splitRatio,
        runId: forecastRunId,
      });
      setForecast(data);
    } catch (err) {
      setForecastError(err instanceof Error ? err.message : 'Unable to compute forecast.');
    } finally {
      setForecastLoading(false);
    }
  }, [config.symbol, config.interval, config.range, config.splitRatio, forecastRunId]);

  useEffect(() => {
    if (!market || marketError) return;
    loadForecast();
  }, [market, marketError, loadForecast]);

  useEffect(() => {
    if (tab !== 'compare' || comparedIds.length === 0) return;
    let cancelled = false;
    Promise.all(comparedIds.map((id) => fetchRunDetail(id).catch(() => null))).then((results) => {
      if (cancelled) return;
      setComparedDetails(results.filter((r): r is RunDetail => r !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [tab, comparedIds, runs]);

  const handleStartTraining = async () => {
    setActionError(null);
    try {
      const summary = await startTrainingRun(config);
      const initialDetail: RunDetail = {
        ...summary,
        episodes: [],
        trainTrace: null,
        backtest: null,
      };
      setActiveRun(initialDetail);
      setActiveRunId(summary.id);
      setComparedIds((prev) => [summary.id, ...prev.filter((id) => id !== summary.id)].slice(0, 5));
      attachStream(summary.id);
      refreshRunsList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to start training run.');
    }
  };

  const handlePause = async () => {
    if (!activeRun) return;
    try {
      const updated = await pauseTrainingRun(activeRun.id);
      setActiveRun((prev) => (prev ? { ...prev, status: updated.status } : prev));
      refreshRunsList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to pause run.');
    }
  };

  const handleResume = async () => {
    if (!activeRun) return;
    try {
      const updated = await resumeTrainingRun(activeRun.id);
      setActiveRun((prev) => (prev ? { ...prev, status: updated.status } : prev));
      attachStream(activeRun.id);
      refreshRunsList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to resume run.');
    }
  };

  const handleStop = async () => {
    if (!activeRun) return;
    try {
      const updated = await stopTrainingRun(activeRun.id);
      setActiveRun((prev) => (prev ? { ...prev, status: updated.status } : prev));
      refreshRunsList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to stop run.');
    }
  };

  const handleRunBacktest = async (runId: string, overrideSymbol?: string) => {
    setIsRunningBacktest(true);
    setBacktestError(null);
    try {
      const result = await executeBacktest(runId, overrideSymbol);
      if (result.isTransferTest) {
        setTransferResult(result);
      } else {
        setTransferResult(null);
        const refreshed = await fetchRunDetail(runId);
        setActiveRun(refreshed);
        await refreshRunsList();
      }
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : 'Backtest execution failed.');
    } finally {
      setIsRunningBacktest(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    try {
      await deleteTrainingRun(runId);
      setComparedIds((prev) => prev.filter((id) => id !== runId));
      setComparedDetails((prev) => prev.filter((r) => r.id !== runId));
      if (activeRun?.id === runId) {
        closeStream();
        setActiveRun(null);
        setActiveRunId(null);
      }
      await refreshRunsList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to delete run.');
    }
  };

  const handleOpenBacktestForRun = async (runId: string) => {
    await handleSelectRun(runId);
    setTab('backtest');
  };

  const handleToggleCompare = (runId: string) => {
    setComparedIds((prev) => {
      if (prev.includes(runId)) return prev.filter((id) => id !== runId);
      if (prev.length >= 5) return [...prev.slice(1), runId];
      return [...prev, runId];
    });
  };

  useEffect(() => {
    if ((tab === 'backtest' || tab === 'ledger') && !activeRun && runs.length > 0) {
      const target = runs.find((r) => r.hasWeights) || runs[0];
      if (target) handleSelectRun(target.id);
    }
  }, [tab, activeRun, runs, handleSelectRun]);

  const isRunning = activeRun?.status === 'running';
  const isPaused = activeRun?.status === 'paused';

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#DFE7F0] text-[#162436] transition-colors duration-300 dark:bg-[#070A10] dark:text-[#F4F7FB]">
      {/* Silk WebGL background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <SilkCanvas theme={theme} intensity="ambient" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Top brand bar */}
        <header className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4 px-4 pt-5 pb-1 sm:px-6 sm:pt-6">
          <a
            href="#workbench"
            onClick={(e) => {
              e.preventDefault();
              setTab('workbench');
            }}
            className="font-display text-lg font-semibold tracking-tight text-[#162436] whitespace-nowrap shrink-0 dark:text-white"
          >
            Meridian
          </a>

          {activeRun && (isRunning || isPaused) && (
            <div className="font-mono text-xs text-[#43566E] tabular-nums dark:text-[#98A2B3]">
              {activeRun.config.symbol} · {activeRun.config.algorithm} · Pass{' '}
              {activeRun.episodes.length}/{activeRun.config.episodes} ({activeRun.status})
            </div>
          )}
        </header>

        {actionError && (
          <div role="alert" className="mx-auto mt-3 w-full max-w-[1440px] px-4 sm:px-6">
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#C73B33]/25 bg-[#C73B33]/10 px-5 py-3 text-xs text-[#9C2B23] backdrop-blur-xl dark:text-[#F59B95]">
              <span>{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="font-medium underline underline-offset-2"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Main workspace viewport */}
        <main className="flex-1 pb-28 sm:pb-32">
          <AnimatePresence mode="wait">
            {tab === 'workbench' && (
              <motion.div
                key="workbench"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:gap-7"
              >
                <ConfigRail
                  config={config}
                  instruments={instruments}
                  split={market?.split || null}
                  activeStatus={activeRun?.status || null}
                  isMarketLoading={marketLoading}
                  onConfigChange={patchConfig}
                  onRefreshMarket={() => loadMarket(true)}
                  onStart={handleStartTraining}
                  onPause={handlePause}
                  onResume={handleResume}
                  onStop={handleStop}
                />
                <WorkbenchStage
                  market={market}
                  marketLoading={marketLoading}
                  marketError={marketError}
                  forecast={forecast}
                  showForecastOverlay={showForecastOverlay}
                  activeRun={activeRun}
                  recentRuns={runs}
                  initialCapital={config.initialCapital}
                  selectedAlgorithm={config.algorithm}
                  theme={theme}
                  onToggleForecastOverlay={() => setShowForecastOverlay(!showForecastOverlay)}
                  onRetryMarket={() => loadMarket(true)}
                  onSelectRun={handleSelectRun}
                  onOpenBacktest={handleOpenBacktestForRun}
                />
              </motion.div>
            )}

            {tab === 'forecast' && (
              <motion.div
                key="forecast"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <ForecastView
                  market={market}
                  forecast={forecast}
                  loading={forecastLoading}
                  error={forecastError}
                  theme={theme}
                  onRetry={loadForecast}
                  onGoToWorkbench={() => setTab('workbench')}
                />
              </motion.div>
            )}

            {tab === 'backtest' && (
              <motion.div
                key="backtest"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <BacktestView
                  runs={runs}
                  selectedRun={activeRun}
                  instruments={instruments}
                  isRunningBacktest={isRunningBacktest}
                  backtestError={backtestError}
                  transferResult={transferResult}
                  theme={theme}
                  onSelectRun={handleSelectRun}
                  onRunBacktest={handleRunBacktest}
                  onGoToWorkbench={() => setTab('workbench')}
                />
              </motion.div>
            )}

            {tab === 'compare' && (
              <motion.div
                key="compare"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <CompareView
                  runs={runs}
                  comparedIds={comparedIds}
                  comparedDetails={comparedDetails}
                  splitMode={compareSplit}
                  theme={theme}
                  onSplitModeChange={setCompareSplit}
                  onToggleCompareId={handleToggleCompare}
                  onDeleteRun={handleDeleteRun}
                  onOpenBacktest={handleOpenBacktestForRun}
                />
              </motion.div>
            )}

            {tab === 'ledger' && (
              <motion.div
                key="ledger"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <LedgerView
                  runs={runs}
                  selectedRun={activeRun}
                  split={ledgerSplit}
                  sideFilter={ledgerSideFilter}
                  onSplitChange={setLedgerSplit}
                  onSideFilterChange={setLedgerSideFilter}
                  onSelectRun={handleSelectRun}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Floating bottom glass dock */}
        <div className="pointer-events-none fixed right-0 bottom-3 left-0 z-40 flex justify-center px-2.5 sm:bottom-5 sm:px-4">
          <motion.nav
            aria-label="Workspace navigation"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto flex max-w-full items-center gap-0.5 rounded-[24px] border border-white/80 bg-white/58 p-1.5 shadow-[0_16px_42px_-8px_rgba(22,36,54,0.18),0_2px_10px_-2px_rgba(22,36,54,0.08),inset_0_1px_0_0_rgba(255,255,255,0.92)] backdrop-blur-2xl backdrop-saturate-150 transition-colors duration-300 sm:gap-1 dark:border-white/[0.13] dark:bg-[#0D121C]/82 dark:shadow-[0_24px_56px_-10px_rgba(0,0,0,0.78),inset_0_1px_0_0_rgba(255,255,255,0.14)]"
          >
            {NAV_TABS.map(({ id, label, title, Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-label={title}
                  aria-current={active ? 'page' : undefined}
                  title={title}
                  className={`relative flex min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-[18px] px-2 py-1.5 transition-colors sm:min-w-[68px] sm:px-3 sm:py-2 lg:h-11 lg:min-w-0 lg:flex-row lg:gap-2 lg:px-3.5 lg:py-0 ${
                    active
                      ? 'text-[#162436] dark:text-white'
                      : 'text-[#4D6078] hover:text-[#162436] dark:text-[#8A94A6] dark:hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="floating-dock-active"
                      transition={{
                        type: 'spring',
                        stiffness: 420,
                        damping: 32,
                        mass: 0.72,
                      }}
                      className="absolute inset-0 -z-10 rounded-[18px] bg-[#162436]/[0.085] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.75)] dark:bg-white/[0.12] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)]"
                    />
                  )}
                  <Icon
                    className="h-[17px] w-[17px] shrink-0 sm:h-[18px] sm:w-[18px] lg:h-[17px] lg:w-[17px]"
                    strokeWidth={active ? 2.15 : 1.75}
                  />
                  <span className="text-[10px] leading-none font-medium tracking-tight whitespace-nowrap sm:text-[11px] lg:text-[13px]">
                    {label}
                  </span>
                </button>
              );
            })}

            <div
              aria-hidden="true"
              className="mx-0.5 h-6 w-px shrink-0 bg-[#162436]/[0.11] sm:mx-1 dark:bg-white/[0.11]"
            />

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="flex min-w-[44px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[18px] px-1.5 py-1.5 text-[#4D6078] transition-colors hover:bg-[#162436]/[0.06] hover:text-[#162436] sm:min-w-[52px] sm:py-2 lg:h-11 lg:w-11 lg:min-w-0 lg:flex-row lg:p-0 dark:text-[#98A2B3] dark:hover:bg-white/[0.08] dark:hover:text-white"
            >
              {theme === 'dark' ? (
                <Sun className="h-[17px] w-[17px] shrink-0" strokeWidth={1.85} />
              ) : (
                <Moon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.85} />
              )}
              <span className="text-[10px] leading-none font-medium tracking-tight whitespace-nowrap sm:text-[11px] lg:hidden">
                {theme === 'dark' ? 'Light' : 'Dark'}
              </span>
            </button>
          </motion.nav>
        </div>
      </div>
    </div>
  );
}
