/**
 * Universal DOM Controller: turns any HTMLElement into an interactive Liquid Glass surface
 * using Screen-Space WebGL or pure 2D Canvas + TypedArray LUT & Cluster Fusion fallback.
 */

import { normalizeOptions } from './options.mjs';
import { parseCssRgba, areRectsTouching } from './dom.mjs';
import {
  controllerRegistry,
  scheduleStageRedraw,
  attachGlobalStageListeners
} from './stage.mjs';

export class LiquidGlassController {
  constructor(element, options = {}) {
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
    const attrZ = parseInt(this.element.getAttribute('data-lg-z-index'), 10);
    if (!isNaN(attrZ)) return attrZ;

    const inlineZ = parseInt(this.element.style.zIndex, 10);
    if (!isNaN(inlineZ) && inlineZ > 0) return inlineZ;

    const computed = window.getComputedStyle(this.element);
    const compZ = parseInt(computed.zIndex, 10);
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
    // so the WebGL screen-space canvas underneath renders the refracted + tinted pixels directly!
    const computed = window.getComputedStyle(this.element);
    const attrTint = this.element.getAttribute('data-lg-tint');
    this._savedBg = attrTint || this.element.style.backgroundColor || computed.backgroundColor;
    this._tint = parseCssRgba(this._savedBg);
    this.element.style.backgroundColor = 'transparent';

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
        attributeFilter: ['data-lg-tint', 'data-lg-z-index', 'class']
      });
    }

    this._mounted = true;
    scheduleStageRedraw(true);
  }

  getRect() {
    if (!this._rect || this._rectDirty) {
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
    }
    return this._rect;
  }

  setRectPosition(x, y) {
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
      }
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
    if (changed) {
      scheduleStageRedraw(true);
    }
  }

  refresh() {
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
