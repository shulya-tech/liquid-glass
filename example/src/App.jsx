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
  redrawStageNow
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
let staticCanvas = null;
let staticBufW = 0;
let staticBufH = 0;
let staticDpr = 0;

/**
 * Pre-renders heavy static backdrop (grid, pill track, ribbon, spheres, text, shadows)
 * into an offscreen canvas once. Avoids recomputing 5 expensive Gaussian shadow blurs
 * at high DPI on every frame, which severely lags Safari's Canvas 2D engine.
 */
function getStaticBackground(w, h, dpr) {
  const bufW = Math.max(1, Math.floor(w * dpr));
  const bufH = Math.max(1, Math.floor(h * dpr));

  if (
    staticCanvas &&
    staticBufW === bufW &&
    staticBufH === bufH &&
    staticDpr === dpr
  ) {
    return staticCanvas;
  }

  if (!staticCanvas) {
    staticCanvas = document.createElement('canvas');
  }
  staticCanvas.width = bufW;
  staticCanvas.height = bufH;
  staticBufW = bufW;
  staticBufH = bufH;
  staticDpr = dpr;

  const ctx = staticCanvas.getContext('2d');
  if (!ctx) return staticCanvas;

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
  return staticCanvas;
}

function drawStageBackground(canvas, dpr = computeOptimalDpr(), time = 0) {
  if (!canvas) return;
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const bufW = Math.max(1, Math.round(w * dpr));
  const bufH = Math.max(1, Math.round(h * dpr));

  if (canvas.width !== bufW || canvas.height !== bufH) {
    canvas.width = bufW;
    canvas.height = bufH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1. Single instant GPU blit of cached static backdrop (0.05ms)
  const staticBackdrop = getStaticBackground(w, h, dpr);
  ctx.drawImage(staticBackdrop, 0, 0);

  // 2. Smooth floating ambient glowing orbs for real-time optical refraction testing
  ctx.save();
  ctx.scale(dpr, dpr);

  const orbs = [
    {
      x: w * 0.32 + Math.sin(time * 0.0008) * 85,
      y: h * 0.42 + Math.cos(time * 0.0006) * 60,
      r: 95,
      c1: 'rgba(99, 102, 241, 0.42)',
      c2: 'rgba(99, 102, 241, 0.0)'
    },
    {
      x: w * 0.72 + Math.cos(time * 0.0007) * 100,
      y: h * 0.48 + Math.sin(time * 0.0009) * 70,
      r: 120,
      c1: 'rgba(236, 72, 153, 0.38)',
      c2: 'rgba(236, 72, 153, 0.0)'
    },
    {
      x: w * 0.50 + Math.sin(time * 0.0006 + 2.0) * 80,
      y: h * 0.30 + Math.cos(time * 0.0008 + 1.0) * 50,
      r: 80,
      c1: 'rgba(14, 165, 233, 0.40)',
      c2: 'rgba(14, 165, 233, 0.0)'
    },
    {
      x: w * 0.22 + Math.cos(time * 0.0009 + 3.0) * 70,
      y: h * 0.75 + Math.sin(time * 0.0007 + 2.5) * 60,
      r: 105,
      c1: 'rgba(245, 158, 11, 0.35)',
      c2: 'rgba(245, 158, 11, 0.0)'
    }
  ];

  for (let i = 0; i < orbs.length; i++) {
    const orb = orbs[i];
    ctx.save();
    const radGrad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
    radGrad.addColorStop(0, orb.c1);
    radGrad.addColorStop(1, orb.c2);
    ctx.fillStyle = radGrad;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

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
  const [frosted, setFrosted] = useState(0);
  const [fusion, setFusion] = useState(OPTICAL_DEFAULTS.fusion);

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

  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const shapeDomRefs = useRef({});
  const dragState = useRef(null);
  const topZRef = useRef(20);

  useLayoutEffect(() => {
    const canvas = stageRef.current;
    if (!canvas) return;

    let animId = 0;
    const syncStage = (time = performance.now()) => {
      drawStageBackground(canvas, dprRef.current, time);
      redrawStageNow(true);
    };

    syncStage();

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => syncStage());
      ro.observe(canvas);
    }
    const handleResize = () => syncStage();
    window.addEventListener('resize', handleResize);

    let lastBgTime = 0;
    // Ambient background loop: continuous smooth updates without freezing on drag
    const loop = (timestamp) => {
      const bgInterval = 1000 / 30;
      if (timestamp - lastBgTime >= bgInterval) {
        lastBgTime = timestamp;
        drawStageBackground(canvas, dprRef.current, timestamp);
        redrawStageNow(true);
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useLayoutEffect(() => {
    if (stageRef.current) {
      drawStageBackground(stageRef.current, dpr);
    }
  }, [dpr]);

  // Synchronous redraw when optical params or fusion change
  useLayoutEffect(() => {
    redrawStageNow();
  }, [rim, ior, height, frosted, fusion]);

  // Top-left dragging: direct zero-overhead DOM tracking without React re-render hitch
  const handlePointerDown = useCallback((id, e) => {
    const target = shapesRef.current.find((s) => s.id === id);
    if (!target) return;

    dragState.current = {
      id,
      offX: e.clientX - target.x,
      offY: e.clientY - target.y,
      currentX: target.x,
      currentY: target.y
    };
  }, []);

  // Pointer move & up: zero-overhead DOM tracking without React re-render lag
  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!dragState.current) return;
      const d = dragState.current;
      const evt =
        e.getCoalescedEvents && e.getCoalescedEvents().length > 0
          ? e.getCoalescedEvents()[e.getCoalescedEvents().length - 1]
          : e;

      const newX = evt.clientX - d.offX;
      const newY = evt.clientY - d.offY;
      d.currentX = newX;
      d.currentY = newY;

      // 1. Instantly move DOM element with subpixel hardware precision (0ms latency)
      const el = shapeDomRefs.current[d.id];
      if (el) {
        el.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        if (el._lgController) {
          el._lgController.setRectPosition(newX, newY);
        }
      }
      // 2. Instantly update WebGL scissor region: 0.05ms GPU pass
      redrawStageNow(false);
    };

    const handlePointerUp = () => {
      if (!dragState.current) return;
      const { id, currentX, currentY } = dragState.current;
      dragState.current = null;
      const target = shapesRef.current.find((s) => s.id === id);
      if (target) {
        target.x = currentX;
        target.y = currentY;
      }
      const el = shapeDomRefs.current[id];
      if (el && el._lgController && typeof el._lgController.clearManualPosition === 'function') {
        el._lgController.clearManualPosition();
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', handlePointerUp, { passive: true });
    return () => {
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
          ref={(el) => {
            shapeDomRefs.current[s.id] = el;
          }}
          rim={rim}
          ior={ior}
          height={height}
          frosted={frosted}
          fusion={fusion}
          dpr={dpr}
          className="glass-body"
          data-lg-tint="rgba(255, 255, 255, 0.18)"
          data-lg-z-index={20}
          onPointerDown={(e) => handlePointerDown(s.id, e)}
          style={{
            width: `${s.w}px`,
            height: `${s.h}px`,
            borderRadius: `${s.r}px`,
            transform: `translate3d(${s.x}px, ${s.y}px, 0)`,
            zIndex: 20
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
      </div>
    </>
  );
}
