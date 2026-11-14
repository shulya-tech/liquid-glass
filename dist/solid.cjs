/**
 * SolidJS Adapter for Liquid Glass UI (use:liquidGlass Directive + Component)
 */
const { createEffect, onCleanup } = require('solid-js');
const { LiquidGlassController, OPTICAL_DEFAULTS, OPTICAL_LIMITS } = require('./core.cjs');

/**
 * SolidJS Directive:
 * <div use:liquidGlass={() => ({ rim: rim(), ior: ior(), height: height(), frosted: frosted(), fusion: fusion() })}>...</div>
 *
 * @param {HTMLElement} el
 * @param {() => Object | Object} accessor
 */
exports.liquidGlass = function liquidGlass(el, accessor) {
  const initialOpts = typeof accessor === 'function' ? accessor() : accessor || {};
  const controller = new LiquidGlassController(el, initialOpts);

  createEffect(() => {
    const nextOpts = typeof accessor === 'function' ? accessor() : accessor || {};
    controller.update(nextOpts);
  });

  onCleanup(() => {
    controller.destroy();
  });

  return controller;
}

/**
 * SolidJS <LiquidGlass> Component
 */
exports.LiquidGlass = function LiquidGlass(props) {
  let elRef;
  let controller = null;

  createEffect(() => {
    const opts = {
      rim: props.rim ?? OPTICAL_DEFAULTS.rim,
      ior: props.ior ?? OPTICAL_DEFAULTS.ior,
      height: props.height ?? OPTICAL_DEFAULTS.height,
      frosted: props.frosted ?? OPTICAL_DEFAULTS.frosted,
      fusion: props.fusion ?? OPTICAL_DEFAULTS.fusion,
      borderRadius: props.borderRadius ?? null
    };

    if (!controller && elRef) {
      controller = new LiquidGlassController(elRef, opts);
    } else if (controller) {
      controller.update(opts);
    }
  });

  onCleanup(() => {
    if (controller) {
      controller.destroy();
      controller = null;
    }
  });

  return {
    ref(node) {
      elRef = node;
      if (node && !controller) {
        controller = new LiquidGlassController(node, {
          rim: props.rim ?? OPTICAL_DEFAULTS.rim,
          ior: props.ior ?? OPTICAL_DEFAULTS.ior,
          height: props.height ?? OPTICAL_DEFAULTS.height,
          frosted: props.frosted ?? OPTICAL_DEFAULTS.frosted,
          fusion: props.fusion ?? OPTICAL_DEFAULTS.fusion,
          borderRadius: props.borderRadius ?? null
        });
      }
      if (typeof props.ref === 'function') props.ref(node);
    }
  };
}

exports.LiquidGlassController = LiquidGlassController;
exports.OPTICAL_DEFAULTS = OPTICAL_DEFAULTS;
exports.OPTICAL_LIMITS = OPTICAL_LIMITS;
exports.default = liquidGlass;
