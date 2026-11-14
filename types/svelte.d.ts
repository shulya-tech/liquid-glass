import { LiquidGlassOptions, LiquidGlassController } from './index';

export interface SvelteActionReturn {
  update: (newOptions?: LiquidGlassOptions) => void;
  destroy: () => void;
}

export declare function liquidGlass(
  node: HTMLElement,
  options?: LiquidGlassOptions
): SvelteActionReturn;

export { LiquidGlassController };
export default liquidGlass;

