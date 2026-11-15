/**
 * React Adapter for Liquid Glass UI
 */
import React, { useEffect, useRef, useCallback, forwardRef } from 'react';
import { LiquidGlassController, OPTICAL_DEFAULTS } from './core.js';

/**
 * React Hook to turn any ref element into a Liquid Glass block
 */
export function useLiquidGlass(options = {}) {
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
    options.enabled,
    options.dpr
  ]);

  return ref;
}

/**
 * <LiquidGlass> React Component
 */
export const LiquidGlass = forwardRef(function LiquidGlass(
  {
    rim = OPTICAL_DEFAULTS.rim,
    ior = OPTICAL_DEFAULTS.ior,
    height = OPTICAL_DEFAULTS.height,
    frosted = OPTICAL_DEFAULTS.frosted,
    fusion = OPTICAL_DEFAULTS.fusion,
    fusionDistance,
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

export {
  LiquidGlassController,
  OPTICAL_DEFAULTS,
  OPTICAL_LIMITS,
  scheduleStageRedraw,
  redrawStageNow,
  setUseWebGL,
  isWebGLActive
} from './core.js';
export default LiquidGlass;
