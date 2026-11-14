import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback
} from 'react';
import {
  LiquidGlass,
  OPTICAL_DEFAULTS,
  scheduleStageRedraw,
  setUseWebGL,
  isWebGLActive
} from '@shulya/liquid-glass/react';

/**
 * «Золотое сечение» DPR на старте (computeOptimalDpr):
 * 1. Обычные экраны (DPR <= 1.5): рендерятся 1:1 в нативном DPR.
 * 2. Десктопы и Retina Mac (DPR 2.0): мощные GPU десктопа легко тянут полное разрешение — рендерятся в нативном 2.0+.
 * 3. Смартфоны со сверхплотными экранами (iPhone 12–17 с DPR 3.0, Android 2.6–3.5):
 *    - Проверяется количество ядер процессора (navigator.hardwareConcurrency).
 *    - iPhone 12 (чип A14, 6 ядер) и аналоги: золотая середина DPR = 2.0 (307 PPI, на 56% меньше вычислений).
 *    - Флагманы с 8+ ядрами стартуют с 2.5.
 */
export function computeOptimalDpr() {
  if (typeof window === 'undefined') return 1;

  const nativeDpr = window.devicePixelRatio || 1;

  // Обычные экраны (DPR <= 1.5): рендерятся 1:1 в нативном DPR
  if (nativeDpr <= 1.5) {
    return nativeDpr;
  }

  // Определение мобильного устройства / смартфона
  const isMobile =
    typeof navigator !== 'undefined' &&
    (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (typeof window !== 'undefined' &&
        window.matchMedia &&
        (window.matchMedia('(pointer: coarse)').matches ||
          window.matchMedia('(max-width: 820px)').matches)));

  // Десктопы и Retina Mac: мощные GPU десктопа легко тянут нативное разрешение
  if (!isMobile) {
    return nativeDpr;
  }

  // Смартфоны со сверхплотными экранами (DPR > 2.0)
  if (nativeDpr > 2.0) {
    const cores =
      typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : 6;

    // Флагманы с 8+ ядрами стартуют с 2.5
    if (cores >= 8) {
      return Math.min(nativeDpr, 2.5);
    }

    // iPhone 12 (чип A14, 6 ядер) и аналоги: золотая середина DPR = 2.0 (-56% вычислений)
    return 2.0;
  }

  return nativeDpr;
}

/**
 * High-DPI optical test stage:
 * - Architectural grid (80px step)
 * - Green pill switch track (250x108, r: 54, green gradient #30d158 -> #248a3d, soft green glow)
 * - Rainbow gradient ribbon (380x90, r: 45)
 * - Electric blue capsule (320x64, r: 32)
 * - Sunset orange sphere (r: 52, warm radial gradient)
 * - High-contrast black/white stripes (240x48, r: 24, 24px grating)
 * - Bold center typography "Shulya" (800 weight with subtle drop shadow)
 */
