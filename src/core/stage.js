/**
 * Stage Compositor & Island Cluster Manager
 * Orchestrates viewport background capture, WebGL fast-path rendering,
 * 2D canvas fallback, and RAF render loop.
 */

import { DEFAULT_FUSION_DISTANCE } from './options.js';
import {
  getDevicePixelRatio,
  hasLiveBackgroundCanvas,
  checkCanvasFilterBlur,
  areRectsTouching
} from './dom.js';
import { renderDomSurfacesToCache } from './dom-cache.js';
import { renderIsolatedController } from '../canvas2d/isolated.js';
import { renderFusedCluster, clearClusterOverlay, resetClusterRect } from '../canvas2d/cluster.js';
import { WebGLGlassRenderer } from '../webgl/renderer.js';

export const controllerRegistry = new Set();

let stageCanvas = null;
let stageCtx = null;
let blurCanvas = null;
let blurCtx = null;
let domCacheCanvas = null;
let domCacheCtx = null;
let domCacheDirty = true;
let clusterOverlayCanvas = null;
let clusterOverlayCtx = null;
let webglCanvas = null;
let webglRenderer = null;
let useWebGL = true;
let rafScheduled = false;
let rafId = 0;
let listenersAttached = false;
let lastFrostedRadius = -1;
let stageDirty = true;
let isPointerDown = false;

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { isPointerDown = true; }, { passive: true, capture: true });
  window.addEventListener('pointerup', () => { isPointerDown = false; }, { passive: true, capture: true });
  window.addEventListener('pointercancel', () => { isPointerDown = false; }, { passive: true, capture: true });
}

