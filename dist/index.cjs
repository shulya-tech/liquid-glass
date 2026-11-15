exports.LiquidGlassController = require('./core.cjs').LiquidGlassController;
exports.createLiquidGlass = require('./core.cjs').createLiquidGlass;
exports.scheduleStageRedraw = require('./core.cjs').scheduleStageRedraw;
exports.redrawStageNow = require('./core.cjs').redrawStageNow;
exports.OPTICAL_DEFAULTS = require('./core.cjs').OPTICAL_DEFAULTS;
exports.OPTICAL_LIMITS = require('./core.cjs').OPTICAL_LIMITS;
exports.normalizeOptions = require('./core.cjs').normalizeOptions;
exports.buildOpticalMapURI = require('./core.cjs').buildOpticalMapURI;
exports.buildElementLUT = require('./core.cjs').buildElementLUT;
exports.renderFusedCluster = require('./core.cjs').renderFusedCluster;
exports.blendSurfaces = require('./core.cjs').blendSurfaces;
exports.sampleTable = require('./core.cjs').sampleTable;
exports.setUseWebGL = require('./core.cjs').setUseWebGL;
exports.isWebGLActive = require('./core.cjs').isWebGLActive;

exports.WebGLGlassRenderer = require('./webgl.cjs').WebGLGlassRenderer;

exports._T0 = require('./tables.cjs')._T0;
exports._T1 = require('./tables.cjs')._T1;
exports._T2 = require('./tables.cjs')._T2;
exports._T3 = require('./tables.cjs')._T3;
exports._T4 = require('./tables.cjs')._T4;
