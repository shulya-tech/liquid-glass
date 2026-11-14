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
 * Draws a crisp, high-DPI optical test stage onto the background canvas
 * using its exact rendered getBoundingClientRect() dimensions so desktop
 * and mobile viewports always match 1:1 to the sub-pixel.
 */
function drawStageBackground(canvas) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || window.innerWidth));
  const h = Math.max(1, Math.round(rect.height || window.innerHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const isMobile = w < 640;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.scale(dpr, dpr);

  // 1. Clean Light Gray Backdrop (#ebedf2)
  ctx.fillStyle = '#ebedf2';
  ctx.fillRect(0, 0, w, h);

  // Fine architectural hairline grid (56px step, 0.5px crisp stroke)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.035)';
  ctx.lineWidth = 0.5;
  const step = isMobile ? 44 : 56;
  ctx.beginPath();
  for (let x = 0; x < w; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = 0; y < h; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();

  // 2. Sleek Green Switch Track (Top-Left)
  const pillX = isMobile ? w * 0.24 : w * 0.16;
  const pillY = isMobile ? h * 0.18 : h * 0.22;
  const pillW = isMobile ? 116 : 160;
  const pillH = isMobile ? 20 : 26;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pillX - pillW / 2, pillY - pillH / 2, pillW, pillH, pillH / 2);
  ctx.fillStyle = '#32d74b';
  ctx.fill();
  ctx.restore();

  // 3. Thin Diagonal Rainbow Gradient Ribbon
  ctx.save();
  ctx.translate(w * 0.5, isMobile ? h * 0.44 : h * 0.51);
  ctx.rotate(-0.2);
  const ribHalfLen = isMobile ? Math.min(w * 0.4, 150) : Math.min(w * 0.28, 310);
  const ribThickness = isMobile ? 18 : 26;
  const ribGrad = ctx.createLinearGradient(-ribHalfLen, 0, ribHalfLen, 0);
  ribGrad.addColorStop(0.0, '#ff2d55');
  ribGrad.addColorStop(0.25, '#ff9500');
  ribGrad.addColorStop(0.5, '#ffcc00');
  ribGrad.addColorStop(0.75, '#5ac8fa');
  ribGrad.addColorStop(1.0, '#5856d6');
  ctx.fillStyle = ribGrad;
  ctx.beginPath();
  ctx.roundRect(
    -ribHalfLen,
    -ribThickness / 2,
    ribHalfLen * 2,
    ribThickness,
    ribThickness / 2
  );
  ctx.fill();
  ctx.restore();

  // 4. Refined Electric Blue Card (Right Center)
  ctx.save();
  const cardW = isMobile ? 108 : 152;
  const cardH = isMobile ? 64 : 88;
  const cardX = isMobile ? w * 0.74 - cardW * 0.5 : w * 0.67;
  const cardY = isMobile ? h * 0.17 : h * 0.24;
  const blueGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
  blueGrad.addColorStop(0, '#007aff');
  blueGrad.addColorStop(1, '#5856d6');
  ctx.fillStyle = blueGrad;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, isMobile ? 16 : 22);
  ctx.fill();
  ctx.restore();

  // 5. Compact Sunset Orange Sphere (Bottom Left)
  ctx.save();
  const orbX = isMobile ? w * 0.25 : w * 0.26;
  const orbY = isMobile ? h * 0.60 : h * 0.67;
  const orbR = isMobile ? 38 : 54;
  const orbGrad = ctx.createRadialGradient(orbX - 10, orbY - 10, 4, orbX, orbY, orbR);
  orbGrad.addColorStop(0, '#ffcc00');
  orbGrad.addColorStop(0.6, '#ff3b30');
  orbGrad.addColorStop(1, '#c91f66');
  ctx.fillStyle = orbGrad;
  ctx.beginPath();
  ctx.arc(orbX, orbY, orbR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 6. Fine Optical Stripe Grating (Bottom Right)
  ctx.save();
  const stW = isMobile ? 112 : 160;
  const stH = isMobile ? 68 : 92;
  const stX = isMobile ? w * 0.72 - stW * 0.5 : w * 0.63;
  const stY = isMobile ? h * 0.56 : h * 0.62;
  const stripeWidth = isMobile ? 8 : 10;
  ctx.beginPath();
  ctx.roundRect(stX, stY, stW, stH, isMobile ? 14 : 18);
  ctx.clip();
  for (let i = 0; i < stW / stripeWidth; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#1c1c1e' : '#ffffff';
    ctx.fillRect(stX + i * stripeWidth, stY, stripeWidth, stH);
  }
  ctx.restore();

  // 7. Sleek Center Typography ("Shulya")
  ctx.save();
  const fontSize = isMobile ? Math.min(w * 0.13, 52) : Math.min(w * 0.082, 92);
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#16181d';
  ctx.fillText('Shulya', w * 0.5, isMobile ? h * 0.38 : h * 0.43);
  ctx.restore();

  ctx.restore();
}

function createInitialShapes(w, h) {
  const isMobile = w < 640;
  if (isMobile) {
    return [
      { id: 'slider', x: w * 0.26, y: h * 0.18, w: 104, h: 58, r: 29 },
      { id: 'rect', x: w * 0.74, y: h * 0.21, w: 132, h: 82, r: 18 },
      { id: 'circle', x: w * 0.26, y: h * 0.60, w: 88, h: 88, r: 44 }
    ];
  }
  return [
    { id: 'slider', x: w * 0.16 + 42, y: h * 0.22, w: 136, h: 74, r: 37 },
    { id: 'rect', x: w * 0.71, y: h * 0.21, w: 196, h: 116, r: 22 },
    { id: 'circle', x: w * 0.22, y: h * 0.65, w: 112, h: 112, r: 56 }
  ];
}

export default function App() {
  const stageRef = useRef(null);

  // Live optical configuration parameters bound to <LiquidGlass> props
  const [rim, setRim] = useState(OPTICAL_DEFAULTS.rim);
  const [ior, setIor] = useState(OPTICAL_DEFAULTS.ior);
  const [height, setHeight] = useState(OPTICAL_DEFAULTS.height);
  const [frosted, setFrosted] = useState(OPTICAL_DEFAULTS.frosted);
  const [fusion, setFusion] = useState(OPTICAL_DEFAULTS.fusion);
  const [fps, setFps] = useState(60);

  // Three sleek draggable LiquidGlass bodies
  const [shapes, setShapes] = useState(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    return createInitialShapes(w, h);
  });

  const dragState = useRef(null);
  const lastModeRef = useRef(
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  // Synchronously redraw stage background before browser paint and on resize
  useLayoutEffect(() => {
    const canvas = stageRef.current;
    if (!canvas) return;

    const syncStage = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width || window.innerWidth));
      const h = Math.max(1, Math.round(rect.height || window.innerHeight));
      const isMobile = w < 640;

      if (isMobile !== lastModeRef.current) {
        lastModeRef.current = isMobile;
        setShapes(createInitialShapes(w, h));
      }

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

  // Trigger optical redraw synchronously after React commits new shape positions or parameters
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

  // Pointer dragging handlers
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
      // Move active dragged shape to top of render order
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
      {/* Background Optical Test Stage */}
      <canvas ref={stageRef} className="stage-canvas" />

      {/* Three Draggable <LiquidGlass> React Components */}
      {shapes.map((s, index) => (
        <LiquidGlass
          key={s.id}
          rim={rim}
          ior={ior}
          height={height}
          frosted={frosted}
          fusion={fusion}
          className="glass-body"
          data-lg-tint="rgba(255, 255, 255, 0.03)"
          onPointerDown={(e) => handlePointerDown(s.id, e)}
          style={{
            width: `${s.w}px`,
            height: `${s.h}px`,
            borderRadius: `${s.r}px`,
            left: `${Math.round(s.x - s.w * 0.5)}px`,
            top: `${Math.round(s.y - s.h * 0.5)}px`,
            zIndex: 20 + index
          }}
        />
      ))}

      {/* Bottom Interactive Control Shelf */}
      <div className="shelf-bar">
        <div className="ctrl">
          <div className="ctrl-head">
            <span>Bevel Width (Rim)</span>
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
            <span>Frosted Blur</span>
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
