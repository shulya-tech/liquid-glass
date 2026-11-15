/**
 * React Adapter for Liquid Glass UI
 */
const React = require('react');
const { useEffect, useRef, useCallback, forwardRef } = require('react');
const { LiquidGlassController, OPTICAL_DEFAULTS } = require('./core.cjs');

/**
 * React Hook to turn any ref element into a Liquid Glass block
 */
exports.useLiquidGlass = function useLiquidGlass(options = {}) {
  const ref = useRef(null);
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    controllerRef.current = new LiquidGlassController(ref.current, options);
    return () => {
      if (controllerRef.current) {
        controllerRef.current.destroy();
        controllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.update({
        rim: options.rim,
        ior: options.ior,
        height: options.height,
        frosted: options.frosted,
        fusion: options.fusion,
        fusionDistance: options.fusionDistance,
        zIndex: options.zIndex,
        enabled: options.enabled,
        dpr: options.dpr
      });
    }
  }, [
    options.rim,
    options.ior,
    options.height,
    options.frosted,
    options.fusion,
    options.fusionDistance,
    options.zIndex,
    options.enabled,
    options.dpr
  ]);

  return ref;
}

/**
 * <LiquidGlass> React Component
 */
const LiquidGlass = exports.LiquidGlass = forwardRef(function LiquidGlass(
  {
    rim = OPTICAL_DEFAULTS.rim,
    ior = OPTICAL_DEFAULTS.ior,
    height = OPTICAL_DEFAULTS.height,
    frosted = OPTICAL_DEFAULTS.frosted,
    fusion = OPTICAL_DEFAULTS.fusion,
    fusionDistance,
    zIndex,
    enabled = true,
    dpr = OPTICAL_DEFAULTS.dpr,
    as: Component = 'div',
    style,
    className,
    children,
    ...rest
  },
  externalRef
) {
  const internalRef = useLiquidGlass({
    rim,
    ior,
    height,
    frosted,
    fusion,
    fusionDistance,
    zIndex,
    enabled,
    dpr
  });

  const setRefs = useCallback(
    (node) => {
      internalRef.current = node;
      if (typeof externalRef === 'function') {
        externalRef(node);
      } else if (externalRef) {
        externalRef.current = node;
      }
    },
    [externalRef, internalRef]
  );

  return React.createElement(
    Component,
    {
      ref: setRefs,
      className,
      style,
      ...rest
    },
    children
  );
});

exports.LiquidGlassController = require('./core.cjs').LiquidGlassController;
exports.OPTICAL_DEFAULTS = require('./core.cjs').OPTICAL_DEFAULTS;
exports.OPTICAL_LIMITS = require('./core.cjs').OPTICAL_LIMITS;
exports.scheduleStageRedraw = require('./core.cjs').scheduleStageRedraw;
exports.redrawStageNow = require('./core.cjs').redrawStageNow;
exports.setUseWebGL = require('./core.cjs').setUseWebGL;
exports.isWebGLActive = require('./core.cjs').isWebGLActive;
exports.default = LiquidGlass;
