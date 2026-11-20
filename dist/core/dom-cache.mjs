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

// WeakMap cache for downscaled image thumbnails to prevent live 4.5MP resampling on every scroll frame
const imgThumbCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

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
    if (rects.length === 0) {
      const pRect = textNode.parentElement ? textNode.parentElement.getBoundingClientRect() : null;
      if (pRect && pRect.width > 0 && pRect.height > 0) {
        return [{ text: fullText.trim(), rect: pRect }];
      }
      return [];
    }
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
      'main [class*="backdrop-blur"], footer [class*="backdrop-blur"], main div.rounded-2xl, main div.rounded-xl, main div.rounded-lg, main a.rounded-2xl, main a.rounded-xl, main a.rounded-lg, main button, main a.inline-flex, main input, main textarea, main span.rounded-lg, main span.rounded-full, main span.rounded-md, footer div.rounded-2xl, footer a, footer button'
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

      // Step 1: Opaque base fill (#080e1d).
      // Solidly fills the card path with 100% opaque dark background before drawing any tints.
      // This is the absolute guarantee that background canvas particles underneath the card
      // are 100% blocked and occluded, matching CSS backdrop-blur behavior!
      domCacheCtx.fillStyle = '#080e1d';
      domCacheCtx.fill();

      const bgImg = style.backgroundImage;
      const inlineBg = el.style && el.style.background;
      const compBg = style.backgroundColor;
      const hasRealBg =
        (bgImg && bgImg.includes('gradient')) ||
        (inlineBg && inlineBg.includes('gradient')) ||
        (compBg && compBg !== 'transparent' && compBg !== 'rgba(0, 0, 0, 0)');

      // Step 2: Composite the card's real background on top of the solid base.
      // Canvas 2D will blend compBg (whether rgba, color(srgb...), or color-mix) directly
      // over #080e1d, keeping the resulting alpha at 1.0!
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
        const pRad = parent && parent.className && typeof parent.className === 'string' && parent.className.includes('rounded')
          ? 16
          : 0;
        if (pRad > 0 && typeof domCacheCtx.roundRect === 'function') {
          domCacheCtx.beginPath();
          domCacheCtx.roundRect(r.left, r.top, r.width, r.height, pRad);
          domCacheCtx.clip();
        }

        let sourceToDraw = img;
        const targetW = Math.max(1, Math.round(r.width * dpr));
        const targetH = Math.max(1, Math.round(r.height * dpr));

        // High-performance thumbnail caching:
        // Downscaling massive 3K/4K images (e.g. 2880x1576) in Canvas 2D takes ~14ms per frame on CPU/GPU.
        // We cache a downsampled offscreen canvas thumbnail ONCE, dropping frame draw cost from 14ms to 0.02ms!
        if (imgThumbCache && (img.naturalWidth > targetW * 1.3 || img.naturalHeight > targetH * 1.3)) {
          let cached = imgThumbCache.get(img);
          if (!cached || cached.width !== targetW || cached.height !== targetH) {
            const off = document.createElement('canvas');
            off.width = targetW;
            off.height = targetH;
            const offCtx = off.getContext('2d');
            if (offCtx) {
              offCtx.drawImage(img, 0, 0, targetW, targetH);
              cached = { canvas: off, width: targetW, height: targetH };
              imgThumbCache.set(img, cached);
            }
          }
          if (cached && cached.canvas) {
            sourceToDraw = cached.canvas;
          }
        }

        domCacheCtx.drawImage(sourceToDraw, r.left, r.top, r.width, r.height);
        domCacheCtx.restore();
      } catch {
        domCacheCtx.restore();
      }
    }

    // 3. Draw visible typography and text elements across <main> and <footer>
    const textContainers = document.querySelectorAll(
      'main h1, main h2, main h3, main h4, main h5, main h6, main p, main button, main a, main label, main input, main textarea, main span, footer p, footer a, footer button, footer span'
    );

    const range = typeof document.createRange === 'function' ? document.createRange() : null;

    for (let i = 0; i < textContainers.length; i++) {
      const el = textContainers[i];
      // Skip links that wrap whole card blocks
      if (el.tagName === 'A' && el.querySelector('img, h3, h2, div')) continue;
      // Skip spans whose text is already processed by an ancestor container (h1-h6, p, button, label, simple a)
      if (el.tagName === 'SPAN') {
        const ancestor = el.closest('h1, h2, h3, h4, h5, h6, p, button, label, a');
        if (ancestor && ancestor !== el) {
          // If the ancestor is an 'A' card wrapper, that 'A' was skipped above, so do NOT skip its child spans!
          const isCardLink = ancestor.tagName === 'A' && ancestor.querySelector('img, h3, h2, div');
          if (!isCardLink) {
            continue;
          }
        }
        // Avoid double-rendering nested spans (e.g. <span><span>View</span></span>)
        if (el.parentElement && el.parentElement.tagName === 'SPAN') {
          continue;
        }
      }

      const r = el.getBoundingClientRect();
      if (r.bottom < minY || r.top > maxScanY || r.height <= 0 || r.width <= 0) continue;
      if (!intersectsAnyCluster(r)) continue;

      // Handle INPUT and TEXTAREA placeholder / value rendering
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const inputEl = /** @type {HTMLInputElement|HTMLTextAreaElement} */ (el);
        const textToShow = inputEl.value || inputEl.placeholder || '';
        if (textToShow.trim().length > 0) {
          const isPlaceholder = !inputEl.value && !!inputEl.placeholder;
          const style = window.getComputedStyle(el);
          domCacheCtx.save();
          domCacheCtx.font = resolveCanvasFont(style);
          domCacheCtx.textAlign = 'left';
          domCacheCtx.fillStyle = isPlaceholder ? 'rgba(148, 163, 184, 0.7)' : (style.color || '#f1f5f9');
          const padLeft = parseFloat(style.paddingLeft) || 12;
          const padTop = parseFloat(style.paddingTop) || 10;
          if (el.tagName === 'TEXTAREA') {
            domCacheCtx.textBaseline = 'top';
            domCacheCtx.fillText(textToShow, r.left + padLeft, r.top + padTop);
          } else {
            domCacheCtx.textBaseline = 'middle';
            domCacheCtx.fillText(textToShow, r.left + padLeft, r.top + r.height * 0.5);
          }
          domCacheCtx.restore();
        }
        continue;
      }

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

        const totalChars = isGradient
          ? lines.reduce((acc, l) => acc + (l.text ? l.text.length : 0), 0)
          : 0;
        let cumulativeChars = 0;

        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
          const line = lines[lIdx];
          const lr = line.rect;
          const lineLen = line.text ? line.text.length : 0;
          if (lr.bottom < minY || lr.top > maxScanY) {
            cumulativeChars += lineLen;
            continue;
          }

          if (isGradient) {
            // Physically accurate multi-line gradient projection:
            // Slices continuous CSS gradient across wrapped lines so words at the end
            // of a line do NOT prematurely turn purple when the gradient spans across to the next line!
            const tStart = totalChars > 0 ? cumulativeChars / totalChars : 0;
            const tEnd = totalChars > 0 ? (cumulativeChars + lineLen) / totalChars : 1;
            const lineSpan = Math.max(0.001, tEnd - tStart);
            const lineWidth = Math.max(10, lr.right - lr.left);
            const fullVirtualWidth = lineWidth / lineSpan;
            const gradLeft = lr.left - tStart * fullVirtualWidth;
            const gradRight = gradLeft + fullVirtualWidth;

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

          // Support for text-decoration: underline
          const hasUnderline =
            parentCls.includes('underline') ||
            (parentStyle.textDecoration && parentStyle.textDecoration.includes('underline')) ||
            (parentStyle.textDecorationLine && parentStyle.textDecorationLine.includes('underline'));

          if (hasUnderline) {
            domCacheCtx.save();
            domCacheCtx.strokeStyle = domCacheCtx.fillStyle;
            domCacheCtx.lineWidth = Math.max(1, Math.round((parseFloat(parentStyle.fontSize) || 14) * 0.08));
            domCacheCtx.beginPath();
            const underlineY = Math.round(lr.bottom - 1.5);
            domCacheCtx.moveTo(lr.left, underlineY);
            domCacheCtx.lineTo(lr.right, underlineY);
            domCacheCtx.stroke();
            domCacheCtx.restore();
          }

          cumulativeChars += lineLen;
        }

        domCacheCtx.restore();
      }
    }

    // 4. Draw visible inline vector icons (<svg>) across <main> and <footer>
    const svgEls = document.querySelectorAll('main svg, footer svg');
    for (let i = 0; i < svgEls.length; i++) {
      const svg = svgEls[i];
      const r = svg.getBoundingClientRect();
      if (r.bottom < minY || r.top > maxScanY || r.width <= 2 || r.height <= 2) continue;
      if (!intersectsAnyCluster(r)) continue;

      const style = window.getComputedStyle(svg);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

      const strokeCol = style.stroke && style.stroke !== 'none' ? style.stroke : (style.color || '#cbd5e1');
      const fillCol = style.fill && style.fill !== 'none' ? style.fill : 'none';

      let vbW = 24, vbH = 24;
      const vb = svg.getAttribute('viewBox');
      if (vb) {
        const parts = vb.trim().split(/[\s,]+/);
        if (parts.length === 4) {
          vbW = parseFloat(parts[2]) || 24;
          vbH = parseFloat(parts[3]) || 24;
        }
      }

      const scaleX = r.width / vbW;
      const scaleY = r.height / vbH;

      domCacheCtx.save();
      domCacheCtx.translate(r.left, r.top);
      domCacheCtx.scale(scaleX, scaleY);

      const paths = svg.querySelectorAll('path, line, polyline, polygon, circle, rect');
      for (let p = 0; p < paths.length; p++) {
        const child = paths[p];
        const tag = child.tagName.toLowerCase();
        domCacheCtx.beginPath();

        if (tag === 'path') {
          const d = child.getAttribute('d');
          if (d && typeof Path2D !== 'undefined') {
            try {
              const p2d = new Path2D(d);
              if (fillCol !== 'none') {
                domCacheCtx.fillStyle = fillCol;
                domCacheCtx.fill(p2d);
              }
              if (strokeCol !== 'none') {
                const sw = parseFloat(child.getAttribute('stroke-width') || style.strokeWidth || '2');
                domCacheCtx.strokeStyle = strokeCol;
                domCacheCtx.lineWidth = sw;
                domCacheCtx.lineCap = 'round';
                domCacheCtx.lineJoin = 'round';
                domCacheCtx.stroke(p2d);
              }
              continue;
            } catch {
              // fallback
            }
          }
        } else if (tag === 'line') {
          const x1 = parseFloat(child.getAttribute('x1') || '0');
          const y1 = parseFloat(child.getAttribute('y1') || '0');
          const x2 = parseFloat(child.getAttribute('x2') || '0');
          const y2 = parseFloat(child.getAttribute('y2') || '0');
          domCacheCtx.moveTo(x1, y1);
          domCacheCtx.lineTo(x2, y2);
        } else if (tag === 'circle') {
          const cx = parseFloat(child.getAttribute('cx') || '0');
          const cy = parseFloat(child.getAttribute('cy') || '0');
          const cr = parseFloat(child.getAttribute('r') || '0');
          domCacheCtx.arc(cx, cy, cr, 0, Math.PI * 2);
        }

        if (fillCol !== 'none') {
          domCacheCtx.fillStyle = fillCol;
          domCacheCtx.fill();
        }
        if (strokeCol !== 'none') {
          const sw = parseFloat(child.getAttribute('stroke-width') || style.strokeWidth || '2');
          domCacheCtx.strokeStyle = strokeCol;
          domCacheCtx.lineWidth = sw;
          domCacheCtx.lineCap = 'round';
          domCacheCtx.lineJoin = 'round';
          domCacheCtx.stroke();
        }
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
  scanMinY = -40,
  scanMaxY = 0,
  clusterBoxes = null
) {
  if (!domCacheCanvas || !domCacheCtx) return;
  const effMaxY = scanMaxY > 0 ? scanMaxY : vh + 40;
  paintDomSurfaces(domCacheCtx, dpr, vw, bw, bh, scanMinY, effMaxY, 0, clusterBoxes);
}
