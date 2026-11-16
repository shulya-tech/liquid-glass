/**
 * Stage Compositor & Island Cluster Manager
 * Hardware-accelerated Screen-Space WebGL only.
 * Restricts GPU rendering strictly to active and fused element cluster regions.
 */

import { DEFAULT_FUSION_DISTANCE } from './options.js';
import {
  getDevicePixelRatio,
  hasLiveBackgroundCanvas,
  areRectsTouching,
  getRectDistance
} from './dom.js';
import { renderDomSurfacesToCache } from './dom-cache.js';
import { renderIsolatedController } from '../canvas2d/isolated.js';
import { WebGLGlassRenderer } from '../webgl/renderer.js';
import { DEFAULT_SHADOW } from './controller.js';

export const controllerRegistry = new Set();

let stageCanvas = null;
let stageCtx = null;
let blurCanvas = null;
let blurCtx = null;
let lastFrostedRadius = -1;
let domCacheCanvas = null;
let domCacheCtx = null;
let domCacheDirty = true;
let webglCanvas = null;
let webglRenderer = null;
let activeClusterTier = 0;
let activeFusedPairs = new Set();
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
  const vw = window.innerWidth || (docEl ? docEl.clientWidth : 1024);
  const vh = window.innerHeight || (docEl ? docEl.clientHeight : 768);
  const bufW = Math.max(1, Math.round(vw * dpr));
  const bufH = Math.max(1, Math.round(vh * dpr));

  if (!stageCanvas) {
    stageCanvas = document.createElement('canvas');
    stageCtx = stageCanvas.getContext('2d', { willReadFrequently: true });
    domCacheCanvas = document.createElement('canvas');
    domCacheCtx = domCacheCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (stageCanvas.width !== bufW || stageCanvas.height !== bufH) {
    stageCanvas.width = bufW;
    stageCanvas.height = bufH;
    if (domCacheCanvas) {
      domCacheCanvas.width = bufW;
      domCacheCanvas.height = bufH;
      domCacheDirty = true;
    }
    if (blurCanvas) {
      blurCanvas.width = bufW;
      blurCanvas.height = bufH;
      lastFrostedRadius = -1;
    }
    stageDirty = true;
  }

  // Pre-warm WebGL renderer immediately on stage initialization (eliminates first-touch prolag!)
  ensureWebGLRenderer(bufW, bufH);

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

/**
 * Tier selection with hysteresis: prevents constant GPU buffer recreation on drag.
 * 512 covers up to 450px; 1024 covers 280–920px; 2048 covers above 720px.
 */
function getTierSizeWithHysteresis(currentTier, maxDim) {
  if (currentTier === 0) {
    if (maxDim <= 450) return 512;
    if (maxDim <= 920) return 1024;
    return 2048;
  }
  if (currentTier === 512) {
    if (maxDim > 450) return 1024;
    return 512;
  }
  if (currentTier === 1024) {
    if (maxDim > 920) return 2048;
    if (maxDim < 280) return 512;
    return 1024;
  }
  if (currentTier === 2048) {
    if (maxDim < 720) return 1024;
    return 2048;
  }
  return 1024;
}

function ensureWebGLRenderer(bufW = 1024, bufH = 1024) {
  if (typeof document === 'undefined') return false;

  const docEl = document.documentElement;
  const vw = window.innerWidth || (docEl ? docEl.clientWidth : 1024);
  const vh = window.innerHeight || (docEl ? docEl.clientHeight : 768);
  const sysDpr = window.devicePixelRatio || 1;
  const w = bufW || Math.max(1, Math.round(vw * sysDpr));
  const h = bufH || Math.max(1, Math.round(vh * sysDpr));

  if (!webglCanvas) {
    const canvas = document.createElement('canvas');
    canvas.className = 'lg-cluster-webgl-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = `
      position: fixed;
      left: 0;
      top: 0;
      width: ${vw}px;
      height: ${vh}px;
      pointer-events: none;
      display: block;
      visibility: hidden;
      z-index: 20;
    `;
    canvas.width = w;
    canvas.height = h;
    document.body.appendChild(canvas);
    webglCanvas = canvas;
  }

  if (webglCanvas.width !== w || webglCanvas.height !== h) {
    webglCanvas.width = w;
    webglCanvas.height = h;
  }
  const cssW = `${vw}px`;
  const cssH = `${vh}px`;
  if (webglCanvas.style.width !== cssW) {
    webglCanvas.style.width = cssW;
  }
  if (webglCanvas.style.height !== cssH) {
    webglCanvas.style.height = cssH;
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

  // 3. Copy any genuine user/page background canvas using physical buffer pixels (exclude all LiquidGlass canvases)
  const allCanvases = document.querySelectorAll('canvas');
  for (let i = 0; i < allCanvases.length; i++) {
    const c = allCanvases[i];
    if (
      c === stageCanvas ||
      c === blurCanvas ||
      c === domCacheCanvas ||
      c === webglCanvas ||
      (c.className && String(c.className).includes('lg-')) ||
      c.getAttribute('data-lg-ignore') === 'true'
    ) {
      continue;
    }
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
    // Keep off-screen fusion anchors in active list when fusion distance is configured
    const margin = (ctrl.options.fusionDistance ?? DEFAULT_FUSION_DISTANCE) > 0 ? DEFAULT_FUSION_DISTANCE : 0;
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
    if (webglCanvas && webglCanvas.style.visibility !== 'hidden') {
      webglCanvas.style.visibility = 'hidden';
    }
    return;
  }

  const dpr = getDevicePixelRatio(activeDpr);
  const bufW = Math.max(1, Math.round(vw * dpr));
  const bufH = Math.max(1, Math.round(vh * dpr));

  // Disjoint-set clustering of visible elements:
  // Elements that are touching/fusing are united into a single cluster ONLY if they share the exact same z-index!
  const nextFusedPairs = new Set();
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
    const zI = visible[i].ctrl._cachedZIndex || 20;
    const threshI = visible[i].ctrl.options.fusionDistance ?? DEFAULT_FUSION_DISTANCE;
    if (threshI <= 0) continue;
    for (let j = i + 1; j < n; j++) {
      const zJ = visible[j].ctrl._cachedZIndex || 20;
      // STRICT: only elements with the exact same z-index can coalesce/fuse!
      if (zI !== zJ) continue;

      const threshJ = visible[j].ctrl.options.fusionDistance ?? DEFAULT_FUSION_DISTANCE;
      if (threshJ <= 0) continue;
      const baseThresh = Math.max(threshI, threshJ);
      const idA = visible[i].ctrl._id || (i + 1);
      const idB = visible[j].ctrl._id || (j + 1);
      const pairKey = idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;

      const wasFused = activeFusedPairs.has(pairKey);
      // Hysteresis corridor (+16px): prevents rapid flipping/flickering at the threshold boundary
      const exitThresh = baseThresh + 16;
      const currentThresh = wasFused ? exitThresh : baseThresh;

      const dist = getRectDistance(visible[i].rect, visible[j].rect);
      if (dist < currentThresh) {
        nextFusedPairs.add(pairKey);
        union(i, j);
      }
    }
  }

  activeFusedPairs = nextFusedPairs;

  const clusterGroups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusterGroups.has(root)) clusterGroups.set(root, []);
    clusterGroups.get(root).push(visible[i]);
  }

  const isolated = [];
  const fusedGroups = [];

  for (const group of clusterGroups.values()) {
    if (group.length === 1) {
      isolated.push(group[0]);
    } else {
      fusedGroups.push(group);
    }
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
        'canvas:not(.lg-lens-canvas):not(.lg-cluster-canvas):not(.lg-cluster-webgl-canvas):not(.lg-webgl-canvas)'
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

  ensureStageBuffers(activeDpr);

  const needsCapture = stageDirty || !stageCanvas || !stageCtx || (webglRenderer && !webglRenderer.hasSourceTex);
  if (needsCapture) {
    captureViewportStage(activeDpr);
    stageDirty = false;
  }

  // 1. Ensure all elements have DOM CSS box-shadow disabled and clear 2D canvases
  for (let i = 0; i < n; i++) {
    const item = visible[i];
    item.ctrl._fused = true;
    if (item.ctrl._canvas && item.ctrl._canvas.style.visibility !== 'hidden') {
      item.ctrl._canvas.style.visibility = 'hidden';
    }
    if (item.ctrl._ctx && item.ctrl._canvas) {
      item.ctrl._ctx.clearRect(0, 0, item.ctrl._canvas.width, item.ctrl._canvas.height);
    }
    if (item.ctrl.element && item.ctrl.element.style.boxShadow !== 'none') {
      item.ctrl.element.style.boxShadow = 'none';
    }
  }

  // 2. 100% Unified WebGL SDF Rendering for all elements and fused clusters
  if (!ensureWebGLRenderer(bufW, bufH)) {
    // Fallback to 2D canvas if WebGL context creation failed
    for (let i = 0; i < isolated.length; i++) {
      const { ctrl, rect } = isolated[i];
      if (ctrl._canvas) ctrl._canvas.style.visibility = 'visible';
      renderIsolatedController(ctrl, rect, { stageCtx, blurCtx: stageCtx });
    }
    return;
  }

  if (webglCanvas.style.visibility !== 'visible') {
    webglCanvas.style.visibility = 'visible';
  }

  const clusters = [];
  let primaryOptions = visible[0].ctrl.options;

  for (const group of clusterGroups.values()) {
    let minCssX = Infinity,
      minCssY = Infinity,
      maxCssX = -Infinity,
      maxCssY = -Infinity;
    let maxRim = 16;

    for (let i = 0; i < group.length; i++) {
      const item = group[i];
      const r = item.rect;
      if (r.left < minCssX) minCssX = r.left;
      if (r.top < minCssY) minCssY = r.top;
      if (r.right > maxCssX) maxCssX = r.right;
      if (r.bottom > maxCssY) maxCssY = r.bottom;
      const rimVal = item.ctrl.options.rim;
      if (typeof rimVal === 'number' && rimVal > maxRim) maxRim = rimVal;
    }

    let easedFusionSpan = 0;
    if (group.length > 1) {
      let groupMinDist = Infinity;
      let groupThresh = DEFAULT_FUSION_DISTANCE;
      for (let gi = 0; gi < group.length; gi++) {
        const tI = group[gi].ctrl.options.fusionDistance || DEFAULT_FUSION_DISTANCE;
        for (let gj = gi + 1; gj < group.length; gj++) {
          const d = getRectDistance(group[gi].rect, group[gj].rect);
          if (d < groupMinDist) {
            groupMinDist = d;
            groupThresh = Math.max(tI, group[gj].ctrl.options.fusionDistance || DEFAULT_FUSION_DISTANCE);
          }
        }
      }

      const effectiveThresh = groupThresh;
      const clampedDist = Math.max(0, Math.min(groupMinDist, effectiveThresh));
      const tRamp = 1.0 - clampedDist / effectiveThresh;
      const bridgeRamp = tRamp * tRamp * (3.0 - 2.0 * tRamp);
      easedFusionSpan = Math.round(groupThresh * bridgeRamp);
    }

    const cssPad = Math.max(maxRim + 16, 52);
    const scissorX = Math.max(0, Math.floor((minCssX - cssPad) * dpr));
    const scissorY = Math.max(0, Math.floor(bufH - (maxCssY + cssPad) * dpr));
    const scissorW = Math.min(bufW - scissorX, Math.ceil((maxCssX - minCssX + 2 * cssPad) * dpr));
    const scissorH = Math.min(bufH - scissorY, Math.ceil((maxCssY - minCssY + 2 * cssPad) * dpr));

    const elements = group.map(({ ctrl, rect }) => ({
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
      borderRadius: ctrl._getRadius(),
      shape: ctrl._getShape(),
      tint: ctrl._tint,
      fused: group.length > 1
    }));

    const primaryCtrl = group[group.length - 1].ctrl;
    primaryOptions = primaryCtrl.options;

    clusters.push({
      elements,
      hasFused: group.length > 1,
      options: {
        ...primaryCtrl.options,
        fusionDistance: easedFusionSpan
      },
      areaOriginX: 0,
      areaOriginY: 0,
      scissorX,
      scissorY,
      scissorW,
      scissorH
    });
  }

  webglRenderer.render({
    sourceCanvas: stageCanvas,
    clusters,
    options: {
      ...primaryOptions,
      frosted: maxFrosted
    },
    dpr,
    sourceCanvasDirty: needsCapture
  });
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
    for (const ctrl of controllerRegistry) ctrl.invalidateRect();
    domCacheDirty = true;
    stageDirty = true;
    scheduleStageRedraw(true);

    if (scrollRestTimer) clearTimeout(scrollRestTimer);
    scrollRestTimer = setTimeout(() => {
      for (const ctrl of controllerRegistry) ctrl.invalidateRect();
      domCacheDirty = true;
      stageDirty = true;
      scheduleStageRedraw(true);
    }, 120);
  };

  const onResize = () => {
    for (const ctrl of controllerRegistry) ctrl.invalidateRect();
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
