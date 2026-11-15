/**
 * DOM Surface Cache Painter
 * Renders simplified DOM cards, typography, and images onto an offscreen canvas
 * restricted strictly to active glass element regions with zero animation frame lag.
 */

/**
 * Paints simplified DOM surfaces whose viewport rects intersect [minY, maxY]
 * and any of the active cluster regions into ctx.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} dpr
 * @param {number} vw
 * @param {number} bw
 * @param {number} bh
 * @param {number} minY
 * @param {number} maxY
 * @param {number} originY
 * @param {Array<{left: number, top: number, right: number, bottom: number}>|null} clusterBoxes
 */
export function paintDomSurfaces(ctx, dpr, vw, bw, bh, minY, maxY, originY, clusterBoxes = null) {
  if (typeof document === 'undefined') return;

  const domCacheCtx = ctx;
  const maxScanY = maxY;
  domCacheCtx.clearRect(0, 0, bw, bh);
  domCacheCtx.save();
  domCacheCtx.scale(dpr, dpr);
  domCacheCtx.translate(0, -originY);

  // When cluster regions are provided, clip canvas strictly to those regions
  if (clusterBoxes && clusterBoxes.length > 0) {
    domCacheCtx.beginPath();
    for (let b = 0; b < clusterBoxes.length; b++) {
      const box = clusterBoxes[b];
      domCacheCtx.rect(
        box.left,
        box.top - originY,
        box.right - box.left,
        box.bottom - box.top
      );
    }
    domCacheCtx.clip();
  }

  const intersectsAnyCluster = (r) => {
    if (!clusterBoxes || clusterBoxes.length === 0) return true;
    for (let i = 0; i < clusterBoxes.length; i++) {
      const b = clusterBoxes[i];
      if (!(r.left > b.right || r.right < b.left || r.top > b.bottom || r.bottom < b.top)) {
        return true;
      }
    }
    return false;
  };

  const mainEl = document.querySelector('main, footer');
  if (mainEl) {
    // 1. Draw visible block surfaces (cards, buttons, pills, inputs) inside <main> and <footer>
    const surfaceEls = document.querySelectorAll(
      'main div.rounded-2xl, main div.rounded-xl, main a.rounded-2xl, main a.rounded-xl, main button, main a.inline-flex, main input, main textarea, main span.rounded-lg, main span.rounded-full'
    );
    for (let i = 0; i < surfaceEls.length; i++) {
      const el = surfaceEls[i];
      const r = el.getBoundingClientRect();
      if (r.bottom < minY || r.top > maxScanY || r.width <= 2 || r.height <= 2) continue;
      if (!intersectsAnyCluster(r)) continue;

      const style = window.getComputedStyle(el);
      const rad = Math.min(parseFloat(style.borderRadius) || 12, r.width * 0.5, r.height * 0.5);
      const cls = typeof el.className === 'string' ? el.className : '';

      domCacheCtx.save();
      domCacheCtx.beginPath();
      if (typeof domCacheCtx.roundRect === 'function') {
        domCacheCtx.roundRect(r.left, r.top, r.width, r.height, rad);
      } else {
        domCacheCtx.rect(r.left, r.top, r.width, r.height);
      }

      const bgImg = style.backgroundImage;
      const inlineBg = el.style && el.style.background;
      if ((bgImg && bgImg.includes('gradient')) || (inlineBg && inlineBg.includes('gradient'))) {
        const g = domCacheCtx.createLinearGradient(r.left, r.top, r.right, r.bottom);
        g.addColorStop(0, '#fb923c');
        g.addColorStop(0.5, '#ec4899');
        g.addColorStop(1, '#a855f7');
        domCacheCtx.fillStyle = g;
        domCacheCtx.fill();
      } else if (el.style && el.style.backgroundColor) {
        domCacheCtx.fillStyle = el.style.backgroundColor;
        domCacheCtx.fill();
      } else if (cls.includes('bg-slate-950')) {
        domCacheCtx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        domCacheCtx.fill();
      } else {
        domCacheCtx.fillStyle = 'rgba(30, 41, 59, 0.88)';
        domCacheCtx.fill();
      }

      const bWidth = parseFloat(style.borderTopWidth) || 1.5;
      domCacheCtx.lineWidth = Math.max(1.5, bWidth);
      if (el.style && el.style.borderColor) {
        domCacheCtx.strokeStyle = el.style.borderColor;
      } else {
        domCacheCtx.strokeStyle = 'rgba(148, 163, 184, 0.82)';
      }
      domCacheCtx.stroke();
      domCacheCtx.restore();
    }

    // 2. Draw visible images inside <main>
    const imgs = document.querySelectorAll('main img');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img.complete || img.naturalWidth === 0) continue;
      const r = img.getBoundingClientRect();
      if (r.bottom < minY || r.top > maxScanY || r.right < 0 || r.left > vw) continue;
      if (!intersectsAnyCluster(r)) continue;

      try {
        domCacheCtx.save();
        const parent = img.parentElement;
        const pStyle = parent ? window.getComputedStyle(parent) : null;
        const pRad = pStyle ? parseFloat(pStyle.borderRadius) || 0 : 0;
        if (pRad > 0 && typeof domCacheCtx.roundRect === 'function') {
          domCacheCtx.beginPath();
          domCacheCtx.roundRect(r.left, r.top, r.width, r.height, pRad);
          domCacheCtx.clip();
        }
        domCacheCtx.drawImage(img, r.left, r.top, r.width, r.height);
        domCacheCtx.restore();
      } catch {
        domCacheCtx.restore();
      }
    }

    // 3. Draw visible text, headings, buttons & labels
    const textEls = document.querySelectorAll(
      'main h1, main h2, main h3, main p, main button, main a, main label, main input, main textarea, main span.font-mono, main span.rounded-full, main span.bg-clip-text, main div.rounded-xl span, main div.rounded-2xl span, footer p, footer a, footer button, footer span'
    );
    for (let i = 0; i < textEls.length; i++) {
      const el = textEls[i];
      if (el.tagName === 'A' && el.querySelector('img, h3')) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < minY || r.top > maxScanY || r.height <= 0 || r.width <= 0) continue;
      if (!intersectsAnyCluster(r)) continue;

      const tag = el.tagName;
      const style = window.getComputedStyle(el);
      const cls = typeof el.className === 'string' ? el.className : '';
      domCacheCtx.save();
      domCacheCtx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      domCacheCtx.textBaseline = 'top';
      if (tag === 'H1' || tag === 'H2' || tag === 'H3' || cls.includes('bg-clip-text')) {
        const grad = domCacheCtx.createLinearGradient(r.left, r.top, r.right, r.top);
        if (cls.includes('bg-clip-text') && tag === 'SPAN') {
          grad.addColorStop(0, '#fb923c');
          grad.addColorStop(0.5, '#ec4899');
          grad.addColorStop(1, '#a855f7');
        } else {
          grad.addColorStop(0, '#f8fafc');
          grad.addColorStop(0.55, '#f8fafc');
          grad.addColorStop(0.75, '#fb923c');
          grad.addColorStop(0.9, '#ec4899');
          grad.addColorStop(1, '#a855f7');
        }
        domCacheCtx.fillStyle = grad;
      } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
        domCacheCtx.fillStyle = '#94a3b8';
      } else {
        const col = style.color;
        domCacheCtx.fillStyle = col && col.startsWith('rgb') ? col : '#f1f5f9';
      }
      const rawText =
        tag === 'INPUT' || tag === 'TEXTAREA'
          ? el.value || el.getAttribute('placeholder') || ''
          : el.textContent || '';
      const text = rawText.trim().replace(/\s+/g, ' ');
      if (!text) {
        domCacheCtx.restore();
        continue;
      }
      const fontSizePx = parseFloat(style.fontSize) || 16;
      const isButtonOrPill =
        tag === 'BUTTON' ||
        tag === 'A' ||
        tag === 'INPUT' ||
        style.display.includes('inline-flex') ||
        cls.includes('rounded-full') ||
        cls.includes('rounded-lg');
      let y = isButtonOrPill ? r.top + (r.height - fontSizePx) * 0.5 : r.top;
      const isCentered = style.textAlign === 'center' || (isButtonOrPill && tag !== 'INPUT');
      domCacheCtx.textAlign = isCentered ? 'center' : 'left';
      const drawX = isCentered ? r.left + r.width * 0.5 : r.left + (tag === 'INPUT' ? 12 : 0);

      if (!isButtonOrPill && r.width > 20) {
        domCacheCtx.fillText(text, drawX, y, r.width);
      } else {
        domCacheCtx.fillText(text, drawX, y);
      }
      domCacheCtx.restore();
    }
  }
  domCacheCtx.restore();
}

