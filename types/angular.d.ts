import { LiquidGlassOptions, LiquidGlassController } from './index';

export declare class LiquidGlassDirective {
  el: HTMLElement;
  rim: number;
  ior: number;
  height: number;
  frosted: number;
  fusion: boolean;
  borderRadius: number | null;
  liquidGlass: LiquidGlassOptions | null;
  constructor(elementRef: { nativeElement: HTMLElement } | HTMLElement);
  ngOnInit(): void;
  ngOnChanges(): void;
  ngOnDestroy(): void;
}

export declare function attachAngularLiquidGlass(
  elementRef: { nativeElement: HTMLElement } | HTMLElement,
  options?: LiquidGlassOptions
): LiquidGlassController;

export { LiquidGlassController };
export default LiquidGlassDirective;
