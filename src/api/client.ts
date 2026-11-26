import type {
  BacktestResult,
  ForecastResponse,
  InstrumentOption,
  IntervalType,
  MarketDataResponse,
  RangeType,
  RunConfig,
  RunDetail,
  RunSummary,
} from '../types/trading';

function normalizeApiBase(raw: string | undefined): string {
  const cleaned = (raw || '').trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('/') || /^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  return `https://${cleaned}`;
}

const API_BASE_URL = normalizeApiBase(import.meta.env.VITE_API_BASE_URL);

export function getApiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  return path.startsWith('/') ? `${API_BASE_URL}${path}` : `${API_BASE_URL}/${path}`;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (init?.body !== undefined && !('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(getApiUrl(url), {
      ...init,
      headers,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error';
    throw new Error(
      API_BASE_URL
        ? `Could not reach backend (${API_BASE_URL}): ${detail}. If hosted on Render Free, wait ~30s for wake-up and check ALLOWED_ORIGINS.`
        : `Backend unreachable: ${detail}`,
    );
  }

  const text = await res.text();
  let data: unknown = null;
  let parsedJson = false;
  try {
    data = text ? JSON.parse(text) : null;
    parsedJson = true;
  } catch {
    const looksHtml = /^\s*</.test(text);
    data = {
      error: looksHtml
        ? !API_BASE_URL
          ? `Backend URL is not configured (HTTP ${res.status}). Set VITE_API_BASE_URL in Vercel and redeploy.`
          : `Backend returned HTML instead of JSON (HTTP ${res.status}). Check VITE_API_BASE_URL (${API_BASE_URL}).`
        : text || `HTTP ${res.status}`,
    };
  }
  if (!res.ok || !parsedJson) {
    const errMsg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new Error(errMsg);
  }
  return data as T;
}

export async function fetchInstruments(): Promise<InstrumentOption[]> {
  const res = await apiRequest<{ instruments: InstrumentOption[] }>('/api/instruments');
  return res.instruments;
}

export async function fetchMarketData(params: {
  symbol: string;
  interval: IntervalType;
  range: RangeType;
  splitRatio: number;
  refresh?: boolean;
}): Promise<MarketDataResponse> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    range: params.range,
    split: params.splitRatio.toFixed(2),
  });
  if (params.refresh) qs.set('refresh', '1');
  return apiRequest<MarketDataResponse>(`/api/market-data?${qs.toString()}`);
}

export async function fetchForecast(params: {
  symbol: string;
  interval: IntervalType;
  range: RangeType;
  splitRatio: number;
  runId?: string | null;
}): Promise<ForecastResponse> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    range: params.range,
    split: params.splitRatio.toFixed(2),
  });
  if (params.runId) qs.set('runId', params.runId);
  return apiRequest<ForecastResponse>(`/api/forecast?${qs.toString()}`);
}

export async function fetchRuns(): Promise<RunSummary[]> {
  const res = await apiRequest<{ runs: RunSummary[] }>('/api/runs');
  return res.runs;
}

export async function fetchRunDetail(runId: string): Promise<RunDetail> {
  return apiRequest<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
}

export async function startTrainingRun(config: RunConfig): Promise<RunSummary> {
  return apiRequest<RunSummary>('/api/runs/start', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function pauseTrainingRun(runId: string): Promise<RunSummary> {
  return apiRequest<RunSummary>(`/api/runs/${encodeURIComponent(runId)}/pause`, {
    method: 'POST',
  });
}

export async function resumeTrainingRun(runId: string): Promise<RunSummary> {
  return apiRequest<RunSummary>(`/api/runs/${encodeURIComponent(runId)}/resume`, {
    method: 'POST',
  });
}

export async function stopTrainingRun(runId: string): Promise<RunSummary> {
  return apiRequest<RunSummary>(`/api/runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
  });
}

export async function deleteTrainingRun(runId: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  });
}

export async function executeBacktest(runId: string, overrideSymbol?: string): Promise<BacktestResult> {
  return apiRequest<BacktestResult>(`/api/runs/${encodeURIComponent(runId)}/backtest`, {
    method: 'POST',
    body: JSON.stringify(overrideSymbol ? { symbol: overrideSymbol } : {}),
  });
}