/**
 * Caches DOM surface cards, typography and images onto a separate offscreen canvas
 * Recomputed ONLY on scroll, resize, or DOM mutations so animation frames take < 0.1ms
 *
 * @param {HTMLCanvasElement} domCacheCanvas
 * @param {CanvasRenderingContext2D} domCacheCtx
 * @param {Set} controllerRegistry
 * @param {number} dpr
 * @param {number} vw
 * @param {number} vh
 * @param {number} bw
 * @param {number} bh
 * @param {Array<{left: number, top: number, right: number, bottom: number}>|null} clusterBoxes
 */
export function renderDomSurfacesToCache(
  domCacheCanvas,
  domCacheCtx,
  controllerRegistry,
  dpr,
  vw,
  vh,
  bw,
  bh,
  clusterBoxes = null
) {
  if (!domCacheCanvas || !domCacheCtx) return;
  let maxScanY = vh + 20;
  if (controllerRegistry && controllerRegistry.size > 0) {
    let m = 0;
    for (const ctrl of controllerRegistry) {
      if (ctrl._mounted && ctrl.enabled && ctrl.element) {
        const r = ctrl.element.getBoundingClientRect();
        if (r.bottom > m) m = r.bottom;
      }
    }
    if (m > 0 && m < vh * 0.7) {
      maxScanY = Math.ceil(m + 40);
    }
  }
  paintDomSurfaces(domCacheCtx, dpr, vw, bw, bh, -20, maxScanY, 0, clusterBoxes);
}
