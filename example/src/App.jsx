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
  scheduleStageRedraw
} from '@shulya/liquid-glass/react';

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
function drawStageBackground(canvas) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || window.innerWidth));
  const h = Math.max(1, Math.round(rect.height || window.innerHeight));
  const isMobileScreen =
    typeof navigator !== 'undefined' &&
    (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (typeof window !== 'undefined' &&
        window.matchMedia &&
        (window.matchMedia('(pointer: coarse)').matches ||
          window.matchMedia('(max-width: 768px)').matches)));
  const dpr = isMobileScreen ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);

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
  const [fps, setFps] = useState(120);

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
      drawStageBackground(canvas);
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
    scheduleStageRedraw();
  }, [shapes, rim, ior, height, frosted, fusion]);

  // FPS monitor
  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let rafId;

    const tick = (now) => {
      frameCount++;
      if (now - lastTime >= 500) {
        setFps(Math.min(120, Math.round((frameCount * 1000) / (now - lastTime))));
        frameCount = 0;
        lastTime = now;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

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
    const handlePointerMove = (e) => {
      if (!dragState.current) return;
      const { id, offX, offY } = dragState.current;
      const nextX = e.clientX - offX;
      const nextY = e.clientY - offY;

      setShapes((prev) =>
        prev.map((s) => (s.id === id ? { ...s, x: nextX, y: nextY } : s))
      );
    };

    const handlePointerUp = () => {
      dragState.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
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
          rim={rim}
          ior={ior}
          height={height}
          frosted={frosted}
          fusion={fusion}
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

        <div className="fps-tag">{fps} FPS</div>
      </div>
    </>
  );
}