function drawStageBackground(canvas, dpr = computeOptimalDpr()) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || window.innerWidth));
  const h = Math.max(1, Math.round(rect.height || window.innerHeight));

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.scale(dpr, dpr);

  // 1. Clean Light Gray Backdrop (#ebedf2) + Architectural Grid
  ctx.fillStyle = '#ebedf2';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.035)';
  ctx.lineWidth = 1;
  const step = 80;
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y <= h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // 2. Green Pill Switch Track (Top-Left)
  const gx = w * 0.12;
  const gy = h * 0.20;
  const gw = 250;
  const gh = 108;
  const gr = gh * 0.5;

  ctx.save();
  ctx.shadowColor = 'rgba(48, 209, 88, 0.28)';
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 16;
  const greenGrad = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
  greenGrad.addColorStop(0, '#30d158');
  greenGrad.addColorStop(1, '#248a3d');
  ctx.fillStyle = greenGrad;
  ctx.beginPath();
  ctx.roundRect(gx, gy, gw, gh, gr);
  ctx.fill();
  ctx.restore();

  // 3. Rainbow Gradient Ribbon (Top-Right)
  const rx = w * 0.54;
  const ry = h * 0.22;
  const rw = Math.min(w * 0.38, 380);
  const rh = 90;
  const rr = rh * 0.5;

  ctx.save();
  ctx.shadowColor = 'rgba(255, 45, 85, 0.25)';
  ctx.shadowBlur = 38;
  ctx.shadowOffsetY = 16;
  const ribbonGrad = ctx.createLinearGradient(rx, ry, rx + rw, ry);
  ribbonGrad.addColorStop(0.00, '#007aff');
  ribbonGrad.addColorStop(0.35, '#af52de');
  ribbonGrad.addColorStop(0.68, '#ff2d55');
  ribbonGrad.addColorStop(0.88, '#ff9500');
  ribbonGrad.addColorStop(1.00, '#ffd60a');
  ctx.fillStyle = ribbonGrad;
  ctx.beginPath();
  ctx.roundRect(rx, ry, rw, rh, rr);
  ctx.fill();
  ctx.restore();

  // 4. Electric Blue Capsule (Bottom-Left)
  const bx = w * 0.10;
  const by = h * 0.76;
  const bw = Math.min(w * 0.32, 320);
  const bh = 64;
  const br = bh * 0.5;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 114, 255, 0.22)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  const blueGrad = ctx.createLinearGradient(bx, by, bx + bw, by);
  blueGrad.addColorStop(0, '#00c6ff');
  blueGrad.addColorStop(1, '#0072ff');
  ctx.fillStyle = blueGrad;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, br);
  ctx.fill();
  ctx.restore();

  // 5. Sunset Orange Sphere (Bottom-Right)
  const sx = w * 0.85;
  const sy = h * 0.68;
  const sr = 52;

  ctx.save();
  ctx.shadowColor = 'rgba(255, 149, 0, 0.35)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 14;
  const orangeGrad = ctx.createRadialGradient(sx - sr * 0.3, sy - sr * 0.3, sr * 0.1, sx, sy, sr);
  orangeGrad.addColorStop(0, '#ffd60a');
  orangeGrad.addColorStop(0.6, '#ff9500');
  orangeGrad.addColorStop(1, '#e05300');
  ctx.fillStyle = orangeGrad;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 6. High-Contrast Stripes (Center-Bottom)
  const px = w * 0.38;
  const py = h * 0.80;
  const pw = Math.min(w * 0.28, 240);
  const ph = 48;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 24);
  ctx.clip();
  for (let i = 0; i < pw + ph; i += 24) {
    ctx.fillStyle = Math.floor(i / 24) % 2 === 0 ? '#1d1d1f' : '#ffffff';
    ctx.fillRect(px + i - ph, py, 24, ph);
  }
  ctx.restore();

  // 7. Bold Center Typography "Shulya"
  ctx.save();
  const fontSize = Math.floor(Math.min(w * 0.12, 108));
  ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1d1d1f';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.05)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 2;
  ctx.fillText('Shulya', w * 0.5, h * 0.44);
  ctx.restore();

  ctx.restore();
}

function createInitialShapes(w, h) {
  const isMobile = w < 600;
  if (isMobile) {
    return [
      {
        id: 'slider',
        x: Math.round(w * 0.5 - 80),
        y: Math.round(h * 0.16),
        w: 160,
        h: 90,
        r: 45
      },
      {
        id: 'circle',
        x: Math.round(w * 0.5 - 60),
        y: Math.round(h * 0.36),
        w: 120,
        h: 120,
        r: 60
      },
      {
        id: 'rect',
        x: Math.round(w * 0.5 - 95),
        y: Math.round(h * 0.60),
        w: 190,
        h: 110,
        r: 22
      }
    ];
  }
  return [
    {
      id: 'slider',
      x: w * 0.12 + 60,
      y: h * 0.20,
      w: 186,
      h: 108,
      r: 54
    },
    {
      id: 'rect',
      x: w * 0.72,
      y: h * 0.18,
      w: 270,
      h: 160,
      r: 26
    },
    {
      id: 'circle',
      x: w * 0.18,
      y: h * 0.65,
      w: 150,
      h: 150,
      r: 75
    }
  ];
}

