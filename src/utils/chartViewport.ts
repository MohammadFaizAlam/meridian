export interface TimeViewport {
  /** Floating-point index of left edge (0 .. totalCount - 1) */
  start: number;
  /** Floating-point index of right edge (start + minSpan .. totalCount - 1) */
  end: number;
}

export interface ViewportConstraints {
  totalCount: number;
  minVisible: number;
  maxVisible: number;
}

/**
 * Computes a readable default window anchored to the latest (rightmost) bars
 * so mobile and tablet screens never squeeze hundreds of candles into tiny slivers.
 */
export function computeDefaultViewport(
  totalCount: number,
  containerWidthPx: number,
  targetPxPerBar = 10,
  minVisible = 16,
): TimeViewport {
  if (totalCount <= 1) return { start: 0, end: Math.max(0, totalCount - 1) };
  const safeMin = Math.min(totalCount, Math.max(4, minVisible));
  const desiredCount = Math.round(Math.max(containerWidthPx, 180) / Math.max(targetPxPerBar, 3));
  const visibleCount = Math.max(safeMin, Math.min(totalCount, desiredCount));
  const end = totalCount - 1;
  const start = Math.max(0, end - (visibleCount - 1));
  return { start, end };
}

/**
 * Clamps a time viewport cleanly inside [0, totalCount - 1] while preserving span.
 */
export function clampViewport(
  vp: TimeViewport,
  constraints: ViewportConstraints,
): TimeViewport {
  const { totalCount, minVisible, maxVisible } = constraints;
  if (totalCount <= 1) return { start: 0, end: Math.max(0, totalCount - 1) };

  const maxIndex = totalCount - 1;
  const minSpan = Math.min(maxIndex, Math.max(3, minVisible - 1));
  const maxSpan = Math.min(maxIndex, Math.max(minSpan, maxVisible - 1));

  let span = vp.end - vp.start;
  if (!Number.isFinite(span) || span < minSpan) span = minSpan;
  if (span > maxSpan) span = maxSpan;

  let start = Number.isFinite(vp.start) ? vp.start : 0;
  let end = start + span;

  if (start < 0) {
    start = 0;
    end = span;
  }
  if (end > maxIndex) {
    end = maxIndex;
    start = Math.max(0, end - span);
  }
  return { start, end };
}

/**
 * Shifts the viewport horizontally by deltaBars (positive = look further right/newer).
 */
export function panViewport(
  vp: TimeViewport,
  deltaBars: number,
  constraints: ViewportConstraints,
): TimeViewport {
  return clampViewport(
    { start: vp.start + deltaBars, end: vp.end + deltaBars },
    constraints,
  );
}

/**
 * Zooms the time axis around anchorRatio (0 = left edge, 1 = right edge).
 * scaleFactor < 1 zooms IN (fewer bars, wider candles); scaleFactor > 1 zooms OUT (more bars).
 */
export function zoomViewport(
  vp: TimeViewport,
  scaleFactor: number,
  anchorRatio: number,
  constraints: ViewportConstraints,
): TimeViewport {
  const { totalCount, minVisible, maxVisible } = constraints;
  if (totalCount <= 1) return { start: 0, end: Math.max(0, totalCount - 1) };

  const maxIndex = totalCount - 1;
  const minSpan = Math.min(maxIndex, Math.max(3, minVisible - 1));
  const maxSpan = Math.min(maxIndex, Math.max(minSpan, maxVisible - 1));

  const currentSpan = Math.max(minSpan, vp.end - vp.start);
  const clampedAnchor = Math.max(0, Math.min(1, anchorRatio));
  const anchorIndex = vp.start + currentSpan * clampedAnchor;

  const nextSpan = Math.max(minSpan, Math.min(maxSpan, currentSpan * scaleFactor));
  const nextStart = anchorIndex - nextSpan * clampedAnchor;
  const nextEnd = nextStart + nextSpan;

  return clampViewport({ start: nextStart, end: nextEnd }, constraints);
}

/**
 * Applies a manual price-axis stretch/compress factor around the auto-fit vertical midpoint.
 * yScale > 1 compresses price vertically (zooms out Y); yScale < 1 stretches price (zooms in Y).
 */
export function computeScaledYBounds(
  rawMin: number,
  rawMax: number,
  yScale: number,
  padFraction = 0.08,
): { minY: number; maxY: number } {
  const baseSpan = rawMax - rawMin || Math.max(Math.abs(rawMax) * 0.05, 1);
  const paddedSpan = baseSpan * (1 + padFraction * 2);
  const mid = (rawMin + rawMax) / 2;
  const safeScale = Math.max(0.2, Math.min(6.0, yScale));
  const half = (paddedSpan * safeScale) / 2;
  return {
    minY: mid - half,
    maxY: mid + half,
  };
}

/**
 * Returns integer slice bounds [sliceStart, sliceEnd] inclusive (with 1-bar bleed on each side
 * so lines/candles never clip abruptly at viewport edges).
 */
export function getVisibleSliceIndices(
  vp: TimeViewport,
  totalCount: number,
): { sliceStart: number; sliceEnd: number } {
  if (totalCount <= 0) return { sliceStart: 0, sliceEnd: -1 };
  const sliceStart = Math.max(0, Math.floor(vp.start) - 1);
  const sliceEnd = Math.min(totalCount - 1, Math.ceil(vp.end) + 1);
  return { sliceStart, sliceEnd };
}
