/**
 * Svelte Adapter for Liquid Glass UI (use:liquidGlass Action + Helper)
 */
const { LiquidGlassController, OPTICAL_DEFAULTS, OPTICAL_LIMITS } = require('./core.cjs');

/**
 * Svelte Action:
 * <div use:liquidGlass={{ rim: 16, ior: 1.46, height: 18, frosted: 0, fusion: true }}>...</div>
 *
 * @param {HTMLElement} node
 * @param {Object} options
 */
exports.liquidGlass = function liquidGlass(node, options = {}) {
  const controller = new LiquidGlassController(node, options);

  return {
    update(newOptions = {}) {
      controller.update(newOptions);
    },
    destroy() {
      controller.destroy();
    }
  };
}

exports.LiquidGlassController = LiquidGlassController;
exports.OPTICAL_DEFAULTS = OPTICAL_DEFAULTS;
exports.OPTICAL_LIMITS = OPTICAL_LIMITS;
exports.default = liquidGlass;
