/**
 * 2D Canvas Empirical Optical Look-Up Table (LUT) Generator
 * Computes per-pixel displacement maps, fresnel glints, rim indices, and top sheen
 */

import { _T0, _T1, _T2, _T4 } from '../tables.mjs';
import { normalizeOptions } from '../core/options.mjs';
import { evalRoundedRect, sampleTable } from '../core/math.mjs';

/**
 * Precomputes the static per-pixel TypedArray LUT for an isolated lens element
 * @param {number} w - Physical pixel width
 * @param {number} h - Physical pixel height
 * @param {number} rad - Border radius
 * @param {Object} rawOptions - Optical options
 * @param {number} dpr - Device pixel ratio
 * @returns {Object} LUT object with offsets, dispMap, glints, alphas, topSheen
 */
export function buildElementLUT(w, h, rad, rawOptions = {}, dpr = 1) {
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
export function buildOpticalMapURI(width, height, borderRadius, rawOptions = {}) {
  const lut = buildElementLUT(
    Math.max(16, Math.round(width)),
    Math.max(16, Math.round(height)),
    borderRadius,
    rawOptions,
    1
  );
  return { lut, scale: 1 };
}
