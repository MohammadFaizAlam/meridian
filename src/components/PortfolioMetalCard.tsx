import { useEffect, useRef, useState } from 'react';
import { formatCurrency, formatSignedPct } from '../utils/format';

interface PortfolioMetalCardProps {
  balance: number;
  currency: string;
  returnPct: number | null;
  symbol: string;
  algorithm: string;
  runId: string | null;
  progressLabel: string;
  isTrained: boolean;
}

function formatCardSerial(runId: string | null): string {
  if (!runId) return '••••  ••••  ••••  LIVE';
  const cleaned = runId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const tail = (cleaned.slice(-4) || '0001').padStart(4, '0');
  return `••••  ••••  ••••  ${tail}`;
}

export function PortfolioMetalCard({
  balance,
  currency,
  returnPct,
  symbol,
  algorithm,
  runId,
  progressLabel,
  isTrained,
}: PortfolioMetalCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [allowTilt, setAllowTilt] = useState(false);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, gx: 42, gy: 32, active: false });

  // Enable subtle angled + 3D hover tilt strictly on desktop fine-pointer devices
  useEffect(() => {
    const mqDesktop = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)');
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setAllowTilt(mqDesktop.matches && !mqMotion.matches);
    sync();
    mqDesktop.addEventListener('change', sync);
    mqMotion.addEventListener('change', sync);
    return () => {
      mqDesktop.removeEventListener('change', sync);
      mqMotion.removeEventListener('change', sync);
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!allowTilt || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / Math.max(rect.width, 1);
    const py = (e.clientY - rect.top) / Math.max(rect.height, 1);
    const ry = (px - 0.5) * 9;
    const rx = (0.5 - py) * 7.5;
    setTilt({
      rx,
      ry,
      gx: Math.round(px * 100),
      gy: Math.round(py * 100),
      active: true,
    });
  };

  const handleMouseLeave = () => {
    if (!allowTilt) return;
    setTilt({ rx: 0, ry: 0, gx: 42, gy: 32, active: false });
  };

  const isPositive = returnPct !== null ? returnPct >= 0 : true;

  // Static diagonal peek tilt on phone & tablet (no 3D hover tilt);
  // subtle peeking angle + smooth 3D hover tilt on desktop fine pointers.
  const transformStyle = allowTilt
    ? tilt.active
      ? `perspective(1000px) rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg) rotateZ(-5deg) translate(-4px, -2px)`
      : 'perspective(1000px) rotateX(2deg) rotateY(-5deg) rotateZ(-8deg)'
    : 'rotate(-8deg)';

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      aria-label="Portfolio summary metal card"
      style={{
        transform: transformStyle,
        transition: tilt.active
          ? 'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)'
          : 'transform 460ms cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: allowTilt ? 'transform' : undefined,
      }}
      className="relative aspect-[1.586/1] w-[216px] sm:w-[228px] lg:w-[244px] select-none overflow-hidden rounded-[14px] border border-white/80 bg-gradient-to-br from-[#F4F7FB] via-[#DCE5F1] to-[#C8D6E8] p-3.5 text-[#162436] shadow-[0_16px_32px_-8px_rgba(22,36,54,0.28),0_4px_10px_-2px_rgba(22,36,54,0.12),inset_0_1px_0_0_rgba(255,255,255,0.95)] dark:border-white/[0.18] dark:bg-gradient-to-br dark:from-[#20293B] dark:via-[#0F1522] dark:to-[#192233] dark:text-[#F4F7FB] dark:shadow-[0_20px_40px_-8px_rgba(0,0,0,0.85),0_4px_14px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.22)]"
    >
      {/* Brushed horizontal titanium grain */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.06] dark:opacity-[0.095]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(180deg, transparent 0px, transparent 2px, currentColor 2px, currentColor 3px)',
        }}
      />

      {/* Specular sheen across the metal surface */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: allowTilt && tilt.active ? 1 : 0.5,
          background: `radial-gradient(circle at ${tilt.gx}% ${tilt.gy}%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.07) 34%, transparent 68%)`,
        }}
      />

      {/* Subtle directional accent glow */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -right-8 -bottom-8 h-24 w-24 rounded-full blur-2xl ${
          !isTrained
            ? 'bg-[#6488B4]/18 dark:bg-[#8BA8CE]/14'
            : isPositive
              ? 'bg-[#0E8554]/22 dark:bg-[#22C58B]/18'
              : 'bg-[#C73B33]/20 dark:bg-[#F0645C]/18'
        }`}
      />

      {/* Keep all card copy inside the visible left-to-center zone so right-edge peek never clips text */}
      <div className="relative z-10 flex h-full flex-col justify-between pr-9">
        {/* Card header: brand mark + strategy + contactless wave */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-display text-[11px] font-semibold tracking-[0.08em] uppercase text-[#162436] dark:text-[#F4F7FB]">
              Meridian
            </span>
            <span className="font-mono text-[9px] tracking-wider text-[#4D6078] dark:text-[#92A2B8]">
              {algorithm}
            </span>
          </div>

          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className="shrink-0 text-[#4D6078]/70 dark:text-[#A9B7CA]/60"
          >
            <path d="M7.5 13.5a4.8 4.8 0 0 0 0-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M10.5 15.8a8.1 8.1 0 0 0 0-11.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M13.5 18a11.4 11.4 0 0 0 0-16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>

        {/* Middle row: brushed metallic EMV chip + ticker & return */}
        <div className="flex items-center gap-2.5">
          <div
            aria-hidden="true"
            className="relative h-5.5 w-7.5 shrink-0 overflow-hidden rounded-[5px] border border-[#9E8B63]/45 bg-gradient-to-br from-[#EFE3C4] via-[#CBB687] to-[#A69060] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-[#D5C39C]/35 dark:from-[#E5D7B7] dark:via-[#B8A47A] dark:to-[#8B7852]"
          >
            <svg viewBox="0 0 36 28" className="h-full w-full opacity-55" fill="none">
              <path d="M0 9.5H12M0 18.5H12M24 9.5H36M24 18.5H36M12 0V28M24 0V28M12 14H24" stroke="#4F4023" strokeWidth="1.1" />
            </svg>
          </div>

          <div className="min-w-0 font-mono tabular-nums">
            <div className="truncate text-[10px] font-semibold tracking-wide text-[#162436] dark:text-[#ECEFF4]">
              {symbol}
              <span className="ml-1.5 text-[8.5px] font-normal text-[#546880] dark:text-[#8697AE]">
                {progressLabel}
              </span>
            </div>
            <div
              className={`text-[10px] font-semibold ${
                returnPct === null
                  ? 'text-[#5B6E86] dark:text-[#8E9DB2]'
                  : returnPct >= 0
                    ? 'text-[#0E8554] dark:text-[#22C58B]'
                    : 'text-[#C73B33] dark:text-[#F0645C]'
              }`}
            >
              {returnPct !== null ? formatSignedPct(returnPct) : 'READY'}
            </div>
          </div>
        </div>

        {/* Lower block: engraved live balance and serial */}
        <div>
          <div className="text-[8px] font-medium tracking-[0.08em] uppercase text-[#546880] dark:text-[#8898AE]">
            {isTrained ? 'Portfolio Value' : 'Starting Cash'}
          </div>
          <div className="mt-0.5 font-mono text-[15.5px] font-semibold leading-tight tracking-tight text-[#162436] tabular-nums sm:text-[16.5px] dark:text-white">
            {formatCurrency(balance, currency)}
          </div>

          <div className="mt-1 font-mono text-[8px] tracking-[0.11em] text-[#546880] tabular-nums dark:text-[#7E8FA5]">
            {formatCardSerial(runId)}
          </div>
        </div>
      </div>
    </div>
  );
}
