import { LiquidGlassOptions, LiquidGlassController } from './index';

export declare function liquidGlass(
  el: HTMLElement,
  accessor: () => LiquidGlassOptions | LiquidGlassOptions
): LiquidGlassController;

export declare function LiquidGlass(
  props: LiquidGlassOptions & { ref?: (el: HTMLElement) => void; children?: any }
): any;

export { LiquidGlassController };
export default liquidGlass;

