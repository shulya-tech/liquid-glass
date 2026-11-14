/**
 * Core Empirical Surface Engine (Pure 2D Canvas + TypedArray LUT & Cluster Fusion)
 * Zero WebGL / Zero SVG / Zero PNG — Direct ImageData Optical Compositor
 */

const { _T0, _T1, _T2, _T3, _T4 } = require('./tables.cjs');

/**
 * Default parameter values and strict min/max clamping bounds
 */
const OPTICAL_DEFAULTS = exports.OPTICAL_DEFAULTS = Object.freeze({
  rim: 16,
  ior: 1.46,
  height: 18,
  frosted: 0,
  fusion: true
});

const OPTICAL_LIMITS = exports.OPTICAL_LIMITS = Object.freeze({
  rim: Object.freeze({ min: 4, max: 48 }),
  ior: Object.freeze({ min: 1.05, max: 2.20 }),
  height: Object.freeze({ min: 2, max: 50 }),
  frosted: Object.freeze({ min: 0, max: 32 })
});

function clampNumber(val, fallback, min, max) {
  const num = typeof val === 'number' && !Number.isNaN(val) ? val : fallback;
  return Math.max(min, Math.min(max, num));
}

/**
 * Sanitizes and clamps optical configuration parameters to valid physical bounds
 */
exports.normalizeOptions = function normalizeOptions(options = {}) {
  return {
    rim: clampNumber(
      options.rim,
      OPTICAL_DEFAULTS.rim,
      OPTICAL_LIMITS.rim.min,
      OPTICAL_LIMITS.rim.max
    ),
    ior: clampNumber(
      options.ior,
      OPTICAL_DEFAULTS.ior,
      OPTICAL_LIMITS.ior.min,
      OPTICAL_LIMITS.ior.max
    ),
    height: clampNumber(
      options.height,
      OPTICAL_DEFAULTS.height,
      OPTICAL_LIMITS.height.min,
      OPTICAL_LIMITS.height.max
    ),
    frosted: clampNumber(
      options.frosted,
      OPTICAL_DEFAULTS.frosted,
      OPTICAL_LIMITS.frosted.min,
      OPTICAL_LIMITS.frosted.max
    ),
    fusion: options.fusion !== undefined ? Boolean(options.fusion) : OPTICAL_DEFAULTS.fusion
  };
}

/**
 * Fast linear interpolation from a 256-entry precomputed Float32Array table
 * @param {Float32Array} table - 256-entry empirical LUT
 * @param {number} u - normalized coordinate in [0, 1]
 * @returns {number}
 */
exports.sampleTable = function sampleTable(table, u) {
  if (u <= 0) return table[0];
  if (u >= 1) return table[255];
  const pos = u * 255.0;
  const idx = pos | 0;
  if (idx >= 255) return table[255];
  const frac = pos - idx;
  return table[idx] + (table[idx + 1] - table[idx]) * frac;
}

/**
 * Empirical boundary distance for a rounded rectangle
 */
exports.evalRoundedRect = function evalRoundedRect(px, py, halfW, halfH, rad) {
  const r = Math.min(rad, halfW, halfH);
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  return (
    Math.min(Math.max(qx, qy), 0.0) +
    Math.hypot(Math.max(qx, 0.0), Math.max(qy, 0.0)) -
    r
  );
}

/**
 * Empirical boundary distance for a circle
 */
exports.evalCircle = function evalCircle(px, py, r) {
  return Math.hypot(px, py) - r;
}

/**
 * Tabular surface coalescence using precomputed _T3 empirical bridge weights
 */
exports.blendSurfaces = function blendSurfaces(d1, d2, span) {
  if (span <= 0.001) return Math.min(d1, d2);
  const diff = Math.abs(d1 - d2);
  if (diff >= span) return Math.min(d1, d2);
  const weight = sampleTable(_T3, diff / span);
  return Math.min(d1, d2) - weight * span;
}

/**
 * Precomputes the static per-pixel TypedArray LUT for an isolated lens element
 */
