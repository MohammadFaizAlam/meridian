import { useCallback, useEffect, useState } from 'react';
import type {
  AlgorithmType,
  IntervalType,
  RangeType,
  RewardModeType,
  RunConfig,
  WorkspaceTab,
} from '../types/trading';

export const UI_STATE_STORAGE_KEY = 'meridian-ui-state-v2';

export interface PersistedUiState {
  tab: WorkspaceTab;
  config: RunConfig;
  activeRunId: string | null;
  compareSplit: 'test' | 'train';
  comparedIds: string[];
  ledgerSplit: 'train' | 'test';
  ledgerSideFilter: 'ALL' | 'BUY' | 'SELL';
  showForecastOverlay: boolean;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  symbol: 'AAPL',
  interval: '1d',
  range: '2y',
  splitRatio: 0.75,
  algorithm: 'DQN',
  episodes: 30,
  learningRate: 0.0025,
  gamma: 0.97,
  exploration: 0.85,
  initialCapital: 10000,
  feeBps: 10,
  slippageBps: 5,
  positionFraction: 1.0,
  rewardMode: 'log_return',
  seed: 42,
};

export const DEFAULT_UI_STATE: PersistedUiState = {
  tab: 'workbench',
  config: DEFAULT_RUN_CONFIG,
  activeRunId: null,
  compareSplit: 'train',
  comparedIds: [],
  ledgerSplit: 'train',
  ledgerSideFilter: 'ALL',
  showForecastOverlay: true,
};

const VALID_TABS = new Set<WorkspaceTab>(['workbench', 'forecast', 'backtest', 'compare', 'ledger']);
const VALID_ALGOS = new Set<AlgorithmType>(['DQN', 'PPO', 'A2C', 'Q-Learning']);
const VALID_INTERVALS = new Set<IntervalType>(['1d', '1h']);
const VALID_RANGES = new Set<RangeType>(['6mo', '1y', '2y', '5y']);
const VALID_REWARDS = new Set<RewardModeType>(['log_return', 'risk_adjusted', 'drawdown_penalized']);

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizePersistedUiState(raw: unknown): PersistedUiState {
  if (!raw || typeof raw !== 'object') return DEFAULT_UI_STATE;
  const obj = raw as Record<string, unknown>;
  const rawCfg = (obj.config && typeof obj.config === 'object' ? obj.config : {}) as Record<
    string,
    unknown
  >;

  const symbol =
    typeof rawCfg.symbol === 'string' && /^[A-Z0-9.\-^=]{1,15}$/i.test(rawCfg.symbol.trim())
      ? rawCfg.symbol.trim().toUpperCase()
      : DEFAULT_RUN_CONFIG.symbol;

  const config: RunConfig = {
    symbol,
    interval: VALID_INTERVALS.has(rawCfg.interval as IntervalType)
      ? (rawCfg.interval as IntervalType)
      : DEFAULT_RUN_CONFIG.interval,
    range: VALID_RANGES.has(rawCfg.range as RangeType)
      ? (rawCfg.range as RangeType)
      : DEFAULT_RUN_CONFIG.range,
    splitRatio: clampNum(rawCfg.splitRatio, 0.55, 0.85, DEFAULT_RUN_CONFIG.splitRatio),
    algorithm: VALID_ALGOS.has(rawCfg.algorithm as AlgorithmType)
      ? (rawCfg.algorithm as AlgorithmType)
      : DEFAULT_RUN_CONFIG.algorithm,
    episodes: Math.round(clampNum(rawCfg.episodes, 10, 120, DEFAULT_RUN_CONFIG.episodes)),
    learningRate: clampNum(rawCfg.learningRate, 0.0001, 0.1, DEFAULT_RUN_CONFIG.learningRate),
    gamma: clampNum(rawCfg.gamma, 0.8, 0.995, DEFAULT_RUN_CONFIG.gamma),
    exploration: clampNum(rawCfg.exploration, 0.1, 1.0, DEFAULT_RUN_CONFIG.exploration),
    initialCapital: clampNum(rawCfg.initialCapital, 500, 10_000_000, DEFAULT_RUN_CONFIG.initialCapital),
    feeBps: Math.round(clampNum(rawCfg.feeBps, 0, 200, DEFAULT_RUN_CONFIG.feeBps)),
    slippageBps: Math.round(clampNum(rawCfg.slippageBps, 0, 200, DEFAULT_RUN_CONFIG.slippageBps)),
    positionFraction: clampNum(rawCfg.positionFraction, 0.25, 1.0, DEFAULT_RUN_CONFIG.positionFraction),
    rewardMode: VALID_REWARDS.has(rawCfg.rewardMode as RewardModeType)
      ? (rawCfg.rewardMode as RewardModeType)
      : DEFAULT_RUN_CONFIG.rewardMode,
    seed: Math.round(clampNum(rawCfg.seed, 0, 99999, DEFAULT_RUN_CONFIG.seed)),
  };

  const comparedIds = Array.isArray(obj.comparedIds)
    ? obj.comparedIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 5)
    : [];

  return {
    tab: VALID_TABS.has(obj.tab as WorkspaceTab) ? (obj.tab as WorkspaceTab) : DEFAULT_UI_STATE.tab,
    config,
    activeRunId: typeof obj.activeRunId === 'string' && obj.activeRunId ? obj.activeRunId : null,
    compareSplit: obj.compareSplit === 'test' ? 'test' : 'train',
    comparedIds,
    ledgerSplit: obj.ledgerSplit === 'test' ? 'test' : 'train',
    ledgerSideFilter:
      obj.ledgerSideFilter === 'BUY' || obj.ledgerSideFilter === 'SELL'
        ? obj.ledgerSideFilter
        : 'ALL',
    showForecastOverlay:
      typeof obj.showForecastOverlay === 'boolean'
        ? obj.showForecastOverlay
        : DEFAULT_UI_STATE.showForecastOverlay,
  };
}

