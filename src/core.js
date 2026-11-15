/**
 * Core Empirical Surface Engine Facade
 * Pure 2D Canvas + TypedArray LUT & Cluster Fusion / Screen-Space WebGL
 */

export {
  OPTICAL_DEFAULTS,
  OPTICAL_LIMITS,
  DEFAULT_FUSION_DISTANCE,
  normalizeOptions
} from './core/options.js';

export {
  sampleTable,
  evalRoundedRect,
  evalCircle,
  blendSurfaces
} from './core/math.js';

export {
  buildElementLUT,
  buildOpticalMapURI
} from './canvas2d/lut.js';

export {
  renderFusedCluster
} from './canvas2d/cluster.js';

export {
  LiquidGlassController,
  createLiquidGlass
} from './core/controller.js';

export {
  scheduleStageRedraw,
  redrawStageNow,
  setUseWebGL,
  isWebGLActive
} from './core/stage.js';

export { WebGLGlassRenderer } from './webgl/renderer.js';

export { _T0, _T1, _T2, _T3, _T4 } from './tables.js';
