/**
 * 2D Canvas Fused Cluster Compositor
 * Performs disjoint-set island clustering, O(1) distGrid SDF evaluation,
 * and empirical optical refraction for touching Liquid Glass elements without WebGL
 */

import { _T0, _T1, _T2, _T4 } from '../tables.js';
import { normalizeOptions, DEFAULT_FUSION_DISTANCE } from '../core/options.js';

let clusterDistGrid = null;
let clusterDistGridCap = 0;
let clusterDstImg = null;
let clusterDstImgW = 0;
let clusterDstImgH = 0;
let lastClusterRect = null;

/**
 * Resets cached cluster rectangle
 */
export function resetClusterRect() {
  lastClusterRect = null;
}

/**
 * Clears the last cluster overlay rectangle on the given context
 * @param {CanvasRenderingContext2D} ctx
 */
export function clearClusterOverlay(ctx) {
  if (lastClusterRect && ctx) {
    ctx.clearRect(lastClusterRect.x, lastClusterRect.y, lastClusterRect.w, lastClusterRect.h);
    lastClusterRect = null;
  }
}

/**
 * Renders a cluster of touching LiquidGlass elements onto a 2D canvas context
 * using precomputed empirical tables (_T0.._T4) and O(1) distGrid gradients.
 *
 * @param {CanvasRenderingContext2D} ctx - Destination canvas context
 * @param {CanvasRenderingContext2D} sourceCtx - Background source context
 * @param {Array<Object>} elements - Elements in the cluster
 * @param {Object} rawOptions - Optical options
 * @param {number} dpr - Device pixel ratio
 * @returns {Object|undefined} Bounding box details of the rendered cluster
 */