export default function App() {
  const stageRef = useRef(null);

  // Optical parameters
  const [rim, setRim] = useState(OPTICAL_DEFAULTS.rim);
  const [ior, setIor] = useState(OPTICAL_DEFAULTS.ior);
  const [height, setHeight] = useState(OPTICAL_DEFAULTS.height);
  const [frosted, setFrosted] = useState(OPTICAL_DEFAULTS.frosted);
  const [fusion, setFusion] = useState(OPTICAL_DEFAULTS.fusion);
  const [useGpu, setUseGpu] = useState(true);
  const [fps, setFps] = useState(60);
  const [frameMs, setFrameMs] = useState(1.0);

  // 1. «Золотое сечение» на старте (computeOptimalDpr)
  const initialDpr = computeOptimalDpr();
  const [dpr, setDpr] = useState(initialDpr);
  const dprRef = useRef(initialDpr);
  dprRef.current = dpr;

  // 3 draggable glass bodies with top-left positioning
  const [shapes, setShapes] = useState(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    return createInitialShapes(w, h);
  });

  const dragState = useRef(null);

  useLayoutEffect(() => {
    const canvas = stageRef.current;
    if (!canvas) return;

    const syncStage = () => {
      drawStageBackground(canvas, dprRef.current);
      scheduleStageRedraw();
    };

    syncStage();

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncStage);
      ro.observe(canvas);
    }
    window.addEventListener('resize', syncStage);

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', syncStage);
    };
  }, []);

  useLayoutEffect(() => {
    if (stageRef.current) {
      drawStageBackground(stageRef.current, dpr);
    }
  }, [dpr]);

  useLayoutEffect(() => {
    scheduleStageRedraw();
  }, [shapes, rim, ior, height, frosted, fusion]);

  // 2. Динамический регулятор FPS в реальном времени (stepAnimation):
  useEffect(() => {
    let lastFrameTime = performance.now();
    let consecutiveSlowFrames = 0;
    let lastDprDropTime = 0;
    let framesCount = 0;
    let lastFpsUpdate = performance.now();
    let accumulatedDelta = 0;
    let rafId;

    const stepAnimation = (timestamp) => {
      const frameDelta = timestamp - lastFrameTime;
      lastFrameTime = timestamp;

      // Фильтруем паузы вкладки и фоновый режим
      const isVisible = typeof document === 'undefined' || !document.hidden;
      if (isVisible && frameDelta > 0 && frameDelta <= 2000) {
        framesCount++;
        accumulatedDelta += frameDelta;

        if (timestamp - lastFpsUpdate >= 400) {
          const currentFps = Math.round((framesCount * 1000) / (timestamp - lastFpsUpdate));
          const avgMs = accumulatedDelta / framesCount;
          setFps(Math.min(120, currentFps));
          setFrameMs(avgMs);
          framesCount = 0;
          accumulatedDelta = 0;
          lastFpsUpdate = timestamp;
        }

        // > 22 мс соответствует падению FPS ниже 45 (только для CPU режима)
        if (!useGpu && frameDelta > 22) {
          consecutiveSlowFrames++;
          if (consecutiveSlowFrames >= 3 && timestamp - lastDprDropTime >= 100) {
            const current = dprRef.current;
            const nextDpr = Math.max(1.35, +(current * 0.85).toFixed(2));
            if (nextDpr < current) {
              setDpr(nextDpr);
              lastDprDropTime = timestamp;
            }
            consecutiveSlowFrames = 0;
          }
        } else {
          consecutiveSlowFrames = 0;
        }
      } else {
        consecutiveSlowFrames = 0;
      }

      rafId = requestAnimationFrame(stepAnimation);
    };

    rafId = requestAnimationFrame(stepAnimation);
    return () => cancelAnimationFrame(rafId);
  }, [useGpu]);

  // Top-left dragging
  const handlePointerDown = useCallback((id, e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setShapes((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx === -1) return prev;
      const target = prev[idx];
      dragState.current = {
        id,
        offX: e.clientX - target.x,
        offY: e.clientY - target.y
      };
      const next = [...prev];
      const [picked] = next.splice(idx, 1);
      next.push(picked);
      return next;
    });
  }, []);

  useEffect(() => {
    let rafMoveId = null;
    let pendingCoords = null;

    const handlePointerMove = (e) => {
      if (!dragState.current) return;
      const { id, offX, offY } = dragState.current;
      pendingCoords = { id, nextX: e.clientX - offX, nextY: e.clientY - offY };

      if (!rafMoveId) {
        rafMoveId = requestAnimationFrame(() => {
          rafMoveId = null;
          if (!pendingCoords) return;
          const { id: targetId, nextX, nextY } = pendingCoords;
          setShapes((prev) =>
            prev.map((s) => (s.id === targetId ? { ...s, x: nextX, y: nextY } : s))
          );
        });
      }
    };

    const handlePointerUp = () => {
      if (rafMoveId) {
        cancelAnimationFrame(rafMoveId);
        rafMoveId = null;
      }
      if (pendingCoords) {
        const { id: targetId, nextX, nextY } = pendingCoords;
        pendingCoords = null;
        setShapes((prev) =>
          prev.map((s) => (s.id === targetId ? { ...s, x: nextX, y: nextY } : s))
        );
      }
      dragState.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', handlePointerUp, { passive: true });
    return () => {
      if (rafMoveId) cancelAnimationFrame(rafMoveId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  return (
    <>
      {/* High-DPI Background Optical Test Stage */}
      <canvas ref={stageRef} className="stage-canvas" />

      {/* 3 Draggable <LiquidGlass> Bodies */}
      {shapes.map((s, index) => (
        <LiquidGlass
          key={s.id}
          rim={rim}
          ior={ior}
          height={height}
          frosted={frosted}
          fusion={fusion}
          dpr={dpr}
          className="glass-body"
          data-lg-tint="rgba(255, 255, 255, 0.04)"
          onPointerDown={(e) => handlePointerDown(s.id, e)}
          style={{
            width: `${s.w}px`,
            height: `${s.h}px`,
            borderRadius: `${s.r}px`,
            left: `${Math.round(s.x)}px`,
            top: `${Math.round(s.y)}px`,
            zIndex: 20 + index
          }}
        />
      ))}

      {/* Bottom Interactive Control Shelf */}
      <div className="shelf-bar">
        <div className="ctrl">
          <div className="ctrl-head">
            <span>Bevel Rim</span>
            <span className="ctrl-val">{rim} px</span>
          </div>
          <input
            type="range"
            min="6"
            max="32"
            step="1"
            value={rim}
            onChange={(e) => setRim(Number(e.target.value))}
          />
        </div>

        <div className="ctrl">
          <div className="ctrl-head">
            <span>Refraction (IOR)</span>
            <span className="ctrl-val">{ior.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="1.10"
            max="1.70"
            step="0.02"
            value={ior}
            onChange={(e) => setIor(Number(e.target.value))}
          />
        </div>

        <div className="ctrl">
          <div className="ctrl-head">
            <span>Thickness (Height)</span>
            <span className="ctrl-val">{height} px</span>
          </div>
          <input
            type="range"
            min="6"
            max="34"
            step="1"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </div>

        <div className="ctrl">
          <div className="ctrl-head">
            <span>Frosted Glass</span>
            <span className="ctrl-val">{frosted} px</span>
          </div>
          <input
            type="range"
            min="0"
            max="30"
            step="1"
            value={frosted}
            onChange={(e) => setFrosted(Number(e.target.value))}
          />
        </div>

        <label className="ctrl-toggle">
          <input
            type="checkbox"
            checked={fusion}
            onChange={(e) => setFusion(e.target.checked)}
          />
          <span>Liquid Fusion</span>
        </label>

        <label
          className="ctrl-toggle"
          style={{
            cursor: 'pointer',
            background: useGpu ? 'rgba(0, 122, 255, 0.12)' : 'rgba(255, 149, 0, 0.15)'
          }}
        >
          <input
            type="checkbox"
            checked={useGpu}
            onChange={(e) => {
              const val = e.target.checked;
              setUseGpu(val);
              setUseWebGL(val);
              scheduleStageRedraw();
            }}
          />
          <span style={{ fontWeight: 700, color: useGpu ? '#007aff' : '#d70015' }}>
            {useGpu ? '⚡ WebGL (GPU)' : '🐢 Canvas (CPU)'}
          </span>
        </label>

        <div
          className="fps-tag"
          style={{
            background: isWebGLActive() ? 'rgba(48, 209, 88, 0.15)' : 'rgba(255, 149, 0, 0.15)',
            color: isWebGLActive() ? '#248a3d' : '#e05300'
          }}
        >
          {fps} FPS ({frameMs.toFixed(1)} ms) — {isWebGLActive() ? 'GPU' : 'CPU'}
        </div>
      </div>
    </>
  );
}
