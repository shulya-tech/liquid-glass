/**
 * Stage Compositor & Island Cluster Manager
 * Hardware-accelerated Screen-Space WebGL only.
 * Restricts GPU rendering strictly to active and fused element cluster regions.
 */

import { DEFAULT_FUSION_DISTANCE } from './options.js';
import {
  getDevicePixelRatio,
  hasLiveBackgroundCanvas,
  areRectsTouching
} from './dom.js';
import { renderDomSurfacesToCache } from './dom-cache.js';
import { WebGLGlassRenderer } from '../webgl/renderer.js';

export const controllerRegistry = new Set();

let stageCanvas = null;
let stageCtx = null;
let domCacheCanvas = null;
let domCacheCtx = null;
let domCacheDirty = true;
let webglCanvas = null;
let webglRenderer = null;
let rafScheduled = false;
let rafId = 0;
let listenersAttached = false;
let stageDirty = true;

let cachedBodyBg = '';
let cachedBodyBgClean = '#040814';
let cachedDirectBgCanvas = null;
let cachedDirectBgCheckedAt = 0;

function getBodyBg() {
  if (cachedBodyBg) return cachedBodyBgClean;
  if (typeof document === 'undefined') return '#040814';
  const bodyBg = window.getComputedStyle(document.body).backgroundColor;
  cachedBodyBg = bodyBg || 'transparent';
  cachedBodyBgClean =
    bodyBg && bodyBg !== 'transparent' && bodyBg !== 'rgba(0, 0, 0, 0)' ? bodyBg : '#040814';
  return cachedBodyBgClean;
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
    stageCtx = stageCanvas.getContext('2d');
    domCacheCanvas = document.createElement('canvas');
    domCacheCtx = domCacheCanvas.getContext('2d');
  }

  if (stageCanvas.width !== bufW || stageCanvas.height !== bufH) {
    stageCanvas.width = bufW;
    stageCanvas.height = bufH;
    if (domCacheCanvas) {
      domCacheCanvas.width = bufW;
      domCacheCanvas.height = bufH;
      domCacheDirty = true;
    }
    stageDirty = true;
  }

  return true;
}

/**
 * WebGL is always active. Kept for API compatibility.
 */
export function setUseWebGL() {
  scheduleStageRedraw();
}

/**
 * Returns true if WebGL renderer is active.
 */
export function isWebGLActive() {
  return webglRenderer !== null;
}

function ensureWebGLRenderer(customDpr = 0) {
  if (typeof document === 'undefined') return false;
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
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10;
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
      console.warn('[LiquidGlass] WebGL initialization failed:', err);
      return false;
    }
  }

  return true;
}

/**
 * Captures the entire live viewport background into stageCanvas
 * so glass lenses can refract any location with zero black cutoff edges.
 */
