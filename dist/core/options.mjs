/**
 * Optical configuration constants, boundary limits and options sanitizer
 */

// Default distance threshold (in CSS pixels) for liquid fusion bridging
export const DEFAULT_FUSION_DISTANCE = 88;

/**
 * Default parameter values and strict min/max clamping bounds
 */
export const OPTICAL_DEFAULTS = Object.freeze({
  rim: 16,
  ior: 1.46,
  height: 18,
  frosted: 0,
  fusion: true,
  fusionDistance: 88,
  dpr: 0
});

export const OPTICAL_LIMITS = Object.freeze({
  rim: Object.freeze({ min: 4, max: 48 }),
  ior: Object.freeze({ min: 1.05, max: 2.20 }),
  height: Object.freeze({ min: 2, max: 50 }),
  frosted: Object.freeze({ min: 0, max: 32 }),
  dpr: Object.freeze({ min: 0.5, max: 3.0 })
});

export function clampNumber(val, fallback, min, max) {
  const num = typeof val === 'number' && !Number.isNaN(val) ? val : fallback;
  return Math.max(min, Math.min(max, num));
}

/**
 * Sanitizes and clamps optical configuration parameters to valid physical bounds
 * @param {Object} options - Raw user-provided optical configuration
 * @returns {Object} Normalized optical options
 */
export function normalizeOptions(options = {}) {
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
    fusion: options.fusion !== undefined ? Boolean(options.fusion) : OPTICAL_DEFAULTS.fusion,
    fusionDistance:
      typeof options.fusionDistance === 'number' && !Number.isNaN(options.fusionDistance)
        ? Math.max(10, Math.min(200, options.fusionDistance))
        : (OPTICAL_DEFAULTS.fusionDistance || DEFAULT_FUSION_DISTANCE),
    dpr:
      typeof options.dpr === 'number' && options.dpr > 0
        ? clampNumber(options.dpr, 1, OPTICAL_LIMITS.dpr.min, OPTICAL_LIMITS.dpr.max)
        : 0
  };
}
