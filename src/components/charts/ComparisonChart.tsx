import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { RunDetail } from '../../types/trading';
import { normalizeEquitySeries } from '../../utils/format';
import { computeScaledYBounds, getVisibleSliceIndices } from '../../utils/chartViewport';
import { useChartViewport } from '../../hooks/useChartViewport';

export const COMPARE_PALETTE_LIGHT = [
  '#1A3350', // Deep Slate Navy
  '#0E8554', // Forest Emerald
  '#B67B24', // Warm Ochre
  '#3B6B8C', // Slate Steel
  '#C73B33', // Brick Crimson
];

export const COMPARE_PALETTE_DARK = [
  '#E8EDF5', // Platinum White
  '#22C58B', // Luminous Emerald
  '#E5A94C', // Warm Amber
  '#6FA3C7', // Cool Steel
  '#F0645C', // Soft Coral Red
];

interface ComparisonChartProps {
  runs: RunDetail[];
  splitMode: 'test' | 'train';
  height?: number;
  theme: 'dark' | 'light';
}

export function ComparisonChart({ runs, splitMode, height = 330, theme }: ComparisonChartProps) {
  const uid = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);
  const [hoverStep, setHoverStep] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.floor(el.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [runs.length]);

  const isDark = theme === 'dark';
  const palette = isDark ? COMPARE_PALETTE_DARK : COMPARE_PALETTE_LIGHT;

  const seriesList = useMemo(() => {
    return runs
      .map((run, idx) => {
        const trace = splitMode === 'test' ? run.backtest : run.trainTrace;
        const curve = trace?.equityCurve || [];
        return {
          run,
          color: palette[idx % palette.length],
          points: normalizeEquitySeries(curve),
        };
      })
      .filter((s) => s.points.length > 0);
  }, [runs, splitMode, palette]);

  const maxLen = useMemo(() => Math.max(0, ...seriesList.map((s) => s.points.length)), [seriesList]);

  const effectiveW = width > 0 ? width : 360;
  const isCompact = effectiveW < 480;
  const axisW = isCompact ? 50 : 60;
  const pad = { top: 20, right: axisW, bottom: 28, left: isCompact ? 10 : 16 };
  const innerW = Math.max(80, effectiveW - pad.left - pad.right);
  const innerH = Math.max(120, height - pad.top - pad.bottom);

  const {
    viewport,
    yScale,
    isPanning,
    isScalingY,
    isCustomView,
    plotRef,
    priceAxisRef,
    zoomBy,
    resetToAutoFit,
  } = useChartViewport({
    totalCount: maxLen,
    resetKey: `cmp-${splitMode}-${runs.map((r) => r.id).join(',')}`,
    innerWidth: innerW,
    targetPxPerBar: isCompact ? 6.5 : 4.5,
    minVisible: 16,
  });

  const { sliceStart, sliceEnd } = useMemo(
    () => getVisibleSliceIndices(viewport, maxLen),
    [viewport, maxLen],
  );

  const bounds = useMemo(() => {
    let minY = 100;
    let maxY = 100;
    for (const s of seriesList) {
      const sEnd = Math.min(sliceEnd, s.points.length - 1);
      for (let i = sliceStart; i <= sEnd; i++) {
        const v = s.points[i].value;
        if (v < minY) minY = v;
        if (v > maxY) maxY = v;
      }
    }
    return computeScaledYBounds(minY, maxY, yScale, 0.12);
  }, [seriesList, sliceStart, sliceEnd, yScale]);

  const visibleSpan = Math.max(1, viewport.end - viewport.start);
  const xOf = (idx: number) => pad.left + ((idx - viewport.start) / visibleSpan) * innerW;
  const yOf = (val: number) =>
    pad.top + ((bounds.maxY - val) / Math.max(bounds.maxY - bounds.minY, 1e-9)) * innerH;

  const yTicks = useMemo(() => {
    const out: number[] = [];
    for (let k = 0; k < 5; k++) {
      out.push(bounds.minY + ((bounds.maxY - bounds.minY) * k) / 4);
    }
    return out;
  }, [bounds]);

  const gridStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(22,36,54,0.08)';
  const axisFill = isDark ? '#8B95A5' : '#4D6078';

  if (seriesList.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-white/75 bg-white/56 px-6 text-center text-sm text-[#4D6078] shadow-[0_12px_36px_-10px_rgba(22,36,54,0.12),inset_0_1px_0_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.11] dark:bg-[#0D121C]/74 dark:text-[#98A6BA] dark:shadow-[0_22px_54px_-14px_rgba(0,0,0,0.68),inset_0_1px_0_0_rgba(255,255,255,0.10)]">
        No {splitMode === 'test' ? 'new-data test' : 'training'} curves available for the selected runs yet.
      </div>
    );
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning || maxLen <= 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    if (relX < 0 || relX > innerW) {
      setHoverStep(null);
      return;
    }
    const rawIdx = viewport.start + (relX / Math.max(innerW, 1)) * visibleSpan;
    setHoverStep(Math.max(0, Math.min(maxLen - 1, Math.round(rawIdx))));
  };

  const hoverX = hoverStep !== null ? xOf(hoverStep) : 0;
  const tooltipAlignRight = hoverX > effectiveW * 0.56;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/75 bg-white/56 shadow-[0_12px_36px_-10px_rgba(22,36,54,0.12),inset_0_1px_0_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.11] dark:bg-[#0D121C]/74 dark:shadow-[0_22px_54px_-14px_rgba(0,0,0,0.68),inset_0_1px_0_0_rgba(255,255,255,0.10)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#162436]/[0.08] px-5 py-3.5 dark:border-white/[0.07]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {seriesList.map((s) => {
            const pt =
              hoverStep !== null
                ? s.points[Math.min(hoverStep, s.points.length - 1)]
                : s.points[s.points.length - 1];
            return (
              <span key={s.run.id} className="flex items-center gap-2 font-mono tabular-nums">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="font-sans font-medium text-[#162436] dark:text-[#ECEFF4]">
                  {s.run.config.algorithm} · {s.run.config.symbol}
                </span>
                <span className="text-[#4D6078] dark:text-[#98A2B3]">{pt.value.toFixed(1)}</span>
              </span>
            );
          })}
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hidden font-mono text-[11px] text-[#4D6078] sm:inline dark:text-[#8B95A5]">
            Starts at 100
          </span>
          <div className="flex items-center rounded-lg border border-[#162436]/[0.08] bg-[#162436]/[0.04] p-0.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
            <button
              type="button"
              onClick={() => zoomBy(0.75, 0.85)}
              aria-label="Zoom in comparison chart"
              className="flex h-6 w-6 items-center justify-center rounded text-[#4D6078] hover:text-[#162436] dark:text-[#98A2B3] dark:hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => zoomBy(1.32, 0.85)}
              aria-label="Zoom out comparison chart"
              className="flex h-6 w-6 items-center justify-center rounded text-[#4D6078] hover:text-[#162436] dark:text-[#98A2B3] dark:hover:text-white"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            {isCustomView && (
              <button
                type="button"
                onClick={resetToAutoFit}
                aria-label="Reset comparison chart"
                className="flex h-6 items-center px-1.5 font-mono text-[10px] font-medium text-[#162436] dark:text-white"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="relative w-full min-w-0 select-none overflow-hidden">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${effectiveW} ${height}`}
          className="block"
          role="img"
          aria-label="Normalized multi-run equity comparison chart"
        >
          <defs>
            <clipPath id={`cmp-clip-${uid}`}>
              <rect x={pad.left} y={pad.top} width={innerW} height={innerH} />
            </clipPath>
          </defs>

          {yTicks.map((val, i) => {
            const y = yOf(val);
            return (
              <g key={i}>
                <line x1={pad.left} y1={y} x2={pad.left + innerW} y2={y} stroke={gridStroke} strokeWidth={1} />
                <text
                  x={pad.left + innerW + 7}
                  y={y + 3.5}
                  fill={isScalingY ? (isDark ? '#ECEFF4' : '#162436') : axisFill}
                  fontSize={isCompact ? 9 : 10}
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {val.toFixed(1)}
                </text>
              </g>
            );
          })}

          <line
            x1={pad.left + innerW}
            y1={pad.top}
            x2={pad.left + innerW}
            y2={pad.top + innerH}
            stroke={gridStroke}
            strokeWidth={1}
          />

          <g clipPath={`url(#cmp-clip-${uid})`}>
            <line
              x1={pad.left}
              y1={yOf(100)}
              x2={pad.left + innerW}
              y2={yOf(100)}
              stroke={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(22,36,54,0.22)'}
              strokeWidth={1}
              strokeDasharray="4 3"
            />

            {seriesList.map((s) => {
              const sEnd = Math.min(sliceEnd, s.points.length - 1);
              if (sEnd < sliceStart) return null;
              const pts: string[] = [];
              for (let idx = sliceStart; idx <= sEnd; idx++) {
                pts.push(`${pts.length === 0 ? 'M' : 'L'}${xOf(idx).toFixed(1)},${yOf(s.points[idx].value).toFixed(1)}`);
              }
              return (
                <path
                  key={s.run.id}
                  d={pts.join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}

            {hoverStep !== null && !isPanning && maxLen > 1 && (
              <g pointerEvents="none">
                <line
                  x1={hoverX}
                  y1={pad.top}
                  x2={hoverX}
                  y2={pad.top + innerH}
                  stroke={isDark ? '#ECEFF4' : '#162436'}
                  strokeWidth={0.85}
                  strokeDasharray="2 2"
                  opacity={0.45}
                />
                {seriesList.map((s) => {
                  const idx = Math.min(hoverStep, s.points.length - 1);
                  return (
                    <circle
                      key={s.run.id}
                      cx={xOf(idx)}
                      cy={yOf(s.points[idx].value)}
                      r={3.5}
                      fill={s.color}
                      stroke={isDark ? '#0E121A' : '#FFFFFF'}
                      strokeWidth={1.4}
                    />
                  );
                })}
              </g>
            )}
          </g>
        </svg>

        <div
          ref={plotRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverStep(null)}
          style={{
            left: pad.left,
            top: pad.top,
            width: innerW,
            height: innerH,
            touchAction: 'pan-y',
          }}
          className={`absolute z-10 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        />

        <div
          ref={priceAxisRef}
          title="Drag vertically to stretch or compress scale. Double-tap to reset."
          style={{
            right: 0,
            top: pad.top,
            width: axisW,
            height: innerH,
            touchAction: 'none',
          }}
          className={`absolute z-10 cursor-ns-resize transition-colors ${
            isScalingY ? 'bg-black/[0.04] dark:bg-white/[0.06]' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
          }`}
        />

        <AnimatePresence>
          {hoverStep !== null && !isPanning && maxLen > 1 && (
            <motion.div
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              style={{
                left: tooltipAlignRight ? undefined : Math.min(effectiveW - 196, Math.max(10, hoverX + 12)),
                right: tooltipAlignRight ? Math.max(axisW + 8, effectiveW - hoverX + 12) : undefined,
              }}
              className="pointer-events-none absolute top-3 z-20 w-[190px] rounded-xl border border-white/80 bg-white/86 p-2.5 text-[11px] shadow-[0_12px_28px_-8px_rgba(22,36,54,0.18)] backdrop-blur-2xl dark:border-white/[0.11] dark:bg-[#111621]/92 dark:shadow-lg"
            >
              <div className="mb-1.5 font-mono text-[#4D6078] dark:text-[#8B95A5]">
                Step {hoverStep + 1} / {maxLen}
              </div>
              <div className="space-y-1 font-mono tabular-nums">
                {seriesList.map((s) => {
                  const pt = s.points[Math.min(hoverStep, s.points.length - 1)];
                  const delta = pt.value - 100;
                  return (
                    <div key={s.run.id} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 truncate text-[#162436] dark:text-[#ECEFF4]">
                        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.run.config.algorithm}
                      </span>
                      <span className={delta >= 0 ? 'text-[#0E8554] dark:text-[#22C58B]' : 'text-[#C73B33] dark:text-[#F0645C]'}>
                        {pt.value.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
