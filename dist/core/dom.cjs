/**
 * DOM, Canvas & Device Inspection Utilities
 * Handles CSS color parsing, mobile device heuristics, and canvas capability checks
 */

/**
 * Checks if a live user-provided canvas exists in the background
 */
exports.hasLiveBackgroundCanvas = function hasLiveBackgroundCanvas() {
  if (typeof document === 'undefined') return false;
  const c = document.querySelector(
    'canvas:not(.lg-lens-canvas):not(.lg-cluster-canvas):not(.lg-webgl-canvas)'
  );
  return Boolean(c && c.width > 0 && c.height > 0);
}

/**
 * Parses CSS rgba/rgb color string into [r, g, b, a] tuple (0-255, 0-1)
 * @param {string} str - CSS color string
 * @returns {[number, number, number, number]}
 */
exports.parseCssRgba = function parseCssRgba(str) {
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

/**
 * Computes readable fallback fill color for DOM overlay cards
 */
exports.getReadableFillColor = function getReadableFillColor(bgCol, fallback = 'rgba(30, 41, 59, 0.72)') {
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

/**
 * Computes readable stroke color for DOM overlay borders
 */
exports.getReadableStrokeColor = function getReadableStrokeColor(borderCol, fallback = 'rgba(148, 163, 184, 0.55)') {
  if (!borderCol || borderCol === 'transparent' || borderCol === 'rgba(0, 0, 0, 0)') {
    return fallback;
  }
  if (borderCol.startsWith('rgb')) {
    return borderCol;
  }
  return fallback;
}

/**
 * Returns true if the client is a mobile device or touch-limited screen
 */
exports.isMobileDevice = function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  if (typeof window !== 'undefined') {
    if (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
      if (window.innerWidth <= 1024 || window.innerHeight <= 1024) return true;
    }
    if (
      window.matchMedia &&
      (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 820px)').matches)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves optimal DPR (Device Pixel Ratio) taking mobile performance into account
 * @param {number} customDpr - Optional user-configured DPR override
 * @returns {number} Effective device pixel ratio
 */
exports.getDevicePixelRatio = function getDevicePixelRatio(customDpr = 0) {
  if (typeof customDpr === 'number' && customDpr > 0) {
    return Math.max(0.5, Math.min(3.0, customDpr));
  }
  if (typeof window === 'undefined') return 1;

  const sysDpr = window.devicePixelRatio || 1;
  return Math.min(sysDpr, 2.0);
}

let supportsCanvasFilterBlur = null;

/**
 * Detects whether 2D Canvas context supports the native CSS filter blur property
 */
exports.checkCanvasFilterBlur = function checkCanvasFilterBlur() {
  if (supportsCanvasFilterBlur !== null) return supportsCanvasFilterBlur;
  if (typeof document === 'undefined') return false;
  try {
    const testC = document.createElement('canvas');
    const testCtx = testC.getContext('2d');
    supportsCanvasFilterBlur = Boolean(testCtx && typeof testCtx.filter === 'string');
    return supportsCanvasFilterBlur;
  } catch {
    return (supportsCanvasFilterBlur = false);
  }
}

/**
 * Tests whether two DOM element bounding rects are touching / proximity-fused
 * @param {DOMRect} r1 - First rect
 * @param {DOMRect} r2 - Second rect
 * @param {number} threshold - Distance threshold in pixels
 * @returns {boolean}
 */
exports.areRectsTouching = function areRectsTouching(r1, r2, threshold = 56) {
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
