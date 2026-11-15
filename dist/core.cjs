/**
 * Core Empirical Surface Engine Facade
 * Pure 2D Canvas + TypedArray LUT & Cluster Fusion / Screen-Space WebGL
 */

exports.OPTICAL_DEFAULTS = require('./core/options.cjs').OPTICAL_DEFAULTS;
exports.OPTICAL_LIMITS = require('./core/options.cjs').OPTICAL_LIMITS;
exports.DEFAULT_FUSION_DISTANCE = require('./core/options.cjs').DEFAULT_FUSION_DISTANCE;
exports.normalizeOptions = require('./core/options.cjs').normalizeOptions;

exports.sampleTable = require('./core/math.cjs').sampleTable;
exports.evalRoundedRect = require('./core/math.cjs').evalRoundedRect;
exports.evalCircle = require('./core/math.cjs').evalCircle;
exports.blendSurfaces = require('./core/math.cjs').blendSurfaces;

exports.buildElementLUT = require('./canvas2d/lut.cjs').buildElementLUT;
exports.buildOpticalMapURI = require('./canvas2d/lut.cjs').buildOpticalMapURI;

exports.renderFusedCluster = require('./canvas2d/cluster.cjs').renderFusedCluster;

exports.LiquidGlassController = require('./core/controller.cjs').LiquidGlassController;
exports.createLiquidGlass = require('./core/controller.cjs').createLiquidGlass;

exports.scheduleStageRedraw = require('./core/stage.cjs').scheduleStageRedraw;
exports.redrawStageNow = require('./core/stage.cjs').redrawStageNow;
exports.setUseWebGL = require('./core/stage.cjs').setUseWebGL;
exports.isWebGLActive = require('./core/stage.cjs').isWebGLActive;

exports.WebGLGlassRenderer = require('./webgl/renderer.cjs').WebGLGlassRenderer;

exports._T0 = require('./tables.cjs')._T0;
exports._T1 = require('./tables.cjs')._T1;
exports._T2 = require('./tables.cjs')._T2;
exports._T3 = require('./tables.cjs')._T3;
exports._T4 = require('./tables.cjs')._T4;
