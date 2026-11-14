/**
 * Angular Adapter for Liquid Glass UI
 */
const { LiquidGlassController, OPTICAL_DEFAULTS, OPTICAL_LIMITS } = require('./core.cjs');

/**
 * Framework-agnostic Angular Directive Controller Class
 * Can be used directly with Angular's @Directive({ selector: '[liquidGlass]', standalone: true })
 * or instantiated via ElementRef in any Angular component.
 */
const LiquidGlassDirective = exports.LiquidGlassDirective = class LiquidGlassDirective {
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
exports.attachAngularLiquidGlass = function attachAngularLiquidGlass(elementRef, options = {}) {
  const el = elementRef && elementRef.nativeElement ? elementRef.nativeElement : elementRef;
  return new LiquidGlassController(el, options);
}

exports.LiquidGlassController = LiquidGlassController;
exports.OPTICAL_DEFAULTS = OPTICAL_DEFAULTS;
exports.OPTICAL_LIMITS = OPTICAL_LIMITS;
exports.default = LiquidGlassDirective;