function ensureStageBuffers(customDpr = 0) {
  if (typeof document === 'undefined') return false;
  const dpr = getDevicePixelRatio(customDpr);
  const docEl = document.documentElement;
  const vw = Math.max(1, window.innerWidth, docEl ? docEl.clientWidth : 0);
  const vh = Math.max(1, window.innerHeight, docEl ? docEl.clientHeight : 0);
  const bufW = Math.round(vw * dpr);
  const bufH = Math.round(vh * dpr);

  if (!stageCanvas) {
    stageCanvas = document.createElement('canvas');
    stageCtx = stageCanvas.getContext('2d', { willReadFrequently: true });
    blurCanvas = document.createElement('canvas');
    blurCtx = blurCanvas.getContext('2d', { willReadFrequently: true });
    domCacheCanvas = document.createElement('canvas');
    domCacheCtx = domCacheCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (stageCanvas.width !== bufW || stageCanvas.height !== bufH) {
    stageCanvas.width = bufW;
    stageCanvas.height = bufH;
    blurCanvas.width = bufW;
    blurCanvas.height = bufH;
    if (domCacheCanvas) {
      domCacheCanvas.width = bufW;
      domCacheCanvas.height = bufH;
      domCacheDirty = true;
    }
  }

  if (!clusterOverlayCanvas) {
    clusterOverlayCanvas = document.createElement('canvas');
    clusterOverlayCanvas.className = 'lg-cluster-canvas';
    clusterOverlayCanvas.setAttribute('aria-hidden', 'true');
    clusterOverlayCanvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 49;
      transform: translate3d(0, 0, 0);
      -webkit-transform: translate3d(0, 0, 0);
      will-change: transform;
      visibility: hidden;
    `;
    document.body.appendChild(clusterOverlayCanvas);
    clusterOverlayCtx = clusterOverlayCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (clusterOverlayCanvas.width !== bufW || clusterOverlayCanvas.height !== bufH) {
    clusterOverlayCanvas.width = bufW;
    clusterOverlayCanvas.height = bufH;
    resetClusterRect();
  }

  return true;
}

export function setUseWebGL(enabled) {
  useWebGL = Boolean(enabled);
  if (!useWebGL && webglCanvas) {
    webglCanvas.style.display = 'none';
  }
  scheduleStageRedraw();
}

export function isWebGLActive() {
  return useWebGL && webglRenderer !== null;
}

function ensureWebGLRenderer(customDpr = 0) {
  if (typeof document === 'undefined' || !useWebGL) return false;
  const dpr = getDevicePixelRatio(customDpr);
  const docEl = document.documentElement;
  const vw = Math.max(1, window.innerWidth, docEl ? docEl.clientWidth : 0);
  const vh = Math.max(1, window.innerHeight, docEl ? docEl.clientHeight : 0);
  const bufW = Math.max(1, Math.round(vw * dpr));
  const bufH = Math.max(1, Math.round(vh * dpr));

  if (!webglCanvas) {
    const canvas = document.createElement('canvas');
    canvas.className = 'lg-webgl-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 49;
      transform: translate3d(0, 0, 0);
      -webkit-transform: translate3d(0, 0, 0);
      will-change: transform;
      display: none;
    `;
    document.body.appendChild(canvas);
    webglCanvas = canvas;
  }

  if (webglCanvas.width !== bufW || webglCanvas.height !== bufH) {
    webglCanvas.width = bufW;
    webglCanvas.height = bufH;
  }

  if (!webglRenderer) {
    try {
      webglRenderer = new WebGLGlassRenderer(webglCanvas);
    } catch (err) {
      console.warn('[LiquidGlass] WebGL initialization failed, falling back to 2D canvas:', err);
      useWebGL = false;
      return false;
    }
  }

  return true;
}

/**
 * Captures the live viewport background (background canvas + visible images & typography)
 * onto stageCanvas so isolated & fused lenses can refract live pixels at native 60 / 120 FPS
 */
function captureViewportStage(neededBlur, customDpr = 0) {
  if (!ensureStageBuffers(customDpr)) return;
  const dpr = getDevicePixelRatio(customDpr);
  const bw = stageCanvas.width;
  const bh = stageCanvas.height;
  const vw = Math.round(bw / dpr);
  const vh = Math.round(bh / dpr);

  // 1. Re-render DOM overlay only when dirty (scroll, resize, mutation), 0ms overhead during animation
  if (domCacheDirty || !domCacheCanvas) {
    renderDomSurfacesToCache(domCacheCanvas, domCacheCtx, controllerRegistry, dpr, vw, vh, bw, bh);
    domCacheDirty = false;
  }

  // 2. Base page background (detect light/dark body background)
  const bodyBg = typeof document !== 'undefined' ? window.getComputedStyle(document.body).backgroundColor : '';
  stageCtx.fillStyle = bodyBg && bodyBg !== 'transparent' && bodyBg !== 'rgba(0, 0, 0, 0)' ? bodyBg : '#040814';
  stageCtx.fillRect(0, 0, bw, bh);

  // 3. Copy any background 2D canvas using physical buffer pixels (live particles at 60/120 FPS)
  const bgCanvases = document.querySelectorAll(
    'canvas:not(.lg-lens-canvas):not(.lg-cluster-canvas):not(.lg-webgl-canvas)'
  );
  for (let i = 0; i < bgCanvases.length; i++) {
    const c = bgCanvases[i];
    if (c.width > 0 && c.height > 0) {
      try {
        const cr = c.getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) {
          stageCtx.drawImage(
            c,
            Math.round(cr.left * dpr),
            Math.round(cr.top * dpr),
            Math.round(cr.width * dpr),
            Math.round(cr.height * dpr)
          );
        }
      } catch {
        // Ignore cross-origin canvas if any
      }
    }
  }

  // 4. Composite cached DOM elements (cards, text, buttons) over live background canvas in 0.05ms
  if (domCacheCanvas) {
    stageCtx.drawImage(domCacheCanvas, 0, 0);
  }

  // 5. Blur buffer for frosted glass (Native hardware-accelerated blur across Chrome, Safari & mobile)
  if (neededBlur > 0 && !useWebGL) {
    lastFrostedRadius = neededBlur;
    blurCtx.clearRect(0, 0, bw, bh);

    if (checkCanvasFilterBlur()) {
      blurCtx.filter = `blur(${Math.round(neededBlur * dpr)}px)`;
      blurCtx.drawImage(stageCanvas, 0, 0);
      blurCtx.filter = 'none';
    } else {
      const factor = Math.max(0.2, 1.0 / (1.0 + neededBlur * 0.25));
      const midW = Math.max(32, Math.round(bw * 0.5));
      const midH = Math.max(32, Math.round(bh * 0.5));
      const pw = Math.max(16, Math.round(bw * factor));
      const ph = Math.max(16, Math.round(bh * factor));
      blurCtx.imageSmoothingEnabled = true;
      blurCtx.imageSmoothingQuality = 'high';
      blurCtx.drawImage(stageCanvas, 0, 0, midW, midH);
      blurCtx.drawImage(blurCanvas, 0, 0, midW, midH, 0, 0, pw, ph);
      blurCtx.drawImage(blurCanvas, 0, 0, pw, ph, 0, 0, midW, midH);
      blurCtx.drawImage(blurCanvas, 0, 0, midW, midH, 0, 0, bw, bh);
    }
  }
}

