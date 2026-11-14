/**
 * Angular Adapter for Liquid Glass UI
 */
import { LiquidGlassController, OPTICAL_DEFAULTS, OPTICAL_LIMITS } from './core.js';

/**
 * Framework-agnostic Angular Directive Controller Class
 * Can be used directly with Angular's @Directive({ selector: '[liquidGlass]', standalone: true })
 * or instantiated via ElementRef in any Angular component.
 */
export class LiquidGlassDirective {
  /**
   * @param {{ nativeElement: HTMLElement } | HTMLElement} elementRef
   */
  constructor(elementRef) {
    this.el = elementRef && elementRef.nativeElement ? elementRef.nativeElement : elementRef;
    this.rim = OPTICAL_DEFAULTS.rim;
    this.ior = OPTICAL_DEFAULTS.ior;
    this.height = OPTICAL_DEFAULTS.height;
    this.frosted = OPTICAL_DEFAULTS.frosted;
    this.fusion = OPTICAL_DEFAULTS.fusion;
    this.borderRadius = null;
    this.liquidGlass = null;
    this._controller = null;
  }

  ngOnInit() {
    const opts =
      typeof this.liquidGlass === 'object' && this.liquidGlass !== null
        ? this.liquidGlass
        : {
            rim: this.rim,
            ior: this.ior,
            height: this.height,
            frosted: this.frosted,
            fusion: this.fusion,
            borderRadius: this.borderRadius
          };
    this._controller = new LiquidGlassController(this.el, opts);
  }

  ngOnChanges() {
    if (this._controller) {
      const opts =
        typeof this.liquidGlass === 'object' && this.liquidGlass !== null
          ? this.liquidGlass
          : {
              rim: this.rim,
              ior: this.ior,
              height: this.height,
              frosted: this.frosted,
              fusion: this.fusion,
              borderRadius: this.borderRadius
            };
      this._controller.update(opts);
    }
  }

  ngOnDestroy() {
    if (this._controller) {
      this._controller.destroy();
      this._controller = null;
    }
  }
}

/**
 * Helper to attach LiquidGlass directly inside Angular ngAfterViewInit
 */
export function attachAngularLiquidGlass(elementRef, options = {}) {
  const el = elementRef && elementRef.nativeElement ? elementRef.nativeElement : elementRef;
  return new LiquidGlassController(el, options);
}

export { LiquidGlassController, OPTICAL_DEFAULTS, OPTICAL_LIMITS };
export default LiquidGlassDirective;
