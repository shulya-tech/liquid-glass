/**
 * Svelte Adapter for Liquid Glass UI (use:liquidGlass Action + Helper)
 */
import { LiquidGlassController, OPTICAL_DEFAULTS, OPTICAL_LIMITS } from './core.js';

/**
 * Svelte Action:
 * <div use:liquidGlass={{ rim: 16, ior: 1.46, height: 18, frosted: 0, fusion: true }}>...</div>
 *
 * @param {HTMLElement} node
 * @param {Object} options
 */
export function liquidGlass(node, options = {}) {
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

export { LiquidGlassController, OPTICAL_DEFAULTS, OPTICAL_LIMITS };
export default liquidGlass;