function renderAllActiveLenses() {
  rafScheduled = false;
  if (typeof document === 'undefined' || controllerRegistry.size === 0) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const visible = [];
  let maxFrosted = 0;
  let activeDpr = 0;

  for (const ctrl of controllerRegistry) {
    if (!ctrl._mounted || !ctrl.enabled || !ctrl.element) {
      if (ctrl._canvas) ctrl._canvas.style.opacity = '0';
      continue;
    }
    const r = ctrl.element.getBoundingClientRect();
    if (r.width <= 4 || r.height <= 4) continue;
    // Keep off-screen fusion anchors (within 80px of viewport) in the active list when fusion is enabled
    const margin = ctrl.options.fusion ? DEFAULT_FUSION_DISTANCE : 0;
    if (
      r.bottom < -margin ||
      r.top > vh + margin ||
      r.right < -margin ||
      r.left > vw + margin
    ) {
      continue;
    }
    if (ctrl.options.frosted > maxFrosted) {
      maxFrosted = ctrl.options.frosted;
    }
    if (ctrl.options.dpr > 0 && activeDpr === 0) {
      activeDpr = ctrl.options.dpr;
    }
    visible.push({ ctrl, rect: r });
  }

  if (visible.length === 0) {
    if (webglCanvas) webglCanvas.style.display = 'none';
    if (clusterOverlayCanvas) {
      clusterOverlayCanvas.style.visibility = 'hidden';
      clearClusterOverlay(clusterOverlayCtx);
    }
    return;
  }

  const needsCapture = stageDirty || !stageCanvas;
  if (needsCapture) {
    captureViewportStage(maxFrosted, activeDpr);
    stageDirty = false;
  }

  // WebGL Fast-Path: single fullscreen GPU draw call (zero canvas reallocations, 120 FPS locked)
  if (useWebGL && ensureWebGLRenderer(activeDpr)) {
    try {
      const dpr = getDevicePixelRatio(activeDpr);
      const n = visible.length;
      const fusedFlags = new Array(n).fill(false);

      for (let i = 0; i < n; i++) {
        if (!visible[i].ctrl.options.fusion) continue;
        const baseThresh = (visible[i].ctrl.options.fusionDistance || DEFAULT_FUSION_DISTANCE);
        const thresh = visible[i].ctrl._fused ? baseThresh + 8 : baseThresh;
        for (let j = 0; j < n; j++) {
          if (i !== j && visible[j].ctrl.options.fusion) {
            if (areRectsTouching(visible[i].rect, visible[j].rect, thresh)) {
              fusedFlags[i] = true;
              fusedFlags[j] = true;
            }
          }
        }
      }

      for (let i = 0; i < n; i++) {
        visible[i].ctrl._fused = fusedFlags[i];
      }

      // Remove CSS box-shadow from elements where they merge, restore when unmerged!
      for (let i = 0; i < n; i++) {
        const el = visible[i].ctrl.element;
        if (el) {
          if (fusedFlags[i]) {
            if (el._lgOrigBoxShadow === undefined) {
              el._lgOrigBoxShadow = el.style.boxShadow || '';
            }
            if (el.style.boxShadow !== 'none') {
              el.style.boxShadow = 'none';
            }
          } else if (el._lgOrigBoxShadow !== undefined) {
            el.style.boxShadow = el._lgOrigBoxShadow;
            delete el._lgOrigBoxShadow;
          }
        }
      }

      const elements = visible.map(({ ctrl, rect }, i) => ({
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        borderRadius: ctrl._getRadius(),
        shape: ctrl._getShape(),
        tint: ctrl._tint,
        fusion: ctrl.options.fusion,
        fused: fusedFlags[i]
      }));

      for (let i = 0; i < visible.length; i++) {
        if (visible[i].ctrl._canvas) {
          visible[i].ctrl._canvas.style.opacity = '0';
        }
      }

      const primaryCtrl = visible[visible.length - 1].ctrl;

      webglRenderer.render({
        sourceCanvas: stageCanvas,
        elements,
        options: {
          ...primaryCtrl.options,
          frosted: maxFrosted
        },
        dpr,
        sourceCanvasDirty: needsCapture
      });

      if (webglCanvas) {
        webglCanvas.style.display = 'block';
        if (clusterOverlayCanvas) clusterOverlayCanvas.style.visibility = 'hidden';

        let minZ = 50;
        for (let i = 0; i < visible.length; i++) {
          const z = visible[i].ctrl._cachedZIndex || 50;
          if (z < minZ) minZ = z;
        }
        webglCanvas.style.zIndex = String(Math.max(1, minZ - 1));
      }
      return;
    } catch (e) {
      console.warn('[LiquidGlass] WebGL render failed, falling back to 2D canvas:', e);
      useWebGL = false;
    }
  }

  if (needsCapture) {
    captureViewportStage(maxFrosted, activeDpr);
    stageDirty = false;
  }

  if (webglCanvas) {
    webglCanvas.style.display = 'none';
  }

  // Disjoint-set Island Clustering
  const n = visible.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(i) {
    while (parent[i] !== i) i = parent[i];
    return i;
  }
  function union(i, j) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  for (let i = 0; i < n; i++) {
    if (!visible[i].ctrl.options.fusion) continue;
    const thresh = (visible[i].ctrl.options.fusionDistance || DEFAULT_FUSION_DISTANCE);
    for (let j = i + 1; j < n; j++) {
      if (!visible[j].ctrl.options.fusion) continue;
      if (areRectsTouching(visible[i].rect, visible[j].rect, thresh)) {
        union(i, j);
      }
    }
  }

  const clusters = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(visible[i]);
  }

  let hasFusedCluster = false;

  for (const group of clusters.values()) {
    if (group.length === 1) {
      const { ctrl, rect } = group[0];
      if (rect.bottom > 1 && rect.top < vh) {
        renderIsolatedController(ctrl, rect, { stageCtx, blurCtx });
      }
    } else {
      hasFusedCluster = true;
      for (const item of group) {
        item.ctrl._canvas.style.opacity = '0';
      }
      const primaryCtrl = group[group.length - 1].ctrl;
      const sourceCtx = primaryCtrl.options.frosted > 0 ? blurCtx : stageCtx;
      const elements = group.map(({ ctrl, rect }) => ({
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        borderRadius: ctrl._getRadius(),
        fusion: true,
        tint: ctrl._tint,
        dpr: ctrl.options.dpr
      }));

      const dpr = getDevicePixelRatio(primaryCtrl.options.dpr);
      const box = renderFusedCluster(
        clusterOverlayCtx,
        sourceCtx,
        elements,
        {
          ...primaryCtrl.options,
          fusionDistance: primaryCtrl.options.fusionDistance || DEFAULT_FUSION_DISTANCE
        },
        dpr
      );

      if (box && clusterOverlayCanvas) {
        clusterOverlayCanvas.style.visibility = 'visible';
        clusterOverlayCanvas.style.filter = 'none';

        if (clusterOverlayCanvas.parentElement !== document.body) {
          document.body.appendChild(clusterOverlayCanvas);
        }

        // Match z-index to highest element in the cluster so it cleanly covers individual elements
        let maxZ = 20;
        for (const item of group) {
          const z = item.ctrl._cachedZIndex || 20;
          if (z > maxZ) maxZ = z;
        }
        clusterOverlayCanvas.style.zIndex = String(maxZ + 1);
      }
    }
  }

  if (!hasFusedCluster && clusterOverlayCanvas) {
    clusterOverlayCanvas.style.visibility = 'hidden';
    clearClusterOverlay(clusterOverlayCtx);
  }
}

