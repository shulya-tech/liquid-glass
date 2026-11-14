/**
 * Vue 3 Adapter for Liquid Glass UI (Component + v-liquid-glass Directive)
 */
const { defineComponent, h, ref, onMounted, onBeforeUnmount, watch } = require('vue');
const { LiquidGlassController, OPTICAL_DEFAULTS } = require('./core.cjs');

/**
 * Vue Directive: v-liquid-glass="{ rim: 16, ior: 1.46, height: 18, frosted: 0, fusion: true }"
 */
const vLiquidGlass = exports.vLiquidGlass = {
  mounted(el, binding) {
    el.__liquidGlass = new LiquidGlassController(el, binding.value || {});
  },
  updated(el, binding) {
    if (el.__liquidGlass) {
      el.__liquidGlass.update(binding.value || {});
    }
  },
  unmounted(el) {
    if (el.__liquidGlass) {
      el.__liquidGlass.destroy();
      delete el.__liquidGlass;
    }
  }
};

/**
 * <LiquidGlass> Vue 3 Component
 */
const LiquidGlass = exports.LiquidGlass = defineComponent({
  name: 'LiquidGlass',
  props: {
    rim: { type: Number, default: OPTICAL_DEFAULTS.rim },
    ior: { type: Number, default: OPTICAL_DEFAULTS.ior },
    height: { type: Number, default: OPTICAL_DEFAULTS.height },
    frosted: { type: Number, default: OPTICAL_DEFAULTS.frosted },
    fusion: { type: Boolean, default: OPTICAL_DEFAULTS.fusion },
    tag: { type: String, default: 'div' }
  },
  setup(props, { slots, attrs }) {
    const rootRef = ref(null);
    let controller = null;

    onMounted(() => {
      if (rootRef.value) {
        controller = new LiquidGlassController(rootRef.value, {
          rim: props.rim,
          ior: props.ior,
          height: props.height,
          frosted: props.frosted,
          fusion: props.fusion
        });
      }
    });

    watch(
      () => [props.rim, props.ior, props.height, props.frosted, props.fusion],
      ([rim, ior, height, frosted, fusion]) => {
        if (controller) {
          controller.update({ rim, ior, height, frosted, fusion });
        }
      }
    );

    onBeforeUnmount(() => {
      if (controller) {
        controller.destroy();
        controller = null;
      }
    });

    return () =>
      h(
        props.tag,
        {
          ref: rootRef,
          ...attrs
        },
        slots.default ? slots.default() : null
      );
  }
});

const LiquidGlassPlugin = exports.LiquidGlassPlugin = {
  install(app) {
    app.component('LiquidGlass', LiquidGlass);
    app.directive('liquid-glass', vLiquidGlass);
  }
};

exports.LiquidGlassController = require('./core.cjs').LiquidGlassController;
exports.OPTICAL_DEFAULTS = require('./core.cjs').OPTICAL_DEFAULTS;
exports.OPTICAL_LIMITS = require('./core.cjs').OPTICAL_LIMITS;
exports.default = LiquidGlass;
