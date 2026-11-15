/**
 * DOM Surface Cache Painter
 * Renders simplified DOM cards, typography, and images onto an offscreen canvas
 * restricted strictly to active glass element regions with zero animation frame lag.
 */

/**
 * Cleanly resolves a CSS font string for Canvas 2D context
 * Strips CSS variables (e.g. var(--font-inter)) which Canvas 2D silently rejects
 *
 * @param {CSSStyleDeclaration} style
 * @returns {string}
 */
function resolveCanvasFont(style) {
  const weight = style.fontWeight || '400';
  const size = style.fontSize || '16px';
  let family = style.fontFamily || 'sans-serif';

  // Strip CSS variables like var(--font-inter) which Canvas 2D does not parse
  family = family.replace(/var\([^)]+\),?\s*/g, '');
  family = family.replace(/^,\s*|,\s*$/g, '').trim();
  if (!family) {
    family = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  }
  return `${weight} ${size} ${family}`;
}

/**
 * Extracts accurate visual line breaks and bounding boxes from a DOM Text node using Range
 *
 * @param {Text} textNode
 * @param {Range} range
 * @returns {Array<{text: string, rect: DOMRect|{left: number, top: number, right: number, bottom: number, width: number, height: number}}>}
 */
function getLinesFromTextNode(textNode, range) {
  const fullText = textNode.textContent || '';
  if (!fullText.trim()) return [];

  try {
    range.selectNodeContents(textNode);
    const rects = range.getClientRects();
    if (rects.length === 0) return [];
    if (rects.length === 1) {
      return [{ text: fullText.trim(), rect: rects[0] }];
    }

    const parts = fullText.split(/(\s+)/);
    const lines = [];
    let curLineText = '';
    let curLineRect = null;
    let charOffset = 0;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partLen = part.length;
      if (!partLen) continue;

      if (part.trim().length > 0) {
        range.setStart(textNode, charOffset);
        range.setEnd(textNode, charOffset + partLen);
        const wordRect = range.getBoundingClientRect();

        if (!curLineRect) {
          curLineRect = {
            left: wordRect.left,
            top: wordRect.top,
            right: wordRect.right,
            bottom: wordRect.bottom,
            width: wordRect.width,
            height: wordRect.height
          };
          curLineText = part;
        } else if (Math.abs(wordRect.top - curLineRect.top) < Math.max(8, wordRect.height * 0.5)) {
          // Same visual line
          curLineText += part;
          curLineRect.left = Math.min(curLineRect.left, wordRect.left);
          curLineRect.right = Math.max(curLineRect.right, wordRect.right);
          curLineRect.bottom = Math.max(curLineRect.bottom, wordRect.bottom);
          curLineRect.width = curLineRect.right - curLineRect.left;
          curLineRect.height = Math.max(curLineRect.height, wordRect.height);
        } else {
          // Next visual line
          if (curLineText.trim()) {
            lines.push({ text: curLineText.trim(), rect: curLineRect });
          }
          curLineRect = {
            left: wordRect.left,
            top: wordRect.top,
            right: wordRect.right,
            bottom: wordRect.bottom,
            width: wordRect.width,
            height: wordRect.height
          };
          curLineText = part;
        }
      } else {
        if (curLineRect) {
          curLineText += part;
        }
      }
      charOffset += partLen;
    }

    if (curLineText.trim() && curLineRect) {
      lines.push({ text: curLineText.trim(), rect: curLineRect });
    }

    return lines;
  } catch {
    const r = textNode.parentElement ? textNode.parentElement.getBoundingClientRect() : null;
    return r ? [{ text: fullText.trim(), rect: r }] : [];
  }
}

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
exports.paintDomSurfaces = function paintDomSurfaces(ctx, dpr, vw, bw, bh, minY, maxY, originY, clusterBoxes = null) {
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

      domCacheCtx.save();
      domCacheCtx.beginPath();
      if (typeof domCacheCtx.roundRect === 'function') {
        domCacheCtx.roundRect(r.left, r.top, r.width, r.height, rad);
      } else {
        domCacheCtx.rect(r.left, r.top, r.width, r.height);
      }

      const bgImg = style.backgroundImage;
      const inlineBg = el.style && el.style.background;
      const compBg = style.backgroundColor;
      const hasRealBg =
        (bgImg && bgImg.includes('gradient')) ||
        (inlineBg && inlineBg.includes('gradient')) ||
        (compBg && compBg !== 'transparent' && compBg !== 'rgba(0, 0, 0, 0)');

      if ((bgImg && bgImg.includes('gradient')) || (inlineBg && inlineBg.includes('gradient'))) {
        const g = domCacheCtx.createLinearGradient(r.left, r.top, r.right, r.bottom);
        g.addColorStop(0, '#fb923c');
        g.addColorStop(0.5, '#ec4899');
        g.addColorStop(1, '#a855f7');
        domCacheCtx.fillStyle = g;
        domCacheCtx.fill();
      } else if (hasRealBg) {
        domCacheCtx.fillStyle = compBg;
        domCacheCtx.fill();
      }

      const bWidth = parseFloat(style.borderTopWidth) || 0;
      const bStyle = style.borderTopStyle;
      const bColor = style.borderTopColor;
      if (bWidth > 0 && bStyle !== 'none' && bColor && bColor !== 'transparent' && bColor !== 'rgba(0, 0, 0, 0)') {
        domCacheCtx.lineWidth = bWidth;
        domCacheCtx.strokeStyle = bColor;
        domCacheCtx.stroke();
      }
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

    // 3. Draw visible typography and text elements across <main> and <footer>
    const textContainers = document.querySelectorAll(
      'main h1, main h2, main h3, main h4, main h5, main h6, main p, main button, main a, main label, main input, main textarea, main span.bg-clip-text, footer p, footer a, footer button'
    );

    const range = typeof document.createRange === 'function' ? document.createRange() : null;

    for (let i = 0; i < textContainers.length; i++) {
      const el = textContainers[i];
      // Skip links that wrap whole card blocks
      if (el.tagName === 'A' && el.querySelector('img, h3, h2, div')) continue;
      // Skip spans that are already inside a heading or paragraph (their text nodes are processed by the parent container)
      if (el.tagName === 'SPAN' && el.closest('h1, h2, h3, h4, h5, h6, p, button, a')) continue;

      const r = el.getBoundingClientRect();
      if (r.bottom < minY || r.top > maxScanY || r.height <= 0 || r.width <= 0) continue;
      if (!intersectsAnyCluster(r)) continue;

      // Collect all text nodes inside this container
      const textNodes = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.trim().length > 0) {
          textNodes.push(node);
        }
      }

      for (let tIdx = 0; tIdx < textNodes.length; tIdx++) {
        const textNode = textNodes[tIdx];
        const parent = textNode.parentElement || el;
        const parentStyle = window.getComputedStyle(parent);
        const parentCls = typeof parent.className === 'string' ? parent.className : '';

        // Check if this text node is part of a gradient span
        const isGradient =
          parentCls.includes('bg-clip-text') ||
          parentStyle.webkitBackgroundClip === 'text' ||
          parentStyle.backgroundClip === 'text';

        const lines = range ? getLinesFromTextNode(textNode, range) : null;
        if (!lines || lines.length === 0) continue;

        domCacheCtx.save();
        domCacheCtx.font = resolveCanvasFont(parentStyle);
        domCacheCtx.textBaseline = 'top';
        domCacheCtx.textAlign = 'left';

        if ('letterSpacing' in domCacheCtx && parentStyle.letterSpacing && parentStyle.letterSpacing !== 'normal') {
          domCacheCtx.letterSpacing = parentStyle.letterSpacing;
        }

        const parentRect = parent.getBoundingClientRect();

        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
          const line = lines[lIdx];
          const lr = line.rect;
          if (lr.bottom < minY || lr.top > maxScanY) continue;

          if (isGradient) {
            const gradLeft = parentRect.left;
            const gradRight = parentRect.right > gradLeft ? parentRect.right : (lr.right || gradLeft + 100);
            const grad = domCacheCtx.createLinearGradient(gradLeft, lr.top, gradRight, lr.top);
            grad.addColorStop(0, '#fb923c');
            grad.addColorStop(0.5, '#ec4899');
            grad.addColorStop(1, '#a855f7');
            domCacheCtx.fillStyle = grad;
          } else {
            const col = parentStyle.color;
            domCacheCtx.fillStyle =
              col && col.startsWith('rgb') && col !== 'rgba(0, 0, 0, 0)' && col !== 'transparent'
                ? col
                : '#f1f5f9';
          }

          domCacheCtx.fillText(line.text, lr.left, lr.top);
        }

        domCacheCtx.restore();
      }
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
exports.renderDomSurfacesToCache = function renderDomSurfacesToCache(
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
  paintDomSurfaces(domCacheCtx, dpr, vw, bw, bh, -40, vh + 40, 0, clusterBoxes);
}