exports.buildElementLUT = function buildElementLUT(w, h, rad, rawOptions = {}, dpr = 1) {
  const options = normalizeOptions(rawOptions);
  const total = w * h;
  const offsets = new Int16Array(total * 2);
  const dispMap = new Float32Array(total);
  const glints = new Uint8Array(total);
  const alphas = new Uint8Array(total);
  const topSheen = new Uint8Array(total);
  const rimList = [];

  const halfW = w * 0.5;
  const halfH = h * 0.5;
  const rimPx = Math.max(1, options.rim * dpr);
  const ior = options.ior;
  const heightPx = options.height * dpr;
  const rPx = Math.min(rad * dpr, halfW, halfH);

  const innerSafeX = Math.max(0, halfW - rPx - rimPx - 2);
  const innerSafeY = Math.max(0, halfH - rPx - rimPx - 2);

  for (let y = 0; y < h; y++) {
    const py = y - halfH;
    const isSafeY = Math.abs(py) < innerSafeY;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const px = x - halfW;
      const idx = row + x;

      if (isSafeY && Math.abs(px) < innerSafeX) {
        alphas[idx] = 255;
        continue;
      }

      const d = evalRoundedRect(px, py, halfW, halfH, rPx);
      if (d > 1.0) continue;

      const alpha = Math.max(0, Math.min(1, 0.5 - d));
      alphas[idx] = Math.round(alpha * 255);

      if (d < 0) {
        const innerDist = -d;
        if (innerDist < rimPx) {
          const u = innerDist / rimPx;
          const gain = sampleTable(_T0, u);
          dispMap[idx] = sampleTable(_T4, u);

          const dx =
            evalRoundedRect(px + 1, py, halfW, halfH, rPx) -
            evalRoundedRect(px - 1, py, halfW, halfH, rPx);
          const dy =
            evalRoundedRect(px, py + 1, halfW, halfH, rPx) -
            evalRoundedRect(px, py - 1, halfW, halfH, rPx);
          const len = Math.hypot(dx, dy) + 1e-6;
          const gx = dx / len;
          const gy = dy / len;

          const shift = gain * (ior - 1.0) * heightPx;
          offsets[idx * 2] = Math.round(-gx * shift);
          offsets[idx * 2 + 1] = Math.round(-gy * shift);

          if (gy < -0.2) {
            topSheen[idx] = Math.round(sampleTable(_T2, u) * (-gy));
          }
          rimList.push(idx);
        }
      } else {
        rimList.push(idx);
      }

      const absD = Math.abs(d);
      if (absD < 3.0) {
        glints[idx] = Math.round(sampleTable(_T1, absD * 0.33));
      }
    }
  }

  return {
    w,
    h,
    rad: rPx,
    offsets,
    dispMap,
    glints,
    alphas,
    topSheen,
    rimIndices: new Uint32Array(rimList)
  };
}

/**
 * Legacy helper kept for API compatibility (no SVG or PNG used by controller)
 */
exports.buildOpticalMapURI = function buildOpticalMapURI(width, height, borderRadius, rawOptions = {}) {
  const lut = buildElementLUT(
    Math.max(16, Math.round(width)),
    Math.max(16, Math.round(height)),
    borderRadius,
    rawOptions,
    1
  );
  return { lut, scale: 1 };
}

/**
 * Renders a cluster of touching LiquidGlass elements onto a 2D canvas context
 * using precomputed empirical tables (_T0.._T4) and O(1) distGrid gradients.
 */