export function scheduleStageRedraw(dirty = false) {
  if (dirty) stageDirty = true;
  if (typeof window === 'undefined') return;
  if (rafScheduled) return;
  rafScheduled = true;
  rafId = window.requestAnimationFrame(renderAllActiveLenses);
}

export function redrawStageNow(dirty = false) {
  if (dirty) stageDirty = true;
  if (typeof window === 'undefined') return;
  if (rafScheduled) {
    window.cancelAnimationFrame(rafId);
    rafScheduled = false;
  }
  renderAllActiveLenses();
}

export function attachGlobalStageListeners() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  let scrollRestTimer = null;
  const onScroll = () => {
    // Redraw glass positions at native 120 FPS immediately without expensive DOM scanning or texture uploads
    scheduleStageRedraw(false);

    if (scrollRestTimer) clearTimeout(scrollRestTimer);
    scrollRestTimer = setTimeout(() => {
      domCacheDirty = true;
      stageDirty = true;
      scheduleStageRedraw(true);
    }, 150);
  };

  const onResize = () => {
    domCacheDirty = true;
    stageDirty = true;
    scheduleStageRedraw(true);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  // Live background canvas sync: 60/120 FPS on WebGL GPU path; 8 FPS (125ms) throttled on CPU
  const tick = () => {
    if (controllerRegistry.size > 0 && hasLiveBackgroundCanvas()) {
      if (!isPointerDown) {
        if (useWebGL) {
          scheduleStageRedraw(true);
          window.requestAnimationFrame(tick);
          return;
        } else {
          stageDirty = true;
          scheduleStageRedraw(true);
        }
      }
    }
    window.setTimeout(() => window.requestAnimationFrame(tick), 125);
  };
  window.requestAnimationFrame(tick);
}
