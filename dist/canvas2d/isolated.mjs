/**
 * Fast Isolated Lens Renderer (Takes ~0.12 ms using precomputed TypedArray LUT)
 * Direct per-pixel optical refraction for individual non-fused glass blocks
 */

import { getDevicePixelRatio } from '../core/dom.mjs';
import { buildElementLUT } from './lut.mjs';

/**
 * Renders an isolated LiquidGlass element onto its own inner canvas
 * @param {Object} ctrl - LiquidGlassController instance
 * @param {DOMRect} rect - Bounding rectangle
 * @param {Object} contexts - Stage contexts { stageCtx, blurCtx }
 */
export function renderIsolatedController(ctrl, rect, { stageCtx, blurCtx }) {
  if (!ctrl || !ctrl._canvas || !ctrl._ctx || !stageCtx) return;
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
  if (!lut || !lut.offsets) return;

  if (ctrl._canvas.width !== w || ctrl._canvas.height !== h) {
    ctrl._canvas.width = w;
    ctrl._canvas.height = h;
  }

  // Use exact un-clamped element position in physical canvas pixels with rim padding
  const dx = Math.round(rect.left * dpr);
  const dy = Math.round(rect.top * dpr);
  const rimPx = Math.max(1, (ctrl.options.rim || 16) * dpr);
  const pad = Math.ceil(rimPx * 0.5) + 4;
  const sx0 = dx - pad;
  const sy0 = dy - pad;
  const sw = w + pad * 2;
  const sh = h + pad * 2;

  const sourceCtx = ctrl.options.frosted > 0 ? (blurCtx || stageCtx) : stageCtx;
  if (!sourceCtx || !sourceCtx.canvas || sourceCtx.canvas.width === 0 || sourceCtx.canvas.height === 0) return;

  let srcImg;
  try {
    srcImg = sourceCtx.getImageData(sx0, sy0, sw, sh);
  } catch {
    return;
  }
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
      const sxG = Math.max(0, Math.min(sw - 1, x + pad + offX));
      const syG = Math.max(0, Math.min(sh - 1, y + pad + offY));
      const sxR = Math.max(0, Math.min(sw - 1, x + pad + Math.round(offX * (1.0 + disp))));
      const syR = Math.max(0, Math.min(sh - 1, y + pad + Math.round(offY * (1.0 + disp))));
      const sxB = Math.max(0, Math.min(sw - 1, x + pad + Math.round(offX * (1.0 - disp))));
      const syB = Math.max(0, Math.min(sh - 1, y + pad + Math.round(offY * (1.0 - disp))));

      rBg = srcData[(syR * sw + sxR) * 4];
      gBg = srcData[(syG * sw + sxG) * 4 + 1];
      bBg = srcData[(syB * sw + sxB) * 4 + 2];
    } else {
      const sx = Math.max(0, Math.min(sw - 1, x + pad + offX));
      const sy = Math.max(0, Math.min(sh - 1, y + pad + offY));
      const sIdx = (sy * sw + sx) * 4;
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
  if (ctrl._canvas.style.display !== 'block') {
    ctrl._canvas.style.display = 'block';
  }
}
