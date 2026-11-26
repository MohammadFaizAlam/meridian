import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { EpisodeSummary } from '../../types/trading';
import { computeRollingAverage, formatRatio, formatSignedPct } from '../../utils/format';
import { computeScaledYBounds, getVisibleSliceIndices } from '../../utils/chartViewport';
import { useChartViewport } from '../../hooks/useChartViewport';

interface RewardChartProps {
  episodes: EpisodeSummary[];
  height?: number;
  theme: 'dark' | 'light';
}

export function RewardChart({ episodes, height = 270, theme }: RewardChartProps) {
  const uid = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [metric, setMetric] = useState<'reward' | 'sharpe'>('reward');

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
  }, [episodes.length]);

  const isDark = theme === 'dark';
  const effectiveW = width > 0 ? width : 320;
  const isCompact = effectiveW < 420;
  const axisW = isCompact ? 46 : 54;
  const pad = { top: 18, right: axisW, bottom: 28, left: isCompact ? 8 : 14 };
  const innerW = Math.max(80, effectiveW - pad.left - pad.right);
  const innerH = Math.max(110, height - pad.top - pad.bottom);

  const values = useMemo(
    () => episodes.map((e) => (metric === 'reward' ? e.totalReward : e.sharpeRatio)),
    [episodes, metric],
  );
  const rolling = useMemo(() => computeRollingAverage(values, 5), [values]);

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
    totalCount: values.length,
    resetKey: `reward-${metric}-${episodes[0]?.totalEpisodes || 0}`,
    innerWidth: innerW,
    targetPxPerBar: isCompact ? 11 : 9,
    minVisible: 8,
  });

  const { sliceStart, sliceEnd } = useMemo(
    () => getVisibleSliceIndices(viewport, values.length),
    [viewport, values.length],
  );

  const bounds = useMemo(() => {
    if (sliceEnd < sliceStart || !values.length) return { minY: -1, maxY: 1 };
    let minV = 0;
    let maxV = 0;
    for (let i = sliceStart; i <= sliceEnd; i++) {
      if (values[i] < minV) minV = values[i];
      if (values[i] > maxV) maxV = values[i];
    }
    return computeScaledYBounds(minV, maxV, yScale, 0.14);
  }, [values, sliceStart, sliceEnd, yScale]);

  const visibleSpan = Math.max(1, viewport.end - viewport.start);
  const xOf = (i: number) => pad.left + ((i - viewport.start) / visibleSpan) * innerW;
  const yOf = (v: number) =>
    pad.top + ((bounds.maxY - v) / Math.max(bounds.maxY - bounds.minY, 1e-9)) * innerH;

  const { avgPath, yTicks } = useMemo(() => {
    if (sliceEnd < sliceStart || !values.length) return { avgPath: '', yTicks: [] };
    const pts: string[] = [];
    for (let i = sliceStart; i <= sliceEnd; i++) {
      pts.push(`${pts.length === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(rolling[i]).toFixed(1)}`);
    }
    const yt: number[] = [];
    for (let k = 0; k < 4; k++) {
      yt.push(bounds.minY + ((bounds.maxY - bounds.minY) * k) / 3);
    }
    return { avgPath: pts.join(' '), yTicks: yt };
  }, [values, rolling, sliceStart, sliceEnd, bounds, viewport, visibleSpan, innerW, innerH]);

  const activeEp =
    hoverIdx !== null && episodes[hoverIdx] ? episodes[hoverIdx] : episodes[episodes.length - 1];

  const accentPos = isDark ? '#22C58B' : '#0E8554';
  const accentNeg = isDark ? '#F0645C' : '#C73B33';
  const gridStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(22,36,54,0.08)';
  const axisFill = isDark ? '#8B95A5' : '#4D6078';
  const barW = Math.max(2.5, Math.min(10, (innerW / Math.max(visibleSpan, 1)) * 0.48));

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning || !episodes.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    if (relX < 0 || relX > innerW) {
      setHoverIdx(null);
      return;
    }
    const rawIdx = viewport.start + (relX / Math.max(innerW, 1)) * visibleSpan;
    setHoverIdx(Math.max(0, Math.min(episodes.length - 1, Math.round(rawIdx))));
  };

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#162436]/[0.08] px-5 py-3.5 dark:border-white/[0.07]">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#162436] dark:text-[#ECEFF4]">Learning Progress</h3>
          <p className="truncate text-xs text-[#4D6078] dark:text-[#8B95A5]">
            Score per pass + 5-pass avg
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex items-center rounded-lg border border-[#162436]/[0.08] bg-[#162436]/[0.045] p-0.5 text-xs dark:border-white/[0.08] dark:bg-white/[0.04]">
            {(['reward', 'sharpe'] as const).map((m) => {
              const active = metric === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetric(m)}
                  className={`relative z-10 rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-[#162436] dark:text-white'
                      : 'text-[#4D6078] hover:text-[#162436] dark:text-[#8B95A5] dark:hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={`reward-mode-${uid}`}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 -z-10 rounded-md bg-white/90 shadow-xs dark:bg-white/[0.12]"
                    />
                  )}
                  {m === 'reward' ? 'Score' : 'Risk'}
                </button>
              );
            })}
          </div>

          {episodes.length > 0 && (
            <div className="flex items-center rounded-lg border border-[#162436]/[0.08] bg-[#162436]/[0.04] p-0.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
              <button
                type="button"
                onClick={() => zoomBy(0.75, 0.85)}
                aria-label="Zoom in learning chart"
                className="flex h-6 w-6 items-center justify-center rounded text-[#4D6078] hover:text-[#162436] dark:text-[#98A2B3] dark:hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => zoomBy(1.32, 0.85)}
                aria-label="Zoom out learning chart"
                className="flex h-6 w-6 items-center justify-center rounded text-[#4D6078] hover:text-[#162436] dark:text-[#98A2B3] dark:hover:text-white"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              {isCustomView && (
                <button
                  type="button"
                  onClick={resetToAutoFit}
                  aria-label="Reset learning chart"
                  className="flex h-6 items-center px-1.5 font-mono text-[10px] font-medium text-[#162436] dark:text-white"
                >
                  <Maximize2 className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {episodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 text-center" style={{ height }}>
          <p className="text-sm font-medium text-[#162436] dark:text-[#ECEFF4]">Waiting for training passes</p>
          <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[#4D6078] dark:text-[#98A2B3]">
            As the model finishes each pass through history, its score and risk trend appear here live.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#162436]/[0.06] px-5 py-2.5 font-mono text-xs tabular-nums dark:border-white/[0.05]">
            <span className="text-[#162436] dark:text-white">
              Pass <strong>{activeEp.episode}</strong>/{activeEp.totalEpisodes}
            </span>
            <span
              className={
                activeEp.totalReward >= 0
                  ? 'text-[#0E8554] dark:text-[#22C58B]'
                  : 'text-[#C73B33] dark:text-[#F0645C]'
              }
            >
              Score {activeEp.totalReward.toFixed(2)}
            </span>
            <span className="text-[#4D6078] dark:text-[#8B95A5]">
              Return {formatSignedPct(activeEp.totalReturnPct)}
            </span>
            <span className="text-[#4D6078] dark:text-[#8B95A5]">
              Risk {formatRatio(activeEp.sharpeRatio)}
            </span>
          </div>

          <div ref={containerRef} className="relative w-full min-w-0 select-none overflow-hidden">
            <svg
              width="100%"
              height={height}
              viewBox={`0 0 ${effectiveW} ${height}`}
              className="block"
              role="img"
              aria-label="Training learning progress interactive chart"
            >
              <defs>
                <clipPath id={`rew-clip-${uid}`}>
                  <rect x={pad.left} y={pad.top} width={innerW} height={innerH} />
                </clipPath>
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

              <g clipPath={`url(#rew-clip-${uid})`}>
                <line
                  x1={pad.left}
                  y1={yOf(0)}
                  x2={pad.left + innerW}
                  y2={yOf(0)}
                  stroke={isDark ? 'rgba(255,255,255,0.18)' : 'rgba(22,36,54,0.2)'}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />

                <g>
                  {values.slice(sliceStart, sliceEnd + 1).map((v, offset) => {
                    const i = sliceStart + offset;
                    const x = xOf(i);
                    const y0 = yOf(0);
                    const yv = yOf(v);
                    const top = Math.min(y0, yv);
                    const h = Math.max(1.5, Math.abs(yv - y0));
                    return (
                      <rect
                        key={i}
                        x={x - barW / 2}
                        y={top}
                        width={barW}
                        height={h}
                        rx={1}
                        fill={v >= 0 ? accentPos : accentNeg}
                        opacity={hoverIdx === i ? 0.65 : isDark ? 0.24 : 0.2}
                      />
                    );
                  })}
                </g>

                {values.length > 1 ? (
                  <path
                    d={avgPath}
                    fill="none"
                    stroke={accentPos}
                    strokeWidth={2.2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : (
                  <circle cx={xOf(0)} cy={yOf(values[0])} r={4} fill={accentPos} />
                )}

                {hoverIdx !== null && !isPanning && episodes[hoverIdx] && (
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
                      cy={yOf(rolling[hoverIdx])}
                      r={3.8}
                      fill={accentPos}
                      stroke={isDark ? '#0E121A' : '#FFFFFF'}
                      strokeWidth={1.5}
                    />
                  </g>
                )}
              </g>

              <text
                x={pad.left}
                y={height - 8}
                fill={axisFill}
                fontSize={10}
                fontFamily="IBM Plex Mono, monospace"
              >
                Pass {Math.max(1, Math.floor(viewport.start) + 1)}
              </text>
              <text
                x={pad.left + innerW}
                y={height - 8}
                textAnchor="end"
                fill={axisFill}
                fontSize={10}
                fontFamily="IBM Plex Mono, monospace"
              >
                Pass {Math.min(episodes.length, Math.ceil(viewport.end) + 1)}
              </text>
            </svg>

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
          </div>
        </>
      )}
    </div>
  );
}