function captureViewportStage(customDpr = 0) {
  if (!ensureStageBuffers(customDpr)) return;
  const dpr = getDevicePixelRatio(customDpr);
  const bw = stageCanvas.width;
  const bh = stageCanvas.height;
  const vw = Math.round(bw / dpr);
  const vh = Math.round(bh / dpr);

  // 1. Re-render DOM overlay cards and text when dirty
  if (domCacheDirty || !domCacheCanvas) {
    renderDomSurfacesToCache(
      domCacheCanvas,
      domCacheCtx,
      controllerRegistry,
      dpr,
      vw,
      vh,
      bw,
      bh
    );
    domCacheDirty = false;
  }

  // 2. Base page background (cached light/dark body background)
  stageCtx.fillStyle = getBodyBg();
  stageCtx.fillRect(0, 0, bw, bh);

  // 3. Copy any background 2D canvas using physical buffer pixels
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

  // 4. Composite cached DOM elements (cards, text, buttons)
  if (domCacheCanvas) {
    stageCtx.drawImage(domCacheCanvas, 0, 0);
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
      continue;
    }
    const r = ctrl.getRect ? ctrl.getRect() : ctrl.element.getBoundingClientRect();
    if (!r || r.width <= 4 || r.height <= 4) continue;
    // Keep off-screen fusion anchors in active list when fusion is enabled
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
    if (webglCanvas && webglCanvas.style.display !== 'none') {
      webglCanvas.style.display = 'none';
    }
    return;
  }

  const dpr = getDevicePixelRatio(activeDpr);
  const bufW = Math.max(1, Math.round(vw * dpr));
  const bufH = Math.max(1, Math.round(vh * dpr));

  // Disjoint-set clustering of visible elements:
  // Elements that are touching/fusing are united into a single cluster.
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
    const thresh = visible[i].ctrl.options.fusionDistance || DEFAULT_FUSION_DISTANCE;
    for (let j = i + 1; j < n; j++) {
      if (!visible[j].ctrl.options.fusion) continue;
      if (areRectsTouching(visible[i].rect, visible[j].rect, thresh)) {
        union(i, j);
      }
    }
  }

  const clusterGroups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusterGroups.has(root)) clusterGroups.set(root, []);
    clusterGroups.get(root).push(visible[i]);
  }

  const clusters = [];

  for (const group of clusterGroups.values()) {
    const isFused = group.length > 1;
    let minCssX = Infinity,
      minCssY = Infinity,
      maxCssX = -Infinity,
      maxCssY = -Infinity;

    for (let i = 0; i < group.length; i++) {
      const item = group[i];
      item.ctrl._fused = isFused;
      const r = item.rect;
      if (r.left < minCssX) minCssX = r.left;
      if (r.top < minCssY) minCssY = r.top;
      if (r.right > maxCssX) maxCssX = r.right;
      if (r.bottom > maxCssY) maxCssY = r.bottom;
    }

    // Compute bounding box expanded by refraction rim and liquid drop shadow
    let maxRim = 16;
    for (let i = 0; i < group.length; i++) {
      const rimVal = group[i].ctrl.options.rim;
      if (typeof rimVal === 'number' && rimVal > maxRim) maxRim = rimVal;
    }
    const cssPad = Math.max(maxRim + 16, 44);

    const boxCssLeft = Math.max(0, Math.floor(minCssX - cssPad));
    const boxCssTop = Math.max(0, Math.floor(minCssY - cssPad));
    const boxCssRight = Math.min(vw, Math.ceil(maxCssX + cssPad));
    const boxCssBottom = Math.min(vh, Math.ceil(maxCssY + cssPad));

    const cX = Math.max(0, Math.floor(boxCssLeft * dpr));
    const cY = Math.max(0, Math.floor(boxCssTop * dpr));
    const cRight = Math.min(bufW, Math.ceil(boxCssRight * dpr));
    const cBottom = Math.min(bufH, Math.ceil(boxCssBottom * dpr));
    const cW = Math.max(0, cRight - cX);
    const cH = Math.max(0, cBottom - cY);

    if (cW <= 0 || cH <= 0) continue;

    // WebGL Scissor box (Y=0 is bottom of canvas in WebGL)
    const scissorX = cX;
    const scissorY = Math.max(0, bufH - cBottom);
    const scissorW = cW;
    const scissorH = cH;

    // WebGL canvas is fixed inset:0 (left:0, top:0), zero synchronous layout reflow
    const elements = group.map(({ ctrl, rect }) => ({
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
      borderRadius: ctrl._getRadius(),
      shape: ctrl._getShape(),
      tint: ctrl._tint,
      fusion: ctrl.options.fusion,
      fused: isFused
    }));

    const primaryCtrl = group[group.length - 1].ctrl;

    clusters.push({
      elements,
      hasFused: isFused,
      options: primaryCtrl.options,
      scissorX,
      scissorY,
      scissorW,
      scissorH,
      boxCss: { left: boxCssLeft, top: boxCssTop, right: boxCssRight, bottom: boxCssBottom }
    });
  }

  let activeSourceCanvas = stageCanvas;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (
    !cachedDirectBgCanvas ||
    !cachedDirectBgCanvas.isConnected ||
    now - cachedDirectBgCheckedAt > 1000
  ) {
    cachedDirectBgCheckedAt = now;
    const mainEl = typeof document !== 'undefined' ? document.querySelector('main, footer') : null;
    if (!mainEl && typeof document !== 'undefined') {
      const bgCanvases = document.querySelectorAll(
        'canvas:not(.lg-lens-canvas):not(.lg-cluster-canvas):not(.lg-webgl-canvas)'
      );
      if (bgCanvases.length === 1) {
        cachedDirectBgCanvas = bgCanvases[0];
      } else {
        cachedDirectBgCanvas = null;
      }
    } else {
      cachedDirectBgCanvas = null;
    }
  }

  if (
    cachedDirectBgCanvas &&
    Math.abs(cachedDirectBgCanvas.width - bufW) <= 1 &&
    Math.abs(cachedDirectBgCanvas.height - bufH) <= 1
  ) {
    activeSourceCanvas = cachedDirectBgCanvas;
  }

  const needsCapture = stageDirty || !stageCanvas || (webglRenderer && !webglRenderer.hasSourceTex);
  if (needsCapture) {
    if (activeSourceCanvas === stageCanvas) {
      captureViewportStage(activeDpr);
    }
    stageDirty = false;
  }

  // WebGL hardware-accelerated pass with per-cluster scissor boxes
  if (ensureWebGLRenderer(activeDpr)) {
    try {
      const primaryCtrl = visible[visible.length - 1].ctrl;

      webglRenderer.render({
        sourceCanvas: activeSourceCanvas,
        clusters,
        options: {
          ...primaryCtrl.options,
          frosted: maxFrosted
        },
        dpr,
        sourceCanvasDirty: needsCapture
      });

      if (webglCanvas) {
        if (webglCanvas.style.display !== 'block') {
          webglCanvas.style.display = 'block';
        }
        let maxZ = 20;
        for (let i = 0; i < visible.length; i++) {
          const z = visible[i].ctrl._cachedZIndex || 20;
          if (z > maxZ) maxZ = z;
        }
        const targetZ = Math.max(1, maxZ - 1);
        const targetZStr = String(targetZ);
        if (webglCanvas.style.zIndex !== targetZStr) {
          webglCanvas.style.zIndex = targetZStr;
        }
      }
      return;
    } catch (e) {
      console.warn('[LiquidGlass] WebGL render error:', e);
    }
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

  // Immediate full preload of background stage on start and after assets load
  stageDirty = true;
  domCacheDirty = true;
  scheduleStageRedraw(true);

  if (document.readyState !== 'complete') {
    const onFullLoad = () => {
      cachedBodyBg = '';
      domCacheDirty = true;
      stageDirty = true;
      scheduleStageRedraw(true);
    };
    window.addEventListener('DOMContentLoaded', onFullLoad, { once: true });
    window.addEventListener('load', onFullLoad, { once: true });
  }

  let scrollRestTimer = null;
  const onScroll = () => {
    domCacheDirty = true;
    stageDirty = true;
    scheduleStageRedraw(true);

    if (scrollRestTimer) clearTimeout(scrollRestTimer);
    scrollRestTimer = setTimeout(() => {
      domCacheDirty = true;
      stageDirty = true;
      scheduleStageRedraw(true);
    }, 120);
  };

  const onResize = () => {
    cachedBodyBg = '';
    domCacheDirty = true;
    stageDirty = true;
    scheduleStageRedraw(true);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  // Ambient continuous tick for live background canvases (e.g. ShulhinManifoldBackground)
  // Ensures living particles in the header keep floating smoothly at the top of the page without freezing!
  let lastAmbientTime = 0;
  const ambientTick = (timestamp) => {
    if (controllerRegistry.size > 0 && hasLiveBackgroundCanvas()) {
      if (timestamp - lastAmbientTime >= 33) {
        lastAmbientTime = timestamp;
        stageDirty = true;
        scheduleStageRedraw(true);
      }
    }
    window.requestAnimationFrame(ambientTick);
  };
  window.requestAnimationFrame(ambientTick);
}
