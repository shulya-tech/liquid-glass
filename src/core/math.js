/**
 * Optical Mathematics & Signed Distance Fields (SDF)
 * Pure, deterministic mathematical evaluation functions
 */

/**
 * Fast linear interpolation from a 256-entry precomputed Float32Array table
 * @param {Float32Array} table - 256-entry empirical LUT
 * @param {number} u - normalized coordinate in [0, 1]
 * @returns {number}
 */
export function sampleTable(table, u) {
  if (u <= 0) return table[0];
  if (u >= 1) return table[255];
  const pos = u * 255.0;
  const idx = pos | 0;
  if (idx >= 255) return table[255];
  const frac = pos - idx;
  return table[idx] + (table[idx + 1] - table[idx]) * frac;
}

/**
 * Empirical boundary distance (SDF) for a rounded rectangle
 * @param {number} px - Point X relative to center
 * @param {number} py - Point Y relative to center
 * @param {number} halfW - Half-width
 * @param {number} halfH - Half-height
 * @param {number} rad - Corner radius
 * @returns {number} Signed distance (negative inside, positive outside)
 */
export function evalRoundedRect(px, py, halfW, halfH, rad) {
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
 * Empirical boundary distance (SDF) for a circle
 * @param {number} px - Point X relative to center
 * @param {number} py - Point Y relative to center
 * @param {number} r - Circle radius
 * @returns {number} Signed distance (negative inside, positive outside)
 */
export function evalCircle(px, py, r) {
  return Math.hypot(px, py) - r;
}

/**
 * Smooth quadratic minimum matching empirical _T3 bridge calibration
 * Guarantees thick, continuous liquid droplet attraction without creases or filaments.
 * @param {number} d1 - Distance to first surface
 * @param {number} d2 - Distance to second surface
 * @param {number} span - Fusion distance threshold
 * @returns {number} Smoothly blended distance
 */
export function blendSurfaces(d1, d2, span) {
  if (span <= 0.001) return Math.min(d1, d2);
  const diff = Math.abs(d1 - d2);
  if (diff >= span) return Math.min(d1, d2);
  const h = span - diff;
  return Math.min(d1, d2) - (h * h * 0.25) / span;
}
