export type AlgorithmType = 'DQN' | 'PPO' | 'A2C' | 'Q-Learning';
export type IntervalType = '1d' | '1h';
export type RangeType = '6mo' | '1y' | '2y' | '5y';
export type RewardModeType = 'log_return' | 'risk_adjusted' | 'drawdown_penalized';
export type RunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'stopped' | 'error';
export type WorkspaceTab = 'workbench' | 'forecast' | 'backtest' | 'compare' | 'ledger';

export interface InstrumentOption {
  symbol: string;
  name: string;
  assetClass: string;
  source: string;
}

export interface OHLCVBar {
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma10: number | null;
  sma30: number | null;
  ema12?: number | null;
  ema26?: number | null;
  ema50?: number | null;
  rsi14: number | null;
  volatility20: number | null;
  macd: number | null;
  macd_hist?: number | null;
  bb_z: number | null;
  bb_width?: number | null;
  atr14?: number | null;
  adx14?: number | null;
  plus_di?: number | null;
  minus_di?: number | null;
  donchian_pos?: number | null;
  obv_slope?: number | null;
}

export interface MarketMeta {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  source: string;
  interval: IntervalType;
  range: RangeType;
  annualizationFactor: number;
  cached: boolean;
  fetchedAt: string;
}

export interface MarketSummary {
  lastClose: number;
  lastDate: string;
  lastChangePct: number;
  periodReturnPct: number;
  periodHigh: number;
  periodLow: number;
  avgVolume: number;
}

export interface SplitInfo {
  ratio: number;
  splitIndex: number;
  totalBars: number;
  trainBars: number;
  testBars: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  bestEpisode?: number;
  validationSharpe?: number;
}

export interface MarketDataResponse {
  meta: MarketMeta;
  summary: MarketSummary;
  split: SplitInfo;
  bars: OHLCVBar[];
}

export interface RunConfig {
  symbol: string;
  interval: IntervalType;
  range: RangeType;
  splitRatio: number;
  algorithm: AlgorithmType;
  episodes: number;
  learningRate: number;
  gamma: number;
  exploration: number;
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  positionFraction: number;
  rewardMode: RewardModeType;
  seed: number;
}

export interface PerformanceMetrics {
  initialCapital: number;
  finalEquity: number;
  benchmarkFinalEquity: number;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  alphaPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  annualizedVolatilityPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  winRatePct: number | null;
  profitFactor: number | null;
  totalTrades: number;
  closedRoundTrips: number;
  totalFeesPaid: number;
  totalSlippagePaid: number;
  exposurePct: number;
}

export interface EquityPoint {
  step: number;
  timestamp: number;
  date: string;
  price: number;
  equity: number;
  benchmark_equity: number;
  cash: number;
  position: number;
  action: number;
  drawdown_pct: number;
}

export interface TradeRecord {
  step: number;
  timestamp: number;
  date: string;
  side: 'BUY' | 'SELL';
  market_price: number;
  fill_price: number;
  quantity: number;
  notional: number;
  fee: number;
  slippage_cost: number;
  realized_pnl: number | null;
  return_pct: number | null;
  equity_after: number;
}

export interface TracePayload {
  metrics: PerformanceMetrics;
  equityCurve: EquityPoint[];
  trades: TradeRecord[];
}

export interface EpisodeSummary {
  episode: number;
  totalEpisodes: number;
  totalReward: number;
  finalEquity: number;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  winRatePct: number | null;
  totalTrades: number;
  validationSharpe?: number;
  bestEpisode?: number;
  epsilon?: number;
  entropy?: number;
  loss?: number;
  statesVisited?: number;
}

export interface BacktestResult extends TracePayload {
  evaluatedAt: string;
  symbol: string;
  isTransferTest: boolean;
  testStart: string;
  testEnd: string;
  testBars: number;
  bars: OHLCVBar[];
}

export interface RunSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  config: RunConfig;
  split: SplitInfo;
  completedEpisodes: number;
  latestEpisode: EpisodeSummary | null;
  trainMetrics: PerformanceMetrics | null;
  testMetrics: PerformanceMetrics | null;
  hasWeights: boolean;
  hasBacktest: boolean;
  errorMessage: string | null;
}

export interface RunDetail extends RunSummary {
  episodes: EpisodeSummary[];
  trainTrace: TracePayload | null;
  backtest: BacktestResult | null;
}

export interface ForecastTrajectoryPoint {
  step: number;
  timestamp: number;
  date: string;
  projectedPrice: number;
  upperBand: number;
  lowerBand: number;
  expectedReturnPct: number;
}

export interface ForecastHorizon {
  horizonBars: number;
  label: string;
  targetDate: string;
  projectedPrice: number;
  expectedReturnPct: number;
  lowBand: number;
  highBand: number;
}

export interface DetectedPattern {
  name: string;
  category: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  strength: number;
  evidence: string;
}

export interface ForecastRlSignal {
  runId: string;
  algorithm: string;
  symbol: string;
  stance: string;
  buyProb: number;
  holdProb: number;
  sellProb: number;
  netScore: number;
}

export interface ForecastAudit {
  horizonBars: number;
  samplesEvaluated: number;
  directionalAccuracyPct: number | null;
  meanAbsErrorPct: number | null;
  baselineUpPct: number | null;
  residualStd: number | null;
}

export interface ForecastRegime {
  label: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  adx14: number;
  rsi14: number | null;
  atrPct: number;
  volatilityPercentile: number;
  donchianPct: number;
}

export interface ForecastKeyLevels {
  support: number;
  supportDistancePct: number;
  resistance: number;
  resistanceDistancePct: number;
  high20: number;
  low20: number;
  atrMove: number;
}

export interface ForecastResponse {
  symbol: string;
  currency: string;
  interval: IntervalType;
  asOfDate: string;
  lastClose: number;
  outlook: string;
  compositeScore: number;
  components: {
    statisticalScore: number;
    patternScore: number;
    rlScore: number | null;
  };
  regime: ForecastRegime;
  keyLevels: ForecastKeyLevels;
  horizons: ForecastHorizon[];
  trajectory: ForecastTrajectoryPoint[];
  patterns: DetectedPattern[];
  rlSignal: ForecastRlSignal | null;
  audit: ForecastAudit;
}
