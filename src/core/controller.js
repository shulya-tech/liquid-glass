/**
 * Universal DOM Controller: turns any HTMLElement into an interactive Liquid Glass surface
 * using Screen-Space WebGL or pure 2D Canvas + TypedArray LUT & Cluster Fusion fallback.
 */

import { normalizeOptions } from './options.js';
import { parseCssRgba, areRectsTouching } from './dom.js';
import {
  controllerRegistry,
  scheduleStageRedraw,
  attachGlobalStageListeners
} from './stage.js';

let ctrlCounter = 0;

export const DEFAULT_SHADOW =
  '0 14px 28px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.06)';

export class LiquidGlassController {
  constructor(element, options = {}) {
    this._id = ++ctrlCounter;
    this.element = element;
    this.options = normalizeOptions(options);
    this.enabled = options.enabled !== undefined ? Boolean(options.enabled) : true;

    this._canvas = null;
    this._ctx = null;
    this._lut = null;
    this._ro = null;
    this._mo = null;
    this._tint = [15, 23, 42, 0.35];
    this._savedBg = '';
    this._savedShadow = '';
    this._cachedZIndex = 50;
    this._mounted = false;
    this._fused = false;
    this._init();
  }

  _computeZIndex() {
    if (!this.element || typeof window === 'undefined') return 20;
    if (this.options && typeof this.options.zIndex === 'number') {
      return this.options.zIndex;
    }
    const directAttrZ = parseInt(this.element.getAttribute('data-lg-z-index'), 10);
    if (!isNaN(directAttrZ)) return directAttrZ;

    // Fast check: inspect inline styles and attributes up the tree (0ms, no style recalc!)
    let curr = this.element;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.getAttribute) {
        const attrZ = parseInt(curr.getAttribute('data-lg-z-index'), 10);
        if (!isNaN(attrZ)) return attrZ;
      }
      const inlineZ = curr.style && curr.style.zIndex ? parseInt(curr.style.zIndex, 10) : NaN;
      if (!isNaN(inlineZ) && inlineZ > 0) return inlineZ;
      curr = curr.parentElement;
    }

    if (this._cachedZIndex !== undefined) return this._cachedZIndex;
    const compZ = parseInt(window.getComputedStyle(this.element).zIndex, 10);
    if (!isNaN(compZ) && compZ > 0) return compZ;

    return 20;
  }

  _init() {
    if (!this.element || typeof document === 'undefined') return;

    this._cachedZIndex = this._computeZIndex();

    if (!this.element.style.position) {
      const computed = window.getComputedStyle(this.element);
      if (computed.position === 'static') {
        this.element.style.position = 'relative';
      }
    }
    this.element.style.overflow = 'hidden';

    // Read element's intended CSS background tint, then make CSS background transparent
    // so the individual canvas lens / fused cluster renders the refracted + tinted pixels directly!
    const computed = window.getComputedStyle(this.element);
    const attrTint = this.element.getAttribute('data-lg-tint');
    this._savedBg = attrTint || this.element.style.backgroundColor || computed.backgroundColor;
    this._tint = parseCssRgba(this._savedBg);
    this.element.style.backgroundColor = 'transparent';

    const existingShadow = this.element.style.boxShadow || computed.boxShadow;
    if (!existingShadow || existingShadow === 'none') {
      this._savedShadow = DEFAULT_SHADOW;
      this.element.style.boxShadow = DEFAULT_SHADOW;
    } else {
      this._savedShadow = existingShadow;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'lg-lens-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      border-radius: inherit;
      display: block;
      visibility: visible;
    `;
    this.element.insertBefore(canvas, this.element.firstChild);
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');

    this.element._lgController = this;
    this._rect = null;
    this._rectDirty = true;

    controllerRegistry.add(this);
    attachGlobalStageListeners();

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        this._cachedZIndex = this._computeZIndex();
        this._cachedRadius = undefined;
        this._rectDirty = true;
        scheduleStageRedraw();
      });
      this._ro.observe(this.element);
    }

    if (typeof MutationObserver !== 'undefined') {
      if (this.element.style.backgroundColor && this.element.style.backgroundColor !== 'transparent') {
        this._savedBg = this.element.style.backgroundColor;
        this._tint = parseCssRgba(this._savedBg);
        this.element.style.backgroundColor = 'transparent';
      }
      this._mo = new MutationObserver(() => {
        this._cachedZIndex = this._computeZIndex();
        if (this.element) {
          const newAttrTint = this.element.getAttribute('data-lg-tint');
          if (newAttrTint) {
            this._savedBg = newAttrTint;
            this._tint = parseCssRgba(newAttrTint);
          }
        }
        scheduleStageRedraw(false);
      });
      this._mo.observe(this.element, {
        attributes: true,
        attributeFilter: ['data-lg-tint', 'data-lg-z-index', 'data-lg-shape', 'class']
      });
    }

    this._mounted = true;
    scheduleStageRedraw(true);
  }

  getRect() {
    if (this._isManualPos && this._rect) {
      return this._rect;
    }
    if (this._rect && !this._rectDirty) {
      return this._rect;
    }
    if (!this.element) return null;
    const domRect = this.element.getBoundingClientRect();
    this._rect = {
      left: domRect.left,
      top: domRect.top,
      width: domRect.width,
      height: domRect.height,
      right: domRect.right,
      bottom: domRect.bottom
    };
    this._rectDirty = false;
    return this._rect;
  }

  invalidateRect() {
    if (!this._isManualPos) {
      this._rectDirty = true;
    }
  }

  setRectPosition(x, y) {
    this._isManualPos = true;
    if (!this._rect) {
      this.getRect();
    }
    if (this._rect) {
      this._rect.left = x;
      this._rect.top = y;
      this._rect.right = x + this._rect.width;
      this._rect.bottom = y + this._rect.height;
    }
  }

  clearManualPosition() {
    this._isManualPos = false;
    this._rectDirty = true;
  }

  setZIndex(z) {
    this._cachedZIndex = z;
    if (this.element && this.element.style.zIndex !== String(z)) {
      this.element.style.zIndex = String(z);
    }
  }

  _getRadius() {
    if (!this.element) return 0;
    const inlineRad = parseFloat(this.element.style.borderRadius);
    if (!Number.isNaN(inlineRad)) return inlineRad;
    if (this._cachedRadius !== undefined) return this._cachedRadius;
    const computed = window.getComputedStyle(this.element);
    this._cachedRadius = parseFloat(computed.borderRadius) || 0;
    return this._cachedRadius;
  }

  _getShape() {
    if (!this.element) return 'rect';
    const attrShape = this.element.getAttribute('data-lg-shape');
    if (attrShape) return attrShape;
    const rad = this._getRadius();
    const r = this.getRect();
    if (r && Math.abs(r.width - r.height) < 1.0 && Math.abs(rad - r.width * 0.5) < 1.0) {
      return 'circle';
    }
    return 'rect';
  }

  isTouchingAny(threshold = 40) {
    if (!this.options.fusion || !this.element) return false;
    const r1 = this.element.getBoundingClientRect();
    for (const other of controllerRegistry) {
      if (other === this || !other.element || !other.options.fusion) continue;
      const r2 = other.element.getBoundingClientRect();
      if (areRectsTouching(r1, r2, threshold)) return true;
    }
    return false;
  }

  update(newOptions = {}) {
    const merged = normalizeOptions({ ...this.options, ...newOptions });
    let lutChanged = false;
    let changed = false;

    if (newOptions.enabled !== undefined && Boolean(newOptions.enabled) !== this.enabled) {
      this.enabled = Boolean(newOptions.enabled);
      if (this.element) {
        if (!this.enabled && this._savedBg) {
          this.element.style.backgroundColor = this._savedBg;
        } else if (this.enabled) {
          this.element.style.backgroundColor = 'transparent';
        }
        if (this._canvas) {
          this._canvas.style.display = this.enabled ? 'block' : 'none';
        }
      }
      changed = true;
    }

    if (newOptions.zIndex !== undefined && newOptions.zIndex !== this.options.zIndex) {
      this.options.zIndex = newOptions.zIndex;
      this._cachedZIndex = this._computeZIndex();
      changed = true;
    }

    for (const key of ['rim', 'ior', 'height', 'frosted', 'fusion', 'fusionDistance', 'dpr']) {
      if (merged[key] !== this.options[key]) {
        this.options[key] = merged[key];
        changed = true;
        if (key === 'rim' || key === 'ior' || key === 'height' || key === 'dpr') {
          lutChanged = true;
        }
      }
    }

    if (lutChanged) {
      this._lut = null;
    }
    this._cachedZIndex = this._computeZIndex();
    this._rectDirty = true;
    this._cachedRadius = undefined;
    if (changed) {
      scheduleStageRedraw(true);
    }
  }

  refresh() {
    this._rectDirty = true;
    this._cachedRadius = undefined;
    this._cachedZIndex = this._computeZIndex();
    scheduleStageRedraw(true);
  }

  destroy() {
    controllerRegistry.delete(this);
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    if (this._mo) {
      this._mo.disconnect();
      this._mo = null;
    }
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    if (this.element && this._savedBg) {
      this.element.style.backgroundColor = this._savedBg;
    }
    if (this.element && this._savedShadow !== undefined) {
      this.element.style.boxShadow =
        this._savedShadow === DEFAULT_SHADOW ? '' : this._savedShadow;
    }
    if (this.element && this.element._lgController === this) {
      delete this.element._lgController;
    }
    this._mounted = false;
    scheduleStageRedraw();
  }
}

/**
 * Imperative helper to attach Liquid Glass to any DOM selector or HTMLElement
 * @param {string | HTMLElement} target
 * @param {Object} options
 * @returns {LiquidGlassController}
 */
export function createLiquidGlass(target, options = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  return new LiquidGlassController(el, options);
}
