import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { EquityPoint } from '../../types/trading';
import { formatCurrency, formatShortDate, formatSignedPct } from '../../utils/format';
import { computeScaledYBounds, getVisibleSliceIndices } from '../../utils/chartViewport';
import { useChartViewport } from '../../hooks/useChartViewport';

interface EquityCurveChartProps {
  curve: EquityPoint[];
  title: string;
  subtitle?: string;
  currency?: string;
  height?: number;
  theme: 'dark' | 'light';
  emptyPrompt?: string;
}

export function EquityCurveChart({
  curve,
  title,
  subtitle,
  currency = 'USD',
  height = 270,
  theme,
  emptyPrompt = 'Start training to watch your portfolio balance compare against Buy & Hold.',
}: EquityCurveChartProps) {
  const uid = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'equity' | 'drawdown'>('equity');

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
  }, [curve.length]);

  const isDark = theme === 'dark';
  const effectiveW = width > 0 ? width : 360;
  const isCompact = effectiveW < 460;
  const axisW = isCompact ? 62 : 76;
  const pad = { top: 18, right: axisW, bottom: 28, left: isCompact ? 8 : 14 };
  const innerW = Math.max(80, effectiveW - pad.left - pad.right);
  const innerH = Math.max(110, height - pad.top - pad.bottom);

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
    totalCount: curve.length,
    resetKey: `${title}-${curve.length > 0 ? curve[0].timestamp : 0}-${viewMode}`,
    innerWidth: innerW,
    targetPxPerBar: isCompact ? 6.5 : 4.5,
    minVisible: 16,
  });

  const { sliceStart, sliceEnd } = useMemo(
    () => getVisibleSliceIndices(viewport, curve.length),
    [viewport, curve.length],
  );

  const bounds = useMemo(() => {
    if (sliceEnd < sliceStart || !curve.length) return { minY: 0, maxY: 1 };
    if (viewMode === 'drawdown') {
      let minDd = -1;
      for (let i = sliceStart; i <= sliceEnd; i++) {
        if (curve[i].drawdown_pct < minDd) minDd = curve[i].drawdown_pct;
      }
      const scaled = Math.max(-100, minDd * 1.15 * Math.max(0.35, Math.min(3.5, yScale)));
      return { minY: scaled, maxY: 0 };
    }
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = sliceStart; i <= sliceEnd; i++) {
      const pt = curve[i];
      if (pt.equity < minV) minV = pt.equity;
      if (pt.benchmark_equity < minV) minV = pt.benchmark_equity;
      if (pt.equity > maxV) maxV = pt.equity;
      if (pt.benchmark_equity > maxV) maxV = pt.benchmark_equity;
    }
    return computeScaledYBounds(minV, maxV, yScale, 0.09);
  }, [curve, sliceStart, sliceEnd, viewMode, yScale]);

  const visibleSpan = Math.max(1, viewport.end - viewport.start);
  const xOf = (i: number) => pad.left + ((i - viewport.start) / visibleSpan) * innerW;
  const yOf = (v: number) =>
    pad.top + ((bounds.maxY - v) / Math.max(bounds.maxY - bounds.minY, 1e-9)) * innerH;

  const { agentPath, agentAreaPath, benchPath, ddAreaPath, yTicks, xTicks } = useMemo(() => {
    if (sliceEnd < sliceStart || !curve.length) {
      return { agentPath: '', agentAreaPath: '', benchPath: '', ddAreaPath: '', yTicks: [], xTicks: [] };
    }
    const ap: string[] = [];
    const bp: string[] = [];
    const ddPts: string[] = [];

    for (let i = sliceStart; i <= sliceEnd; i++) {
      const pt = curve[i];
      const x = xOf(i);
      if (viewMode === 'equity') {
        ap.push(`${ap.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${yOf(pt.equity).toFixed(1)}`);
        bp.push(`${bp.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${yOf(pt.benchmark_equity).toFixed(1)}`);
      } else {
        ddPts.push(`${ddPts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${yOf(pt.drawdown_pct).toFixed(1)}`);
      }
    }

    const baseBottom = pad.top + innerH;
    const eqArea =
      viewMode === 'equity' && ap.length > 1
        ? `${ap.join(' ')} L${xOf(sliceEnd).toFixed(1)},${baseBottom.toFixed(1)} L${xOf(sliceStart).toFixed(1)},${baseBottom.toFixed(1)} Z`
        : '';

    const ddArea =
      viewMode === 'drawdown' && ddPts.length > 1
        ? `${ddPts.join(' ')} L${xOf(sliceEnd).toFixed(1)},${yOf(0).toFixed(1)} L${xOf(sliceStart).toFixed(1)},${yOf(0).toFixed(1)} Z`
        : '';

    const yt: number[] = [];
    for (let k = 0; k < 4; k++) {
      yt.push(bounds.minY + ((bounds.maxY - bounds.minY) * k) / 3);
    }

    const xtCount = isCompact ? 3 : 4;
    const xt: { idx: number; label: string; x: number }[] = [];
    const seen = new Set<number>();
    for (let k = 0; k < xtCount; k++) {
      const frac = (k + 0.35) / (xtCount - 0.3);
      const idx = Math.max(0, Math.min(curve.length - 1, Math.round(viewport.start + visibleSpan * frac)));
      if (!seen.has(idx)) {
        seen.add(idx);
        xt.push({ idx, label: formatShortDate(curve[idx].date), x: xOf(idx) });
      }
    }

    return {
      agentPath: viewMode === 'equity' ? ap.join(' ') : ddPts.join(' '),
      agentAreaPath: eqArea,
      benchPath: bp.join(' '),
      ddAreaPath: ddArea,
      yTicks: yt,
      xTicks: xt,
    };
  }, [curve, sliceStart, sliceEnd, bounds, viewport, visibleSpan, innerW, innerH, viewMode, isCompact]);

  const active = hoverIdx !== null && curve[hoverIdx] ? curve[hoverIdx] : curve[curve.length - 1];
  const isGain = curve.length > 0 && curve[curve.length - 1].equity >= curve[0].equity;
  const lineAccent = isGain
    ? isDark ? '#22C58B' : '#0E8554'
    : isDark ? '#F0645C' : '#C73B33';
  const ddColor = isDark ? '#F0645C' : '#C73B33';
  const gridStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(22,36,54,0.08)';
  const axisFill = isDark ? '#8B95A5' : '#4D6078';
  const benchStroke = isDark ? '#707D91' : '#6B7E94';

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning || !curve.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    if (relX < 0 || relX > innerW) {
      setHoverIdx(null);
      return;
    }
    const rawIdx = viewport.start + (relX / Math.max(innerW, 1)) * visibleSpan;
    setHoverIdx(Math.max(0, Math.min(curve.length - 1, Math.round(rawIdx))));
  };

  const hoverX = hoverIdx !== null ? xOf(hoverIdx) : 0;
  const tooltipAlignRight = hoverX > effectiveW * 0.56;

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#162436]/[0.08] px-5 py-3.5 dark:border-white/[0.07]">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#162436] dark:text-[#ECEFF4]">{title}</h3>
          {subtitle && <p className="truncate text-xs text-[#4D6078] dark:text-[#8B95A5]">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex items-center rounded-lg border border-[#162436]/[0.08] bg-[#162436]/[0.045] p-0.5 text-xs dark:border-white/[0.08] dark:bg-white/[0.04]">
            {(['equity', 'drawdown'] as const).map((m) => {
              const activeTab = viewMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setViewMode(m)}
                  className={`relative z-10 rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeTab
                      ? 'text-[#162436] dark:text-white'
                      : 'text-[#4D6078] hover:text-[#162436] dark:text-[#8B95A5] dark:hover:text-white'
                  }`}
                >
                  {activeTab && (
                    <motion.span
                      layoutId={`eq-mode-${uid}`}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 -z-10 rounded-md bg-white/90 shadow-xs dark:bg-white/[0.12]"
                    />
                  )}
                  {m === 'equity' ? 'Balance' : 'Drops'}
                </button>
              );
            })}
          </div>

          {curve.length > 0 && (
            <div className="flex items-center rounded-lg border border-[#162436]/[0.08] bg-[#162436]/[0.04] p-0.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
              <button
                type="button"
                onClick={() => zoomBy(0.75, 0.85)}
                aria-label="Zoom in balance chart"
                className="flex h-6 w-6 items-center justify-center rounded text-[#4D6078] hover:text-[#162436] dark:text-[#98A2B3] dark:hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => zoomBy(1.32, 0.85)}
                aria-label="Zoom out balance chart"
                className="flex h-6 w-6 items-center justify-center rounded text-[#4D6078] hover:text-[#162436] dark:text-[#98A2B3] dark:hover:text-white"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              {isCustomView && (
                <button
                  type="button"
                  onClick={resetToAutoFit}
                  aria-label="Reset balance chart"
                  className="flex h-6 items-center px-1.5 font-mono text-[10px] font-medium text-[#162436] dark:text-white"
                >
                  <Maximize2 className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {curve.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center bg-transparent px-6 text-center"
          style={{ height }}
        >
          <p className="text-sm font-medium text-[#162436] dark:text-[#ECEFF4]">No balance curve yet</p>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[#4D6078] dark:text-[#98A2B3]">
            {emptyPrompt}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-[#162436]/[0.06] px-5 py-2.5 font-mono text-xs tabular-nums dark:border-white/[0.05]">
            <span className="text-[#4D6078] dark:text-[#8B95A5]">{active.date}</span>
            <span className="text-[#162436] dark:text-white">
              Strategy <strong>{formatCurrency(active.equity, currency)}</strong>
            </span>
            <span className="text-[#4D6078] dark:text-[#8B95A5]">
              Buy & Hold {formatCurrency(active.benchmark_equity, currency)}
            </span>
            <span
              className={
                active.drawdown_pct < -0.01
                  ? 'text-[#C73B33] dark:text-[#F0645C]'
                  : 'text-[#4D6078] dark:text-[#8B95A5]'
              }
            >
              Drop {formatSignedPct(active.drawdown_pct)}
            </span>
          </div>

          <div ref={containerRef} className="relative w-full min-w-0 select-none overflow-hidden">
            <svg
              width="100%"
              height={height}
              viewBox={`0 0 ${effectiveW} ${height}`}
              className="block"
              role="img"
              aria-label={`${title} interactive chart`}
            >
              <defs>
                <clipPath id={`eq-clip-${uid}`}>
                  <rect x={pad.left} y={pad.top} width={innerW} height={innerH} />
                </clipPath>
                <linearGradient id={`eq-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineAccent} stopOpacity={isDark ? 0.24 : 0.16} />
                  <stop offset="100%" stopColor={lineAccent} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`dd-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ddColor} stopOpacity={0.04} />
                  <stop offset="100%" stopColor={ddColor} stopOpacity={0.28} />
                </linearGradient>
              </defs>

              {yTicks.map((val, idx) => {
                const y = yOf(val);
                return (
                  <g key={idx}>
                    <line x1={pad.left} y1={y} x2={pad.left + innerW} y2={y} stroke={gridStroke} strokeWidth={1} />
                    <text
                      x={pad.left + innerW + 7}
                      y={y + 3.5}
                      fill={isScalingY ? (isDark ? '#ECEFF4' : '#162436') : axisFill}
                      fontSize={isCompact ? 9 : 10}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {viewMode === 'equity' ? formatCurrency(val, currency) : `${val.toFixed(1)}%`}
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

              <g clipPath={`url(#eq-clip-${uid})`}>
                {viewMode === 'equity' ? (
                  <>
                    {agentAreaPath && <path d={agentAreaPath} fill={`url(#eq-grad-${uid})`} />}
                    <path
                      d={benchPath}
                      fill="none"
                      stroke={benchStroke}
                      strokeWidth={1.35}
                      strokeDasharray="4 3"
                    />
                    <path
                      d={agentPath}
                      fill="none"
                      stroke={lineAccent}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </>
                ) : (
                  <>
                    <path d={ddAreaPath} fill={`url(#dd-grad-${uid})`} />
                    <path d={agentPath} fill="none" stroke={ddColor} strokeWidth={1.7} />
                  </>
                )}

                {hoverIdx !== null && !isPanning && curve[hoverIdx] && (
                  <g pointerEvents="none">
                    <line
                      x1={xOf(hoverIdx)}
                      y1={pad.top}
                      x2={xOf(hoverIdx)}
                      y2={pad.top + innerH}
                      stroke={isDark ? '#ECEFF4' : '#162436'}
                      strokeWidth={0.85}
                      strokeDasharray="2 2"
                      opacity={0.45}
                    />
                    <circle
                      cx={xOf(hoverIdx)}
                      cy={yOf(viewMode === 'equity' ? curve[hoverIdx].equity : curve[hoverIdx].drawdown_pct)}
                      r={3.8}
                      fill={viewMode === 'equity' ? lineAccent : ddColor}
                      stroke={isDark ? '#0E121A' : '#FFFFFF'}
                      strokeWidth={1.5}
                    />
                  </g>
                )}
              </g>

              {xTicks.map((t) => (
                <text
                  key={t.idx}
                  x={t.x}
                  y={height - 8}
                  textAnchor="middle"
                  fill={axisFill}
                  fontSize={isCompact ? 9 : 10}
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {t.label}
                </text>
              ))}
            </svg>

            {/* Plot Interactive Pan/Pinch/Wheel Hit Layer */}
            <div
              ref={plotRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                left: pad.left,
                top: pad.top,
                width: innerW,
                height: innerH,
                touchAction: 'pan-y',
              }}
              className={`absolute z-10 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
            />

            {/* Right Value Axis Drag-to-Scale Hit Layer */}
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
              {hoverIdx !== null && !isPanning && active && (
                <motion.div
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    left: tooltipAlignRight ? undefined : Math.min(effectiveW - 190, Math.max(10, hoverX + 12)),
                    right: tooltipAlignRight ? Math.max(axisW + 8, effectiveW - hoverX + 12) : undefined,
                  }}
                  className="pointer-events-none absolute top-3 z-20 w-[180px] rounded-xl border border-white/80 bg-white/86 p-2.5 font-mono text-[11px] tabular-nums shadow-[0_12px_28px_-8px_rgba(22,36,54,0.18)] backdrop-blur-2xl dark:border-white/[0.11] dark:bg-[#111621]/92 dark:shadow-lg"
                >
                  <div className="text-[#4D6078] dark:text-[#8B95A5]">{active.date}</div>
                  <div className="mt-1 flex justify-between text-[#162436] dark:text-white">
                    <span>Strategy</span>
                    <span className="font-semibold">{formatCurrency(active.equity, currency)}</span>
                  </div>
                  <div className="flex justify-between text-[#4D6078] dark:text-[#8B95A5]">
                    <span>Buy & Hold</span>
                    <span>{formatCurrency(active.benchmark_equity, currency)}</span>
                  </div>
                  <div className="mt-1 flex justify-between border-t border-[#162436]/[0.08] pt-1 dark:border-white/[0.08]">
                    <span className="text-[#4D6078] dark:text-[#8B95A5]">Drop</span>
                    <span className={active.drawdown_pct < -0.01 ? 'text-[#C73B33] dark:text-[#F0645C]' : 'text-[#4D6078] dark:text-[#8B95A5]'}>
                      {formatSignedPct(active.drawdown_pct)}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}
