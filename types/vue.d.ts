import { Directive, DefineComponent, Plugin } from 'vue';
import { LiquidGlassOptions, LiquidGlassController } from './index';

export declare const vLiquidGlass: Directive<HTMLElement, LiquidGlassOptions>;

export declare const LiquidGlass: DefineComponent<{
  rim?: number;
  ior?: number;
  height?: number;
  frosted?: number;
  fusion?: boolean;
  borderRadius?: number | null;
  tag?: string;
}>;

export declare const LiquidGlassPlugin: Plugin;

export { LiquidGlassController };
export default LiquidGlass;
