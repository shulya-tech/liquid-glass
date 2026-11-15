/**
 * Stage Compositor & Island Cluster Manager
 * Hardware-accelerated Screen-Space WebGL only.
 * Restricts GPU rendering strictly to active and fused element cluster regions.
 */

const { DEFAULT_FUSION_DISTANCE } = require('./options.cjs');
const { getDevicePixelRatio,
  hasLiveBackgroundCanvas,
  areRectsTouching } = require('./dom.cjs');
const { renderDomSurfacesToCache } = require('./dom-cache.cjs');
const { renderIsolatedController } = require('../canvas2d/isolated.cjs');
const { WebGLGlassRenderer } = require('../webgl/renderer.cjs');

const controllerRegistry = exports.controllerRegistry = new Set();

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
    if (blurCanvas) {
      blurCanvas.width = bufW;
      blurCanvas.height = bufH;
      lastFrostedRadius = -1;
    }
    stageDirty = true;
  }

  return true;
}

/**
 * WebGL is always active. Kept for API compatibility.
 */
exports.setUseWebGL = function setUseWebGL() {
  scheduleStageRedraw();
}

/**
 * Returns true if WebGL renderer is active.
 */
exports.isWebGLActive = function isWebGLActive() {
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

function ensureWebGLRenderer(targetTier = 1024) {
  if (typeof document === 'undefined') return false;

  if (!webglCanvas) {
    const canvas = document.createElement('canvas');
    canvas.className = 'lg-cluster-webgl-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = `
      position: fixed;
      left: 0;
      top: 0;
      pointer-events: none;
      display: none;
      will-change: transform;
    `;
    canvas.width = targetTier;
    canvas.height = targetTier;
    document.body.appendChild(canvas);
    webglCanvas = canvas;
  }

  if (webglCanvas.width !== targetTier || webglCanvas.height !== targetTier) {
    webglCanvas.width = targetTier;
    webglCanvas.height = targetTier;
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
  // Elements that are touching/fusing are united into a single cluster ONLY if they share the exact same z-index!
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
    const zI = visible[i].ctrl._cachedZIndex || 20;
    const threshI = visible[i].ctrl.options.fusionDistance || DEFAULT_FUSION_DISTANCE;
    for (let j = i + 1; j < n; j++) {
      if (!visible[j].ctrl.options.fusion) continue;
      const zJ = visible[j].ctrl._cachedZIndex || 20;
      // STRICT: only elements with the exact same z-index can coalesce/fuse!
      if (zI !== zJ) continue;

      const thresh = Math.max(threshI, visible[j].ctrl.options.fusionDistance || DEFAULT_FUSION_DISTANCE);
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

  // 1. Render isolated lenses directly into their own internal <canvas class="lg-lens-canvas">
  let blurSourceCtx = stageCtx;
  if (maxFrosted > 0 && stageCanvas) {
    if (!blurCanvas) {
      blurCanvas = document.createElement('canvas');
      blurCtx = blurCanvas.getContext('2d');
    }
    if (blurCanvas.width !== bufW || blurCanvas.height !== bufH) {
      blurCanvas.width = bufW;
      blurCanvas.height = bufH;
      lastFrostedRadius = -1;
    }
    const blurRadius = Math.round(maxFrosted * dpr);
    if (blurRadius !== lastFrostedRadius || needsCapture) {
      lastFrostedRadius = blurRadius;
      blurCtx.filter = `blur(${blurRadius}px)`;
      blurCtx.drawImage(stageCanvas, 0, 0);
      blurCtx.filter = 'none';
    }
    blurSourceCtx = blurCtx;
  }

  for (let i = 0; i < isolated.length; i++) {
    const { ctrl, rect } = isolated[i];
    ctrl._fused = false;
    if (ctrl._canvas && ctrl._canvas.style.opacity !== '1') {
      ctrl._canvas.style.opacity = '1';
    }
    renderIsolatedController(ctrl, rect, {
      stageCtx,
      blurCtx: blurSourceCtx
    });
  }

  // 2. Render fused clusters using the shared WebGL cluster canvas (Dynamic Bounding Box + Fixed GPU Texture)
  if (fusedGroups.length === 0) {
    if (webglCanvas && webglCanvas.style.display !== 'none') {
      webglCanvas.style.display = 'none';
    }
    return;
  }

  for (const group of fusedGroups) {
    for (let i = 0; i < group.length; i++) {
      const item = group[i];
      item.ctrl._fused = true;
      if (item.ctrl._canvas && item.ctrl._canvas.style.opacity !== '0') {
        item.ctrl._canvas.style.opacity = '0';
      }
    }

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

    const cssPad = Math.max(maxRim + 16, 44);
    const boxCssLeft = Math.max(0, Math.floor(minCssX - cssPad));
    const boxCssTop = Math.max(0, Math.floor(minCssY - cssPad));
    const boxCssRight = Math.min(vw, Math.ceil(maxCssX + cssPad));
    const boxCssBottom = Math.min(vh, Math.ceil(maxCssY + cssPad));
    const boxCssWidth = Math.max(1, boxCssRight - boxCssLeft);
    const boxCssHeight = Math.max(1, boxCssBottom - boxCssTop);

    const clusterW = Math.round(boxCssWidth * dpr);
    const clusterH = Math.round(boxCssHeight * dpr);
    const maxDim = Math.max(clusterW, clusterH);

    const targetTier = getTierSizeWithHysteresis(activeClusterTier, maxDim);
    activeClusterTier = targetTier;

    if (ensureWebGLRenderer(targetTier)) {
      if (webglCanvas.style.display !== 'block') {
        webglCanvas.style.display = 'block';
      }
      const tierCssW = `${targetTier / dpr}px`;
      const tierCssH = `${targetTier / dpr}px`;
      if (webglCanvas.style.width !== tierCssW) webglCanvas.style.width = tierCssW;
      if (webglCanvas.style.height !== tierCssH) webglCanvas.style.height = tierCssH;
      webglCanvas.style.transform = `translate3d(${boxCssLeft}px, ${boxCssTop}px, 0)`;

      const clusterZ = String(group[0].ctrl._cachedZIndex || 20);
      if (webglCanvas.style.zIndex !== clusterZ) {
        webglCanvas.style.zIndex = clusterZ;
      }

      const scissorX = 0;
      const scissorY = Math.max(0, targetTier - clusterH);
      const scissorW = Math.min(targetTier, clusterW);
      const scissorH = Math.min(targetTier, clusterH);

      const elements = group.map(({ ctrl, rect }) => ({
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        borderRadius: ctrl._getRadius(),
        shape: ctrl._getShape(),
        tint: ctrl._tint,
        fusion: ctrl.options.fusion,
        fused: true
      }));

      const primaryCtrl = group[group.length - 1].ctrl;

      webglRenderer.render({
        sourceCanvas: activeSourceCanvas,
        clusters: [
          {
            elements,
            hasFused: true,
            options: primaryCtrl.options,
            areaOriginX: Math.round(boxCssLeft * dpr),
            areaOriginY: Math.round(boxCssTop * dpr),
            scissorX,
            scissorY,
            scissorW,
            scissorH
          }
        ],
        options: {
          ...primaryCtrl.options,
          frosted: maxFrosted
        },
        dpr,
        sourceCanvasDirty: needsCapture
      });
    }
  }
}

exports.scheduleStageRedraw = function scheduleStageRedraw(dirty = false) {
  if (dirty) stageDirty = true;
  if (typeof window === 'undefined') return;
  if (rafScheduled) return;
  rafScheduled = true;
  rafId = window.requestAnimationFrame(renderAllActiveLenses);
}

exports.redrawStageNow = function redrawStageNow(dirty = false) {
  if (dirty) stageDirty = true;
  if (typeof window === 'undefined') return;
  if (rafScheduled) {
    window.cancelAnimationFrame(rafId);
    rafScheduled = false;
  }
  renderAllActiveLenses();
}

exports.attachGlobalStageListeners = function attachGlobalStageListeners() {
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
