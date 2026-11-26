import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type {
  ForecastTrajectoryPoint,
  OHLCVBar,
  SplitInfo,
  TradeRecord,
} from '../../types/trading';
import {
  formatCurrency,
  formatPrice,
  formatShortDate,
  formatSignedPct,
  formatVolume,
} from '../../utils/format';
import { computeScaledYBounds, getVisibleSliceIndices } from '../../utils/chartViewport';
import { useChartViewport } from '../../hooks/useChartViewport';

interface PriceTradeChartProps {
  bars: OHLCVBar[];
  split: SplitInfo | null;
  trades: TradeRecord[];
  mode: 'full' | 'test-only';
  symbol: string;
  currency?: string;
  height?: number;
  theme: 'dark' | 'light';
  forecast?: ForecastTrajectoryPoint[] | null;
  showForecast?: boolean;
  onToggleForecast?: () => void;
  supportLevel?: number | null;
  resistanceLevel?: number | null;
}

export function PriceTradeChart({
  bars,
  split,
  trades,
  mode,
  symbol,
  currency = 'USD',
  height = 390,
  theme,
  forecast = null,
  showForecast = false,
  onToggleForecast,
  supportLevel = null,
  resistanceLevel = null,
}: PriceTradeChartProps) {
  const uid = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showSma, setShowSma] = useState(true);
  const [chartStyle, setChartStyle] = useState<'line' | 'candles'>('candles');

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
  }, []);

  const isDark = theme === 'dark';
  const effectiveW = width > 0 ? width : 360;
  const isCompact = effectiveW < 540;
  const chartHeight = isCompact ? Math.min(height, 330) : height;

  const activeForecast = showForecast && forecast && forecast.length > 0 ? forecast : null;
  const forecastCount = activeForecast ? activeForecast.length : 0;
  const totalCount = bars.length + forecastCount;

  const axisW = isCompact ? 58 : 72;
  const pad = { top: 22, right: axisW, bottom: 30, left: isCompact ? 8 : 14 };
  const innerW = Math.max(80, effectiveW - pad.left - pad.right);
  const volH = isCompact ? 34 : 46;
  const priceH = Math.max(120, chartHeight - pad.top - pad.bottom - volH - 14);

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
    totalCount,
    resetKey: `${symbol}-${mode}-${bars.length > 0 ? bars[0].timestamp : 0}-${forecastCount}`,
    innerWidth: innerW,
    targetPxPerBar: chartStyle === 'candles' ? (isCompact ? 9.5 : 8.5) : isCompact ? 6.5 : 5.5,
    minVisible: 16,
  });

  const tradeByTs = useMemo(() => {
    const m = new Map<number, TradeRecord[]>();
    for (const t of trades) {
      const arr = m.get(t.timestamp) || [];
      arr.push(t);
      m.set(t.timestamp, arr);
    }
    return m;
  }, [trades]);

  const { sliceStart, sliceEnd } = useMemo(() => {
    const raw = getVisibleSliceIndices(viewport, totalCount);
    return {
      sliceStart: Math.min(raw.sliceStart, Math.max(0, bars.length - 1)),
      sliceEnd: Math.min(raw.sliceEnd, Math.max(0, bars.length - 1)),
    };
  }, [viewport, totalCount, bars.length]);

  const bounds = useMemo(() => {
    if (sliceEnd < sliceStart || !bars.length) return { minP: 0, maxP: 1, maxV: 1 };
    let minP = Infinity;
    let maxP = -Infinity;
    let maxV = 0;
    for (let i = sliceStart; i <= sliceEnd; i++) {
      const b = bars[i];
      if (!b) continue;
      if (b.low < minP) minP = b.low;
      if (b.high > maxP) maxP = b.high;
      if (b.volume > maxV) maxV = b.volume;
    }

    // Include forecast band bounds when visible in viewport
    if (activeForecast && viewport.end >= bars.length - 1) {
      for (const pt of activeForecast) {
        if (pt.lowerBand < minP) minP = pt.lowerBand;
        if (pt.upperBand > maxP) maxP = pt.upperBand;
      }
    }

    if (!Number.isFinite(minP)) return { minP: 0, maxP: 1, maxV: 1 };
    const { minY, maxY } = computeScaledYBounds(minP, maxP, yScale, 0.08);
    return { minP: minY, maxP: maxY, maxV: maxV > 0 ? maxV : 1 };
  }, [bars, sliceStart, sliceEnd, yScale, activeForecast, viewport.end]);

  const visibleSpan = Math.max(1, viewport.end - viewport.start);
  const xOf = (i: number) => pad.left + ((i - viewport.start) / visibleSpan) * innerW;
  const yOf = (p: number) =>
    pad.top + ((bounds.maxP - p) / Math.max(bounds.maxP - bounds.minP, 1e-9)) * priceH;

  const {
    pricePath,
    areaPath,
    sma10Path,
    sma30Path,
    forecastLinePath,
    forecastConePath,
    splitX,
    yTicks,
    xTicks,
  } = useMemo(() => {
    if (sliceEnd < sliceStart || !bars.length) {
      return {
        pricePath: '',
        areaPath: '',
        sma10Path: '',
        sma30Path: '',
        forecastLinePath: '',
        forecastConePath: '',
        splitX: null,
        yTicks: [],
        xTicks: [],
      };
    }

    const pts: string[] = [];
    const s10: string[] = [];
    const s30: string[] = [];
    let s10Started = false;
    let s30Started = false;

    for (let i = sliceStart; i <= sliceEnd; i++) {
      const b = bars[i];
      const x = xOf(i);
      const y = yOf(b.close);
      pts.push(`${pts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);

      if (b.sma10 !== null && b.sma10 !== undefined) {
        s10.push(`${!s10Started ? 'M' : 'L'}${x.toFixed(1)},${yOf(b.sma10).toFixed(1)}`);
        s10Started = true;
      }
      if (b.sma30 !== null && b.sma30 !== undefined) {
        s30.push(`${!s30Started ? 'M' : 'L'}${x.toFixed(1)},${yOf(b.sma30).toFixed(1)}`);
        s30Started = true;
      }
    }

    const baselineY = pad.top + priceH;
    const area =
      pts.length > 1
        ? `${pts.join(' ')} L${xOf(sliceEnd).toFixed(1)},${baselineY.toFixed(1)} L${xOf(sliceStart).toFixed(1)},${baselineY.toFixed(1)} Z`
        : '';

    let fLine = '';
    let fCone = '';
    if (activeForecast && bars.length > 0) {
      const lastIdx = bars.length - 1;
      const startX = xOf(lastIdx);
      const startY = yOf(bars[lastIdx].close);
      const lineSegs = [`M${startX.toFixed(1)},${startY.toFixed(1)}`];
      const upperSegs = [`M${startX.toFixed(1)},${startY.toFixed(1)}`];
      const lowerSegs: string[] = [];

      activeForecast.forEach((pt, k) => {
        const px = xOf(lastIdx + 1 + k);
        lineSegs.push(`L${px.toFixed(1)},${yOf(pt.projectedPrice).toFixed(1)}`);
        upperSegs.push(`L${px.toFixed(1)},${yOf(pt.upperBand).toFixed(1)}`);
        lowerSegs.unshift(`L${px.toFixed(1)},${yOf(pt.lowerBand).toFixed(1)}`);
      });

      fLine = lineSegs.join(' ');
      fCone = `${upperSegs.join(' ')} ${lowerSegs.join(' ')} Z`;
    }

    const sx =
      mode === 'full' && split && split.splitIndex > 0 && split.splitIndex < bars.length
        ? xOf(split.splitIndex)
        : null;

    const yt: number[] = [];
    const tickCount = isCompact ? 4 : 5;
    for (let k = 0; k < tickCount; k++) {
      yt.push(bounds.minP + ((bounds.maxP - bounds.minP) * k) / (tickCount - 1));
    }

    const xtCount = isCompact ? 3 : 6;
    const xt: { idx: number; label: string; x: number }[] = [];
    const seen = new Set<number>();
    for (let k = 0; k < xtCount; k++) {
      const frac = (k + 0.35) / (xtCount - 0.3);
      const idx = Math.max(0, Math.min(totalCount - 1, Math.round(viewport.start + visibleSpan * frac)));
      if (!seen.has(idx)) {
        seen.add(idx);
        const dateStr =
          idx < bars.length
            ? bars[idx].date
            : activeForecast?.[idx - bars.length]?.date || '';
        if (dateStr) {
          xt.push({ idx, label: formatShortDate(dateStr), x: xOf(idx) });
        }
      }
    }

    return {
      pricePath: pts.join(' '),
      areaPath: area,
      sma10Path: s10.join(' '),
      sma30Path: s30.join(' '),
      forecastLinePath: fLine,
      forecastConePath: fCone,
      splitX: sx,
      yTicks: yt,
      xTicks: xt,
    };
  }, [
    bars,
    activeForecast,
    totalCount,
    sliceStart,
    sliceEnd,
    bounds,
    viewport,
    visibleSpan,
    innerW,
    priceH,
    split,
    mode,
    isCompact,
  ]);

  const hoverForecastPt =
    hoverIdx !== null && activeForecast && hoverIdx >= bars.length
      ? activeForecast[hoverIdx - bars.length] || null
      : null;
  const activeBar =
    hoverIdx !== null && hoverIdx < bars.length && bars[hoverIdx]
      ? bars[hoverIdx]
      : bars[bars.length - 1];
  const lastBar = bars[bars.length - 1];
  const activeTrades =
    !hoverForecastPt && activeBar ? tradeByTs.get(activeBar.timestamp) || [] : [];

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning || !totalCount) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    if (relX < 0 || relX > innerW) {
      setHoverIdx(null);
      return;
    }
    const rawIdx = viewport.start + (relX / Math.max(innerW, 1)) * visibleSpan;
    const idx = Math.max(0, Math.min(totalCount - 1, Math.round(rawIdx)));
    setHoverIdx(idx);
  };

  const candleWidth = Math.max(2, Math.min(12, (innerW / Math.max(visibleSpan, 1)) * 0.66));
  const strokePrimary = isDark ? '#E8EDF5' : '#162436';
  const gridStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(22,36,54,0.08)';
  const axisFill = isDark ? '#8B95A5' : '#4D6078';
  const splitFill = isDark ? 'rgba(217, 155, 56, 0.08)' : 'rgba(182, 131, 46, 0.08)';
  const splitStroke = isDark ? '#D99B38' : '#A66D19';
  const buyColor = isDark ? '#22C58B' : '#0E8554';
  const sellColor = isDark ? '#F0645C' : '#C73B33';

  const lastForecastPt = activeForecast ? activeForecast[activeForecast.length - 1] : null;
  const forecastUp = lastForecastPt ? lastForecastPt.expectedReturnPct >= 0 : true;
  const forecastStroke = forecastUp
    ? isDark
      ? '#34D399'
      : '#0E8554'
    : isDark
      ? '#F0645C'
      : '#C73B33';

  const hoverX = hoverIdx !== null ? xOf(hoverIdx) : 0;
  const tooltipAlignRight = hoverX > effectiveW * 0.56;

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      {/* Chart toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#162436]/[0.08] px-5 py-3.5 sm:px-6 dark:border-white/[0.07]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-xs">
          <span className="font-mono font-semibold text-[#162436] dark:text-[#ECEFF4]">{symbol}</span>
          {hoverForecastPt ? (
            <>
              <span className="font-mono text-[#4D6078] tabular-nums dark:text-[#8B95A5]">
                Forecast +{hoverForecastPt.step} ({hoverForecastPt.date})
              </span>
              <span className="font-mono font-semibold text-[#162436] tabular-nums dark:text-white">
                {formatPrice(hoverForecastPt.projectedPrice)} ({formatSignedPct(hoverForecastPt.expectedReturnPct)})
              </span>
            </>
          ) : (
            activeBar && (
              <>
                <span className="font-mono text-[#4D6078] tabular-nums dark:text-[#8B95A5]">
                  {activeBar.date}
                </span>
                <span className="hidden font-mono text-[#3E526A] tabular-nums md:inline dark:text-[#B8C2D1]">
                  O {formatPrice(activeBar.open)} · H {formatPrice(activeBar.high)} · L {formatPrice(activeBar.low)} ·{' '}
                  <strong className="font-semibold text-[#162436] dark:text-white">
                    C {formatPrice(activeBar.close)}
                  </strong>
                </span>
                <span className="font-mono font-semibold text-[#162436] tabular-nums md:hidden dark:text-white">
                  {formatPrice(activeBar.close)}
                </span>
              </>
            )
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex items-center rounded-lg border border-[#162436]/[0.08] bg-[#162436]/[0.045] p-0.5 text-xs dark:border-white/[0.08] dark:bg-white/[0.04]">
            {(['candles', 'line'] as const).map((style) => {
              const active = chartStyle === style;
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => setChartStyle(style)}
                  className={`relative z-10 rounded-md px-2.5 py-1 font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-[#162436] dark:text-white'
                      : 'text-[#4D6078] hover:text-[#162436] dark:text-[#8B95A5] dark:hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={`price-style-${uid}`}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 -z-10 rounded-md bg-white/90 shadow-xs dark:bg-white/[0.12]"
                    />
                  )}
                  {style}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowSma((s) => !s)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              showSma
                ? 'border-[#162436]/18 bg-white/75 text-[#162436] dark:border-white/20 dark:bg-white/[0.1] dark:text-white'
                : 'border-transparent text-[#4D6078] hover:text-[#162436] dark:text-[#8B95A5] dark:hover:text-white'
            }`}
          >
            Trend
          </button>

          {forecast && forecast.length > 0 && onToggleForecast && (
            <button
              type="button"
              onClick={onToggleForecast}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                showForecast
                  ? 'border-[#0E8554]/30 bg-[#0E8554]/12 text-[#0E8554] dark:border-[#22C58B]/35 dark:bg-[#22C58B]/12 dark:text-[#22C58B]'
                  : 'border-transparent text-[#4D6078] hover:text-[#162436] dark:text-[#8B95A5] dark:hover:text-white'
              }`}
            >
              Forecast
            </button>
          )}

          <div className="flex items-center rounded-lg border border-[#162436]/[0.08] bg-[#162436]/[0.04] p-0.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
            <button
              type="button"
              onClick={() => zoomBy(0.76, 0.85)}
              aria-label="Zoom in time axis"
              title="Zoom in"
              className="flex h-6 w-6 items-center justify-center rounded text-[#4D6078] transition-colors hover:bg-[#162436]/[0.06] hover:text-[#162436] dark:text-[#98A2B3] dark:hover:bg-white/[0.08] dark:hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => zoomBy(1.32, 0.85)}
              aria-label="Zoom out time axis"
              title="Zoom out"
              className="flex h-6 w-6 items-center justify-center rounded text-[#4D6078] transition-colors hover:bg-[#162436]/[0.06] hover:text-[#162436] dark:text-[#98A2B3] dark:hover:bg-white/[0.08] dark:hover:text-white"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            {isCustomView && (
              <button
                type="button"
                onClick={resetToAutoFit}
                aria-label="Reset chart to auto-fit"
                title="Reset auto-fit"
                className="flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[10px] font-medium text-[#162436] transition-colors hover:bg-[#162436]/[0.06] dark:text-white dark:hover:bg-white/[0.1]"
              >
                <Maximize2 className="h-3 w-3" />
                Auto
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main viewport */}
      <div ref={containerRef} className="relative w-full min-w-0 select-none overflow-hidden">
        <svg
          width="100%"
          height={chartHeight}
          viewBox={`0 0 ${effectiveW} ${chartHeight}`}
          className="block"
          role="img"
          aria-label={`${symbol} interactive price chart`}
        >
          <defs>
            <clipPath id={`plot-clip-${uid}`}>
              <rect x={pad.left} y={pad.top} width={innerW} height={priceH + volH + 14} />
            </clipPath>
            <linearGradient id={`price-area-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokePrimary} stopOpacity={isDark ? 0.14 : 0.08} />
              <stop offset="100%" stopColor={strokePrimary} stopOpacity={0} />
            </linearGradient>
          </defs>

          {yTicks.map((val, idx) => {
            const y = yOf(val);
            return (
              <g key={idx}>
                <line
                  x1={pad.left}
                  y1={y}
                  x2={pad.left + innerW}
                  y2={y}
                  stroke={gridStroke}
                  strokeWidth={1}
                />
                <text
                  x={pad.left + innerW + 8}
                  y={y + 3.5}
                  fill={isScalingY ? strokePrimary : axisFill}
                  fontSize={isCompact ? 9.5 : 10.5}
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {formatPrice(val)}
                </text>
              </g>
            );
          })}

          <line
            x1={pad.left + innerW}
            y1={pad.top}
            x2={pad.left + innerW}
            y2={pad.top + priceH + volH + 14}
            stroke={gridStroke}
            strokeWidth={1}
          />

          <g clipPath={`url(#plot-clip-${uid})`}>
            {/* Unseen test split */}
            {splitX !== null && (
              <g>
                <rect
                  x={Math.max(pad.left, splitX)}
                  y={pad.top}
                  width={Math.max(0, Math.min(pad.left + innerW, xOf(bars.length - 1)) - Math.max(pad.left, splitX))}
                  height={priceH + volH + 14}
                  fill={splitFill}
                />
                <line
                  x1={splitX}
                  y1={pad.top}
                  x2={splitX}
                  y2={pad.top + priceH + volH + 14}
                  stroke={splitStroke}
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                />
                {splitX > pad.left + 30 && splitX < pad.left + innerW - 70 && (
                  <text
                    x={splitX + 8}
                    y={pad.top + 13}
                    fill={splitStroke}
                    fontSize={9.5}
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight={500}
                  >
                    NEW DATA
                  </text>
                )}
              </g>
            )}

            {/* Support and resistance guides */}
            {supportLevel !== null && supportLevel !== undefined && (
              <line
                x1={pad.left}
                y1={yOf(supportLevel)}
                x2={pad.left + innerW}
                y2={yOf(supportLevel)}
                stroke={buyColor}
                strokeWidth={1}
                strokeDasharray="3 4"
                opacity={0.45}
              />
            )}
            {resistanceLevel !== null && resistanceLevel !== undefined && (
              <line
                x1={pad.left}
                y1={yOf(resistanceLevel)}
                x2={pad.left + innerW}
                y2={yOf(resistanceLevel)}
                stroke={sellColor}
                strokeWidth={1}
                strokeDasharray="3 4"
                opacity={0.45}
              />
            )}

            {/* Volume bars */}
            <g>
              {bars.slice(sliceStart, sliceEnd + 1).map((b, offset) => {
                const i = sliceStart + offset;
                const x = xOf(i);
                const h = (b.volume / bounds.maxV) * volH;
                const y = pad.top + priceH + 14 + (volH - h);
                const isUp = b.close >= b.open;
                return (
                  <rect
                    key={b.timestamp}
                    x={x - candleWidth / 2}
                    y={y}
                    width={Math.max(1.2, candleWidth)}
                    height={Math.max(0.8, h)}
                    rx={0.5}
                    fill={isUp ? buyColor : sellColor}
                    opacity={isDark ? 0.22 : 0.18}
                  />
                );
              })}
            </g>

            {/* Moving averages */}
            {showSma && sma30Path && (
              <path
                d={sma30Path}
                fill="none"
                stroke={isDark ? '#D99B38' : '#B67B24'}
                strokeWidth={1.2}
                opacity={0.8}
              />
            )}
            {showSma && sma10Path && (
              <path
                d={sma10Path}
                fill="none"
                stroke={isDark ? '#6895B8' : '#4E7391'}
                strokeWidth={1.2}
                opacity={0.85}
              />
            )}

            {/* Price series */}
            {chartStyle === 'line' ? (
              <g>
                {areaPath && <path d={areaPath} fill={`url(#price-area-${uid})`} />}
                <path
                  d={pricePath}
                  fill="none"
                  stroke={strokePrimary}
                  strokeWidth={1.9}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            ) : (
              <g>
                {bars.slice(sliceStart, sliceEnd + 1).map((b, offset) => {
                  const i = sliceStart + offset;
                  const x = xOf(i);
                  const yOpen = yOf(b.open);
                  const yClose = yOf(b.close);
                  const yHigh = yOf(b.high);
                  const yLow = yOf(b.low);
                  const isUp = b.close >= b.open;
                  const color = isUp ? buyColor : sellColor;
                  const top = Math.min(yOpen, yClose);
                  const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
                  return (
                    <g key={b.timestamp}>
                      <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth={1.1} />
                      <rect
                        x={x - candleWidth / 2}
                        y={top}
                        width={candleWidth}
                        height={bodyH}
                        rx={0.8}
                        fill={color}
                      />
                    </g>
                  );
                })}
              </g>
            )}

            {/* Forward forecast cone and projected path */}
            {activeForecast && forecastConePath && forecastLinePath && (
              <g>
                <line
                  x1={xOf(bars.length - 1)}
                  y1={pad.top}
                  x2={xOf(bars.length - 1)}
                  y2={pad.top + priceH + volH + 14}
                  stroke={forecastStroke}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  opacity={0.45}
                />
                <path d={forecastConePath} fill={forecastStroke} opacity={isDark ? 0.14 : 0.11} />
                <path
                  d={forecastLinePath}
                  fill="none"
                  stroke={forecastStroke}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {lastForecastPt && (
                  <circle
                    cx={xOf(totalCount - 1)}
                    cy={yOf(lastForecastPt.projectedPrice)}
                    r={3.8}
                    fill={forecastStroke}
                    stroke={isDark ? '#0E121A' : '#FFFFFF'}
                    strokeWidth={1.4}
                  />
                )}
              </g>
            )}

            {/* Trade markers */}
            <g>
              {bars.slice(sliceStart, sliceEnd + 1).map((b, offset) => {
                const barTrades = tradeByTs.get(b.timestamp);
                if (!barTrades || !barTrades.length) return null;
                const x = xOf(sliceStart + offset);
                return barTrades.map((t, tIdx) => {
                  const isBuy = t.side === 'BUY';
                  const y = isBuy ? yOf(b.low) + 12 + tIdx * 9 : yOf(b.high) - 12 - tIdx * 9;
                  const clampedY = Math.max(pad.top + 10, Math.min(pad.top + priceH - 8, y));
                  const fill = isBuy ? buyColor : sellColor;
                  return (
                    <g key={`${t.step}-${tIdx}`}>
                      <circle cx={x} cy={clampedY} r={8} fill={fill} opacity={0.18} />
                      {isBuy ? (
                        <polygon
                          points={`${x},${clampedY - 5.5} ${x - 4.8},${clampedY + 3.5} ${x + 4.8},${clampedY + 3.5}`}
                          fill={fill}
                          stroke={isDark ? '#0E121A' : '#FFFFFF'}
                          strokeWidth={1.1}
                        />
                      ) : (
                        <polygon
                          points={`${x},${clampedY + 5.5} ${x - 4.8},${clampedY - 3.5} ${x + 4.8},${clampedY - 3.5}`}
                          fill={fill}
                          stroke={isDark ? '#0E121A' : '#FFFFFF'}
                          strokeWidth={1.1}
                        />
                      )}
                    </g>
                  );
                });
              })}
            </g>

            {/* Hover crosshair */}
            {hoverIdx !== null && !isPanning && (hoverForecastPt || bars[hoverIdx]) && (
              <g pointerEvents="none">
                <line
                  x1={xOf(hoverIdx)}
                  y1={pad.top}
                  x2={xOf(hoverIdx)}
                  y2={pad.top + priceH + volH + 14}
                  stroke={hoverForecastPt ? forecastStroke : strokePrimary}
                  strokeWidth={0.9}
                  strokeDasharray="2 2"
                  opacity={0.5}
                />
                <circle
                  cx={xOf(hoverIdx)}
                  cy={yOf(hoverForecastPt ? hoverForecastPt.projectedPrice : bars[hoverIdx].close)}
                  r={3.5}
                  fill={hoverForecastPt ? forecastStroke : strokePrimary}
                  stroke={isDark ? '#0E121A' : '#FFFFFF'}
                  strokeWidth={1.5}
                />
              </g>
            )}
          </g>

          {/* Latest price marker */}
          {lastBar && yOf(lastBar.close) >= pad.top && yOf(lastBar.close) <= pad.top + priceH && (
            <g pointerEvents="none">
              <line
                x1={pad.left}
                y1={yOf(lastBar.close)}
                x2={pad.left + innerW}
                y2={yOf(lastBar.close)}
                stroke={strokePrimary}
                strokeWidth={0.75}
                strokeDasharray="2 3"
                opacity={0.28}
              />
              <rect
                x={pad.left + innerW + 3}
                y={yOf(lastBar.close) - 9}
                width={axisW - 5}
                height={18}
                rx={3}
                fill={isDark ? '#1F2735' : '#1A3350'}
              />
              <text
                x={pad.left + innerW + 7}
                y={yOf(lastBar.close) + 3.5}
                fill="#FFFFFF"
                fontSize={9.5}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight={500}
              >
                {formatPrice(lastBar.close)}
              </text>
            </g>
          )}

          {xTicks.map((t) => (
            <text
              key={t.idx}
              x={t.x}
              y={chartHeight - 9}
              textAnchor="middle"
              fill={axisFill}
              fontSize={isCompact ? 9.5 : 10.5}
              fontFamily="IBM Plex Mono, monospace"
            >
              {t.label}
            </text>
          ))}
        </svg>

        {/* Plot gesture hit layer */}
        <div
          ref={plotRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          style={{
            left: pad.left,
            top: pad.top,
            width: innerW,
            height: priceH + volH + 14,
            touchAction: 'pan-y',
          }}
          className={`absolute z-10 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        />

        {/* Right price axis drag layer */}
        <div
          ref={priceAxisRef}
          title="Drag vertically to scale price axis. Double-tap to reset."
          style={{
            right: 0,
            top: pad.top,
            width: axisW,
            height: priceH + volH + 14,
            touchAction: 'none',
          }}
          className={`absolute z-10 cursor-ns-resize transition-colors ${
            isScalingY
              ? 'bg-black/[0.04] dark:bg-white/[0.06]'
              : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
          }`}
        />

        {/* Hover tooltip */}
        <AnimatePresence>
          {hoverIdx !== null && !isPanning && (hoverForecastPt || activeBar) && (
            <motion.div
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              style={{
                left: tooltipAlignRight
                  ? undefined
                  : Math.min(effectiveW - 224, Math.max(12, hoverX + 14)),
                right: tooltipAlignRight
                  ? Math.max(axisW + 10, effectiveW - hoverX + 14)
                  : undefined,
              }}
              className="pointer-events-none absolute top-3 z-20 w-[212px] rounded-xl border border-white/80 bg-white/86 p-3 text-[11px] shadow-[0_12px_28px_-8px_rgba(22,36,54,0.18)] backdrop-blur-2xl dark:border-white/[0.11] dark:bg-[#111621]/92 dark:shadow-lg"
            >
              {hoverForecastPt ? (
                <div className="space-y-1.5 font-mono tabular-nums">
                  <div className="flex items-center justify-between text-[#4D6078] dark:text-[#8B95A5]">
                    <span>Forecast +{hoverForecastPt.step}</span>
                    <span>{hoverForecastPt.date}</span>
                  </div>
                  <div className="flex items-center justify-between text-[#162436] dark:text-white">
                    <span>Expected</span>
                    <span className="font-semibold">
                      {formatPrice(hoverForecastPt.projectedPrice)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#4D6078] dark:text-[#8B95A5]">Change</span>
                    <span
                      className={
                        hoverForecastPt.expectedReturnPct >= 0
                          ? 'text-[#0E8554] dark:text-[#22C58B]'
                          : 'text-[#C73B33] dark:text-[#F0645C]'
                      }
                    >
                      {formatSignedPct(hoverForecastPt.expectedReturnPct)}
                    </span>
                  </div>
                  <div className="border-t border-[#162436]/[0.08] pt-1.5 text-[10px] text-[#4D6078] dark:border-white/[0.08] dark:text-[#8B95A5]">
                    Range {formatPrice(hoverForecastPt.lowerBand)} – {formatPrice(hoverForecastPt.upperBand)}
                  </div>
                </div>
              ) : (
                activeBar && (
                  <>
                    <div className="flex items-center justify-between font-mono text-[#4D6078] dark:text-[#8B95A5]">
                      <span>{activeBar.date}</span>
                      <span>Vol {formatVolume(activeBar.volume)}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums text-[#162436] dark:text-[#ECEFF4]">
                      <span>O {formatPrice(activeBar.open)}</span>
                      <span>H {formatPrice(activeBar.high)}</span>
                      <span>L {formatPrice(activeBar.low)}</span>
                      <span className="font-semibold">C {formatPrice(activeBar.close)}</span>
                    </div>
                    {activeTrades.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-[#162436]/[0.08] pt-2 font-mono tabular-nums dark:border-white/[0.09]">
                        {activeTrades.map((t, idx) => (
                          <div key={idx} className="flex flex-col gap-0.5">
                            <div className="flex items-center justify-between">
                              <span
                                className={`font-semibold ${
                                  t.side === 'BUY'
                                    ? 'text-[#0E8554] dark:text-[#22C58B]'
                                    : 'text-[#C73B33] dark:text-[#F0645C]'
                                }`}
                              >
                                {t.side} ORDER
                              </span>
                              <span className="text-[#162436] dark:text-white">
                                {formatCurrency(t.fill_price, currency)}
                              </span>
                            </div>
                            {t.realized_pnl !== null && (
                              <div
                                className={`text-right ${
                                  t.realized_pnl >= 0
                                    ? 'text-[#0E8554] dark:text-[#22C58B]'
                                    : 'text-[#C73B33] dark:text-[#F0645C]'
                                }`}
                              >
                                Profit {formatCurrency(t.realized_pnl, currency)} ({formatSignedPct(t.return_pct)})
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer legend */}
      <div className="flex flex-col gap-2.5 border-t border-[#162436]/[0.08] bg-[#162436]/[0.025] px-5 py-3.5 text-xs text-[#4D6078] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6 dark:border-white/[0.07] dark:bg-white/[0.015] dark:text-[#8B95A5]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-0.5 w-3.5 rounded-full bg-[#162436] dark:bg-[#E8EDF5]" />
            <span>Price</span>
          </span>
          {showSma && (
            <>
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-0.5 w-3.5 rounded-full bg-[#4E7391] dark:bg-[#6895B8]" />
                <span>Avg 10</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-0.5 w-3.5 rounded-full bg-[#B67B24] dark:bg-[#D99B38]" />
                <span>Avg 30</span>
              </span>
            </>
          )}
          {activeForecast && (
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block w-4 border-t-2 border-dashed"
                style={{ borderColor: forecastStroke }}
              />
              <span>Forecast</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
              <polygon points="5,1 1,9 9,9" fill={buyColor} />
            </svg>
            <span className="tabular-nums">Buy ({trades.filter((t) => t.side === 'BUY').length})</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
              <polygon points="5,9 1,1 9,1" fill={sellColor} />
            </svg>
            <span className="tabular-nums">Sell ({trades.filter((t) => t.side === 'SELL').length})</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#5B6E86] dark:text-[#7E899B]">
          <span>Drag to pan · Pinch or scroll to zoom · Drag price axis to scale</span>
        </div>
      </div>
    </div>
  );
}