export function loadPersistedUiState(storage?: Pick<Storage, 'getItem'> | null): PersistedUiState {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return DEFAULT_UI_STATE;
  try {
    const text = store.getItem(UI_STATE_STORAGE_KEY);
    if (!text) return DEFAULT_UI_STATE;
    return sanitizePersistedUiState(JSON.parse(text));
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export function savePersistedUiState(
  state: PersistedUiState,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return;
  try {
    store.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota or sandbox errors
  }
}

export function usePersistedUiState() {
  const [state, setState] = useState<PersistedUiState>(() => loadPersistedUiState());

  // Persist updates cleanly without blocking paint
  useEffect(() => {
    const id = window.setTimeout(() => savePersistedUiState(state), 120);
    return () => window.clearTimeout(id);
  }, [state]);

  const setTab = useCallback((tab: WorkspaceTab) => {
    setState((prev) => (prev.tab === tab ? prev : { ...prev, tab }));
  }, []);

  const patchConfig = useCallback((patch: Partial<RunConfig>) => {
    setState((prev) => ({ ...prev, config: { ...prev.config, ...patch } }));
  }, []);

  const setActiveRunId = useCallback((activeRunId: string | null) => {
    setState((prev) => (prev.activeRunId === activeRunId ? prev : { ...prev, activeRunId }));
  }, []);

  const setCompareSplit = useCallback((compareSplit: 'test' | 'train') => {
    setState((prev) => (prev.compareSplit === compareSplit ? prev : { ...prev, compareSplit }));
  }, []);

  const setComparedIds = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    setState((prev) => ({
      ...prev,
      comparedIds: typeof updater === 'function' ? updater(prev.comparedIds) : updater,
    }));
  }, []);

  const setLedgerSplit = useCallback((ledgerSplit: 'train' | 'test') => {
    setState((prev) => (prev.ledgerSplit === ledgerSplit ? prev : { ...prev, ledgerSplit }));
  }, []);

  const setLedgerSideFilter = useCallback((ledgerSideFilter: 'ALL' | 'BUY' | 'SELL') => {
    setState((prev) =>
      prev.ledgerSideFilter === ledgerSideFilter ? prev : { ...prev, ledgerSideFilter },
    );
  }, []);

  const setShowForecastOverlay = useCallback((showForecastOverlay: boolean) => {
    setState((prev) =>
      prev.showForecastOverlay === showForecastOverlay ? prev : { ...prev, showForecastOverlay },
    );
  }, []);

  return {
    uiState: state,
    setTab,
    patchConfig,
    setActiveRunId,
    setCompareSplit,
    setComparedIds,
    setLedgerSplit,
    setLedgerSideFilter,
    setShowForecastOverlay,
  };
}
