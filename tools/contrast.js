// What "readable" means, measured: the contrast of every text on a page against what it is actually drawn on.
//
// auditPage runs IN a page (it is handed to page.evaluate, so it names nothing outside itself): for every element that shows
// text it works the background out layer by layer up the page (translucent colours composited over what is behind them; a
// gradient counted at its worst stop), composites the text colour over that, and reports the ones under the bar —
// 4.5:1 for ordinary text, 3:1 for large text and for icons that carry meaning (WCAG 1.4.3 / 1.4.11). Shared by the audit of
// the classic portals (tests/themeaudit.js) and of the new app's gallery (tests/galleryaudit.js).
// Runs in the page: [{ sig, text, fg, bg, ratio, need }] for everything that shows text.
function auditPage() {
  const parse = c => {
    c = String(c).trim();
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(c);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4])];
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(c);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4])];
    // oklch(), color-mix in another space, display-p3…: a canvas turns any colour into sRGB bytes
    if (/^(oklch|oklab|lch|lab|hwb|hsl|color)\(/.test(c)) {
      const x = (parse.cv = parse.cv || document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
      x.canvas.width = x.canvas.height = 1; x.fillStyle = '#ff00ff'; x.fillStyle = c; x.fillRect(0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    }
    return null;
  };
  const over = (top, under) => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map(i => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a);
  };
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  // the colour stops of a (computed) gradient, as the solid colours a text on it could meet
  // (only the topmost layer: with a border-box gradient behind a padding-box one, the content sits on the top one)
  const topLayer = img => { let depth = 0; for (let i = 0; i < img.length; i++) { if (img[i] === '(') depth++; else if (img[i] === ')') depth--; else if (img[i] === ',' && depth === 0) return img.slice(0, i); } return img; };
  const stops = img => [...topLayer(img).matchAll(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g)].map(m => parse(m[0])).filter(Boolean);

  // What an element is drawn on: a list of candidate solid colours (one unless a gradient is
  // involved), worked out from the element's own background up to the first opaque layer.
  const ground = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const solid = parse(cs.backgroundColor) || [0, 0, 0, 0];
      const img = cs.backgroundImage;
      if (img && img !== 'none') {
        if (/url\(/.test(img) && !/gradient/.test(img)) layers.push({ unknown: true });
        else { const s = stops(img); if (s.length) layers.push({ stops: s }); }
      }
      layers.push({ solid });
      if (solid[3] === 1 && !(img && img !== 'none')) break;
    }
    let candidates = [[255, 255, 255, 1]];   // the browser's canvas, if nothing above is opaque
    for (const l of layers.reverse()) {
      if (l.unknown) return null;
      if (l.stops) candidates = candidates.flatMap(u => l.stops.map(s => over(s, u)));
      else candidates = candidates.map(u => over(l.solid, u));
    }
    return candidates;
  };

  const out = [];
  const seen = new Set();
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'OPTION', 'SVG', 'CANVAS', 'PATH', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OPTGROUP'].includes(el.tagName.toUpperCase())) continue;
    if (el.closest('svg, canvas, iframe')) continue;
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    text = text.replace(/\s+/g, ' ').trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.closest('[disabled], [aria-disabled="true"], .disabled')) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const cand = ground(el);
    if (!cand) continue;
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    let worst = 99, worstBg = null;
    for (const bg of cand) {
      const solidBg = bg[3] < 1 ? over(bg, [255, 255, 255, 1]) : bg;
      const text = fg[3] < 1 ? over(fg, solidBg) : fg;
      const rr = ratio(text, solidBg);
      if (rr < worst) { worst = rr; worstBg = solidBg; }
    }
    if (worst >= need) continue;
    const sig = el.localName + (el.getAttribute('class') ? '.' + el.getAttribute('class').trim().split(/\s+/).slice(0, 3).join('.') : '');
    const parent = el.parentElement ? el.parentElement.localName + (el.parentElement.getAttribute('class') ? '.' + el.parentElement.getAttribute('class').trim().split(/\s+/)[0] : '') : '';
    const key = sig + '|' + hex(fg) + '|' + hex(worstBg);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sig, parent, text: text.slice(0, 28), fg: hex(fg), bg: hex(worstBg), ratio: Math.round(worst * 100) / 100, need });
  }
  // Icons: a graphic that carries meaning is held to 3:1 (WCAG 1.4.11), drawn in the colour it inherits.
  for (const el of document.body.querySelectorAll('svg.lucide')) {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (el.closest('[disabled], [aria-disabled="true"], .disabled')) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const cand = ground(el);
    if (!cand) continue;
    let worst = 99, worstBg = null;
    for (const bg of cand) {
      const solidBg = bg[3] < 1 ? over(bg, [255, 255, 255, 1]) : bg;
      const ink = fg[3] < 1 ? over(fg, solidBg) : fg;
      const rr = ratio(ink, solidBg);
      if (rr < worst) { worst = rr; worstBg = solidBg; }
    }
    if (worst >= 3) continue;
    const name = (el.getAttribute('class') || '').match(/lucide-([a-z0-9-]+)/);
    const sig = 'icon ' + (name ? name[1] : '?');
    const p = el.parentElement;
    const parent = p ? p.localName + (p.getAttribute('class') ? '.' + p.getAttribute('class').trim().split(/\s+/)[0] : '') : '';
    const key = sig + '|' + parent + '|' + hex(fg) + '|' + hex(worstBg);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sig, parent, text: '', fg: hex(fg), bg: hex(worstBg), ratio: Math.round(worst * 100) / 100, need: 3 });
  }
  return out;
}

module.exports = { auditPage };
