/**
 * Fast Isolated Lens Renderer (Takes ~0.12 ms using precomputed TypedArray LUT)
 * Direct per-pixel optical refraction for individual non-fused glass blocks
 */

const { getDevicePixelRatio } = require('../core/dom.cjs');
const { buildElementLUT } = require('./lut.cjs');

/**
 * Renders an isolated LiquidGlass element onto its own inner canvas
 * @param {Object} ctrl - LiquidGlassController instance
 * @param {DOMRect} rect - Bounding rectangle
 * @param {Object} contexts - Stage contexts { stageCtx, blurCtx }
 */
exports.renderIsolatedController = function renderIsolatedController(ctrl, rect, { stageCtx, blurCtx }) {
  const dpr = getDevicePixelRatio(ctrl.options.dpr);
  const w = Math.max(16, Math.round(rect.width * dpr));
  const h = Math.max(16, Math.round(rect.height * dpr));
  const rad = ctrl._getRadius();
  const radPx = Math.min(rad * dpr, w * 0.5, h * 0.5);

  if (
    !ctrl._lut ||
    ctrl._lut.w !== w ||
    ctrl._lut.h !== h ||
    Math.abs(ctrl._lut.rad - radPx) > 1.0
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

  if (!ctrl._lensImg || ctrl._lensImg.width !== w || ctrl._lensImg.height !== h) {
    ctrl._lensImg = ctrl._ctx.createImageData(w, h);
  }
  const lensImg = ctrl._lensImg;
  const lensData = lensImg.data;

  // Start with tinted interior copy
  const [tR, tG, tB, rawTA] = ctrl._tint;
  const frostedFactor = Math.min(1.0, Math.max(0.0, (ctrl.options.frosted || 0) / 10.0));
  const tA = Math.min(rawTA, 0.03) + (rawTA - Math.min(rawTA, 0.03)) * frostedFactor;
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