export function renderFusedCluster(ctx, sourceCtx, elements, rawOptions = {}, dpr = 1) {
  const options = normalizeOptions(rawOptions);
  const fusionSpan = options.fusion ? (rawOptions.fusionDistance ?? DEFAULT_FUSION_DISTANCE) * dpr : 0;
  const rimPx = Math.max(1, options.rim * dpr);
  const ior = options.ior;
  const heightPx = options.height * dpr;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const el of elements) {
    minX = Math.min(minX, el.x - 16);
    minY = Math.min(minY, el.y - 16);
    maxX = Math.max(maxX, el.x + el.w + 16);
    maxY = Math.max(maxY, el.y + el.h + 16);
  }

  const cssMinX = Math.max(0, Math.floor(minX));
  const cssMinY = Math.max(0, Math.floor(minY));
  const cssMaxX = Math.ceil(maxX);
  const cssMaxY = Math.ceil(maxY);

  const cMinX = Math.round(cssMinX * dpr);
  const cMinY = Math.round(cssMinY * dpr);
  const cMaxX = Math.min(sourceCtx.canvas.width, Math.round(cssMaxX * dpr));
  const cMaxY = Math.min(sourceCtx.canvas.height, Math.round(cssMaxY * dpr));

  const boxW = cMaxX - cMinX;
  const boxH = cMaxY - cMinY;
  if (boxW <= 2 || boxH <= 2) return;

  const srcImg = sourceCtx.getImageData(cMinX, cMinY, boxW, boxH);
  const srcData = srcImg.data;

  const isOverlayCanvas = ctx.canvas && typeof ctx.canvas.className === 'string' && ctx.canvas.className.includes('lg-cluster-canvas');

  if (!isOverlayCanvas) {
    if (ctx.canvas.width !== boxW || ctx.canvas.height !== boxH) {
      ctx.canvas.width = boxW;
      ctx.canvas.height = boxH;
    }
  }

  const needCap = boxW * boxH;
  if (!clusterDistGrid || clusterDistGridCap < needCap) {
    clusterDistGridCap = Math.max(needCap, (clusterDistGridCap * 1.5) | 0);
    clusterDistGrid = new Float32Array(clusterDistGridCap);
  }
  const distGrid = clusterDistGrid;

  if (!clusterDstImg || clusterDstImgW !== boxW || clusterDstImgH !== boxH) {
    clusterDstImg = ctx.createImageData(boxW, boxH);
    clusterDstImgW = boxW;
    clusterDstImgH = boxH;
  }
  const dstImg = clusterDstImg;
  const dstData = dstImg.data;
  new Uint32Array(dstData.buffer, 0, needCap).fill(0);

  const prep = elements.map((b) => {
    const halfW = b.w * 0.5 * dpr;
    const halfH = b.h * 0.5 * dpr;
    const rad = (b.borderRadius ?? 0) * dpr;
    const r = Math.min(rad, halfW, halfH);
    const isCircle = b.shape === 'circle' || (Math.abs(halfW - halfH) < 1.0 && Math.abs(r - halfW) < 1.0);
    return {
      cx: (b.x + b.w * 0.5) * dpr,
      cy: (b.y + b.h * 0.5) * dpr,
      halfW,
      halfH,
      r,
      isCircle,
      fusion: b.fusion !== undefined ? Boolean(b.fusion) : options.fusion,
      tintR: b.tint ? b.tint[0] : 15,
      tintG: b.tint ? b.tint[1] : 23,
      tintB: b.tint ? b.tint[2] : 42,
      tintA: b.tint ? b.tint[3] : 0.35
    };
  });

  const primary = prep[0];
  const tR = primary.tintR;
  const tG = primary.tintG;
  const tB = primary.tintB;
  const rawTA = primary.tintA;
  const frostedFactor = Math.min(1.0, Math.max(0.0, (options.frosted || 0) / 10.0));
  const tA = Math.min(rawTA, 0.03) + (rawTA - Math.min(rawTA, 0.03)) * frostedFactor;
  const invTA = 1.0 - tA;
  const tR_tA = Math.round(tR * tA);
  const tG_tA = Math.round(tG * tA);
  const tB_tA = Math.round(tB * tA);
  const span = fusionSpan;

  // Pass 1: Boundary evaluation across cluster bounding box (Inlined fast LUT math)
  for (let y = 0; y < boxH; y++) {
    const py = cMinY + y;
    const row = y * boxW;
    for (let x = 0; x < boxW; x++) {
      const px = cMinX + x;
      let dCluster = Infinity;
      for (let i = 0; i < prep.length; i++) {
        const b = prep[i];
        let dShape;
        if (b.isCircle) {
          const dx = px - b.cx;
          const dy = py - b.cy;
          dShape = Math.sqrt(dx * dx + dy * dy) - b.halfW;
        } else {
          const qx = Math.abs(px - b.cx) - b.halfW + b.r;
          const qy = Math.abs(py - b.cy) - b.halfH + b.r;
          const ox = qx > 0 ? qx : 0;
          const oy = qy > 0 ? qy : 0;
          const outDist = ox > 0 || oy > 0 ? Math.sqrt(ox * ox + oy * oy) : 0;
          const inDist = qx < 0 && qy < 0 ? (qx > qy ? qx : qy) : 0;
          dShape = inDist + outDist - b.r;
        }

        if (i === 0) {
          dCluster = dShape;
        } else if (b.fusion && span > 0.001) {
          const diff = dCluster > dShape ? dCluster - dShape : dShape - dCluster;
          if (diff < span) {
            const h = span - diff;
            dCluster = (dCluster < dShape ? dCluster : dShape) - (h * h * 0.25) / span;
          } else if (dShape < dCluster) {
            dCluster = dShape;
          }
        } else if (dShape < dCluster) {
          dCluster = dShape;
        }
      }
      distGrid[row + x] = dCluster;
    }
  }

  const maxShift = rimPx * 1.25;

  // Pass 2: Fast vectorized lookup from distGrid + tabular chromatic shift (_T4)
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
        topSheenVal = 0,
        glintVal = 0,
        disp = 0;

      if (d < 0) {
        const innerDist = -d;
        if (innerDist < rimPx) {
          const u = innerDist / rimPx;
          const posU = u * 255.0;
          const uIdx = Math.min(254, posU | 0);
          const uFrac = posU - uIdx;
          const gain = _T0[uIdx] + (_T0[uIdx + 1] - _T0[uIdx]) * uFrac;
          disp = _T4[uIdx] + (_T4[uIdx + 1] - _T4[uIdx]) * uFrac;

          const dx = distGrid[row + x + 1] - distGrid[row + x - 1];
          const dy = distGrid[(y + 1) * boxW + x] - distGrid[(y - 1) * boxW + x];
          const invLen = 1.0 / (Math.sqrt(dx * dx + dy * dy) + 1e-6);
          const gx = dx * invLen;
          const gy = dy * invLen;

          const rawShift = gain * (ior - 1.0) * heightPx;
          const shift = Math.min(maxShift, rawShift);
          offX = Math.round(-gx * shift);
          offY = Math.round(-gy * shift);

          if (gy < -0.2) {
            const sVal = _T2[uIdx] + (_T2[uIdx + 1] - _T2[uIdx]) * uFrac;
            topSheenVal = Math.round(sVal * (-gy));
          }
        } else {
          // Fast interior path: zero displacement inside flat region (-d >= rimPx)
          const sIdx = idx * 4;
          dstData[sIdx] = (srcData[sIdx] * invTA + tR_tA) | 0;
          dstData[sIdx + 1] = (srcData[sIdx + 1] * invTA + tG_tA) | 0;
          dstData[sIdx + 2] = (srcData[sIdx + 2] * invTA + tB_tA) | 0;
          dstData[sIdx + 3] = 255;
          continue;
        }
      }

      const absD = Math.abs(d);
      if (absD < 3.0) {
        const posG = Math.min(254, absD * 0.33 * 255.0);
        const gIdx = posG | 0;
        glintVal = Math.round(_T1[gIdx] + (_T1[gIdx + 1] - _T1[gIdx]) * (posG - gIdx));
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

      const pIdx = idx * 4;
      if (tA < 0.15) {
        const clearSheen = topSheenVal * 0.92 + glintVal * 0.88;
        dstData[pIdx] = Math.min(255, Math.round(rBg * invTA + tR * tA + clearSheen));
        dstData[pIdx + 1] = Math.min(255, Math.round(gBg * invTA + tG * tA + clearSheen));
        dstData[pIdx + 2] = Math.min(255, Math.round(bBg * invTA + tB * tA + clearSheen));
      } else {
        const sheen = topSheenVal * 0.78 + glintVal * 0.65;
        dstData[pIdx] = Math.min(255, Math.round(rBg * invTA + tR * tA + sheen * 0.72));
        dstData[pIdx + 1] = Math.min(255, Math.round(gBg * invTA + tG * tA + sheen * 0.88));
        dstData[pIdx + 2] = Math.min(255, Math.round(bBg * invTA + tB * tA + sheen));
      }
      dstData[pIdx + 3] = Math.round(edgeAlpha * 255);
    }
  }

  if (isOverlayCanvas) {
    if (lastClusterRect) {
      ctx.clearRect(lastClusterRect.x, lastClusterRect.y, lastClusterRect.w, lastClusterRect.h);
    }
    ctx.putImageData(dstImg, cMinX, cMinY);
    lastClusterRect = { x: cMinX, y: cMinY, w: boxW, h: boxH };
  } else {
    ctx.putImageData(dstImg, 0, 0);
  }
  return { cMinX, cMinY, boxW, boxH, cssMinX, cssMinY, cssW: cssMaxX - cssMinX, cssH: cssMaxY - cssMinY };
}
