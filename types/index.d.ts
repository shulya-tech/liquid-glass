export interface LiquidGlassOptions {
  /**
   * Optical rim bevel width in pixels (default: 16, min: 4, max: 48)
   */
  rim?: number;

  /**
   * Index of Refraction (default: 1.46, min: 1.05, max: 2.20)
   */
  ior?: number;

  /**
   * Optical surface height / thickness in pixels (default: 18, min: 2, max: 50)
   */
  height?: number;

  /**
   * Frosted blur intensity in pixels (default: 0, min: 0, max: 32)
   */
  frosted?: number;

  /**
   * Proximity distance threshold in pixels for liquid fusion bridging (default: 88).
   * Elements with the same z-index coalesce automatically when within this distance.
   */
  fusionDistance?: number;

  /**
   * Dynamically enable or pause the Liquid Glass optical effect (default: true).
   */
  enabled?: boolean;

  /**
   * Optional custom device pixel ratio override (e.g. 1.0 for full-width navbars to maximize FPS, or 1.5–2.0 for high-DPI retina sharpness).
   * Defaults to 0 (automatic: 1.5 for compact UI elements, 1.0 for elements >= 700px wide).
   */
  dpr?: number;

  /**
   * Optional explicit z-index for stage stacking ordering
   */
  zIndex?: number;

  /**
   * Optional border radius override in pixels
   */
  borderRadius?: number | null;
}

export declare const OPTICAL_DEFAULTS: Readonly<{
  rim: 16;
  ior: 1.46;
  height: 18;
  frosted: 0;
  fusion: true;
  dpr: 0;
}>;

export declare const OPTICAL_LIMITS: Readonly<{
  rim: Readonly<{ min: 4; max: 48 }>;
  ior: Readonly<{ min: 1.05; max: 2.2 }>;
  height: Readonly<{ min: 2; max: 50 }>;
  frosted: Readonly<{ min: 0; max: 32 }>;
  dpr: Readonly<{ min: 0.5; max: 3.0 }>;
}>;

export declare function normalizeOptions(options?: LiquidGlassOptions): Required<LiquidGlassOptions>;

export declare class LiquidGlassController {
  element: HTMLElement;
  options: Required<LiquidGlassOptions>;
  constructor(element: HTMLElement, options?: LiquidGlassOptions);
  isTouchingAny(threshold?: number): boolean;
  update(newOptions: Partial<LiquidGlassOptions>): void;
  refresh(): void;
  destroy(): void;
}

export declare function createLiquidGlass(
  target: string | HTMLElement,
  options?: LiquidGlassOptions
): LiquidGlassController;

export declare function scheduleStageRedraw(dirty?: boolean): void;
export declare function redrawStageNow(dirty?: boolean): void;
export declare function setUseWebGL(enabled: boolean): void;
export declare function isWebGLActive(): boolean;

export declare class WebGLGlassRenderer {
  canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement);
  render(config: {
    sourceCanvas: HTMLCanvasElement;
    elements: any[];
    options: any;
    dpr: number;
  }): void;
  destroy(): void;
}

export declare function sampleTable(table: Float32Array, u: number): number;
export declare function blendSurfaces(d1: number, d2: number, span: number): number;

export declare const _T0: Float32Array;
export declare const _T1: Float32Array;
export declare const _T2: Float32Array;
export declare const _T3: Float32Array;
export declare const _T4: Float32Array;
