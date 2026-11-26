import { useEffect, useRef } from 'react';

interface SilkCanvasProps {
  theme: 'dark' | 'light';
  className?: string;
  intensity?: 'ambient' | 'empty-stage';
}

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/**
 * Flowing liquid-silk ribbon shader inspired by faiz-sakinah.vercel.app:
 * - Two-stage rotated FBM domain warp with finite-difference specular slope glint
 * - Three counter-flowing Gaussian-crested satin ribbons + film-grain anti-banding dither
 * - Theme-calibrated dual palette:
 *     Dark Mode: Deep Obsidian Slate (#0A0D14) -> Brushed Graphite Fold -> Cool Platinum-Silver Crest
 *     Light Mode: Luminous Alabaster (#F5F6F3) -> Whisper Pearl Fold -> Soft Porcelain-White Crest
 *       (strictly low-contrast luminous tones so light theme stays calm, airy, and never blotchy)
 */
const FRAG_SRC = `
precision highp float;
varying vec2 v_uv;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_dark;       // 0.0 = light mode, 1.0 = dark mode (smoothly interpolated)
uniform float u_presence;   // overall ribbon visibility weight

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    val += amp * noise(p);
    p = rot * p * 2.02 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return val;
}

vec2 silkWarp(vec2 p, float t) {
  vec2 q = vec2(
    fbm(p * 0.82 + vec2(t * 0.24, -t * 0.17)),
    fbm(p * 0.82 + vec2(-t * 0.19, t * 0.22) + vec2(4.7, 1.9))
  );
  vec2 r = vec2(
    fbm(p * 1.02 + 1.42 * q + vec2(1.7 + t * 0.15, 8.4 - t * 0.13)),
    fbm(p * 1.02 + 1.42 * q + vec2(7.6 - t * 0.14, 2.3 + t * 0.16))
  );
  return r;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // Subtle pointer drift
  vec2 ptr = (u_pointer - 0.5) * 0.075;
  p += ptr;

  float t = u_time * 0.32;

  // Two-stage fluid silk warp + directional slope glint
  vec2 r = silkWarp(p, t);
  vec2 rDx = silkWarp(p + vec2(0.035, 0.0), t);
  float slopeGlint = clamp(0.58 + (r.x - rDx.x) * 8.0 + (r.y - rDx.y) * 4.5, 0.25, 1.45);

  // Primary sweeping liquid-silk ribbon
  float flow1 = (p.x * 1.02 - p.y * 1.44) + r.x * 2.65 + r.y * 1.10 - t * 0.52;
  float s1 = sin(flow1);
  float band1 = exp(-s1 * s1 * 5.2);
  float crest1 = exp(-s1 * s1 * 26.0);

  // Secondary counter-flowing satin fold
  float flow2 = (p.x * 0.78 + p.y * 1.58) - r.y * 2.45 + r.x * 1.18 + t * 0.42 + 1.35;
  float s2 = sin(flow2);
  float band2 = exp(-s2 * s2 * 6.8);
  float crest2 = exp(-s2 * s2 * 32.0);

  // Delicate shimmer thread drifting inside the folds
  float flow3 = (p.x * 1.32 - p.y * 0.68) + (r.x - r.y) * 2.15 - t * 0.30;
  float s3 = cos(flow3);
  float band3 = exp(-s3 * s3 * 9.5) * 0.52;

  float ribbonBody = (band1 * 0.58 + band2 * 0.44 + band3 * 0.30) * u_presence;
  float liquidCrest = (crest1 * 0.74 + crest2 * 0.52) * slopeGlint * u_presence;

  // Dark theme: deep obsidian base, midnight-slate folds, satin silver ribbons, platinum crests
  vec3 dBase  = vec3(0.028, 0.038, 0.058); // #070A0F
  vec3 dFold  = vec3(0.095, 0.132, 0.195); // Midnight steel fold
  vec3 dSilk  = vec3(0.365, 0.445, 0.560); // Brushed cool silver-slate
  vec3 dCrest = vec3(0.790, 0.855, 0.940); // Luminous platinum highlight

  vec3 darkCol = dBase;
  darkCol = mix(darkCol, dFold, smoothstep(0.04, 0.58, ribbonBody) * 0.94);
  darkCol = mix(darkCol, dSilk, smoothstep(0.16, 0.96, ribbonBody * 0.92) * 0.64);
  darkCol = mix(darkCol, dCrest, clamp(liquidCrest, 0.0, 1.0) * 0.46);

  // Grounding dark vignette
  float vigD = 1.0 - smoothstep(0.50, 1.44, length((uv - 0.5) * vec2(1.05, 1.0)));
  darkCol = mix(dBase * 0.82, darkCol, 0.56 + 0.44 * vigD);

  // Light theme: coastal mist base, mineral slate folds, satin steel ribbons, porcelain crests
  vec3 lBase  = vec3(0.845, 0.888, 0.935);
  vec3 lFold  = vec3(0.675, 0.768, 0.870);
  vec3 lSilk  = vec3(0.470, 0.612, 0.768);
  vec3 lPearl = vec3(0.755, 0.740, 0.860);
  vec3 lCrest = vec3(0.992, 0.996, 1.000);

  vec3 lightCol = lBase;
  lightCol = mix(lightCol, lFold, smoothstep(0.05, 0.62, ribbonBody) * 0.88);
  lightCol = mix(lightCol, lSilk, smoothstep(0.18, 0.95, ribbonBody * 0.92) * 0.68);
  lightCol = mix(lightCol, lPearl, smoothstep(0.22, 0.85, band2 * u_presence) * 0.34);
  lightCol = mix(lightCol, lCrest, clamp(liquidCrest, 0.0, 1.0) * 0.82);

  // Soft outer mist vignette keeps edges airy
  float vigL = 1.0 - smoothstep(0.55, 1.48, length((uv - 0.5) * vec2(1.05, 1.0)));
  lightCol = mix(lBase * 0.96, lightCol, 0.72 + 0.28 * vigL);

  vec3 color = mix(lightCol, darkCol, u_dark);

  // Fine film-grain dither prevents banding
  float grain = (hash12(gl_FragCoord.xy + fract(u_time * 0.5) * 37.0) - 0.5) * mix(0.008, 0.012, u_dark);
  color += grain;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export function SilkCanvas({ theme, className = '', intensity = 'ambient' }: SilkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeTargetRef = useRef<number>(theme === 'dark' ? 1.0 : 0.0);
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    themeTargetRef.current = theme === 'dark' ? 1.0 : 0.0;
    redrawRef.current?.();
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: true,
    });
    if (!gl) return;

    const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = dbgInfo ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) || '') : '';
    const isSoftwareGl = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererStr);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const compile = (type: number, source: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const locPos = gl.getAttribLocation(prog, 'a_pos');
    const locTime = gl.getUniformLocation(prog, 'u_time');
    const locRes = gl.getUniformLocation(prog, 'u_resolution');
    const locPtr = gl.getUniformLocation(prog, 'u_pointer');
    const locDark = gl.getUniformLocation(prog, 'u_dark');
    const locPresence = gl.getUniformLocation(prog, 'u_presence');

    gl.useProgram(prog);
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

    const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    const onPointerMove = (e: PointerEvent) => {
      pointer.tx = e.clientX / Math.max(window.innerWidth, 1);
      pointer.ty = 1.0 - e.clientY / Math.max(window.innerHeight, 1);
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const presenceVal = intensity === 'empty-stage' ? 1.0 : 0.92;
    let currentDark = themeTargetRef.current;
    const start = performance.now();
    let rafId = 0;
    let alive = true;

    const drawFrame = (now: number, snapTheme = false) => {
      if (!alive) return;
      pointer.x += (pointer.tx - pointer.x) * 0.045;
      pointer.y += (pointer.ty - pointer.y) * 0.045;
      if (snapTheme) {
        currentDark = themeTargetRef.current;
      } else {
        currentDark += (themeTargetRef.current - currentDark) * 0.12;
        if (Math.abs(themeTargetRef.current - currentDark) < 0.002) {
          currentDark = themeTargetRef.current;
        }
      }

      const elapsed = (now - start) / 1000.0;
      gl.uniform1f(locTime, elapsed);
      gl.uniform2f(locRes, canvas.width, canvas.height);
      gl.uniform2f(locPtr, pointer.x, pointer.y);
      gl.uniform1f(locDark, currentDark);
      gl.uniform1f(locPresence, presenceVal);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = isSoftwareGl ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.35);
      const w = Math.max(2, Math.floor(rect.width * dpr));
      const h = Math.max(2, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        // Redraw right away since resizing wipes the drawing buffer
        drawFrame(performance.now(), isSoftwareGl || reducedMotion);
      }
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Draw initial frame right away
    drawFrame(performance.now(), true);

    redrawRef.current = () => {
      if (isSoftwareGl || reducedMotion) {
        drawFrame(performance.now(), true);
      }
    };

    if (!reducedMotion && !isSoftwareGl) {
      let lastDraw = 0;
      const loop = (now: number) => {
        if (!alive) return;
        if (!document.hidden && now - lastDraw >= 22) {
          drawFrame(now, false);
          lastDraw = now;
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      alive = false;
      redrawRef.current = null;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      gl.deleteBuffer(buf);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(prog);
    };
  }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="silk-webgl-canvas"
      aria-hidden="true"
      className={`pointer-events-none block h-full w-full transition-colors duration-300 ${
        theme === 'dark' ? 'bg-[#070A10]' : 'bg-[#D7E2EE]'
      } ${className}`}
    />
  );
}
