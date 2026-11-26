import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_UI_STATE,
  loadPersistedUiState,
  sanitizePersistedUiState,
  savePersistedUiState,
} from './usePersistedUiState';

function makeMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

test('round-trips tab focus and comparison panel preferences cleanly', () => {
  const storage = makeMemoryStorage();
  const saved = {
    ...DEFAULT_UI_STATE,
    tab: 'compare' as const,
    activeRunId: 'run_abc123',
    compareSplit: 'test' as const,
    comparedIds: ['run_1', 'run_2'],
    ledgerSplit: 'test' as const,
    ledgerSideFilter: 'SELL' as const,
    showForecastOverlay: false,
    config: { ...DEFAULT_UI_STATE.config, symbol: 'NVDA', algorithm: 'PPO' as const, episodes: 45 },
  };

  savePersistedUiState(saved, storage);
  const loaded = loadPersistedUiState(storage);

  assert.equal(loaded.tab, 'compare');
  assert.equal(loaded.activeRunId, 'run_abc123');
  assert.equal(loaded.compareSplit, 'test');
  assert.deepEqual(loaded.comparedIds, ['run_1', 'run_2']);
  assert.equal(loaded.ledgerSplit, 'test');
  assert.equal(loaded.ledgerSideFilter, 'SELL');
  assert.equal(loaded.showForecastOverlay, false);
  assert.equal(loaded.config.symbol, 'NVDA');
  assert.equal(loaded.config.algorithm, 'PPO');
  assert.equal(loaded.config.episodes, 45);
});

test('sanitizes corrupt or out-of-range persisted payloads safely', () => {
  const clean = sanitizePersistedUiState({
    tab: 'invalid-tab',
    compareSplit: 'unknown',
    comparedIds: ['r1', 42, '', 'r2', 'r3', 'r4', 'r5', 'r6'],
    config: { symbol: 'BAD;SQL', episodes: 999, splitRatio: 0.1 },
  });

  assert.equal(clean.tab, 'workbench');
  assert.equal(clean.compareSplit, 'train');
  assert.deepEqual(clean.comparedIds, ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.equal(clean.config.symbol, 'AAPL');
  assert.equal(clean.config.episodes, 120);
  assert.equal(clean.config.splitRatio, 0.55);
});
