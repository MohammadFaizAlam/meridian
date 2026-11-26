import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDefaultViewport,
  panViewport,
  zoomViewport,
  computeScaledYBounds,
  getVisibleSliceIndices,
} from './chartViewport';

test('computeDefaultViewport shows a readable mobile window instead of squeezing 500 bars', () => {
  const mobile = computeDefaultViewport(500, 340, 10, 16);
  const visibleMobile = mobile.end - mobile.start + 1;
  assert.equal(mobile.end, 499);
  assert.equal(visibleMobile, 34);

  const desktop = computeDefaultViewport(500, 1000, 10, 16);
  const visibleDesktop = desktop.end - desktop.start + 1;
  assert.equal(desktop.end, 499);
  assert.equal(visibleDesktop, 100);
});

test('panViewport shifts smoothly and clamps strictly within data bounds', () => {
  const c = { totalCount: 100, minVisible: 12, maxVisible: 100 };
  const startVp = { start: 60, end: 99 };

  const pannedLeft = panViewport(startVp, -20, c);
  assert.equal(pannedLeft.start, 40);
  assert.equal(pannedLeft.end, 79);

  const clampedLeft = panViewport(startVp, -200, c);
  assert.equal(clampedLeft.start, 0);
  assert.equal(clampedLeft.end, 39);

  const clampedRight = panViewport({ start: 20, end: 59 }, 200, c);
  assert.equal(clampedRight.end, 99);
  assert.equal(clampedRight.start, 60);
});

test('zoomViewport preserves anchor point while zooming in and out', () => {
  const c = { totalCount: 200, minVisible: 12, maxVisible: 200 };
  const vp = { start: 100, end: 180 }; // span 80, midpoint at 140

  const zoomedIn = zoomViewport(vp, 0.5, 0.5, c);
  assert.ok(Math.abs((zoomedIn.end - zoomedIn.start) - 40) < 1e-6);
  assert.ok(Math.abs(((zoomedIn.start + zoomedIn.end) / 2) - 140) < 1e-6);

  // Respects minVisible limit
  const maxZoomIn = zoomViewport(vp, 0.01, 0.5, c);
  assert.equal(Math.round(maxZoomIn.end - maxZoomIn.start), 11);
});

test('computeScaledYBounds stretches and compresses symmetrically around midpoint', () => {
  const auto = computeScaledYBounds(100, 200, 1.0, 0.1); // span 120, mid 150 -> [90, 210]
  assert.ok(Math.abs(auto.minY - 90) < 1e-6);
  assert.ok(Math.abs(auto.maxY - 210) < 1e-6);

  const compressed = computeScaledYBounds(100, 200, 2.0, 0.1); // span 240, mid 150 -> [30, 270]
  assert.ok(Math.abs(compressed.minY - 30) < 1e-6);
  assert.ok(Math.abs(compressed.maxY - 270) < 1e-6);
});

test('getVisibleSliceIndices includes 1-bar edge bleed safely', () => {
  const slice = getVisibleSliceIndices({ start: 10.4, end: 30.2 }, 100);
  assert.deepEqual(slice, { sliceStart: 9, sliceEnd: 32 });

  const edge = getVisibleSliceIndices({ start: 0, end: 99 }, 100);
  assert.deepEqual(edge, { sliceStart: 0, sliceEnd: 99 });
});
