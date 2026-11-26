import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampViewport,
  computeDefaultViewport,
  panViewport,
  zoomViewport,
  type TimeViewport,
} from '../utils/chartViewport';

interface UseChartViewportOptions {
  totalCount: number;
  resetKey: string;
  innerWidth: number;
  targetPxPerBar?: number;
  minVisible?: number;
}

export function useChartViewport({
  totalCount,
  resetKey,
  innerWidth,
  targetPxPerBar = 10,
  minVisible = 16,
}: UseChartViewportOptions) {
  const [viewport, setViewport] = useState<TimeViewport>(() =>
    computeDefaultViewport(totalCount, innerWidth || 400, targetPxPerBar, minVisible),
  );
  const [yScale, setYScale] = useState<number>(1.0);
  const [isPanning, setIsPanning] = useState(false);
  const [isScalingY, setIsScalingY] = useState(false);

  const vpRef = useRef(viewport);
  vpRef.current = viewport;

  const yScaleRef = useRef(yScale);
  yScaleRef.current = yScale;

  const innerWidthRef = useRef(innerWidth);
  innerWidthRef.current = Math.max(80, innerWidth);

  const totalRef = useRef(totalCount);
  totalRef.current = totalCount;

  const lastResetKeyRef = useRef(resetKey);
  const userInteractedRef = useRef(false);
  const momentumRafRef = useRef<number>(0);

  const constraints = () => ({
    totalCount: totalRef.current,
    minVisible,
    maxVisible: Math.max(minVisible, totalRef.current),
  });

  const stopMomentum = useCallback(() => {
    if (momentumRafRef.current) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = 0;
    }
  }, []);

  const resetToAutoFit = useCallback(() => {
    stopMomentum();
    userInteractedRef.current = false;
    setYScale(1.0);
    setViewport(
      computeDefaultViewport(totalRef.current, innerWidthRef.current, targetPxPerBar, minVisible),
    );
  }, [minVisible, stopMomentum, targetPxPerBar]);

  // Reset viewport when dataset identity changes (e.g., new ticker or timeframe)
  useEffect(() => {
    if (lastResetKeyRef.current !== resetKey) {
      lastResetKeyRef.current = resetKey;
      userInteractedRef.current = false;
      stopMomentum();
      setYScale(1.0);
      setViewport(
        computeDefaultViewport(totalCount, innerWidth || 400, targetPxPerBar, minVisible),
      );
      return;
    }

    // If new live bars/episodes arrive while user hasn't manually panned away, follow the right edge
    if (!userInteractedRef.current && totalCount > 0) {
      setViewport(computeDefaultViewport(totalCount, innerWidth || 400, targetPxPerBar, minVisible));
    } else if (totalCount > 0) {
      setViewport((prev) =>
        clampViewport(prev, {
          totalCount,
          minVisible,
          maxVisible: Math.max(minVisible, totalCount),
        }),
      );
    }
  }, [totalCount, resetKey, innerWidth, targetPxPerBar, minVisible, stopMomentum]);

  useEffect(() => stopMomentum, [stopMomentum]);

  const zoomBy = useCallback(
    (scaleFactor: number, anchorRatio = 0.5) => {
      stopMomentum();
      userInteractedRef.current = true;
      setViewport((prev) => zoomViewport(prev, scaleFactor, anchorRatio, constraints()));
    },
    [stopMomentum],
  );

  const startMomentum = useCallback((initialVelocityBarsPerMs: number) => {
    stopMomentum();
    let vel = initialVelocityBarsPerMs;
    let lastTs = performance.now();

    const step = (now: number) => {
      const dt = Math.min(34, Math.max(4, now - lastTs));
      lastTs = now;
      vel *= Math.pow(0.92, dt / 16.67);
      if (Math.abs(vel) < 0.0025) {
        momentumRafRef.current = 0;
        return;
      }
      setViewport((prev) => {
        const next = panViewport(prev, vel * dt, constraints());
        if (Math.abs(next.start - prev.start) < 1e-5) {
          vel = 0;
        }
        return next;
      });
      if (Math.abs(vel) >= 0.0025) {
        momentumRafRef.current = requestAnimationFrame(step);
      } else {
        momentumRafRef.current = 0;
      }
    };
    momentumRafRef.current = requestAnimationFrame(step);
  }, [stopMomentum]);

  // Attach native wheel & touch listeners to a plot element so gesture prevention is non-passive only when needed
  const plotRef = useRef<HTMLDivElement | null>(null);
  const priceAxisRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const plotEl = plotRef.current;
    if (!plotEl) return;

    // Mouse drag state
    let mouseDown = false;
    let mouseLastX = 0;
    let mouseLastTime = 0;
    let mouseVel = 0;

    // Touch gesture state (disambiguates horizontal pan vs vertical page scroll vs 2-finger pinch)
    let touchMode: 'none' | 'pending' | 'pan' | 'scroll' | 'pinch' = 'none';
    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastX = 0;
    let touchLastTime = 0;
    let touchVel = 0;
    let lastTapTime = 0;

    let pinchStartDist = 0;
    let pinchStartVp: TimeViewport = vpRef.current;
    let pinchAnchor = 0.5;

    const onWheel = (e: WheelEvent) => {
      if (totalRef.current <= 1) return;
      const rect = plotEl.getBoundingClientRect();
      const anchor = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(innerWidthRef.current, 1)));

      // Horizontal trackpad scroll -> pan time
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
        e.preventDefault();
        stopMomentum();
        userInteractedRef.current = true;
        const span = Math.max(1, vpRef.current.end - vpRef.current.start);
        const deltaBars = (e.deltaX / Math.max(innerWidthRef.current, 1)) * span;
        setViewport((prev) => panViewport(prev, deltaBars, constraints()));
        return;
      }

      // Mouse wheel / trackpad pinch zooms time axis cleanly
      e.preventDefault();
      stopMomentum();
      userInteractedRef.current = true;
      const factor = e.deltaY > 0 ? 1.13 : 0.885;
      setViewport((prev) => zoomViewport(prev, factor, anchor, constraints()));
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || totalRef.current <= 1) return;
      stopMomentum();
      mouseDown = true;
      mouseLastX = e.clientX;
      mouseLastTime = performance.now();
      mouseVel = 0;
      setIsPanning(true);
    };

    const onWindowMouseMove = (e: MouseEvent) => {
      if (!mouseDown) return;
      const dx = e.clientX - mouseLastX;
      const now = performance.now();
      const dt = Math.max(1, now - mouseLastTime);
      mouseLastX = e.clientX;
      mouseLastTime = now;

      userInteractedRef.current = true;
      const span = Math.max(1, vpRef.current.end - vpRef.current.start);
      const deltaBars = (-dx / Math.max(innerWidthRef.current, 1)) * span;
      mouseVel = mouseVel * 0.45 + (deltaBars / dt) * 0.55;
      setViewport((prev) => panViewport(prev, deltaBars, constraints()));
    };

    const onWindowMouseUp = () => {
      if (!mouseDown) return;
      mouseDown = false;
      setIsPanning(false);
      if (Math.abs(mouseVel) > 0.008) {
        startMomentum(mouseVel);
      }
    };

    const onDblClick = () => {
      resetToAutoFit();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (totalRef.current <= 1) return;
      stopMomentum();

      if (e.touches.length === 2) {
        touchMode = 'pinch';
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        pinchStartVp = vpRef.current;
        const rect = plotEl.getBoundingClientRect();
        const midX = (t0.clientX + t1.clientX) / 2;
        pinchAnchor = Math.max(0, Math.min(1, (midX - rect.left) / Math.max(innerWidthRef.current, 1)));
        userInteractedRef.current = true;
        return;
      }

      if (e.touches.length === 1) {
        const now = performance.now();
        if (now - lastTapTime < 280) {
          lastTapTime = 0;
          resetToAutoFit();
          touchMode = 'none';
          return;
        }
        lastTapTime = now;

        const t = e.touches[0];
        touchMode = 'pending';
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchLastX = t.clientX;
        touchLastTime = now;
        touchVel = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchMode === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        if (pinchStartDist > 12 && dist > 12) {
          const factor = pinchStartDist / dist;
          setViewport(zoomViewport(pinchStartVp, factor, pinchAnchor, constraints()));
        }
        return;
      }

      if (e.touches.length !== 1) return;
      const t = e.touches[0];

      if (touchMode === 'pending') {
        const dxTotal = Math.abs(t.clientX - touchStartX);
        const dyTotal = Math.abs(t.clientY - touchStartY);
        if (dxTotal < 6 && dyTotal < 6) return;
        // Strict gesture disambiguation: vertical wins -> native page scroll; horizontal wins -> chart pan
        if (dyTotal > dxTotal * 1.15) {
          touchMode = 'scroll';
          return;
        }
        touchMode = 'pan';
        setIsPanning(true);
      }

      if (touchMode === 'pan') {
        e.preventDefault();
        const dx = t.clientX - touchLastX;
        const now = performance.now();
        const dt = Math.max(1, now - touchLastTime);
        touchLastX = t.clientX;
        touchLastTime = now;

        userInteractedRef.current = true;
        const span = Math.max(1, vpRef.current.end - vpRef.current.start);
        const deltaBars = (-dx / Math.max(innerWidthRef.current, 1)) * span;
        touchVel = touchVel * 0.4 + (deltaBars / dt) * 0.6;
        setViewport((prev) => panViewport(prev, deltaBars, constraints()));
      }
    };

    const onTouchEnd = () => {
      if (touchMode === 'pan') {
        setIsPanning(false);
        if (Math.abs(touchVel) > 0.008) {
          startMomentum(touchVel);
        }
      }
      touchMode = 'none';
    };

    plotEl.addEventListener('wheel', onWheel, { passive: false });
    plotEl.addEventListener('mousedown', onMouseDown);
    plotEl.addEventListener('dblclick', onDblClick);
    plotEl.addEventListener('touchstart', onTouchStart, { passive: true });
    plotEl.addEventListener('touchmove', onTouchMove, { passive: false });
    plotEl.addEventListener('touchend', onTouchEnd, { passive: true });
    plotEl.addEventListener('touchcancel', onTouchEnd, { passive: true });
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    return () => {
      plotEl.removeEventListener('wheel', onWheel);
      plotEl.removeEventListener('mousedown', onMouseDown);
      plotEl.removeEventListener('dblclick', onDblClick);
      plotEl.removeEventListener('touchstart', onTouchStart);
      plotEl.removeEventListener('touchmove', onTouchMove);
      plotEl.removeEventListener('touchend', onTouchEnd);
      plotEl.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [resetToAutoFit, startMomentum, stopMomentum]);

  // Price-axis vertical drag to stretch / compress scale + double-tap/double-click reset
  useEffect(() => {
    const axisEl = priceAxisRef.current;
    if (!axisEl) return;

    let active = false;
    let startY = 0;
    let startScale = 1.0;
    let lastTap = 0;

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - lastTap < 280) {
        lastTap = 0;
        setYScale(1.0);
        return;
      }
      lastTap = now;
      active = true;
      startY = e.clientY;
      startScale = yScaleRef.current;
      setIsScalingY(true);
      axisEl.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      // Dragging UP stretches price (smaller scale); dragging DOWN compresses price (larger scale)
      const factor = Math.exp(dy * 0.0085);
      setYScale(Math.max(0.25, Math.min(5.0, startScale * factor)));
    };

    const onPointerUp = () => {
      if (!active) return;
      active = false;
      setIsScalingY(false);
    };

    const onDblClick = (e: MouseEvent) => {
      e.stopPropagation();
      setYScale(1.0);
    };

    axisEl.addEventListener('pointerdown', onPointerDown);
    axisEl.addEventListener('pointermove', onPointerMove);
    axisEl.addEventListener('pointerup', onPointerUp);
    axisEl.addEventListener('pointercancel', onPointerUp);
    axisEl.addEventListener('dblclick', onDblClick);

    return () => {
      axisEl.removeEventListener('pointerdown', onPointerDown);
      axisEl.removeEventListener('pointermove', onPointerMove);
      axisEl.removeEventListener('pointerup', onPointerUp);
      axisEl.removeEventListener('pointercancel', onPointerUp);
      axisEl.removeEventListener('dblclick', onDblClick);
    };
  }, []);

  const isCustomView =
    Math.abs(yScale - 1.0) > 0.02 ||
    (totalCount > 1 && viewport.end < totalCount - 1.5);

  return {
    viewport,
    yScale,
    isPanning,
    isScalingY,
    isCustomView,
    plotRef,
    priceAxisRef,
    zoomBy,
    resetToAutoFit,
  };
}
