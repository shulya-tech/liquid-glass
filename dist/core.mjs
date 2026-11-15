/**
 * Core Empirical Surface Engine Facade
 * Pure 2D Canvas + TypedArray LUT & Cluster Fusion / Screen-Space WebGL
 */

export {
  OPTICAL_DEFAULTS,
  OPTICAL_LIMITS,
  DEFAULT_FUSION_DISTANCE,
  normalizeOptions
} from './core/options.mjs';

export {
  sampleTable,
  evalRoundedRect,
  evalCircle,
  blendSurfaces
} from './core/math.mjs';

export {
  buildElementLUT,
  buildOpticalMapURI
} from './canvas2d/lut.mjs';

export {
  renderFusedCluster
} from './canvas2d/cluster.mjs';

export {
  LiquidGlassController,
  createLiquidGlass
} from './core/controller.mjs';

export {
  scheduleStageRedraw,
  redrawStageNow,
  setUseWebGL,
  isWebGLActive
} from './core/stage.mjs';

export { WebGLGlassRenderer } from './webgl/renderer.mjs';

export { _T0, _T1, _T2, _T3, _T4 } from './tables.mjs';