exports.renderFusedCluster = function renderFusedCluster(ctx, sourceCtx, elements, rawOptions = {}, dpr = 1) {
  const options = normalizeOptions(rawOptions);
  const fusionSpan = options.fusion ? (rawOptions.fusionDistance ?? 44) * dpr : 0;
  const rimPx = Math.max(1, options.rim * dpr);
  const ior = options.ior;
  const heightPx = options.height * dpr;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const el of elements) {
    minX = Math.min(minX, (el.x - 16) * dpr);
    minY = Math.min(minY, (el.y - 16) * dpr);
    maxX = Math.max(maxX, (el.x + el.w + 16) * dpr);
    maxY = Math.max(maxY, (el.y + el.h + 16) * dpr);
  }

  const cMinX = Math.max(0, Math.floor(minX));
  const cMinY = Math.max(0, Math.floor(minY));
  const cMaxX = Math.min(sourceCtx.canvas.width, Math.ceil(maxX));
  const cMaxY = Math.min(sourceCtx.canvas.height, Math.ceil(maxY));

  const boxW = cMaxX - cMinX;
  const boxH = cMaxY - cMinY;
  if (boxW <= 2 || boxH <= 2) return;

  const srcImg = sourceCtx.getImageData(cMinX, cMinY, boxW, boxH);
  const srcData = srcImg.data;

  if (ctx.canvas.width !== boxW || ctx.canvas.height !== boxH) {
    ctx.canvas.width = boxW;
    ctx.canvas.height = boxH;
  }

  const dstImg = ctx.createImageData(boxW, boxH);
  const dstData = dstImg.data;

  const distGrid = new Float32Array(boxW * boxH);
  const prep = elements.map((b) => ({
    cx: (b.x + b.w * 0.5) * dpr,
    cy: (b.y + b.h * 0.5) * dpr,
    halfW: b.w * 0.5 * dpr,
    halfH: b.h * 0.5 * dpr,
    r: Math.min((b.borderRadius ?? 0) * dpr, b.w * 0.5 * dpr, b.h * 0.5 * dpr),
    isCircle: b.shape === 'circle',
    fusion: b.fusion !== undefined ? Boolean(b.fusion) : options.fusion,
    tintR: b.tint ? b.tint[0] : 15,
    tintG: b.tint ? b.tint[1] : 23,
    tintB: b.tint ? b.tint[2] : 42,
    tintA: b.tint ? b.tint[3] : 0.35
  }));

  const primary = prep[0];
  const tR = primary.tintR;
  const tG = primary.tintG;
  const tB = primary.tintB;
  const tA = primary.tintA;
  const invTA = 1.0 - tA;

  // Pass 1: Boundary evaluation across cluster bounding box
  for (let y = 0; y < boxH; y++) {
    const py = cMinY + y;
    const row = y * boxW;
    for (let x = 0; x < boxW; x++) {
      const px = cMinX + x;
      let dCluster = Infinity;
      for (let i = 0; i < prep.length; i++) {
        const b = prep[i];
        const dShape = b.isCircle
          ? evalCircle(px - b.cx, py - b.cy, b.halfW)
          : evalRoundedRect(px - b.cx, py - b.cy, b.halfW, b.halfH, b.r);
        if (i === 0) {
          dCluster = dShape;
        } else if (b.fusion && fusionSpan > 0) {
          dCluster = blendSurfaces(dCluster, dShape, fusionSpan);
        } else {
          dCluster = Math.min(dCluster, dShape);
        }
      }
      distGrid[row + x] = dCluster;
    }
  }

  // Pass 2: O(1) lookup from distGrid + tabular chromatic shift (_T4)
  for (let y = 1; y < boxH - 1; y++) {
    const row = y * boxW;
    for (let x = 1; x < boxW - 1; x++) {
      const idx = row + x;
      const d = distGrid[idx];
      if (d > 1.0) continue;

      const edgeAlpha = Math.max(0, Math.min(1, 0.5 - d));
      if (edgeAlpha <= 0) continue;

      let offX = 0,
        offY = 0,
        glint = 0,
        sheen = 0,
        disp = 0;

      if (d < 0) {
        const innerDist = -d;
        if (innerDist < rimPx) {
          const u = innerDist / rimPx;
          const gain = sampleTable(_T0, u);
          disp = sampleTable(_T4, u);

          const dx = distGrid[row + x + 1] - distGrid[row + x - 1];
          const dy = distGrid[(y + 1) * boxW + x] - distGrid[(y - 1) * boxW + x];
          const len = Math.hypot(dx, dy) + 1e-6;
          const gx = dx / len;
          const gy = dy / len;

          const shift = gain * (ior - 1.0) * heightPx;
          offX = Math.round(-gx * shift);
          offY = Math.round(-gy * shift);

          if (gy < -0.2) {
            sheen = Math.round(sampleTable(_T2, u) * (-gy) * 0.78);
          }
        } else {
          // Fast interior path: zero displacement inside flat region (-d >= rimPx)
          const sIdx = idx * 4;
          dstData[sIdx] = Math.min(255, Math.round(srcData[sIdx] * invTA + tR * tA));
          dstData[sIdx + 1] = Math.min(255, Math.round(srcData[sIdx + 1] * invTA + tG * tA));
          dstData[sIdx + 2] = Math.min(255, Math.round(srcData[sIdx + 2] * invTA + tB * tA));
          dstData[sIdx + 3] = 255;
          continue;
        }
      }

      const absD = Math.abs(d);
      if (absD < 3.0) {
        glint = Math.round(sampleTable(_T1, absD * 0.33) * 0.65);
      }

      const sxG = Math.max(0, Math.min(boxW - 1, x + offX));
      const syG = Math.max(0, Math.min(boxH - 1, y + offY));
      const sxR = Math.max(0, Math.min(boxW - 1, x + Math.round(offX * (1.0 + disp))));
      const syR = Math.max(0, Math.min(boxH - 1, y + Math.round(offY * (1.0 + disp))));
      const sxB = Math.max(0, Math.min(boxW - 1, x + Math.round(offX * (1.0 - disp))));
      const syB = Math.max(0, Math.min(boxH - 1, y + Math.round(offY * (1.0 - disp))));

      const rBg = srcData[(syR * boxW + sxR) * 4];
      const gBg = srcData[(syG * boxW + sxG) * 4 + 1];
      const bBg = srcData[(syB * boxW + sxB) * 4 + 2];

      const totalLum = sheen + glint;
      const pIdx = idx * 4;
      if (tA < 0.15) {
        dstData[pIdx] = Math.min(255, Math.round(rBg * invTA + tR * tA + totalLum));
        dstData[pIdx + 1] = Math.min(255, Math.round(gBg * invTA + tG * tA + totalLum));
        dstData[pIdx + 2] = Math.min(255, Math.round(bBg * invTA + tB * tA + totalLum));
      } else {
        dstData[pIdx] = Math.min(255, Math.round(rBg * invTA + tR * tA + totalLum * 0.72));
        dstData[pIdx + 1] = Math.min(255, Math.round(gBg * invTA + tG * tA + totalLum * 0.88));
        dstData[pIdx + 2] = Math.min(255, Math.round(bBg * invTA + tB * tA + totalLum));
      }
      dstData[pIdx + 3] = Math.round(edgeAlpha * 255);
    }
  }

  ctx.putImageData(dstImg, 0, 0);
  return { cMinX, cMinY, boxW, boxH };
}

// ============================================================================
// STAGE COMPOSITOR & ISLAND CLUSTER MANAGER (100% Pure 2D Canvas, 0 SVG, 0 PNG)
// ============================================================================

const controllerRegistry = new Set();
let stageCanvas = null;
let stageCtx = null;
let blurCanvas = null;
let blurCtx = null;
let clusterOverlayCanvas = null;
let clusterOverlayCtx = null;
let rafScheduled = false;
let rafId = 0;
let listenersAttached = false;
let lastFrostedRadius = -1;

function parseCssRgba(str) {
  if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') {
    return [38, 66, 138, 0.52];
  }
  const m = str.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
  if (m) {
    return [
      parseFloat(m[1]) || 0,
      parseFloat(m[2]) || 0,
      parseFloat(m[3]) || 0,
      m[4] !== undefined ? parseFloat(m[4]) : 1.0
    ];
  }
  return [38, 66, 138, 0.52];
}

function getReadableFillColor(bgCol, fallback = 'rgba(30, 41, 59, 0.72)') {
  if (!bgCol || bgCol === 'transparent' || bgCol === 'rgba(0, 0, 0, 0)') {
    return fallback;
  }
  if (bgCol.startsWith('rgb')) {
    const m = bgCol.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
    if (m) {
      const r = Math.min(255, Math.round(parseFloat(m[1]) + 18));
      const g = Math.min(255, Math.round(parseFloat(m[2]) + 24));
      const b = Math.min(255, Math.round(parseFloat(m[3]) + 38));
      const a = m[4] !== undefined ? Math.max(0.68, parseFloat(m[4])) : 0.85;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return bgCol;
  }
  // Tailwind v4 oklab/oklch/color-mix fallback for slate-900/40 matte cards
  return fallback;
}

function getReadableStrokeColor(borderCol, fallback = 'rgba(148, 163, 184, 0.55)') {
  if (!borderCol || borderCol === 'transparent' || borderCol === 'rgba(0, 0, 0, 0)') {
    return fallback;
  }
  if (borderCol.startsWith('rgb')) {
    return borderCol;
  }
  return fallback;
}

function getDevicePixelRatio() {
  return typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
}

function ensureStageBuffers() {
  if (typeof document === 'undefined') return false;
  const dpr = getDevicePixelRatio();
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
  }

  if (stageCanvas.width !== bufW || stageCanvas.height !== bufH) {
    stageCanvas.width = bufW;
    stageCanvas.height = bufH;
    blurCanvas.width = bufW;
    blurCanvas.height = bufH;
  }

  if (!clusterOverlayCanvas) {
    clusterOverlayCanvas = document.createElement('canvas');
    clusterOverlayCanvas.className = 'lg-cluster-canvas';
    clusterOverlayCanvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 48;
      display: none;
    `;
    document.body.appendChild(clusterOverlayCanvas);
    clusterOverlayCtx = clusterOverlayCanvas.getContext('2d');
  }

  return true;
}

/**
 * Captures the live viewport background (background canvas + visible images & typography)
 * onto stageCanvas so isolated & fused lenses can refract live pixels in < 0.2ms
 */
function captureViewportStage(neededBlur) {
  if (!ensureStageBuffers()) return;
  const dpr = getDevicePixelRatio();
  const bw = stageCanvas.width;
  const bh = stageCanvas.height;
  const vw = Math.round(bw / dpr);
  const vh = Math.round(bh / dpr);

  stageCtx.save();

  // 1. Base page background (detect light/dark body background)
  const bodyBg = typeof document !== 'undefined' ? window.getComputedStyle(document.body).backgroundColor : '';
  stageCtx.fillStyle = bodyBg && bodyBg !== 'transparent' && bodyBg !== 'rgba(0, 0, 0, 0)' ? bodyBg : '#040814';
  stageCtx.fillRect(0, 0, bw, bh);

  // 2. Copy any background 2D canvas using physical buffer pixels
  const bgCanvases = document.querySelectorAll('canvas:not(.lg-lens-canvas):not(.lg-cluster-canvas)');
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

  // Scale context for DOM elements rendered in CSS pixels
  stageCtx.scale(dpr, dpr);

  // 3. Draw visible block surfaces (cards, buttons, pills, inputs) inside <main> and <footer>
  const surfaceEls = document.querySelectorAll(
    'main div.rounded-2xl, main div.rounded-xl, main a.rounded-2xl, main a.rounded-xl, main button, main a.inline-flex, main input, main textarea, main span.rounded-lg, main span.rounded-full'
  );
  for (let i = 0; i < surfaceEls.length; i++) {
    const el = surfaceEls[i];
    const r = el.getBoundingClientRect();
    // Capture visible cards/buttons across the entire viewport (both top header and bottom privacy banner)
    if (r.bottom < -20 || r.top > vh + 20 || r.width <= 2 || r.height <= 2) continue;
    const style = window.getComputedStyle(el);
    const rad = Math.min(parseFloat(style.borderRadius) || 12, r.width * 0.5, r.height * 0.5);
    const cls = typeof el.className === 'string' ? el.className : '';

    stageCtx.save();
    stageCtx.beginPath();
    if (typeof stageCtx.roundRect === 'function') {
      stageCtx.roundRect(r.left, r.top, r.width, r.height, rad);
    } else {
      stageCtx.rect(r.left, r.top, r.width, r.height);
    }

    const bgImg = style.backgroundImage;
    const inlineBg = el.style && el.style.background;
    if ((bgImg && bgImg.includes('gradient')) || (inlineBg && inlineBg.includes('gradient'))) {
      const g = stageCtx.createLinearGradient(r.left, r.top, r.right, r.bottom);
      g.addColorStop(0, '#fb923c');
      g.addColorStop(0.5, '#ec4899');
      g.addColorStop(1, '#a855f7');
      stageCtx.fillStyle = g;
      stageCtx.fill();
    } else if (el.style && el.style.backgroundColor) {
      stageCtx.fillStyle = el.style.backgroundColor;
      stageCtx.fill();
    } else if (cls.includes('bg-slate-950')) {
      stageCtx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      stageCtx.fill();
    } else {
      // Matte slate-900/40 cards & buttons — render with clear contrast against #040814
      stageCtx.fillStyle = 'rgba(30, 41, 59, 0.88)';
      stageCtx.fill();
    }

    const bWidth = parseFloat(style.borderTopWidth) || 1.5;
    stageCtx.lineWidth = Math.max(1.5, bWidth);
    if (el.style && el.style.borderColor) {
      stageCtx.strokeStyle = el.style.borderColor;
    } else {
      stageCtx.strokeStyle = 'rgba(148, 163, 184, 0.82)';
    }
    stageCtx.stroke();
    stageCtx.restore();
  }

  // 4. Draw visible images inside <main> (rounded to parent border-radius if inside a card)
  const imgs = document.querySelectorAll('main img');
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (!img.complete || img.naturalWidth === 0) continue;
    const r = img.getBoundingClientRect();
    if (r.bottom < -20 || r.top > vh + 20 || r.right < 0 || r.left > vw) continue;
    try {
      stageCtx.save();
      const parent = img.parentElement;
      const pStyle = parent ? window.getComputedStyle(parent) : null;
      const pRad = pStyle ? parseFloat(pStyle.borderRadius) || 0 : 0;
      if (pRad > 0 && typeof stageCtx.roundRect === 'function') {
        stageCtx.beginPath();
        stageCtx.roundRect(r.left, r.top, r.width, r.height, pRad);
        stageCtx.clip();
      }
      stageCtx.drawImage(img, r.left, r.top, r.width, r.height);
      stageCtx.restore();
    } catch {
      stageCtx.restore();
    }
  }

  // 5. Draw visible text, headings, buttons & labels in the top viewport band so header refracts them when scrolling over
  const textEls = document.querySelectorAll(
    'main h1, main h2, main h3, main p, main button, main a, main label, main input, main textarea, main span.font-mono, main span.rounded-full, main span.bg-clip-text, main div.rounded-xl span, main div.rounded-2xl span, footer p, footer a, footer button, footer span'
  );
  for (let i = 0; i < textEls.length; i++) {
    const el = textEls[i];
    if (el.tagName === 'A' && el.querySelector('img, h3')) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < -20 || r.top > vh + 20 || r.height <= 0 || r.width <= 0) continue;
    const tag = el.tagName;
    const style = window.getComputedStyle(el);
    const cls = typeof el.className === 'string' ? el.className : '';
    stageCtx.save();
    stageCtx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    stageCtx.textBaseline = 'top';
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || cls.includes('bg-clip-text')) {
      const grad = stageCtx.createLinearGradient(r.left, r.top, r.right, r.top);
      if (cls.includes('bg-clip-text') && tag === 'SPAN') {
        grad.addColorStop(0, '#fb923c');
        grad.addColorStop(0.5, '#ec4899');
        grad.addColorStop(1, '#a855f7');
      } else {
        grad.addColorStop(0, '#f8fafc');
        grad.addColorStop(0.55, '#f8fafc');
        grad.addColorStop(0.75, '#fb923c');
        grad.addColorStop(0.9, '#ec4899');
        grad.addColorStop(1, '#a855f7');
      }
      stageCtx.fillStyle = grad;
    } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
      stageCtx.fillStyle = '#94a3b8';
    } else {
      const col = style.color;
      stageCtx.fillStyle = col && col.startsWith('rgb') ? col : '#f1f5f9';
    }
    const rawText =
      tag === 'INPUT' || tag === 'TEXTAREA'
        ? el.value || el.getAttribute('placeholder') || ''
        : el.textContent || '';
    const text = rawText.trim().replace(/\s+/g, ' ');
    if (!text) {
      stageCtx.restore();
      continue;
    }
    const words = text.split(' ');
    const fontSizePx = parseFloat(style.fontSize) || 16;
    const lineHeight = parseFloat(style.lineHeight) || fontSizePx * 1.3;
    let line = '';
    const isButtonOrPill =
      tag === 'BUTTON' ||
      tag === 'A' ||
      tag === 'INPUT' ||
      style.display.includes('inline-flex') ||
      cls.includes('rounded-full') ||
      cls.includes('rounded-lg');
    let y = isButtonOrPill ? r.top + (r.height - fontSizePx) * 0.5 : r.top;
    const isCentered = style.textAlign === 'center' || (isButtonOrPill && tag !== 'INPUT');
    stageCtx.textAlign = isCentered ? 'center' : 'left';
    const drawX = isCentered ? r.left + r.width * 0.5 : r.left + (tag === 'INPUT' ? 12 : 0);

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const testLine = line ? `${line} ${words[wIdx]}` : words[wIdx];
      if (!isButtonOrPill && stageCtx.measureText(testLine).width > r.width && line) {
        stageCtx.fillText(line, drawX, y);
        line = words[wIdx];
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    if (line) {
      stageCtx.fillText(line, drawX, y);
    }
    stageCtx.restore();
  }

  stageCtx.restore();

  // 5. Blur buffer for frosted glass
  if (neededBlur > 0) {
    lastFrostedRadius = neededBlur;
    blurCtx.clearRect(0, 0, bw, bh);
    blurCtx.filter = `blur(${neededBlur * dpr}px) saturate(135%)`;
    blurCtx.drawImage(stageCanvas, 0, 0);
    blurCtx.filter = 'none';
  }
}

/**
 * Fast Isolated Lens Renderer (Takes ~0.12 ms using precomputed TypedArray LUT!)
 */
function renderIsolatedController(ctrl, rect) {
  const dpr = getDevicePixelRatio();
  const w = Math.max(16, Math.round(rect.width * dpr));
  const h = Math.max(16, Math.round(rect.height * dpr));
  const rad = ctrl._getRadius() * dpr;

  if (
    !ctrl._lut ||
    ctrl._lut.w !== w ||
    ctrl._lut.h !== h ||
    Math.abs(ctrl._lut.rad - Math.min(rad, w * 0.5, h * 0.5)) > 1.0
  ) {
    ctrl._lut = buildElementLUT(w, h, rad, ctrl.options, dpr);
  }

  const lut = ctrl._lut;
  if (ctrl._canvas.width !== w || ctrl._canvas.height !== h) {
    ctrl._canvas.width = w;
    ctrl._canvas.height = h;
  }

  // Use exact un-clamped element position in physical canvas pixels
  const dx = Math.round(rect.left * dpr);
  const dy = Math.round(rect.top * dpr);

  const sourceCtx = ctrl.options.frosted > 0 ? blurCtx : stageCtx;
  const srcImg = sourceCtx.getImageData(dx, dy, w, h);
  const srcData = srcImg.data;

  const lensImg = ctrl._ctx.createImageData(w, h);
  const lensData = lensImg.data;

  // Start with tinted interior copy
  const [tR, tG, tB, tA] = ctrl._tint;
  const invTA = 1.0 - tA;
  const offsets = lut.offsets;
  const dispMap = lut.dispMap;
  const alphas = lut.alphas;
  const glints = lut.glints;
  const topSheen = lut.topSheen;
  const total = w * h;

  for (let idx = 0; idx < total; idx++) {
    const a = alphas[idx];
    if (a === 0) continue;

    const offX = offsets[idx * 2];
    const offY = offsets[idx * 2 + 1];
    const disp = dispMap[idx];

    const x = idx % w;
    const y = (idx / w) | 0;

    let rBg, gBg, bBg;
    if (disp > 0 && (offX !== 0 || offY !== 0)) {
      const sxG = Math.max(0, Math.min(w - 1, x + offX));
      const syG = Math.max(0, Math.min(h - 1, y + offY));
      const sxR = Math.max(0, Math.min(w - 1, x + Math.round(offX * (1.0 + disp))));
      const syR = Math.max(0, Math.min(h - 1, y + Math.round(offY * (1.0 + disp))));
      const sxB = Math.max(0, Math.min(w - 1, x + Math.round(offX * (1.0 - disp))));
      const syB = Math.max(0, Math.min(h - 1, y + Math.round(offY * (1.0 - disp))));

      rBg = srcData[(syR * w + sxR) * 4];
      gBg = srcData[(syG * w + sxG) * 4 + 1];
      bBg = srcData[(syB * w + sxB) * 4 + 2];
    } else {
      const sx = Math.max(0, Math.min(w - 1, x + offX));
      const sy = Math.max(0, Math.min(h - 1, y + offY));
      const sIdx = (sy * w + sx) * 4;
      rBg = srcData[sIdx];
      gBg = srcData[sIdx + 1];
      bBg = srcData[sIdx + 2];
    }

    const sheen = topSheen[idx] * 0.78 + glints[idx] * 0.65;
    const pIdx = idx * 4;
    if (tA < 0.15) {
      const clearSheen = topSheen[idx] * 0.92 + glints[idx] * 0.88;
      lensData[pIdx] = Math.min(255, Math.round(rBg * invTA + tR * tA + clearSheen));
      lensData[pIdx + 1] = Math.min(255, Math.round(gBg * invTA + tG * tA + clearSheen));
      lensData[pIdx + 2] = Math.min(255, Math.round(bBg * invTA + tB * tA + clearSheen));
    } else {
      lensData[pIdx] = Math.min(255, Math.round(rBg * invTA + tR * tA + sheen * 0.72));
      lensData[pIdx + 1] = Math.min(255, Math.round(gBg * invTA + tG * tA + sheen * 0.88));
      lensData[pIdx + 2] = Math.min(255, Math.round(bBg * invTA + tB * tA + sheen));
    }
    lensData[pIdx + 3] = a;
  }

  ctrl._ctx.putImageData(lensImg, 0, 0);
  ctrl._canvas.style.opacity = '1';
}

function areRectsTouching(r1, r2, threshold = 42) {
  const dx = Math.max(
    0,
    Math.abs(r1.left + r1.width * 0.5 - (r2.left + r2.width * 0.5)) -
      (r1.width + r2.width) * 0.5
  );
  const dy = Math.max(
    0,
    Math.abs(r1.top + r1.height * 0.5 - (r2.top + r2.height * 0.5)) -
      (r1.height + r2.height) * 0.5
  );
  return Math.hypot(dx, dy) < threshold;
}

function renderAllActiveLenses() {
  rafScheduled = false;
  if (typeof document === 'undefined' || controllerRegistry.size === 0) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const visible = [];
  let maxFrosted = 0;

  for (const ctrl of controllerRegistry) {
    if (!ctrl._mounted || !ctrl.enabled || !ctrl.element) {
      if (ctrl._canvas) ctrl._canvas.style.opacity = '0';
      continue;
    }
    const r = ctrl.element.getBoundingClientRect();
    if (r.width <= 4 || r.height <= 4) continue;
    // Keep off-screen fusion anchors (within 80px of viewport) in the active list when fusion is enabled
    const margin = ctrl.options.fusion ? 80 : 0;
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
    visible.push({ ctrl, rect: r });
  }

  if (visible.length === 0) return;

  captureViewportStage(maxFrosted);

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
    for (let j = i + 1; j < n; j++) {
      if (!visible[j].ctrl.options.fusion) continue;
      if (areRectsTouching(visible[i].rect, visible[j].rect, 54)) {
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
      if (ctrl._savedShadow && ctrl.element.style.boxShadow === 'none') {
        ctrl.element.style.boxShadow = ctrl._savedInlineShadow || '';
      }
      if (rect.bottom > 1 && rect.top < vh) {
        renderIsolatedController(ctrl, rect);
      }
    } else {
      hasFusedCluster = true;
      let anyHasShadow = false;
      for (const item of group) {
        item.ctrl._canvas.style.opacity = '0';
        if (item.ctrl._savedShadow) {
          anyHasShadow = true;
          item.ctrl.element.style.boxShadow = 'none';
        }
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
        tint: ctrl._tint
      }));

      const dpr = getDevicePixelRatio();
      const box = renderFusedCluster(
        clusterOverlayCtx,
        sourceCtx,
        elements,
        {
          ...primaryCtrl.options,
          fusionDistance: 64
        },
        dpr
      );

      if (box && clusterOverlayCanvas) {
        clusterOverlayCanvas.style.display = 'block';
        clusterOverlayCanvas.style.filter = anyHasShadow
          ? 'drop-shadow(3px 14px 18px rgba(0, 0, 0, 0.16))'
          : 'none';
        clusterOverlayCanvas.style.transform = `translate3d(${box.cMinX / dpr}px, ${box.cMinY / dpr}px, 0)`;
        clusterOverlayCanvas.style.width = `${box.boxW / dpr}px`;
        clusterOverlayCanvas.style.height = `${box.boxH / dpr}px`;
      }
    }
  }

  if (!hasFusedCluster && clusterOverlayCanvas) {
    clusterOverlayCanvas.style.display = 'none';
  }
}

exports.scheduleStageRedraw = function scheduleStageRedraw() {
  if (typeof window === 'undefined') return;
  if (rafScheduled && rafId) {
    window.cancelAnimationFrame(rafId);
  }
  rafScheduled = true;
  rafId = window.requestAnimationFrame(renderAllActiveLenses);
}

function attachGlobalStageListeners() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  window.addEventListener('scroll', scheduleStageRedraw, { passive: true });
  window.addEventListener('resize', scheduleStageRedraw, { passive: true });

  // Continuous 30fps sync with ambient background canvas animation
  const tick = () => {
    scheduleStageRedraw();
    window.setTimeout(() => window.requestAnimationFrame(tick), 32);
  };
  window.requestAnimationFrame(tick);
}

/**
 * Universal DOM Controller: turns any HTMLElement into an interactive Liquid Glass surface
 * using pure 2D Canvas + TypedArray LUT & Cluster Fusion (Zero WebGL, Zero SVG, Zero PNG).
 */
const LiquidGlassController = exports.LiquidGlassController = class LiquidGlassController {
  constructor(element, options = {}) {
    this.element = element;
    this.options = normalizeOptions(options);
    this.enabled = options.enabled !== undefined ? Boolean(options.enabled) : true;

    this._canvas = null;
    this._ctx = null;
    this._lut = null;
    this._ro = null;
    this._tint = [15, 23, 42, 0.35];
    this._savedBg = '';
    this._savedShadow = '';
    this._savedInlineShadow = '';
    this._mounted = false;
    this._init();
  }

  _init() {
    if (!this.element || typeof document === 'undefined') return;

    if (!this.element.style.position) {
      const computed = window.getComputedStyle(this.element);
      if (computed.position === 'static') {
        this.element.style.position = 'relative';
      }
    }
    this.element.style.overflow = 'hidden';

    // Read element's intended CSS background tint, then make CSS background transparent
    // so the 2D Canvas lens underneath renders the refracted + tinted pixels directly!
    const computed = window.getComputedStyle(this.element);
    const attrTint = this.element.getAttribute('data-lg-tint');
    this._savedBg = attrTint || this.element.style.backgroundColor || computed.backgroundColor;
    this._tint = parseCssRgba(this._savedBg);
    this.element.style.backgroundColor = 'transparent';
    if (computed.boxShadow && computed.boxShadow !== 'none') {
      this._savedInlineShadow = this.element.style.boxShadow || '';
      this._savedShadow = computed.boxShadow;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'lg-lens-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      border-radius: inherit;
      display: block;
    `;
    this.element.insertBefore(canvas, this.element.firstChild);
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');

    controllerRegistry.add(this);
    attachGlobalStageListeners();

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        scheduleStageRedraw();
      });
      this._ro.observe(this.element);
    }

    if (typeof MutationObserver !== 'undefined') {
      if (this.element.style.backgroundColor && this.element.style.backgroundColor !== 'transparent') {
        this._savedBg = this.element.style.backgroundColor;
        this._tint = parseCssRgba(this._savedBg);
        this.element.style.backgroundColor = 'transparent';
      }
      this._mo = new MutationObserver(() => {
        if (this.element) {
          const newAttrTint = this.element.getAttribute('data-lg-tint');
          if (newAttrTint) {
            this._savedBg = newAttrTint;
            this._tint = parseCssRgba(newAttrTint);
          } else if (
            this.element.style.backgroundColor &&
            this.element.style.backgroundColor !== 'transparent'
          ) {
            this._savedBg = this.element.style.backgroundColor;
            this._tint = parseCssRgba(this._savedBg);
            this.element.style.backgroundColor = 'transparent';
          }
        }
        scheduleStageRedraw();
      });
      this._mo.observe(this.element, { attributes: true, attributeFilter: ['style', 'class'] });
      if (this.element.parentElement) {
        this._mo.observe(this.element.parentElement, {
          attributes: true,
          attributeFilter: ['style', 'class']
        });
      }
    }

    this._mounted = true;
    scheduleStageRedraw();
  }

  _getRadius() {
    if (!this.element) return 0;
    const inlineRad = parseFloat(this.element.style.borderRadius);
    if (!Number.isNaN(inlineRad)) return inlineRad;
    const computed = window.getComputedStyle(this.element);
    return parseFloat(computed.borderRadius) || 0;
  }

  isTouchingAny(threshold = 40) {
    if (!this.options.fusion || !this.element) return false;
    const r1 = this.element.getBoundingClientRect();
    for (const other of controllerRegistry) {
      if (other === this || !other.element || !other.options.fusion) continue;
      const r2 = other.element.getBoundingClientRect();
      if (areRectsTouching(r1, r2, threshold)) return true;
    }
    return false;
  }

  update(newOptions = {}) {
    const merged = normalizeOptions({ ...this.options, ...newOptions });
    let lutChanged = false;
    let changed = false;

    if (newOptions.enabled !== undefined && Boolean(newOptions.enabled) !== this.enabled) {
      this.enabled = Boolean(newOptions.enabled);
      changed = true;
    }

    for (const key of ['rim', 'ior', 'height', 'frosted', 'fusion']) {
      if (merged[key] !== this.options[key]) {
        this.options[key] = merged[key];
        changed = true;
        if (key === 'rim' || key === 'ior' || key === 'height') {
          lutChanged = true;
        }
      }
    }

    if (lutChanged) {
      this._lut = null;
    }
    if (changed) {
      scheduleStageRedraw();
    }
  }

  refresh() {
    scheduleStageRedraw();
  }

  destroy() {
    controllerRegistry.delete(this);
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    if (this._mo) {
      this._mo.disconnect();
      this._mo = null;
    }
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._mounted = false;
    scheduleStageRedraw();
  }
}

/**
 * Imperative helper to attach Liquid Glass to any DOM selector or HTMLElement
 */
exports.createLiquidGlass = function createLiquidGlass(target, options = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  return new LiquidGlassController(el, options);
}
