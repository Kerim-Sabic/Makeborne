// Per-page website instruments (QUALITY_BAR W6, W7, W9, W10, W13–W17 and the
// D1–D4 identity inputs). measurePage() is called by the measure orchestrator
// on a page that is already being served: a Makeborne build on the local static
// server, or a competitor capture replayed from a HAR (the caller attaches
// routeFromHAR in onContext, or supplies its own newContext factory).
//
// Each width is loaded twice: prefers-reduced-motion "reduce" (content simply
// there) and "no-preference" after scrolling top → bottom → top so every reveal
// has fired. axe, contrast and overflow run in both; the worse result counts and
// the failing mode is recorded. W7 adds loads at 390 and 1440 (VITALS_LOADS per
// width × mode in all) and W9 adds a touch-emulated load at 360/390 when the
// root clips overflow. One failing instrument never aborts the others: its key
// holds {error}.
//
// The in-page functions below are serialised by Playwright, so each is
// self-contained; shared in-page helpers live on window.__mb (installHelpers).
import path from 'node:path';
import assert from 'node:assert/strict';
import { readFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { EVAL_DIR, REPO, OUT, ensureDir, writeJson, rel } from '../paths.mjs';
import { WIDTHS, HEIGHTS, FIRST_SCREENS, BANNED_COPY, LABEL_HEADINGS, WEBSITE } from '../thresholds.mjs';
import { ciede2000, hexToLab } from '../diversity.mjs';
import { median } from '../stats.mjs';

const AXE_PATH = path.join(EVAL_DIR, 'node_modules', 'axe-core', 'axe.min.js');
const WEB_VITALS_PATH = path.join(EVAL_DIR, 'node_modules', 'web-vitals', 'dist', 'web-vitals.iife.js');
const FONT_CATALOG = path.join(REPO, 'infra', 'project-runtime', 'font-catalog.json');
// What the platform, not the site, adds to a published page: the "Made with
// Makeborne" badge composeSiteDocument() appends (infra/customer-sites/site-policy.js,
// <footer data-makeborne-attribution>). Excluded from the W15 tells and the
// identity colours; still counted by axe, contrast and the other visitor checks.
export const PLATFORM_SELECTOR = '[data-makeborne-attribution]';

export const MODES = Object.freeze(['reduce', 'no-preference']);
export const AXE_TAGS = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
const VITALS_WIDTHS = [390, 1440];
// W7: loads per width and motion mode. One load caught Osteria's intermittent
// 0.186 shift only ~80% of the time (it showed in 12 of 22 loads at 1440).
export const VITALS_LOADS = 3;
// W9: widths re-measured with touch emulation when the root clips overflow.
const TOUCH_WIDTHS = [360, 390];
const FIRST_SCREEN_WIDTHS = FIRST_SCREENS.map(screen => screen.width);
const SETTLE_MS = 900;
const SYSTEM_SERIFS = ['serif', 'ui-serif', 'georgia', 'times', 'times new roman', 'garamond', 'baskerville', 'palatino', 'palatino linotype', 'book antiqua', 'cambria', 'iowan old style', 'charter', 'didot', 'bodoni moda', 'libre baskerville', 'lora', 'merriweather', 'eb garamond', 'cormorant garamond', 'source serif pro', 'source serif 4', 'pt serif', 'noto serif', 'crimson text', 'crimson pro', 'spectral', 'literata', 'gelasio'];

/** Serif display families: the runtime font catalog's serif category plus common system/web serifs. */
export function serifFamilies() {
  let catalog = [];
  try { catalog = JSON.parse(readFileSync(FONT_CATALOG, 'utf8')); } catch { /* catalog optional for captures */ }
  return [...new Set([...catalog.filter(font => font.category === 'serif').map(font => font.family.toLowerCase()), ...SYSTEM_SERIFS])];
}

// ---------------------------------------------------------------------------
// Colour maths (Node side). Colours travel as #rrggbb.

export function hexToRgb(hex) {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex ?? '');
  return match ? { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) } : null;
}

export function rgbToHsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

/** CIE L*a*b* (D65) from sRGB. */
export function rgbToLab({ r, g, b }) {
  const linear = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value);

export function describeColour(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);
  const lab = rgbToLab(rgb);
  return { hex, hsl: { h: round(hsl.h, 1), s: round(hsl.s, 3), l: round(hsl.l, 3) }, lab: { L: round(lab.L), a: round(lab.a), b: round(lab.b) }, chroma: round(Math.hypot(lab.a, lab.b)) };
}

/**
 * W15 (c) cream ground. QUALITY_BAR wrote it as "HSL hue 20–60°, saturation
 * 15–60%, lightness ≥ 88%, or L* > 90 with b* > 4"; two corrections, both
 * found on the fixtures:
 *  - HSL saturation explodes near white, so #f8f7f4 (Lab chroma 1.56: a white)
 *    passed the HSL clause as "22% saturated". The HSL clause now also needs a
 *    visible yellow/red cast in Lab: b* ≥ 4 or chroma C* ≥ 4.
 *  - The 88% lightness floor left out real beiges such as #e9dfce (HSL
 *    lightness 86.1%, b* 9.5). The floor is 85%.
 * The Lab clause (L* > 90 and b* > 4) is unchanged. Unit cases in unitChecks().
 */
export const CREAM = Object.freeze({ minHue: 20, maxHue: 60, minSaturation: 0.15, maxSaturation: 0.6, minLightness: 0.85, minTint: 4, labMinL: 90, labMinB: 4 });

export function isCreamGround(hex) {
  const colour = describeColour(hex);
  if (!colour) return false;
  const { h, s, l } = colour.hsl;
  const tinted = colour.lab.b >= CREAM.minTint || colour.chroma >= CREAM.minTint;
  const hsl = h >= CREAM.minHue && h <= CREAM.maxHue && s >= CREAM.minSaturation && s <= CREAM.maxSaturation && l >= CREAM.minLightness && tinted;
  return hsl || (colour.lab.L > CREAM.labMinL && colour.lab.b > CREAM.labMinB);
}

/** b* a light ground needs to be warm: below it, the cast is invisible (#e8e7e2 b* 2.5, #eff0ea 2.8 and #f8f7f4 1.5 are greys and whites). */
export const WARM_MIN_B = 3;

/**
 * D2 ground classes, decided in CIE Lab (perceptual), in this order:
 *  dark        L* < 35
 *  saturated   chroma C* ≥ 30 (a vivid field at any lighter lightness)
 *  warm-light  L* ≥ 85 and (b* ≥ 3 with a* ≥ −3, i.e. a visible yellow/red cast:
 *              cream, ivory, beige, peach) or the W15 cream rule
 *  cool-light  L* ≥ 85 otherwise (white, greys, blue or green tints)
 *  mid-tone    everything else (35 ≤ L* < 85, C* < 30)
 */
export function classifyGround(hex) {
  const colour = describeColour(hex);
  if (!colour) return null;
  const { L, a, b } = colour.lab;
  if (L < 35) return 'dark';
  if (colour.chroma >= 30) return 'saturated';
  if (L >= 85) return (b >= WARM_MIN_B && a >= -3) || isCreamGround(hex) ? 'warm-light' : 'cool-light';
  return 'mid-tone';
}


// ---------------------------------------------------------------------------
// In-page code. Everything below up to "Node orchestration" runs in the page.

/* Installs window.__mb: computed-style cache, colour parsing (any CSS colour
   syntax via a 1×1 canvas), alpha compositing, WCAG contrast, visibility and
   selector helpers. `platformSelector` matches what the platform, not the
   site, put on the page (PLATFORM_SELECTOR). */
function installHelpers({ platformSelector = '' } = {}) {
  if (window.__mb) return true;
  const platform = el => !!(platformSelector && el && el.closest && el.closest(platformSelector));
  const platformRoots = () => (platformSelector ? [...document.querySelectorAll(platformSelector)].filter(el => !platform(el.parentElement)) : []);
  const styles = new WeakMap();
  const style = el => { let s = styles.get(el); if (!s) { s = getComputedStyle(el); styles.set(el, s); } return s; };
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const RGB = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/;
  const sample = (value, backdrop) => {
    ctx.globalCompositeOperation = 'copy'; ctx.fillStyle = backdrop; ctx.fillRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = backdrop; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data;
  };
  const parseColour = value => {
    if (!value || value === 'transparent' || value === 'none' || value === 'initial') return { r: 0, g: 0, b: 0, a: 0 };
    if (cache.has(value)) return cache.get(value);
    let result;
    const m = RGB.exec(value);
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      result = { r: +m[1], g: +m[2], b: +m[3], a };
    } else {
      // Over black gives c·a, over white c·a + 255(1−a): solve for a and c.
      const black = sample(value, '#000');
      const white = sample(value, '#fff');
      const a = 1 - ((white[0] - black[0]) + (white[1] - black[1]) + (white[2] - black[2])) / (3 * 255);
      result = a <= 0.004 ? { r: 0, g: 0, b: 0, a: 0 } : { r: Math.min(255, black[0] / a), g: Math.min(255, black[1] / a), b: Math.min(255, black[2] / a), a: Math.min(1, a) };
    }
    cache.set(value, result);
    return result;
  };
  const premul = c => [c.r * c.a, c.g * c.a, c.b * c.a, c.a];
  const over = (top, bottom) => [0, 1, 2, 3].map(i => top[i] + bottom[i] * (1 - top[3]));
  const unpremul = p => (p[3] > 0 ? { r: p[0] / p[3], g: p[1] / p[3], b: p[2] / p[3], a: p[3] } : { r: 0, g: 0, b: 0, a: 0 });
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const luminance = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (x, y) => { const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const canvasColour = () => { const scheme = style(document.documentElement).colorScheme || ''; return /dark/.test(scheme) && !/light/.test(scheme) ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }; };
  const chainOf = el => { const chain = []; for (let a = el; a; a = a.parentElement) chain.push(a); return chain; };
  /* Exact group compositing along the ancestor chain (innermost first): each
     element's background, then its content, the whole group scaled by its
     opacity, finally over the canvas. With fg it returns the text pixel. */
  const paintAt = (chain, fg) => {
    const levels = [...chain].reverse();
    const render = k => {
      const s = style(levels[k]);
      const inner = k + 1 < levels.length ? render(k + 1) : fg ? premul(fg) : [0, 0, 0, 0];
      const group = over(inner, premul(parseColour(s.backgroundColor)));
      const opacity = parseFloat(s.opacity);
      return opacity < 1 ? group.map(v => v * opacity) : group;
    };
    return unpremul(over(render(0), premul(canvasColour())));
  };
  const rendered = el => (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : el.getClientRects().length > 0);
  const clippedAway = el => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = style(a);
      if (/inset\(\s*50%/.test(s.clipPath)) return true;
      if (s.overflow !== 'visible' || s.clip !== 'auto') {
        const r = a.getBoundingClientRect();
        if (r.width <= 2 || r.height <= 2) return true;
      }
    }
    return false;
  };
  const selectorOf = el => {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    for (let node = el, depth = 0; node && node.nodeType === 1 && depth < 4; node = node.parentElement, depth++) {
      const tag = node.tagName.toLowerCase();
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) { parts.unshift(`${tag}#${node.id}`); break; }
      let part = tag;
      const classes = [...node.classList].filter(c => /^[A-Za-z_-][\w-]*$/.test(c)).slice(0, 2);
      if (classes.length) part += '.' + classes.join('.');
      const parent = node.parentElement;
      if (parent) { const same = [...parent.children].filter(c => c.tagName === node.tagName); if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`; }
      parts.unshift(part);
      if (tag === 'body') break;
    }
    return parts.join(' > ');
  };
  const words = text => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const textOf = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  /* Client rects of a node's contents grouped into lines (viewport coordinates). */
  const groupLines = rects => {
    const lines = [];
    for (const r of rects) {
      const line = lines.find(l => Math.abs(l.top - r.top) < r.height * 0.5);
      if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.bottom = Math.max(line.bottom, r.bottom); } else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    return lines;
  };
  /* Line boxes of one text node; SVG text without range rects falls back to its element box. */
  const nodeLines = (node, svgElement) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    let rects = [...range.getClientRects()].filter(r => r.width >= 1 && r.height >= 1);
    if (!rects.length && svgElement) rects = [svgElement.getBoundingClientRect()].filter(r => r.width >= 1 && r.height >= 1);
    return groupLines(rects);
  };
  /* Union of an element's text line boxes, grouped into lines. */
  const textBox = el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter(r => r.width >= 1 && r.height >= 1);
    if (!rects.length) return null;
    const lines = groupLines(rects);
    const left = Math.min(...lines.map(l => l.left));
    const right = Math.max(...lines.map(l => l.right));
    const top = Math.min(...lines.map(l => l.top));
    const bottom = Math.max(...lines.map(l => l.bottom));
    return { left, right, top, bottom, width: right - left, height: bottom - top, lines };
  };
  const centred = el => {
    const s = style(el);
    if (/center/.test(s.textAlign)) return { centred: true, how: 'text-align' };
    const box = textBox(el);
    if (!box) return { centred: false, how: 'no-text' };
    const mid = innerWidth / 2;
    if (!box.lines.every(l => Math.abs((l.left + l.right) / 2 - mid) <= 40)) return { centred: false, how: 'off-centre' };
    if (box.lines.length === 1) return { centred: true, how: 'single-line' };
    const lefts = box.lines.map(l => l.left);
    return { centred: Math.max(...lefts) - Math.min(...lefts) > 8, how: 'ragged-lines' };
  };
  const isMedia = el => ['IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED'].includes(el.tagName) || el instanceof SVGElement;
  /* 'image' | 'gradient' when a background image can paint under text; null when
     there is none or every layer is sized to a line or nothing (the common
     background-size: 0% 1px / 100% 1px underline trick). */
  const backgroundImageKind = el => {
    const s = style(el);
    if (s.backgroundImage === 'none') return null;
    const box = el.getBoundingClientRect();
    const tiny = s.backgroundSize.split(',').every(layer => layer.trim().split(/\s+/).some((token, axis) => {
      if (!/^[\d.]+(px|%)$/.test(token)) return false;
      const px = token.endsWith('%') ? (parseFloat(token) / 100) * (axis === 0 ? box.width : box.height) : parseFloat(token);
      return px <= 3;
    }));
    if (tiny) return null;
    return s.backgroundImage.includes('url(') ? 'image' : 'gradient';
  };
  const paints = el => {
    if (isMedia(el)) return 'media';
    const image = backgroundImageKind(el);
    if (image) return image;
    return parseColour(style(el).backgroundColor).a > 0 ? 'colour' : null;
  };
  const pseudoOverlay = el => {
    const box = el.getBoundingClientRect();
    const area = box.width * box.height;
    if (!area) return false;
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none' || parseFloat(ps.opacity) === 0 || ps.visibility === 'hidden') continue;
      const painted = ps.backgroundImage !== 'none' || parseColour(ps.backgroundColor).a > 0;
      if (!painted || !['absolute', 'fixed'].includes(ps.position)) continue;
      const w = parseFloat(ps.width);
      const h = parseFloat(ps.height);
      if (Number.isFinite(w) && Number.isFinite(h) && w * h >= 0.25 * area) return true;
    }
    return false;
  };
  /* First chain index whose background is opaque and which is not inside a
     translucent group: nothing beyond it can show through. */
  const opaqueStop = chain => {
    const cumulative = new Array(chain.length);
    let product = 1;
    for (let i = chain.length - 1; i >= 0; i--) { product *= parseFloat(style(chain[i]).opacity); cumulative[i] = product; }
    for (let i = 0; i < chain.length; i++) if (parseColour(style(chain[i]).backgroundColor).a >= 1 && cumulative[i] >= 1) return i;
    return chain.length - 1;
  };
  const backgroundAt = el => {
    const chain = chainOf(el);
    const stop = opaqueStop(chain);
    let kind = 'colour';
    for (let i = 0; i <= stop; i++) {
      const image = backgroundImageKind(chain[i]);
      if (image) { kind = image; break; }
    }
    return { hex: hex(paintAt(chain, null)), kind };
  };
  /* W10 verdict for text whose first line centre is at viewport point (x, y). */
  const contrastAt = (el, x, y) => {
    const indeterminate = reason => ({ status: 'indeterminate', reason });
    const chain = chainOf(el);
    const stop = opaqueStop(chain);
    const s = style(el);
    for (let i = 0; i <= stop; i++) {
      const cs = style(chain[i]);
      if ((cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') && cs.backgroundImage !== 'none') return indeterminate('background-clip-text');
      const image = backgroundImageKind(chain[i]);
      if (image) return indeterminate(image === 'image' ? 'background-image' : 'gradient');
      if (cs.mixBlendMode !== 'normal') return indeterminate('blend-mode');
      if (cs.filter !== 'none' && !/^drop-shadow/.test(cs.filter)) return indeterminate('filter');
      if (cs.backdropFilter && cs.backdropFilter !== 'none' && parseColour(cs.backgroundColor).a < 1) return indeterminate('backdrop-filter');
      if (pseudoOverlay(chain[i])) return indeterminate('pseudo-overlay');
    }
    const fg = parseColour(s.webkitTextFillColor || s.color);
    if (fg.a === 0) return indeterminate('transparent-text');
    const inChain = new Set(chain);
    const stopEl = chain[stop];
    let above = true;
    for (const hit of document.elementsFromPoint(x, y)) {
      if (hit === stopEl) break;
      if (hit === el || el.contains(hit) || inChain.has(hit)) { above = false; continue; }
      const paint = paints(hit);
      if (!paint) continue;
      if (above) return paint === 'colour' && parseColour(style(hit).backgroundColor).a >= 1 ? { status: 'covered' } : indeterminate('overlap-above');
      return indeterminate(paint === 'colour' ? 'overlap' : 'image-under');
    }
    const bg = paintAt(chain, null);
    const text = paintAt(chain, fg);
    const fontSize = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    const value = ratio(text, bg);
    return { status: value < required ? 'fail' : 'pass', ratio: value, required, fg: hex(text), bg: hex(bg), declared: s.color, fontSize, weight };
  };
  const buttonLike = el => {
    const s = style(el);
    const bg = parseColour(s.backgroundColor);
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const bordered = sides.every(side => parseFloat(s[`border${side}Width`]) >= 1 && parseColour(s[`border${side}Color`]).a > 0.3);
    const padded = parseFloat(s.paddingLeft) >= 6 && parseFloat(s.paddingRight) >= 6;
    return { filled: bg.a >= 0.3 || !!backgroundImageKind(el), outlined: bordered && padded, native: el.tagName === 'BUTTON' || el.tagName === 'INPUT' };
  };
  const forcePointerEvents = on => {
    const id = '__mb-pointer-events';
    document.getElementById(id)?.remove();
    if (on) { const tag = document.createElement('style'); tag.id = id; tag.textContent = '*{pointer-events:auto!important}'; document.head.append(tag); }
  };
  window.__mb = { style, parseColour, hex, ratio, chainOf, paintAt, rendered, clippedAway, selectorOf, words, textOf, nodeLines, textBox, centred, isMedia, backgroundImageKind, paints, backgroundAt, contrastAt, buttonLike, forcePointerEvents, platform, platformRoots };
  return true;
}

/* Scroll top → bottom → top in steps so lazy content and IntersectionObserver reveals fire. */
async function scrollThrough() {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const step = Math.max(200, Math.floor(innerHeight * 0.6));
  for (let y = 0; y < document.documentElement.scrollHeight && y < 60000; y += step) {
    scrollTo({ top: y, behavior: 'instant' });
    await wait(90);
  }
  scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  await wait(250);
  scrollTo({ top: 0, behavior: 'instant' });
  await wait(150);
  return document.documentElement.scrollHeight;
}

/* W10: every visible text node, scrolled to mid-viewport so hit testing is real.
   Text whose background the DOM cannot resolve (an image, gradient, backdrop
   filter, overlay or other painting under it, or SVG text with a plain fill)
   is counted as indeterminate here and listed in `pending`; the nodes stay on
   window.__mbContrastPending for resolveContrastPixels(), which settles them
   from screenshots. Blend modes, filters, background-clip:text and layers
   above the text change the text colour itself, so they stay indeterminate.
   Two kinds of text are measured but kept out of the W10 count, each in its
   own bucket: aria-hidden text (decorative) and text inside a picture
   (role="img", e.g. the labels of an SVG illustration), which WCAG 1.4.3
   exempts as "part of a picture that contains significant other visual content". */
function evalContrast() {
  const H = window.__mb;
  const vw = innerWidth;
  const vh = innerHeight;
  const out = { checked: 0, passing: 0, failing: 0, indeterminate: 0, reasons: {}, hidden: 0, offscreen: 0, covered: 0, ariaHidden: { checked: 0, failing: 0, indeterminate: 0 }, picture: { checked: 0, failing: 0, indeterminate: 0 }, failingNodes: [], indeterminateNodes: [], tightestPasses: [], excludedLowest: [], pending: [] };
  const excludedAs = el => (el.closest('[aria-hidden="true"]') ? 'aria-hidden' : el.closest('[role="img"]') ? 'picture' : null);
  const bucketOf = excluded => (excluded === 'aria-hidden' ? out.ariaHidden : excluded === 'picture' ? out.picture : out);
  const firstRect = node => { const range = document.createRange(); range.selectNodeContents(node); return [...range.getClientRects()].find(r => r.width >= 1 && r.height >= 1); };
  const snippet = node => node.nodeValue.replace(/\s+/g, ' ').trim().slice(0, 40);
  const RESOLVABLE = new Set(['background-image', 'gradient', 'image-under', 'overlap', 'pseudo-overlay', 'backdrop-filter', 'svg-text']);
  const pendingNodes = [];
  // Opacity of every group the text paints in: the text's own alpha is scaled by all of them.
  const groupAlpha = el => { let alpha = 1; for (let a = el; a; a = a.parentElement) alpha *= parseFloat(H.style(a).opacity); return alpha; };
  const sizeOf = (el, scale = 1) => {
    const s = H.style(el);
    const fontSize = parseFloat(s.fontSize) * scale;
    const weight = parseInt(s.fontWeight, 10) || 400;
    return { fontSize: Math.round(fontSize * 10) / 10, weight, required: fontSize >= 24 || (fontSize >= 18.66 && weight >= 700) ? 3 : 4.5 };
  };
  /* Queue a node for the pixel pass; returns its pending index or null. */
  const addPending = (node, el, reason, excluded, fg, size) => {
    if (!RESOLVABLE.has(reason) || !fg || !(fg.a > 0)) return null;
    const i = pendingNodes.length;
    pendingNodes.push({ node, el, svg: reason === 'svg-text' });
    out.pending.push({ i, reason, excluded, text: snippet(node), selector: H.selectorOf(el), fg: { r: fg.r, g: fg.g, b: fg.b, a: fg.a * groupAlpha(el) }, ...size });
    return i;
  };
  H.forcePointerEvents(true);
  try {
    scrollTo({ top: 0, behavior: 'instant' });
    const items = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!/\S/.test(node.nodeValue)) continue;
      const el = node.parentElement;
      if (!el || el.closest('script,style,noscript,template,textarea,select,option,title')) continue;
      const svg = el.closest('svg');
      if (svg) {
        // SVG text: shapes and gradients under it are not resolvable from the DOM. A plain
        // fill goes to the pixel pass (size scaled by the SVG's transform); a paint server stays indeterminate.
        if (H.rendered(svg) && !svg.closest('[aria-hidden="true"]')) {
          const excluded = excludedAs(el);
          bucketOf(excluded).indeterminate++;
          const s = H.style(el);
          const fillOpacity = parseFloat(s.fillOpacity);
          const fill = /^(?:rgba?\(|#)/.test(s.fill) ? H.parseColour(s.fill) : null;
          const ctm = el.getScreenCTM ? el.getScreenCTM() : null;
          const pending = addPending(node, el, 'svg-text', excluded, fill && { ...fill, a: fill.a * (Number.isFinite(fillOpacity) ? fillOpacity : 1) }, sizeOf(el, ctm ? Math.hypot(ctm.a, ctm.b) : 1));
          if (!excluded) {
            out.reasons['svg-text'] = (out.reasons['svg-text'] || 0) + 1;
            if (out.indeterminateNodes.length < 40) out.indeterminateNodes.push({ text: snippet(node), reason: 'svg-text', selector: H.selectorOf(el), ...(pending !== null ? { pending } : {}) });
          }
        }
        continue;
      }
      if (!H.rendered(el) || H.clippedAway(el)) { out.hidden++; continue; }
      const rect = firstRect(node);
      if (!rect) { out.hidden++; continue; }
      items.push({ node, el, y: rect.top + scrollY + rect.height / 2 });
    }
    items.sort((p, q) => p.y - q.y);
    for (const item of items) {
      let rect = firstRect(item.node);
      if (!rect) { out.hidden++; continue; }
      let cy = rect.top + rect.height / 2;
      if (cy < vh * 0.2 || cy > vh * 0.8) {
        scrollTo({ top: Math.max(0, scrollY + cy - vh / 2), behavior: 'instant' });
        rect = firstRect(item.node);
        if (!rect) { out.hidden++; continue; }
        cy = rect.top + rect.height / 2;
      }
      if (rect.right <= 0 || rect.left >= vw || cy < 0 || cy >= vh) { out.offscreen++; continue; }
      const cx = (Math.max(rect.left, 0) + Math.min(rect.right, vw)) / 2;
      const verdict = H.contrastAt(item.el, cx, cy);
      if (verdict.status === 'covered') { out.covered++; continue; }
      const excluded = excludedAs(item.el);
      const bucket = bucketOf(excluded);
      if (verdict.status === 'indeterminate') {
        bucket.indeterminate++;
        const s = H.style(item.el);
        const pending = addPending(item.node, item.el, verdict.reason, excluded, H.parseColour(s.webkitTextFillColor || s.color), sizeOf(item.el));
        if (!excluded) {
          out.reasons[verdict.reason] = (out.reasons[verdict.reason] || 0) + 1;
          if (out.indeterminateNodes.length < 40) out.indeterminateNodes.push({ text: snippet(item.node), reason: verdict.reason, selector: H.selectorOf(item.el), ...(pending !== null ? { pending } : {}) });
        }
        continue;
      }
      bucket.checked++;
      if (excluded) {
        // Measured, reported (five lowest), never counted in W10.
        out.excludedLowest.push({ text: snippet(item.node), ratio: Math.round(verdict.ratio * 100) / 100, required: verdict.required, fg: verdict.fg, bg: verdict.bg, fontSize: verdict.fontSize, weight: verdict.weight, selector: H.selectorOf(item.el), excluded, pass: verdict.status === 'pass', method: 'dom' });
        out.excludedLowest.sort((p, q) => p.ratio / p.required - q.ratio / q.required).splice(5);
      }
      if (verdict.status === 'pass') {
        if (excluded) continue;
        out.passing++;
        // Keep the five tightest passes so a reader can spot-check the arithmetic.
        const margin = verdict.ratio / verdict.required;
        if (out.tightestPasses.length < 5 || margin < out.tightestPasses[4].margin) {
          out.tightestPasses.push({ text: snippet(item.node), ratio: Math.round(verdict.ratio * 100) / 100, required: verdict.required, margin, fg: verdict.fg, bg: verdict.bg, fontSize: verdict.fontSize, weight: verdict.weight, selector: H.selectorOf(item.el) });
          out.tightestPasses.sort((p, q) => p.margin - q.margin).splice(5);
        }
        continue;
      }
      bucket.failing++;
      if (!excluded && out.failingNodes.length < 200) {
        out.failingNodes.push({ text: snippet(item.node), ratio: Math.round(verdict.ratio * 100) / 100, required: verdict.required, fg: verdict.fg, bg: verdict.bg, declared: verdict.declared, fontSize: verdict.fontSize, weight: verdict.weight, selector: H.selectorOf(item.el) });
      }
    }
  } finally {
    H.forcePointerEvents(false);
    scrollTo({ top: 0, behavior: 'instant' });
  }
  window.__mbContrastPending = pendingNodes;
  return out;
}

/* W10 pixel pass, step 1: hide every glyph (text, pseudo-element content, SVG
   text fill) without touching layout, stop transitions and pause running
   animations so boxes and pixels stay put; `false` undoes all of it. Glyphs
   are hidden with -webkit-text-fill-color, never with `color`: shapes, borders
   and SVG art painted in currentColor (a label's dark pill) must stay. */
function hideText(on) {
  const id = '__mb-hide-text';
  document.getElementById(id)?.remove();
  if (on) {
    const tag = document.createElement('style');
    tag.id = id;
    tag.textContent = '*,*::before,*::after,*::marker,*::placeholder{-webkit-text-fill-color:transparent!important;-webkit-text-stroke-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important;text-emphasis-color:transparent!important;caret-color:transparent!important;transition:none!important}svg text,svg tspan,svg textPath{fill:transparent!important;stroke:transparent!important}';
    document.head.append(tag);
    window.__mbPaused = document.getAnimations ? document.getAnimations().filter(animation => animation.playState === 'running') : [];
    for (const animation of window.__mbPaused) animation.pause();
  } else {
    for (const animation of window.__mbPaused || []) { try { animation.play(); } catch { /* removed meanwhile */ } }
    window.__mbPaused = null;
  }
  return true;
}

/* W10 pixel pass, step 2: document position of every pending node. */
function contrastLayout() {
  const H = window.__mb;
  const entries = window.__mbContrastPending || [];
  const boxes = entries.map((entry, i) => {
    if (!entry.node.isConnected) return { i, missing: true };
    const lines = H.nodeLines(entry.node, entry.svg ? entry.el : null);
    if (!lines.length) return { i, missing: true };
    return { i, top: Math.min(...lines.map(l => l.top)) + scrollY, bottom: Math.max(...lines.map(l => l.bottom)) + scrollY };
  });
  return { vw: innerWidth, vh: innerHeight, maxScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight), boxes };
}

/* W10 pixel pass, step 3: scroll to y and return the line boxes of `ids` that
   are wholly in view and not under a pinned (fixed/sticky) layer that paints. */
function contrastFrame({ y, ids }) {
  const H = window.__mb;
  const entries = window.__mbContrastPending || [];
  scrollTo({ top: y, behavior: 'instant' });
  const vw = innerWidth;
  const vh = innerHeight;
  const pinned = el => { for (let a = el; a && a !== document.documentElement; a = a.parentElement) { const p = H.style(a).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  H.forcePointerEvents(true);
  try {
    const items = ids.map(i => {
      const { node, el, svg } = entries[i];
      const inView = H.nodeLines(node, svg ? el : null).filter(l => l.top >= -0.5 && l.bottom <= vh + 0.5 && l.right > 0 && l.left < vw);
      const lines = inView.filter(l => {
        const x = (Math.max(l.left, 0) + Math.min(l.right, vw)) / 2;
        const yy = (l.top + l.bottom) / 2;
        for (const hit of document.elementsFromPoint(x, yy)) {
          if (hit === el || el.contains(hit) || hit.contains(el)) return true;
          if (pinned(hit) && H.paints(hit)) return false;
        }
        return true;
      });
      return { i, lines: lines.map(l => ({ left: l.left, top: l.top, right: l.right, bottom: l.bottom })), covered: inView.length > 0 && lines.length === 0 };
    });
    return { scrollY, items };
  } finally {
    H.forcePointerEvents(false);
  }
}

/* W9: document overflow plus elements past the viewport edge with no clipping ancestor
   (containing-block aware: overflow on a non-positioned ancestor does not clip an
   absolutely positioned descendant; viewport-fixed elements never scroll the page). */
function evalOverflow() {
  const H = window.__mb;
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const scrollWidth = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const createsBlock = s => s.position !== 'static' || s.transform !== 'none' || s.filter !== 'none' || /paint|layout|strict|content/.test(s.contain) || /transform/.test(s.willChange);
  const fixedBlock = s => s.transform !== 'none' || s.filter !== 'none' || /paint|layout|strict|content/.test(s.contain);
  const clips = s => ['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX) || /paint|strict|content/.test(s.contain);
  const offenders = [];
  const nearEdge = [];
  let clippedByRoot = 0;
  let clippedElsewhere = 0;
  let offscreenLeft = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META'].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right > vw + 0.5 && r.right <= vw + 1 && nearEdge.length < 5 && H.rendered(el)) nearEdge.push({ selector: H.selectorOf(el), right: Math.round(r.right * 10) / 10 });
    if (!(r.right > vw + 1 || r.left < -1)) continue;
    // Wholly off the left edge (skip links at left:-999px): unreachable, never scrolls the page.
    if (r.right <= 0) { offscreenLeft++; continue; }
    if (!H.rendered(el) || offenders.some(o => o.el.contains(el))) continue;
    let position = H.style(el).position;
    let escaping = position === 'absolute' || position === 'fixed';
    let clippedBy = null;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = H.style(a);
      if (escaping) {
        if (!(position === 'fixed' ? fixedBlock(s) : createsBlock(s))) continue;
        escaping = false;
      }
      if (clips(s)) { clippedBy = a; break; }
      if (s.position === 'absolute' || s.position === 'fixed') { escaping = true; position = s.position; }
    }
    if (escaping && position === 'fixed') continue;
    if (clippedBy) { if (clippedBy === document.body || clippedBy === doc) clippedByRoot++; else clippedElsewhere++; continue; }
    offenders.push({ el, selector: H.selectorOf(el), width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), side: r.right > vw + 1 ? 'right' : 'left' });
  }
  // The root clips when html or body has overflow-x hidden/clip: a script can
  // still scroll a hidden root (overflowPx), a mouse cannot, and on a touch
  // phone the layout viewport may still widen to the content (measured with
  // touch emulation in measurePage: layoutViewport − clientWidth).
  const rootOverflowX = { html: H.style(doc).overflowX, body: document.body ? H.style(document.body).overflowX : null };
  const rootClips = ['hidden', 'clip'].includes(rootOverflowX.html) || ['hidden', 'clip'].includes(rootOverflowX.body);
  return {
    viewport: vw, scrollWidth, clientWidth: doc.clientWidth, layoutViewport: innerWidth, overflowPx: Math.max(0, scrollWidth - doc.clientWidth),
    rootClips, rootOverflowX,
    offenderCount: offenders.length, offenders: offenders.slice(0, 10).map(o => ({ selector: o.selector, width: o.width, left: o.left, right: o.right, side: o.side })), nearEdge, clippedByRoot, clippedElsewhere, offscreenLeft,
  };
}

/* W13 static pass: every a[href]/area[href] with what the DOM can answer locally. */
function evalLinks() {
  const H = window.__mb;
  return [...document.querySelectorAll('a[href], area[href]')].map((a, index) => {
    const href = a.getAttribute('href');
    let fragment = null;
    let samePage = false;
    try {
      const url = new URL(a.href, location.href);
      samePage = url.origin === location.origin && url.pathname === location.pathname && url.search === location.search;
      if (href.startsWith('#') || (samePage && url.hash)) fragment = decodeURIComponent((href.startsWith('#') ? href : url.hash).slice(1));
    } catch { /* malformed URL: classified in Node */ }
    const target = fragment ? document.getElementById(fragment) || document.getElementsByName(fragment)[0] : null;
    return { index, href, resolved: a.href, fragment, samePage, targetExists: !!target, text: (H.textOf(a) || a.getAttribute('aria-label') || '').slice(0, 60), selector: H.selectorOf(a), rendered: H.rendered(a) };
  });
}

/* W14 images, plus CSS background images (informational). */
function evalImages() {
  const H = window.__mb;
  const ratioBox = el => !!el && el.nodeType === 1 && H.style(el).aspectRatio !== 'auto';
  const out = { total: 0, missingDims: [], broken: [], missingAlt: [], pending: 0, emptyAlt: 0, cssBackgroundImages: 0, inlineSvg: document.querySelectorAll('svg').length };
  const describe = img => ({ selector: H.selectorOf(img), src: (img.currentSrc || img.getAttribute('src') || '').slice(0, 120), rendered: H.rendered(img) });
  for (const img of document.images) {
    out.total++;
    const parent = img.parentElement;
    const wrapper = parent && ['PICTURE', 'A', 'SPAN'].includes(parent.tagName) ? parent.parentElement : null;
    const dims = img.hasAttribute('width') && img.hasAttribute('height');
    if (!dims && H.style(img).aspectRatio === 'auto' && !ratioBox(parent) && !ratioBox(wrapper)) out.missingDims.push(describe(img));
    const src = img.currentSrc || img.getAttribute('src') || '';
    if (img.complete && (img.naturalWidth === 0 || !src)) out.broken.push(describe(img));
    else if (!img.complete) out.pending++;
    if (!img.hasAttribute('alt')) out.missingAlt.push(describe(img));
    else if (img.getAttribute('alt').trim() === '') out.emptyAlt++;
  }
  for (const el of document.body.querySelectorAll('*')) if (H.style(el).backgroundImage.includes('url(')) out.cssBackgroundImages++;
  for (const key of ['missingDims', 'broken', 'missingAlt']) { out[`${key}Count`] = out[key].length; out[key] = out[key].slice(0, 20); }
  return out;
}

/* W16 at scrollY 0: h1, value line and primary action inside the first viewport. */
function evalFirstScreen() {
  const H = window.__mb;
  scrollTo({ top: 0, behavior: 'instant' });
  const vw = innerWidth;
  const vh = innerHeight;
  const inside = r => !!r && r.top >= -1 && r.bottom <= vh + 1 && r.left >= -1 && r.right <= vw + 1 && r.width > 0 && r.height > 0;
  const h1 = [...document.querySelectorAll('h1')].find(H.rendered) || null;
  const h1Rect = h1 ? h1.getBoundingClientRect() : null;
  // Value line: the first p (or other element with its own text) after the h1 with ≥ 6 words.
  let valueLine = null;
  if (h1) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    walker.currentNode = h1;
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (h1.contains(el) || !H.rendered(el)) continue;
      if (el.closest('nav,[role="navigation"],button,a,label,h1,h2,h3,h4,h5,h6')) continue;
      // Captions of art or photos are not the value line, even when they come first in the DOM.
      if (el.closest('figure,figcaption,aside,[aria-hidden="true"],[class*="caption" i]')) continue;
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ');
      if (el.tagName !== 'P' && H.words(own) < 6) continue;
      if (H.words(H.textOf(el)) < 6) continue;
      const box = H.textBox(el);
      const line = box && box.lines[0];
      valueLine = { text: H.textOf(el).slice(0, 120), tag: el.tagName.toLowerCase(), visible: !!line && line.top >= -1 && line.bottom <= vh + 1, top: line ? Math.round(line.top) : null };
      break;
    }
  }
  // Primary action: first prominent a/button in main or header that is not navigation or a disclosure toggle.
  const scope = document.querySelector('main, [role="main"], header, [role="banner"]') ? 'main a[href], main button, main input[type="submit"], [role="main"] a[href], [role="main"] button, header a[href], header button, [role="banner"] a[href], [role="banner"] button' : 'a[href], button, input[type="submit"]';
  const candidates = [...new Set(document.querySelectorAll(scope))].sort((p, q) => (p.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  let primary = null;
  let plainLinkInView = null;
  const inViewProminent = [];
  for (const el of candidates) {
    if (el.closest('[role="menu"],[role="menubar"],[role="tablist"],[role="radiogroup"]') || !H.rendered(el)) continue;
    // Disclosure and toggle controls (menu buttons, filters, tabs) are not the primary action.
    if (['aria-expanded', 'aria-controls', 'aria-haspopup', 'aria-pressed', 'aria-selected', 'aria-checked'].some(name => el.hasAttribute(name))) continue;
    if (/^(tab|switch|checkbox|radio|option|menuitem)/.test(el.getAttribute('role') || '')) continue;
    const inNav = !!el.closest('nav,[role="navigation"]');
    const text = (H.textOf(el) || el.value || el.getAttribute('aria-label') || '').trim();
    if (!text) continue;
    const look = H.buttonLike(el);
    let prominence = null;
    if (look.filled) {
      const own = H.parseColour(H.style(el).backgroundColor);
      const behind = el.parentElement ? H.backgroundAt(el.parentElement).hex : '#ffffff';
      const ownHex = H.hex(H.paintAt(H.chainOf(el), null));
      if (H.backgroundImageKind(el) || (own.a >= 0.3 && ownHex !== behind)) prominence = 'filled';
    }
    if (!prominence && look.native) prominence = 'button';
    if (!prominence && look.outlined) prominence = 'outlined';
    // Inside navigation only a filled call to action counts (a header "Book a table" pill), never a plain nav link.
    if (!prominence || (inNav && prominence !== 'filled')) {
      // Informational: an unstyled text link in view is an action, just not a prominent one.
      if (!plainLinkInView && !inNav && !el.closest('header,[role="banner"]') && inside(el.getBoundingClientRect())) plainLinkInView = { text: text.slice(0, 60), selector: H.selectorOf(el) };
      continue;
    }
    const entry = { text: text.slice(0, 60), tag: el.tagName.toLowerCase(), prominence, visible: inside(el.getBoundingClientRect()), selector: H.selectorOf(el) };
    if (!primary) primary = entry;
    if (entry.visible && inViewProminent.length < 4) inViewProminent.push(entry);
  }
  return {
    viewport: { width: vw, height: vh },
    // Visible when its box is in view, or (a headline split across columns, whose block box is
    // wider than the screen) when every line of its text is on screen.
    h1: (() => {
      if (!h1) return { exists: false, visible: false, text: null, top: null, bottom: null };
      const range = document.createRange();
      range.selectNodeContents(h1);
      const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
      const linesInView = lines.length > 0 && lines.every(r => r.top >= -1 && r.bottom <= vh + 1 && r.right > 0 && r.left < vw);
      return { exists: true, visible: inside(h1Rect) || linesInView, byBox: inside(h1Rect), byText: linesInView, text: H.textOf(h1).slice(0, 120), top: Math.round(h1Rect.top), bottom: Math.round(h1Rect.bottom) };
    })(),
    valueLine: valueLine || { text: null, visible: false },
    primaryAction: primary || { text: null, visible: false },
    prominentInView: inViewProminent,
    plainLinkInView,
  };
}

/* W15 raw evidence; the decision (and the ground rule for (c)) is made in Node.
   Platform-injected elements (H.platform: the "Made with Makeborne" badge that
   composeSiteDocument() appends) are not the site's design and are left out of
   every tell; badge pills are counted separately as evidence. */
function evalTells({ serifs }) {
  const H = window.__mb;
  scrollTo({ top: 0, behavior: 'instant' });
  const vw = innerWidth;
  const vh = innerHeight;
  const family = el => (H.style(el).fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();
  // (a) equal card rows
  const equalCardRows = [];
  for (const parent of document.body.querySelectorAll('*')) {
    if (parent.children.length < 3 || H.platform(parent)) continue;
    const kids = [...parent.children].filter(k => H.rendered(k) && !['absolute', 'fixed'].includes(H.style(k).position));
    if (kids.length < 3) continue;
    const rects = kids.map(k => k.getBoundingClientRect());
    const row = kids.filter((k, i) => Math.abs(rects[i].top - rects[0].top) <= 4);
    if (row.length < 3) continue;
    const boxes = row.map(k => k.getBoundingClientRect());
    const ws = boxes.map(b => b.width);
    const hs = boxes.map(b => b.height);
    if (Math.min(...ws) < 160 || Math.min(...hs) < 80) continue;
    if (Math.max(...ws) / Math.min(...ws) > 1.04 || Math.max(...hs) / Math.min(...hs) > 1.04) continue;
    const cards = row.map(k => {
      const heading = k.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
      if (!heading) return null;
      const rest = H.textOf(k).replace(H.textOf(heading), '');
      return H.words(rest) >= 3 ? H.textOf(heading).slice(0, 40) : null;
    });
    if (cards.some(c => c === null)) continue;
    equalCardRows.push({ selector: H.selectorOf(parent), count: row.length, width: Math.round(ws[0]), height: Math.round(hs[0]), headings: cards.slice(0, 4) });
  }
  // (b) centred hero with two or more buttons below the h1
  const h1 = [...document.querySelectorAll('h1')].find(H.rendered) || null;
  let centredHero = { h1: false };
  if (h1) {
    const r = h1.getBoundingClientRect();
    const centring = H.centred(h1);
    const buttons = [...document.querySelectorAll('a[href], button, input[type="submit"], input[type="button"], [role="button"]')].filter(el => {
      if (!H.rendered(el) || H.platform(el) || el.closest('nav,header,[role="navigation"],[role="banner"]')) return false;
      const b = el.getBoundingClientRect();
      if (b.top < r.bottom - 4 || b.bottom > vh || b.width < 1) return false;
      const look = H.buttonLike(el);
      return look.native || look.filled || look.outlined;
    });
    const left = Math.min(...buttons.map(b => b.getBoundingClientRect().left));
    const right = Math.max(...buttons.map(b => b.getBoundingClientRect().right));
    centredHero = {
      h1: true, h1Text: H.textOf(h1).slice(0, 80), h1InView: r.top < vh && r.bottom > 0, h1Centred: centring.centred, how: centring.how,
      buttons: buttons.slice(0, 4).map(b => H.textOf(b).slice(0, 40) || b.value || ''), buttonCount: buttons.length,
      buttonsCentred: buttons.length >= 2 && Math.abs((left + right) / 2 - vw / 2) <= 40,
    };
  }
  // (c) parts: serif h1, coloured italic inside a heading, pill buttons
  const h1Family = h1 ? family(h1) : null;
  const h1Stack = h1 ? H.style(h1).fontFamily : null;
  const serifH1 = !!h1Stack && (serifs.includes((h1Family || '').toLowerCase()) || (/(^|,)\s*serif\s*$/i.test(h1Stack) && !/sans/i.test(h1Family || '')));
  const italicAccents = [];
  for (const heading of document.querySelectorAll('h1,h2,h3')) {
    if (!H.rendered(heading)) continue;
    const base = H.parseColour(H.style(heading).color);
    for (const el of heading.querySelectorAll('*')) {
      const s = H.style(el);
      // Outermost italic run only (an <em> inside an italic span is the same accent).
      if (s.fontStyle !== 'italic' || (el.parentElement !== heading && H.style(el.parentElement).fontStyle === 'italic')) continue;
      const c = H.parseColour(s.webkitTextFillColor || s.color);
      const distance = Math.hypot(c.r - base.r, c.g - base.g, c.b - base.b);
      if (distance > 30 || s.backgroundImage !== 'none') italicAccents.push({ heading: heading.tagName.toLowerCase(), text: H.textOf(el).slice(0, 40), colour: H.hex(c), headingColour: H.hex(base) });
    }
  }
  const pills = [];
  const platformPills = [];
  for (const el of document.querySelectorAll('a[href], button, input[type="submit"]')) {
    if (!H.rendered(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.height < 28 || b.width < 60) continue;
    const look = H.buttonLike(el);
    if (!look.filled && !look.outlined) continue;
    const raw = H.style(el).borderTopLeftRadius;
    const radius = raw.endsWith('%') ? (parseFloat(raw) / 100) * b.height : parseFloat(raw);
    if (radius < b.height / 2 - 1) continue;
    (H.platform(el) ? platformPills : pills).push({ text: (H.textOf(el) || el.value || '').slice(0, 40), height: Math.round(b.height), radius: raw, background: H.hex(H.parseColour(H.style(el).backgroundColor)) });
  }
  // (d) horizontal marquee animation and a giant footer wordmark
  const marquees = [];
  for (const animation of document.getAnimations ? document.getAnimations() : []) {
    const target = animation.effect && animation.effect.target;
    if (!target || !animation.effect.getKeyframes || H.platform(target)) continue;
    const frames = animation.effect.getKeyframes();
    const horizontal = frames.some(f => /translate(?:X|3d)?\(\s*-?(?:[1-9][\d.]*|0?\.\d*[1-9])\s*(?:%|px)/.test(f.transform || '') || /^-?(?:[1-9][\d.]*|0?\.\d*[1-9])(?:%|px)/.test(String(f.translate || '').trim()));
    if (horizontal) marquees.push({ selector: H.selectorOf(target), name: animation.animationName || null, iterations: animation.effect.getTiming().iterations });
  }
  const wordmarks = [];
  for (const footer of document.querySelectorAll('footer, [role="contentinfo"]')) {
    if (H.platform(footer)) continue;
    for (const el of [footer, ...footer.querySelectorAll('*')]) {
      if (!H.rendered(el) || H.platform(el)) continue;
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim();
      const size = parseFloat(H.style(el).fontSize);
      if (own && (size >= 160 || size >= 0.111 * vw)) wordmarks.push({ text: own.slice(0, 40), fontSize: size, selector: H.selectorOf(el) });
    }
  }
  // (e) text for banned copy and label headings (the site's own text only)
  const own = el => H.rendered(el) && !H.platform(el);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(own).map(h => H.textOf(h)).filter(Boolean);
  const controls = [...document.querySelectorAll('input[type="submit"], input[type="button"]')].filter(own).map(i => i.value).filter(Boolean);
  let text = document.body.innerText;
  for (const el of H.platformRoots()) if (el.innerText.trim()) text = text.split(el.innerText).join('\n');
  return { equalCardRows: equalCardRows.slice(0, 8), centredHero, h1Family, h1Stack, serifH1, italicAccents: italicAccents.slice(0, 6), pills: pills.slice(0, 6), pillCount: pills.length, platformPills: platformPills.slice(0, 3), platformPillCount: platformPills.length, marquees: marquees.slice(0, 6), wordmarks: wordmarks.slice(0, 4), text, headings, controls };
}

/* D2 ground samples of one viewport band (scrolled to y): a cols × rows grid.
   Each point is hit-tested twice: with pointer events forced on everywhere
   (so media that ignores the pointer, e.g. decorative hero art, still counts)
   and as the page has them (so a pointer-events:none layer laid over the
   content, e.g. a grain or gradient wash, does not hide what is under it).
   A sample is
     'media'     an <img>, <picture>, <video>, <canvas>, embed or SVG paints there;
     'colour'    only background colours paint there: hex is their composite;
     'image' | 'gradient' | 'overlay'
                 a background image or gradient in the element's backdrop, or a
                 painted pointer-events:none layer above it, may change the
                 colour: hex is the composite of the colours alone, and Node
                 decides from the screenshot whether the layer really paints a
                 different colour there (a photo) or not (a texture).
   Pinned (fixed/sticky) elements are skipped when skipPinned (bands below the
   first, where a fixed header would be counted again and again). */
function evalGroundBand({ y, cols, rows, skipPinned }) {
  const H = window.__mb;
  scrollTo({ top: y, behavior: 'instant' });
  const vw = innerWidth;
  const vh = innerHeight;
  const pinned = el => { for (let a = el; a && a !== document.body; a = a.parentElement) { const p = H.style(a).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  const media = el => !!el && (H.isMedia(el) || !!el.closest('svg'));
  const points = [];
  for (let gx = 0; gx < cols; gx++) for (let gy = 0; gy < rows; gy++) points.push([(gx + 0.5) * vw / cols, (gy + 0.5) * vh / rows]);
  const hitsWith = forced => {
    H.forcePointerEvents(forced);
    try { return points.map(([x, py]) => document.elementFromPoint(x, py)); } finally { H.forcePointerEvents(false); }
  };
  const natural = hitsWith(false);
  const forced = hitsWith(true);
  const samples = [];
  points.forEach(([x, py], index) => {
    const top = forced[index];
    const hit = natural[index];
    // A forced hit outside the natural one is a pointer-events:none layer over the content.
    const overlay = !!top && !!hit && top !== hit && !hit.contains(top);
    const el = media(top) ? top : overlay ? hit : (top || hit);
    if (!el || (skipPinned && pinned(el))) return;
    const at = { x: Math.round(x), y: Math.round(py) };
    if (media(el)) {
      // The plain colour behind the media (when there is one): where the media
      // is transparent (empty areas of SVG art) the screenshot shows it.
      const svg = el.closest('svg');
      const holder = svg ? svg.parentElement : el.parentElement;
      const under = holder ? H.backgroundAt(holder) : null;
      samples.push({ ...at, kind: 'media', ...(under && under.kind === 'colour' ? { under: under.hex } : {}) });
      return;
    }
    const bg = H.backgroundAt(el);
    const layer = overlay ? H.paints(top) : null;
    samples.push({ ...at, kind: bg.kind !== 'colour' ? bg.kind : layer ? 'overlay' : 'colour', hex: bg.hex, ...(layer ? { layer: H.selectorOf(top) } : {}) });
  });
  return { scrollY: Math.round(scrollY), height: document.documentElement.scrollHeight, samples };
}

/* D1–D4 inputs besides the ground samples: ink, accent candidates, fonts and
   first-screen archetype features. groundHex is the first-screen ground. */
function evalIdentity({ groundHex = '#ffffff' } = {}) {
  const H = window.__mb;
  scrollTo({ top: 0, behavior: 'instant' });
  const vw = innerWidth;
  const vh = innerHeight;
  const va = vw * vh;
  const family = el => (el ? (H.style(el).fontFamily.split(',')[0] || '').replace(/["']/g, '').trim() : null);
  // Ink and text face: paragraphs weighted by text length.
  const ink = {};
  const textFaces = {};
  for (const p of document.querySelectorAll('p, li, dd')) {
    if (!H.rendered(p) || p.closest('nav,footer,header')) continue;
    const text = H.textOf(p);
    if (H.words(text) < 3) continue;
    const s = H.style(p);
    const colour = H.hex(H.paintAt(H.chainOf(p), H.parseColour(s.webkitTextFillColor || s.color)));
    ink[colour] = (ink[colour] || 0) + text.length;
    if (p.tagName === 'P') { const face = family(p); textFaces[face] = (textFaces[face] || 0) + text.length; }
  }
  // Fallback accent source: saturated colours on any visible text (the filter is applied in Node).
  const textColours = {};
  const walkerText = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walkerText.nextNode(); node; node = walkerText.nextNode()) {
    const el = node.parentElement;
    const text = node.nodeValue.trim();
    if (!text || !el || el.closest('script,style,noscript,svg') || !H.rendered(el) || H.platform(el)) continue;
    const s = H.style(el);
    const colour = H.hex(H.parseColour(s.webkitTextFillColor || s.color));
    textColours[colour] = (textColours[colour] || 0) + text.length;
  }
  // Accent candidates on interactive elements: filled backgrounds (×2), text colours, borders.
  const accent = {};
  const add = (key, n) => { accent[key] = (accent[key] || 0) + n; };
  for (const el of document.querySelectorAll('a[href], button, [role="button"], input[type="submit"]')) {
    if (!H.rendered(el) || H.platform(el)) continue;
    const s = H.style(el);
    const bg = H.parseColour(s.backgroundColor);
    if (bg.a >= 0.5) add(H.hex(H.paintAt(H.chainOf(el), null)), 2);
    add(H.hex(H.parseColour(s.color)), 1);
    if (parseFloat(s.borderTopWidth) >= 1 && H.parseColour(s.borderTopColor).a > 0.5) add(H.hex(H.parseColour(s.borderTopColor)), 1);
  }
  const h1 = [...document.querySelectorAll('h1')].find(H.rendered) || null;
  const textFace = Object.entries(textFaces).sort((p, q) => q[1] - p[1])[0];
  // First-screen archetype features at scrollY 0.
  const intersect = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const viewport = { left: 0, top: 0, right: vw, bottom: vh };
  const h1Box = h1 ? H.textBox(h1) : null;
  const h1Rect = h1 ? h1.getBoundingClientRect() : null;
  // Where the h1's glyphs are: the union of its text nodes' line fragments only
  // (a range over the whole h1 also returns the border box of every element in
  // it, e.g. a block <em> as wide as its max-width). textureLayers() relates
  // painted pixels to this.
  const inkRect = el => {
    const rects = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) rects.push(r);
    }
    if (!rects.length) return null;
    return { left: Math.round(Math.min(...rects.map(r => r.left))), top: Math.round(Math.min(...rects.map(r => r.top))), right: Math.round(Math.max(...rects.map(r => r.right))), bottom: Math.round(Math.max(...rects.map(r => r.bottom))) };
  };
  const relation = r => {
    if (!h1Box) return { behind: false, beside: false };
    const overlap = intersect(r, h1Box) / Math.max(1, h1Box.width * h1Box.height);
    const xOverlap = Math.max(0, Math.min(r.right, h1Box.right) - Math.max(r.left, h1Box.left));
    const yOverlap = Math.max(0, Math.min(r.bottom, h1Box.bottom) - Math.max(r.top, h1Box.top));
    return {
      behind: overlap >= 0.5,
      beside: xOverlap <= 0.1 * Math.min(r.right - r.left, h1Box.width) && yOverlap >= 0.3 * Math.min(r.bottom - r.top, h1Box.height),
      below: r.top >= h1Box.bottom - 4 && xOverlap > 0,
    };
  };
  const visuals = [];
  const blocks = [];
  // Each visual is tagged data-mb-visual=<probe> so Node can hide it for the
  // texture check (measureIdentity); clearProbes() removes the tags.
  let probes = 0;
  const clip = r => ({ left: Math.max(0, Math.round(r.left)), top: Math.max(0, Math.round(r.top)), right: Math.min(vw, Math.round(r.right)), bottom: Math.min(vh, Math.round(r.bottom)) });
  for (const el of document.body.querySelectorAll('*')) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= vh || r.width < 1 || r.height < 1) continue;
    const area = intersect(r, viewport) / va;
    if (area < 0.02) continue;
    let kind = null;
    let source = 'element';
    if (el.tagName === 'IMG') kind = /\.svg(\?|#|$)|^data:image\/svg/i.test(el.currentSrc || el.src) ? 'svg' : 'raster';
    else if (el.tagName === 'VIDEO') kind = 'raster';
    else if (el.tagName === 'CANVAS') kind = 'canvas';
    else if (el.tagName === 'IFRAME') kind = 'embed';
    else if (el instanceof SVGSVGElement) kind = 'svg';
    else {
      const image = H.style(el).backgroundImage;
      if (image.includes('url(')) { kind = /\.svg|data:image\/svg/i.test(image) ? 'svg' : 'raster'; source = 'background-image'; }
    }
    const containsH1 = !!h1 && (el.contains(h1) || h1.contains(el));
    if (kind) {
      if (!H.rendered(el) || el.parentElement && el.parentElement.closest('svg')) continue;
      const tinted = kind === 'raster' && [el.parentElement, el.parentElement && el.parentElement.parentElement].some(p => p && H.parseColour(H.style(p).backgroundColor).a >= 0.9 && H.hex(H.parseColour(H.style(p).backgroundColor)) !== groundHex);
      const probe = probes++;
      el.setAttribute('data-mb-visual', String(probe));
      visuals.push({ kind, area: Math.round(area * 1000) / 1000, selector: H.selectorOf(el), tinted, probe, source, rect: clip(r), ...relation(r) });
    } else if (!containsH1 && area >= 0.1 && H.rendered(el)) {
      const bg = H.parseColour(H.style(el).backgroundColor);
      const panel = bg.a >= 0.9 && H.hex(bg) !== groundHex && r.width <= 0.75 * vw;
      const tables = el.querySelectorAll('td, th, [role="gridcell"], [role="cell"]').length;
      blocks.push({ el, rect: r, area, panel, tables });
    }
  }
  // UI-mock signal: many small text nodes inside one block that does not hold the h1.
  const small = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/\S/.test(node.nodeValue) || !node.parentElement || !H.rendered(node.parentElement)) continue;
    if (parseFloat(H.style(node.parentElement).fontSize) > 14) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.bottom > 0 && r.top < vh && r.width >= 1) small.push({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, el: node.parentElement });
  }
  let uiMock = null;
  let uiMockEl = null;
  for (const block of blocks) {
    const inside = small.filter(s => block.el.contains(s.el)).length;
    const score = inside + block.tables;
    if ((inside >= 12 || block.tables >= 6) && (!uiMock || score > uiMock.smallText + uiMock.cells)) {
      uiMock = { selector: H.selectorOf(block.el), smallText: inside, cells: block.tables, area: Math.round(block.area * 1000) / 1000, ...relation(block.rect) };
      uiMockEl = block.el;
    }
  }
  // A panel that is the UI mock, holds it or sits inside it is the mock itself:
  // it already scores as product-stage and is not a second visual.
  const partOfMock = el => !!uiMockEl && (el === uiMockEl || el.contains(uiMockEl) || uiMockEl.contains(el));
  const mockPanels = [];
  for (const block of blocks.filter(b => b.panel)) {
    if (partOfMock(block.el)) { mockPanels.push(H.selectorOf(block.el)); continue; }
    visuals.push({ kind: 'panel', area: Math.round(block.area * 1000) / 1000, selector: H.selectorOf(block.el), tinted: false, ...relation(block.rect) });
  }
  if (uiMock && mockPanels.length) uiMock.panelsMerged = mockPanels.slice(0, 4);
  // Index rows: ≥ 4 large stacked links in the first screen.
  const rows = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (!H.rendered(a) || a.closest('nav,header,[role="navigation"],[role="banner"]')) continue;
    const r = a.getBoundingClientRect();
    if (r.top < 0 || r.bottom > vh || r.width < 0.4 * vw) continue;
    if (r.height < 48 && parseFloat(H.style(a).fontSize) < 24) continue;
    if (!rows.some(top => Math.abs(top - r.top) < 8)) rows.push(r.top);
  }
  visuals.sort((p, q) => q.area - p.area);
  // Fonts: the declared families, and one probe element per role (the h1
  // element holding most of its text in the h1's face; the longest paragraph
  // in the text face), tagged data-mb-font-probe so renderedFonts() can ask
  // Chromium which platform font actually painted their glyphs.
  const faces = new Map();
  for (const face of document.fonts || []) {
    const name = face.family.replace(/["']/g, '').trim().toLowerCase();
    if (faces.get(name) !== 'loaded') faces.set(name, face.status);
  }
  const ownText = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim().length;
  const families = el => H.style(el).fontFamily.split(',').map(f => f.replace(/["']/g, '').trim()).filter(Boolean);
  const declared = el => {
    if (!el) return null;
    const stack = families(el);
    return { family: stack[0] ?? null, stack: H.style(el).fontFamily, fontFace: faces.get((stack[0] ?? '').toLowerCase()) ?? null, loadedFamily: stack.find(name => faces.get(name.toLowerCase()) === 'loaded') ?? null };
  };
  let displayProbe = null;
  if (h1) {
    let best = 0;
    for (const el of [h1, ...h1.querySelectorAll('*')]) {
      const n = ownText(el);
      if (n > best && H.rendered(el) && family(el) === family(h1)) { displayProbe = el; best = n; }
    }
  }
  let textProbe = null;
  if (textFace) {
    let best = 0;
    for (const p of document.querySelectorAll('p')) {
      if (!H.rendered(p) || p.closest('nav,footer,header') || family(p) !== textFace[0]) continue;
      const n = ownText(p);
      if (n > best) { textProbe = p; best = n; }
    }
  }
  for (const [role, el] of [['display', displayProbe], ['text', textProbe]]) if (el) el.setAttribute('data-mb-font-probe', `${el.getAttribute('data-mb-font-probe') || ''} ${role}`.trim());
  return {
    ink,
    accent,
    textColours,
    fonts: {
      display: family(h1), text: textFace ? textFace[0] : family(document.body), displayStack: h1 ? H.style(h1).fontFamily : null, textFaces,
      declared: { display: declared(displayProbe ?? h1), text: declared(textProbe ?? document.body) },
      probes: { display: displayProbe ? H.selectorOf(displayProbe) : null, text: textProbe ? H.selectorOf(textProbe) : null },
    },
    firstScreen: {
      vw, vh,
      h1: h1 ? { text: H.textOf(h1).slice(0, 80), fontSize: parseFloat(H.style(h1).fontSize), textWidth: h1Box ? Math.round(h1Box.width) : 0, boxWidth: Math.round(h1Rect.width), top: Math.round(h1Rect.top), inView: h1Rect.top < vh && h1Rect.bottom > 0, textRect: h1Box ? { left: Math.round(h1Box.left), top: Math.round(h1Box.top), right: Math.round(h1Box.right), bottom: Math.round(h1Box.bottom) } : null, inkRect: inkRect(h1), ...H.centred(h1) } : null,
      visuals: visuals.slice(0, 10),
      uiMock,
      indexRows: rows.length,
    },
  };
}

/* Texture check: hide one tagged visual (its background image, or the element)
   or restore it. Layout never changes (background-image and visibility only). */
function toggleVisual({ probe, source, on }) {
  const el = document.querySelector(`[data-mb-visual="${probe}"]`);
  if (!el) return false;
  const property = source === 'background-image' ? 'background-image' : 'visibility';
  if (on) {
    el.setAttribute('data-mb-previous', JSON.stringify([el.style.getPropertyValue(property), el.style.getPropertyPriority(property)]));
    el.style.setProperty(property, source === 'background-image' ? 'none' : 'hidden', 'important');
  } else {
    const [value, priority] = JSON.parse(el.getAttribute('data-mb-previous') || '["",""]');
    if (value) el.style.setProperty(property, value, priority); else el.style.removeProperty(property);
    el.removeAttribute('data-mb-previous');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }
  return true;
}

/* Remove the identity probes' tags. */
function clearProbes() {
  for (const el of document.querySelectorAll('[data-mb-visual], [data-mb-font-probe]')) { el.removeAttribute('data-mb-visual'); el.removeAttribute('data-mb-font-probe'); }
  return true;
}

/* Visible text and tel:/mailto: targets for W17. */
function evalHonestyText() {
  return {
    text: document.body.innerText,
    hrefs: [...document.querySelectorAll('a[href^="tel:" i], a[href^="mailto:" i]')].map(a => a.getAttribute('href')),
  };
}

/* Judge control: the same document with every stylesheet and inline style removed. */
function unstyle() {
  for (const sheet of document.styleSheets) { try { sheet.disabled = true; } catch { /* cross-origin sheet */ } }
  document.adoptedStyleSheets = [];
  for (const el of document.querySelectorAll('[style]')) el.removeAttribute('style');
  scrollTo({ top: 0, behavior: 'instant' });
  return document.styleSheets.length;
}

// ---------------------------------------------------------------------------
// Node orchestration.

const VITALS_INIT = `(() => {
  const store = window.__mbVitals = { webVitals: { cls: null, lcp: null }, observer: { cls: 0, lcp: null, shifts: 0 } };
  try {
    webVitals.onCLS(metric => { store.webVitals.cls = metric.value; }, { reportAllChanges: true });
    webVitals.onLCP(metric => { store.webVitals.lcp = metric.value; }, { reportAllChanges: true });
  } catch (error) { store.webVitalsError = String(error); }
  try {
    // Fallback: CLS as the largest session window (gap < 1 s, window ≤ 5 s), excluding input.
    let session = 0, first = 0, last = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        if (session && entry.startTime - last < 1000 && entry.startTime - first < 5000) session += entry.value;
        else { session = entry.value; first = entry.startTime; }
        last = entry.startTime;
        store.observer.shifts++;
        store.observer.cls = Math.max(store.observer.cls, session);
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      const entry = entries[entries.length - 1];
      if (entry) store.observer.lcp = entry.renderTime || entry.loadTime || entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (error) { store.observerError = String(error); }
})();`;

let vitalsScript;

async function attempt(fn) {
  try { return await fn(); } catch (error) { return { error: String(error?.message ?? error).split('\n')[0].slice(0, 300) }; }
}

async function settle(page, ms = 400) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {});
  await page.waitForTimeout(ms);
}

/** Open one page at width × mode; the caller's hooks may route it (HAR replay) or replace the context. */
async function openSession({ browser, url, width, mode, contextOptions, onContext, newContext, runtime }) {
  const options = { bypassCSP: true, ...contextOptions, viewport: { width, height: HEIGHTS[width] ?? 900 }, deviceScaleFactor: 1, reducedMotion: mode };
  const context = newContext ? await newContext(options, { width, mode }) : await browser.newContext(options);
  try {
    if (onContext) await onContext(context, { width, mode });
    // One script: Playwright wraps each init script in its own scope, so the
    // IIFE's `var webVitals` is only visible to code in the same script.
    vitalsScript ??= `${readFileSync(WEB_VITALS_PATH, 'utf8')}\n;${VITALS_INIT}`;
    await context.addInitScript(vitalsScript);
    const page = await context.newPage();
    page.on('pageerror', error => runtime.push({ kind: 'pageerror', message: String(error.message).slice(0, 300), width, mode }));
    page.on('console', message => {
      if (message.type() === 'error') runtime.push({ kind: 'console', message: message.text().slice(0, 300), url: message.location()?.url ?? null, width, mode });
    });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await settle(page);
    await page.evaluate(installHelpers, { platformSelector: PLATFORM_SELECTOR });
    return { context, page };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function runAxe(page) {
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async tags => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return {
      testEngine: result.testEngine,
      violations: result.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags, nodes: v.nodes.map(n => ({ target: n.target, impact: n.impact, html: n.html.slice(0, 300), failureSummary: n.failureSummary })) })),
    };
  }, [...AXE_TAGS]);
}

async function readVitals(page) {
  const store = await page.evaluate(() => window.__mbVitals ?? null);
  if (!store) return { error: 'vitals store missing' };
  const cls = store.webVitals.cls ?? store.observer.cls;
  const lcp = store.webVitals.lcp ?? store.observer.lcp;
  return { cls: round(cls, 4), lcpMs: lcp == null ? null : Math.round(lcp), source: { cls: store.webVitals.cls == null ? 'observer' : 'web-vitals', lcp: store.webVitals.lcp == null ? 'observer' : 'web-vitals' }, observer: store.observer, errors: [store.webVitalsError, store.observerError].filter(Boolean) };
}

async function shoot(page, file, fullPage) {
  if (!file) return null;
  ensureDir(path.dirname(file));
  if (!fullPage) await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: file, fullPage, animations: 'disabled', timeout: 60000 });
  return rel(file);
}

// --- W13 links -------------------------------------------------------------

const telOk = href => {
  const value = decodeURIComponent(href.replace(/^tel:/i, ''));
  return !/[[\]{}<>a-z]/i.test(value) && (value.match(/\d/g) ?? []).length >= 7;
};
const mailOk = href => {
  const address = decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]);
  return !/[[\]{}<>\s]/.test(address) && address.split(',').every(part => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part.trim()));
};

async function verifyFragments(page, url, candidates) {
  // A fragment with no matching id can still work: hash routes and click handlers.
  // Click the real link (or set the hash when it is not clickable) and see whether
  // the page scrolled, changed content, or now has the target.
  const results = [];
  for (const link of candidates.slice(0, 12)) {
    try {
      await page.goto(url, { waitUntil: 'load' });
      await settle(page, 300);
      const probe = fragment => ({ y: scrollY, size: document.body.innerText.length, title: document.title, target: !!(document.getElementById(fragment) || document.getElementsByName(fragment)[0]) });
      const locator = page.locator('a[href], area[href]').nth(link.index);
      const clickable = await locator.isVisible().catch(() => false);
      // Bring the link into view first so the probe sees only what the click itself does.
      if (clickable) { await locator.scrollIntoViewIfNeeded({ timeout: 3000 }); await page.waitForTimeout(150); }
      const before = await page.evaluate(probe, link.fragment);
      let how = 'hash';
      if (clickable) {
        await locator.click({ timeout: 3000 });
        how = 'click';
      } else {
        await page.evaluate(fragment => { location.hash = fragment; }, link.fragment);
      }
      await page.waitForTimeout(700);
      const after = await page.evaluate(probe, link.fragment);
      const works = after.target || Math.abs(after.y - before.y) > 20 || after.size !== before.size || after.title !== before.title;
      results.push({ ...link, how, works });
    } catch (error) {
      results.push({ ...link, how: 'error', works: false, error: error.message.split('\n')[0] });
    }
  }
  return results;
}

async function checkLinks(page, url, { requestStatus }) {
  const links = await page.evaluate(evalLinks);
  const pageUrl = new URL(page.url());
  const out = { total: links.length, internal: 0, external: 0, hashOnly: [], empty: [], javascript: [], missingAnchors: [], notFound: [], malformedTel: [], malformedMailto: [], hashRoutes: [], unverified: [] };
  const fragments = [];
  const paths = new Map();
  const brief = link => ({ href: link.href, text: link.text, selector: link.selector });
  for (const link of links) {
    const href = (link.href ?? '').trim();
    if (href === '#') { out.hashOnly.push(brief(link)); continue; }
    if (href === '') { out.empty.push(brief(link)); continue; }
    if (/^javascript:/i.test(href)) { out.javascript.push(brief(link)); continue; }
    if (/^tel:/i.test(href)) { if (!telOk(href)) out.malformedTel.push(brief(link)); continue; }
    if (/^mailto:/i.test(href)) { if (!mailOk(href)) out.malformedMailto.push(brief(link)); continue; }
    if (link.fragment !== null && (href.startsWith('#') || link.samePage)) {
      out.internal++;
      if (link.fragment === 'top' || link.targetExists) continue;
      fragments.push(link);
      continue;
    }
    let target;
    try { target = new URL(link.resolved); } catch { out.unverified.push({ ...brief(link), reason: 'unparseable' }); continue; }
    if (!/^https?:$/.test(target.protocol)) continue;
    if (target.origin !== pageUrl.origin) { out.external++; continue; }
    out.internal++;
    if (target.pathname === pageUrl.pathname) continue;
    if (!paths.has(target.pathname)) paths.set(target.pathname, []);
    paths.get(target.pathname).push(brief(link));
  }
  for (const [pathname, owners] of paths) {
    const status = await attempt(async () => (requestStatus ? requestStatus(pathname) : page.evaluate(async p => (await fetch(p, { method: 'GET', cache: 'no-store' })).status, pathname)));
    if (typeof status === 'object' && status?.error) out.unverified.push({ href: pathname, reason: status.error, links: owners.length });
    else if (status === 404 || status === 410) out.notFound.push({ href: pathname, status, text: owners[0].text, links: owners.length });
  }
  // Same fragment repeated: verify once.
  const unique = [...new Map(fragments.map(link => [link.fragment, link])).values()];
  const verified = unique.length ? await verifyFragments(page, url, unique) : [];
  // A hash-router home link ('#/') clicked on the home page rightly changes nothing.
  // It counts as working when at least one other '#/…' route on the page was verified.
  const routerWorks = verified.some(result => result.works && /^\/./.test(result.fragment ?? ''));
  for (const result of verified) {
    const entry = { href: result.href, text: result.text, selector: result.selector, how: result.how, links: fragments.filter(link => link.fragment === result.fragment).length };
    if (!result.works && result.fragment === '/' && routerWorks) { out.hashRoutes.push({ ...entry, how: 'home route (other hash routes work)' }); continue; }
    if (result.works) out.hashRoutes.push(entry); else out.missingAnchors.push(entry);
  }
  out.dead = out.hashOnly.length + out.empty.length + out.javascript.length + out.malformedTel.length + out.malformedMailto.length + out.notFound.length
    + out.missingAnchors.reduce((sum, entry) => sum + entry.links, 0);
  return out;
}

// --- W15 tells -------------------------------------------------------------

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRegExp = phrase => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');

function bannedCopy(raw) {
  const text = [raw.text ?? '', ...(raw.controls ?? [])].join('\n');
  const found = [];
  for (const phrase of BANNED_COPY) {
    const match = phraseRegExp(phrase).exec(text);
    if (match) found.push({ phrase, context: text.slice(Math.max(0, match.index - 30), match.index + phrase.length + 30).replace(/\s+/g, ' ').trim() });
  }
  const labels = (raw.headings ?? []).filter(heading => LABEL_HEADINGS.includes(heading.toLowerCase().replace(/[.:!?]+$/, '').trim()));
  return { present: found.length > 0 || labels.length > 0, phrases: found, labelHeadings: [...new Set(labels)] };
}

// Tells against the brief. prompt.ts (ANTI-PATTERNS, "Defaults check") lets an
// explicitly requested client style win, so the cream/serif/italic/pill and
// marquee/wordmark tells carry requestedByBrief: true when the brief text
// (briefText(), case-insensitive) matches one of these patterns. "warm" on its
// own ("it should feel warm") is a mood, not a ground, and does not count;
// neither does "cream" as a product ("a cream blush").
const COLOUR_NOUN = '(?:palette|ground|background|backdrop|colou?rs?|colou?rway|tones?|hues?|paper|neutrals)';
const COLOUR_WORD = '(?:charcoal|black|white|ink|navy|green|olive|sage|terracotta|rust|brown|gold|red|oxblood|burgundy|blue|grey|gray|clay)';
export const STYLE_REQUEST_PATTERNS = Object.freeze({
  // A warm / cream / ivory / beige ground.
  warmGround: Object.freeze([
    /\b(?:ivory|beige|ecru|parchment|off[- ]white|oatmeal)\b/i, // colour words with no other common meaning in a brief
    new RegExp(`\\b(?:warm|cream)(?:[\\s,]+[\\w-]+){0,2}?[\\s,]+${COLOUR_NOUN}\\b`, 'i'), // "warm skin-tone palette", "cream background"
    new RegExp(`\\bcream\\s+(?:and|&)\\s+${COLOUR_WORD}\\b|\\b${COLOUR_WORD}\\s+(?:and|&)\\s+cream\\b`, 'i'), // "charcoal and cream"
  ]),
  // A serif or editorial look ("sans-serif" / "sans serif" excluded).
  serifOrEditorial: Object.freeze([/(?<!\bsans[\s-]?)\bserifs?\b/i, /\beditorial\b/i]),
  // The marquee / giant-wordmark devices themselves (marqueeAndWordmark only).
  marqueeOrWordmark: Object.freeze([/\bmarquees?\b/i, /\bscrolling\s+(?:band|banner|text|ticker|strip)\b/i, /\b(?:giant|oversized|huge|large|big)\s+(?:footer\s+)?word\s?marks?\b/i]),
});

/** What the brief explicitly asks for, by STYLE_REQUEST_PATTERNS group: the matched phrases. */
export function briefStyleRequests(brief) {
  const text = briefText(brief);
  const found = Object.fromEntries(Object.entries(STYLE_REQUEST_PATTERNS).map(([group, patterns]) => [group,
    [...new Set(patterns.map(pattern => pattern.exec(text)?.[0]).filter(Boolean).map(match => match.replace(/\s+/g, ' ').toLowerCase()))]]));
  return { provided: !!text.trim(), ...found };
}

/**
 * requestedByBrief per tell (null without brief text), with the phrases that
 * decided it. Each tell is requested only by the keyword groups that describe
 * it: the cream/serif/italic/pill look by a warm ground or a serif/editorial
 * request; the marquee/wordmark devices only by the marquee/wordmark group
 * ("editorial" or "warm" asks for a look, not for a scrolling band and a giant
 * footer word).
 */
export const TELL_REQUEST_GROUPS = Object.freeze({ creamSerifItalicPill: Object.freeze(['warmGround', 'serifOrEditorial']), marqueeAndWordmark: Object.freeze(['marqueeOrWordmark']) });

function requestFor(name, requests) {
  if (!requests?.provided) return { requestedByBrief: null, briefMatches: [] };
  const groups = TELL_REQUEST_GROUPS[name] ?? [];
  const matches = groups.flatMap(group => requests[group]);
  return { requestedByBrief: matches.length > 0, briefMatches: matches };
}

function decideTells(raw, ground, requests) {
  const hero = raw.centredHero ?? {};
  const cream = ground ? isCreamGround(ground) : false;
  const tells = {
    equalCardRow: { present: raw.equalCardRows.length > 0, evidence: raw.equalCardRows },
    centredHeroTwoButtons: { present: !!(hero.h1 && hero.h1InView && hero.h1Centred && hero.buttonCount >= 2 && hero.buttonsCentred), evidence: hero },
    creamSerifItalicPill: {
      present: cream && raw.serifH1 && raw.italicAccents.length > 0 && raw.pillCount > 0,
      ...requestFor('creamSerifItalicPill', requests),
      evidence: { ground, creamGround: cream, h1Family: raw.h1Family, serifH1: raw.serifH1, italicAccents: raw.italicAccents, pills: raw.pills, pillCount: raw.pillCount, platformPills: raw.platformPills, platformPillCount: raw.platformPillCount },
    },
    marqueeAndWordmark: { present: raw.marquees.length > 0 && raw.wordmarks.length > 0, ...requestFor('marqueeAndWordmark', requests), evidence: { marquees: raw.marquees, wordmarks: raw.wordmarks } },
    bannedCopy: (() => { const copy = bannedCopy(raw); return { present: copy.present, evidence: copy }; })(),
  };
  return tells;
}

function mergeTells(byMode) {
  const modes = Object.keys(byMode).filter(mode => !byMode[mode].error);
  if (!modes.length) return { error: Object.values(byMode)[0]?.error ?? 'no tells measured' };
  const names = Object.keys(byMode[modes[0]]);
  const merged = {};
  for (const name of names) {
    const presentIn = modes.filter(mode => byMode[mode][name].present);
    merged[name] = { ...byMode[presentIn[0] ?? modes[0]][name], present: presentIn.length > 0, modes: presentIn };
  }
  const present = names.filter(name => merged[name].present);
  // "requested": the brief explicitly asked for this look (requestedByBrief); the rest is drift.
  const requested = present.filter(name => merged[name].requestedByBrief === true);
  return { count: present.length, present, requested, unrequested: present.filter(name => !requested.includes(name)), ...merged };
}

// --- W17 honesty -----------------------------------------------------------

/** All strings in a brief (string or object) joined, for verbatim checks. */
export function briefText(brief) {
  if (brief == null) return '';
  if (typeof brief === 'string') return brief;
  if (Array.isArray(brief)) return brief.map(briefText).join('\n');
  if (typeof brief === 'object') return Object.values(brief).map(briefText).join('\n');
  return String(brief);
}

const insideBrackets = (text, index) => text.lastIndexOf('[', index) > text.lastIndexOf(']', index);

/**
 * Two digit strings are the same phone number when they are equal, or when one
 * ends with the other and the shorter (without a national trunk 0) still has
 * ≥ 7 digits: +1 708 534 1077 (17085341077) is 708-534-1077, +44 113 496 0000
 * (441134960000) is 0113 496 0000.
 */
export function samePhone(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const national = short.replace(/^0+/, '');
  return national.length >= 7 && long.endsWith(national);
}

export function honestyFindings({ text = '', hrefs = [] }, brief) {
  const source = briefText(brief);
  const briefLower = source.toLowerCase();
  const briefDigits = (source.match(/\d[\d\s().\- /]*\d/g) ?? []).map(run => run.replace(/\D/g, '')).filter(run => run.length >= 7);
  // A number is in the brief when a brief digit-run holds it, holds it without
  // its leading country code (1–3 digits after "+" or "00", e.g. a tel: href in
  // E.164 form against the brief's national number), or is the same number by samePhone().
  const inBrief = (digits, international) => {
    const forms = [digits];
    if (international) for (let k = 1; k <= 3; k++) if (digits.length - k >= 7) forms.push(digits.slice(k));
    return briefDigits.some(run => forms.some(form => run.includes(form)) || samePhone(digits, run));
  };
  const international = value => /^\s*(?:\+|00)/.test(value);
  const phones = [];
  const emails = [];
  const allowed = [];
  let bracketed = 0;
  // The same number found again (in the text or as a tel: target) is one finding with more occurrences.
  const addPhone = (value, digits, from) => {
    const known = phones.find(phone => samePhone(phone.digits, digits));
    if (known) { known.occurrences++; if (!known.sources.includes(from)) known.sources.push(from); return; }
    phones.push({ text: value, digits, source: from, sources: [from], occurrences: 1 });
  };
  // A phone number sits on one line of innerText: its groups are joined only by
  // horizontal spaces (space, no-break, thin, narrow no-break), brackets, dots
  // or hyphens. A line break separates blocks and a tab separates table cells,
  // so step counters ("01", "02", "03" on separate lines), calendar days and
  // amount columns ("400.00" above "12") never join into one "number".
  const phoneRe = /\+?\(?\d[\d ()\u00a0\u2009\u202f.\u2011-]{5,}\d/g;
  for (const match of text.matchAll(phoneRe)) {
    const raw = match[0].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) continue;
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(raw)) continue; // dates
    if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(raw)) continue; // year ranges
    if (/[£$€¥]\s?$/.test(text.slice(Math.max(0, match.index - 2), match.index))) continue; // prices
    if (insideBrackets(text, match.index)) { bracketed++; continue; }
    if (briefLower.includes(raw.toLowerCase()) || inBrief(digits, international(raw))) { allowed.push({ type: 'phone', text: raw }); continue; }
    addPhone(raw, digits, 'text');
  }
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const value = match[0];
    if (insideBrackets(text, match.index)) { bracketed++; continue; }
    if (briefLower.includes(value.toLowerCase())) { allowed.push({ type: 'email', text: value }); continue; }
    emails.push({ text: value, source: 'text', reserved: /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|[\w-]+\.(?:invalid|test|example))$/i.test(value) });
  }
  // Link targets are visible as actions even when the label is not the number.
  for (const href of hrefs) {
    const value = decodeURIComponent(href.replace(/^(tel|mailto):/i, '').split('?')[0]).trim();
    if (!value || /[[\]]/.test(value)) continue;
    if (/^tel:/i.test(href)) {
      const digits = value.replace(/\D/g, '');
      if (digits.length < 7) continue;
      if (inBrief(digits, international(value)) || briefLower.includes(value.toLowerCase())) { if (!allowed.some(entry => entry.type === 'phone' && samePhone(entry.text.replace(/\D/g, ''), digits))) allowed.push({ type: 'phone', text: value, source: 'href' }); continue; }
      addPhone(value, digits, 'href');
    } else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && !emails.some(e => e.text.toLowerCase() === value.toLowerCase()) && !briefLower.includes(value.toLowerCase())) {
      emails.push({ text: value, source: 'href', reserved: /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|[\w-]+\.(?:invalid|test|example))$/i.test(value) });
    }
  }
  return { ok: phones.length === 0 && emails.length === 0, briefProvided: !!source.trim(), phones, emails, allowed, bracketed };
}

// --- D1–D4 identity --------------------------------------------------------

const topKey = counts => Object.entries(counts ?? {}).sort((p, q) => q[1] - p[1])[0] ?? null;

/**
 * First-screen archetype by explicit scores (0–1), so a reader can audit the
 * decision. Ties resolve in ARCHETYPE_ORDER (specific before generic); a best
 * score below 0.5 is 'other'.
 */
export const ARCHETYPE_ORDER = Object.freeze(['poster', 'photographic', 'index', 'product-stage', 'editorial-split', 'type-as-image', 'centred-stack']);

export function scoreArchetypes(features, firstScreenSamples) {
  const { vw, h1, uiMock, indexRows = 0 } = features;
  // Texture layers (measureIdentity: hiding them changes no painted pixel by
  // more than TEXTURE_DELTA_E) are grain or washes, not visuals: they neither
  // compete with the type nor make a split or a photograph.
  const textures = (features.visuals ?? []).filter(v => v.texture);
  const visuals = (features.visuals ?? []).filter(v => !v.texture);
  const clamp = value => Math.max(0, Math.min(1, value));
  // A layer behind the h1 that was measured from pixels (textureLayers:
  // paintedRegion) counts with what it paints apart from the ground, not with
  // its box: a full-bleed backdrop SVG is not a visual competing with the
  // type, and the picture it draws beside the h1 is beside it.
  const areaOf = v => (Number.isFinite(v.paintedArea) ? v.paintedArea : v.area);
  const placeOf = v => v.paintedRelation ?? v;
  const scores = {};
  const notes = textures.length ? { texturesIgnored: textures.map(v => ({ kind: v.kind, area: v.area, selector: v.selector, deltaE99: v.textureDeltaE })) } : {};
  const painted = visuals.filter(v => Number.isFinite(v.paintedArea));
  if (painted.length) notes.paintedLayers = painted.map(v => ({ kind: v.kind, selector: v.selector, boxArea: v.area, paintedArea: v.paintedArea, paintedRect: v.paintedRect ?? null, beside: placeOf(v).beside, behind: placeOf(v).behind }));
  // photographic: raster media covering ≥ 50% of the viewport, behind or beside the h1.
  const raster = visuals.filter(v => v.kind === 'raster').sort((p, q) => q.area - p.area)[0];
  if (raster) {
    const related = raster.behind || raster.beside;
    scores.photographic = raster.area >= 0.5 ? (related ? 0.75 + 0.25 * clamp((raster.area - 0.5) / 0.4) : 0.6) : 0.8 * clamp(raster.area / 0.5) * (related ? 1 : 0.6);
    notes.photographic = { area: raster.area, behind: raster.behind, beside: raster.beside, selector: raster.selector };
  } else scores.photographic = 0;
  // type-as-image: h1 ≥ 7% of the viewport width in size, or its text ≥ 70% of the width.
  // The type has to *be* the image: a competing visual of ≥ 12% of the screen damps it by 0.7.
  const largestVisual = visuals.reduce((max, v) => Math.max(max, areaOf(v)), uiMock?.area ?? 0);
  if (h1) {
    const strength = Math.max(h1.fontSize / (0.07 * vw), h1.textWidth / (0.7 * vw));
    const base = strength >= 1 ? 0.6 + 0.4 * clamp((strength - 1) / 0.5) : 0.6 * strength ** 3;
    scores['type-as-image'] = base * (largestVisual >= 0.12 ? 0.7 : 1);
    notes['type-as-image'] = { fontSize: h1.fontSize, textWidth: h1.textWidth, strength: round(strength), competingVisual: largestVisual };
  } else scores['type-as-image'] = 0;
  // editorial-split: h1 in one column and a large visual beside it.
  // (A raster covering half the screen beside the h1 is photographic, not a split.)
  const beside = visuals.filter(v => placeOf(v).beside && (v.kind !== 'raster' || areaOf(v) < 0.5)).sort((p, q) => areaOf(q) - areaOf(p))[0];
  if (h1 && beside && h1.boxWidth <= 0.65 * vw) {
    const area = areaOf(beside);
    scores['editorial-split'] = area >= 0.12 ? 0.6 + 0.4 * clamp((area - 0.12) / 0.2) : 0.5 * clamp(area / 0.12);
    notes['editorial-split'] = { visual: beside.kind, area, selector: beside.selector, h1BoxWidth: h1.boxWidth, ...(Number.isFinite(beside.paintedArea) ? { boxArea: beside.area, from: 'painted pixels' } : {}) };
  } else scores['editorial-split'] = 0;
  // poster: one saturated colour field over ≥ 70% of the first screen, with display type.
  const fill = topKey(firstScreenSamples?.counts);
  if (fill && firstScreenSamples.total) {
    const share = fill[1] / firstScreenSamples.total;
    const colour = describeColour(fill[0]);
    const saturated = colour && colour.chroma >= 30 && colour.lab.L >= 25 && colour.lab.L <= 92;
    scores.poster = saturated && share >= 0.7 && (h1?.fontSize ?? 0) >= 48 ? 0.8 + 0.2 * clamp((share - 0.7) / 0.3) : saturated && share >= 0.5 ? 0.45 : 0;
    notes.poster = { colour: fill[0], share: round(share), chroma: colour?.chroma ?? null };
  } else scores.poster = 0;
  // product-stage: a crafted UI mock (many small text nodes or a table/grid) beside or below the h1,
  // or a product image on a tinted panel.
  const tintedProduct = visuals.find(v => v.kind === 'raster' && v.tinted && v.area >= 0.12 && !v.behind);
  if (uiMock && !uiMock.behind && uiMock.area >= 0.12) {
    scores['product-stage'] = 0.7 + 0.3 * clamp((uiMock.smallText + uiMock.cells - 12) / 30);
    notes['product-stage'] = uiMock;
  } else if (tintedProduct) {
    scores['product-stage'] = 0.65;
    notes['product-stage'] = { tintedProduct };
  } else scores['product-stage'] = 0;
  // index: the hero is a list of ≥ 4 large linked rows.
  scores.index = indexRows >= 4 ? 0.9 : indexRows === 3 ? 0.45 : 0;
  notes.index = { indexRows };
  // centred-stack: centred h1 with nothing else of size in the first screen.
  scores['centred-stack'] = h1?.centred ? (largestVisual < 0.15 ? 0.9 : largestVisual < 0.3 ? 0.45 : 0.1) : 0;
  notes['centred-stack'] = { h1Centred: !!h1?.centred, how: h1?.how ?? null, largestVisual };
  for (const key of Object.keys(scores)) scores[key] = round(scores[key], 3);
  const best = ARCHETYPE_ORDER.reduce((winner, name) => (scores[name] > (scores[winner] ?? -1) ? name : winner), ARCHETYPE_ORDER[0]);
  return { archetype: scores[best] >= 0.5 ? best : 'other', scores, notes };
}

// --- D2 ground: DOM samples checked against painted pixels -----------------

// ΔE00 within which a layered sample (background image, gradient, overlay)
// still shows the colour under the layer: the layer is a texture or a wash,
// not a picture. The same 10 that D1 uses to call two palette colours the same.
export const TEXTURE_DELTA_E = 10;
const PATCH_RADIUS = 4; // a 9 × 9 px patch around each sample point
const LAYERED = new Set(['image', 'gradient', 'overlay']);
const GROUND_GRIDS = Object.freeze({ firstScreen: [16, 10], page: [12, 6] });
const MAX_BANDS = 40;

const deltaE = (p, q) => (p && q ? round(ciede2000(hexToLab(p), hexToLab(q)), 2) : null);

async function decodeShot(buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 5-bit-per-channel colour bins over a box of the image, every `step` px. */
function binPixels(image, { left = 0, top = 0, right = image.width, bottom = image.height } = {}, step = 1, bins = new Map()) {
  const { data, width, channels } = image;
  for (let y = Math.max(0, top); y < Math.min(bottom, image.height); y += step) {
    for (let x = Math.max(0, left); x < Math.min(right, width); x += step) {
      const i = (y * width + x) * channels;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bin.n++; bin.r += data[i]; bin.g += data[i + 1]; bin.b += data[i + 2];
      bins.set(key, bin);
    }
  }
  return bins;
}

function mergeBins(into, from) {
  for (const [key, bin] of from) {
    const target = into.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    target.n += bin.n; target.r += bin.r; target.g += bin.g; target.b += bin.b;
    into.set(key, target);
  }
  return into;
}

/** Dominant colour: the mean colour of the biggest bin, with its share of the pixels. */
function dominantBin(bins) {
  let total = 0;
  let best = null;
  for (const bin of bins.values()) { total += bin.n; if (!best || bin.n > best.n) best = bin; }
  if (!best) return null;
  const channel = value => Math.round(value / best.n).toString(16).padStart(2, '0');
  return { hex: `#${channel(best.r)}${channel(best.g)}${channel(best.b)}`, share: round(best.n / total, 3) };
}

/**
 * Settle a layered sample from the screenshot of its band: when the painted
 * patch around the point is within TEXTURE_DELTA_E of the colour under the
 * layer, the layer does not change the ground (grain, texture, faint wash) and
 * the sample counts as that colour; otherwise the layer paints a picture there
 * and the sample is media. Without a screenshot it stays media (as before).
 * Media samples with a plain colour behind them (sample.under) are settled the
 * same way: where the media is transparent or paints that colour (the empty
 * areas of SVG art over a dark section), the screenshot shows the ground and
 * the sample counts as that colour; a photo or a drawn shape stays media.
 */
function settleSample(sample, image, texture) {
  const media = sample.kind === 'media';
  if (!LAYERED.has(sample.kind) && !(media && sample.under)) return sample;
  const base = media ? sample.under : sample.hex;
  const stats = texture.byKind[sample.kind] ??= { checked: 0, colour: 0, media: 0 };
  stats.checked++;
  if (!image) { stats.media++; return { ...sample, kind: 'media' }; }
  const patch = dominantBin(binPixels(image, { left: sample.x - PATCH_RADIUS, top: sample.y - PATCH_RADIUS, right: sample.x + PATCH_RADIUS + 1, bottom: sample.y + PATCH_RADIUS + 1 }));
  const distance = deltaE(patch?.hex, base);
  const keep = distance !== null && distance <= TEXTURE_DELTA_E;
  stats[keep ? 'colour' : 'media']++;
  if (texture.examples.length < 8 && !texture.examples.some(example => example.kind === sample.kind && example.verdict === (keep ? 'colour' : 'media'))) {
    texture.examples.push({ kind: sample.kind, at: [sample.x, sample.y], underLayer: base, painted: patch?.hex ?? null, deltaE: distance, verdict: keep ? 'colour' : 'media', ...(sample.layer ? { layer: sample.layer } : {}) });
  }
  return { ...sample, kind: keep ? 'colour' : 'media', hex: base };
}

function tallySample(target, sample) {
  target.total++;
  if (sample.kind === 'colour') target.counts[sample.hex] = (target.counts[sample.hex] ?? 0) + 1;
  else target.media++;
}

/**
 * D1–D4 inputs of the page at its current width (scrolled back to the top
 * afterwards): ground samples band by band (first screen 16 × 10, every band
 * of the page 12 × 6), each band's screenshot to settle layered samples and to
 * record the dominant painted colour, then evalIdentity() for the rest.
 */
async function measureIdentity(page) {
  const firstScreen = { counts: {}, media: 0, total: 0 };
  const sampled = { counts: {}, media: 0, total: 0 };
  const texture = { byKind: {}, examples: [] };
  const pageBins = new Map();
  let firstScreenPixels = null;
  let pixelError = null;
  let bands = 0;
  try {
    const vh = await page.evaluate(() => innerHeight);
    let height = Infinity;
    for (let y = 0; y < height && bands < MAX_BANDS; y += vh, bands++) {
      const grids = bands === 0 ? [[firstScreen, ...GROUND_GRIDS.firstScreen, false], [sampled, ...GROUND_GRIDS.page, false]] : [[sampled, ...GROUND_GRIDS.page, true]];
      const results = [];
      for (const [target, cols, rows, skipPinned] of grids) {
        const band = await page.evaluate(evalGroundBand, { y, cols, rows, skipPinned });
        height = band.height;
        results.push([target, band.samples]);
      }
      let image = null;
      try { image = await decodeShot(await page.screenshot({ animations: 'disabled', caret: 'hide', timeout: 30000 })); }
      catch (error) { pixelError ??= String(error?.message ?? error).split('\n')[0].slice(0, 200); }
      if (image) {
        const bins = binPixels(image, undefined, 2);
        if (bands === 0) firstScreenPixels = dominantBin(bins);
        mergeBins(pageBins, bins);
      }
      for (const [target, samples] of results) for (const sample of samples) tallySample(target, settleSample(sample, image, texture));
    }
  } finally {
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
  }
  const groundHex = topKey(firstScreen.counts)?.[0] ?? '#ffffff';
  const rest = await page.evaluate(evalIdentity, { groundHex });
  let textureCheck;
  let renderedFontsResult;
  try {
    textureCheck = await attempt(() => textureLayers(page, rest.firstScreen.visuals, { groundHex, h1Rect: rest.firstScreen.h1?.inkRect ?? rest.firstScreen.h1?.textRect ?? null }));
    renderedFontsResult = await attempt(() => renderedFonts(page));
  } finally {
    await page.evaluate(clearProbes).catch(() => {});
  }
  return {
    ...rest,
    renderedFonts: renderedFontsResult,
    textureCheck,
    samples: { firstScreen, page: sampled, bands },
    pixels: { firstScreen: firstScreenPixels, page: dominantBin(pageBins), method: 'dominant 5-bit bin of each band screenshot (every 2nd px)', ...(pixelError ? { error: pixelError } : {}) },
    texture,
  };
}

// --- texture layers and rendered fonts --------------------------------------

const TEXTURE_MIN_AREA = 0.1; // smaller visuals barely move any archetype score
const MAX_TEXTURE_CHECKS = 8;

/**
 * Where a visual's box and h1 relate (the same rule as evalIdentity's
 * relation()): behind = covers ≥ 50% of the h1 text box; beside = next to it
 * (≤ 10% horizontal overlap) and level with it (≥ 30% vertical overlap).
 */
export function relationTo(r, h1) {
  if (!r || !h1) return { behind: false, beside: false, below: false };
  const width = h1.right - h1.left, height = h1.bottom - h1.top;
  const xOverlap = Math.max(0, Math.min(r.right, h1.right) - Math.max(r.left, h1.left));
  const yOverlap = Math.max(0, Math.min(r.bottom, h1.bottom) - Math.max(r.top, h1.top));
  return {
    behind: (xOverlap * yOverlap) / Math.max(1, width * height) >= 0.5,
    beside: xOverlap <= 0.1 * Math.min(r.right - r.left, width) && yOverlap >= 0.3 * Math.min(r.bottom - r.top, height),
    below: r.top >= h1.bottom - 4 && xOverlap > 0,
  };
}

/**
 * What a layer actually paints inside its box: the sampled pixels (every
 * `step` px) that change when the layer is hidden (ΔE00 > 2, so text drawn
 * over it does not count) AND differ from the first-screen ground by more
 * than TEXTURE_DELTA_E (so the part that only repaints the ground colour, a
 * full-bleed backdrop, does not count). Returns the share of the box, and the
 * 2nd–98th percentile box of those pixels.
 */
export function paintedRegion(shown, hidden, rect, groundHex, step = 3) {
  const ground = groundHex ? hexToLab(groundHex) : null;
  const { left = 0, top = 0, right = shown.width, bottom = shown.height } = rect ?? {};
  const xs = [], ys = [];
  let total = 0;
  for (let y = Math.max(0, top); y < Math.min(bottom, shown.height, hidden.height); y += step) {
    for (let x = Math.max(0, left); x < Math.min(right, shown.width, hidden.width); x += step) {
      total++;
      const i = (y * shown.width + x) * shown.channels;
      const j = (y * hidden.width + x) * hidden.channels;
      const lab = pixelLab(shown.data[i], shown.data[i + 1], shown.data[i + 2]);
      if (shown.data[i] === hidden.data[j] && shown.data[i + 1] === hidden.data[j + 1] && shown.data[i + 2] === hidden.data[j + 2]) continue;
      if (ciede2000(lab, pixelLab(hidden.data[j], hidden.data[j + 1], hidden.data[j + 2])) <= 2) continue;
      if (ground && ciede2000(lab, ground) <= TEXTURE_DELTA_E) continue;
      xs.push(x); ys.push(y);
    }
  }
  if (!total) return { share: null, rect: null, pixels: 0 };
  if (!xs.length) return { share: 0, rect: null, pixels: total };
  const at = (list, q) => list[Math.min(list.length - 1, Math.max(0, Math.round(q * (list.length - 1))))];
  xs.sort((p, q) => p - q); ys.sort((p, q) => p - q);
  return { share: round(xs.length / total, 3), rect: { left: at(xs, 0.02), top: at(ys, 0.02), right: at(xs, 0.98) + step, bottom: at(ys, 0.98) + step }, pixels: total };
}

/**
 * Texture check of the first screen's larger visuals: hide one (its
 * background image, or the element) and compare the two screenshots inside its
 * box. When the 99th percentile ΔE00 stays ≤ TEXTURE_DELTA_E, the layer paints
 * nothing a visitor reads as a picture (grain, noise, a faint wash): the
 * visual is marked `texture` and scoreArchetypes() ignores it.
 * A visual whose BOX lies behind the h1 may still paint mostly the ground
 * (Saltwater & Smoke: a full-bleed SVG that draws the dark backdrop plus a
 * hearth in its lower right). For those the painted part is measured
 * (paintedRegion): paintedArea (share of the viewport) and paintedRelation
 * (behind/beside/below, from the painted pixels' box) replace the box in the
 * archetype scores, so the backdrop neither competes with the type nor hides
 * a picture that sits beside it.
 */
async function textureLayers(page, visuals, { groundHex = null, h1Rect = null } = {}) {
  const candidates = (visuals ?? []).filter(visual => visual.probe !== undefined && visual.area >= TEXTURE_MIN_AREA).slice(0, MAX_TEXTURE_CHECKS);
  if (!candidates.length) return { checked: 0, textures: 0 };
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  const shot = async () => decodeShot(await page.screenshot({ animations: 'disabled', caret: 'hide', timeout: 30000 }));
  const base = await shot();
  let textures = 0;
  let painted = 0;
  for (const visual of candidates) {
    if (!(await page.evaluate(toggleVisual, { probe: visual.probe, source: visual.source, on: true }))) continue;
    let image;
    try { image = await shot(); } finally { await page.evaluate(toggleVisual, { probe: visual.probe, source: visual.source, on: false }); }
    const delta = pixelDelta(base, image, visual.rect);
    visual.textureDeltaE = delta.p99;
    visual.changedShare = delta.changedShare;
    visual.texture = delta.p99 !== null && delta.p99 <= TEXTURE_DELTA_E;
    if (visual.texture) textures++;
    else if (visual.behind && groundHex) {
      const region = paintedRegion(base, image, visual.rect, groundHex);
      if (region.share !== null) {
        visual.paintedShare = region.share;
        visual.paintedArea = round(visual.area * region.share, 3);
        visual.paintedRect = region.rect;
        visual.paintedRelation = region.rect ? relationTo(region.rect, h1Rect) : { behind: false, beside: false, below: false };
        painted++;
      }
    }
  }
  return {
    checked: candidates.length, textures, painted, ground: groundHex,
    method: 'hide the layer, screenshot, p99 ΔE00 inside its box (every 3rd px) ≤ 10 = texture; a non-texture layer behind the h1: painted = pixels that change when it is hidden (ΔE00 > 2) and differ from the ground by ΔE00 > 10',
  };
}

/**
 * The platform fonts Chromium actually used for the glyphs of the display and
 * text probe elements (CDP CSS.getPlatformFontsForNode), most glyphs first.
 * A declared family that is neither a loaded web font nor installed falls back
 * silently; this is what the visitor on this machine sees.
 */
async function renderedFonts(page) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument', { depth: 0 });
    const out = {};
    for (const role of ['display', 'text']) {
      const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-mb-font-probe~="${role}"]` });
      if (!nodeId) { out[role] = null; continue; }
      const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
      out[role] = fonts.map(font => ({ family: font.familyName, postScriptName: font.postScriptName ?? null, custom: font.isCustomFont, glyphs: font.glyphCount })).sort((p, q) => q.glyphs - p.glyphs);
    }
    return out;
  } finally {
    await client.detach().catch(() => {});
  }
}

// Families that name no particular font (CSS generics and platform aliases):
// falling back from them is how they work, so it is never a missing font.
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial', 'unset']);

/**
 * Declared vs rendered families per role. The rendered family is the loaded
 * web font's CSS family when Chromium painted with a custom font, else the
 * platform font's name. D3 pairs the rendered families. A named first family
 * that did not render is a missing font: fontFace says whether the site has
 * an @font-face for it at all (null = none: it relied on an installed font).
 */
export function decideFonts(fonts, rendered) {
  const out = { display: null, text: null, declared: { display: fonts?.display ?? null, text: fonts?.text ?? null }, rendered: { display: null, text: null }, stacks: { display: fonts?.declared?.display?.stack ?? fonts?.displayStack ?? null, text: fonts?.declared?.text?.stack ?? null }, platform: { display: null, text: null }, missing: [], probes: fonts?.probes ?? null, textFaces: fonts?.textFaces ?? null };
  for (const role of ['display', 'text']) {
    const info = fonts?.declared?.[role] ?? null;
    const platform = rendered && !rendered.error ? rendered[role] ?? null : null;
    const top = platform?.[0] ?? null;
    const name = !top ? null : top.custom ? (info?.loadedFamily ?? top.family) : top.family;
    out.platform[role] = platform ? platform.slice(0, 3) : null;
    out.rendered[role] = name;
    out[role] = name ?? out.declared[role];
    const first = info?.family ?? out.declared[role];
    if (name && first && !GENERIC_FAMILIES.has(first.toLowerCase()) && name.toLowerCase() !== first.toLowerCase()) {
      out.missing.push({
        role, declared: first, rendered: name, fontFace: info?.fontFace ?? null,
        finding: info?.fontFace ? `${first} has an @font-face (${info.fontFace}) but ${name} painted the glyphs` : `${first} is declared with no @font-face and is not installed here: ${name} renders instead`,
      });
    }
  }
  out.method = rendered?.error ? `declared families only (rendered fonts unavailable: ${rendered.error})` : 'rendered = CDP CSS.getPlatformFontsForNode on the probe elements (font with most glyphs)';
  return out;
}

// --- pixel helpers ----------------------------------------------------------

const toHex = ({ r, g, b }) => `#${[r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const LINEAR = Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const luminanceOf = (r, g, b) => 0.2126 * LINEAR[Math.round(r)] + 0.7152 * LINEAR[Math.round(g)] + 0.0722 * LINEAR[Math.round(b)];
const labCache = new Map();
const pixelLab = (r, g, b) => {
  const key = (r << 16) | (g << 8) | b;
  let lab = labCache.get(key);
  if (!lab) { if (labCache.size > 250_000) labCache.clear(); lab = rgbToLab({ r, g, b }); labCache.set(key, lab); }
  return lab;
};

/** 99th percentile ΔE00 between two same-size screenshots inside rect (every `step` px) and the share of pixels changed by more than 2. */
function pixelDelta(a, b, rect, step = 3) {
  const values = [];
  const { left = 0, top = 0, right = a.width, bottom = a.height } = rect ?? {};
  for (let y = Math.max(0, top); y < Math.min(bottom, a.height, b.height); y += step) {
    for (let x = Math.max(0, left); x < Math.min(right, a.width, b.width); x += step) {
      const i = (y * a.width + x) * a.channels;
      const j = (y * b.width + x) * b.channels;
      if (a.data[i] === b.data[j] && a.data[i + 1] === b.data[j + 1] && a.data[i + 2] === b.data[j + 2]) { values.push(0); continue; }
      values.push(ciede2000(pixelLab(a.data[i], a.data[i + 1], a.data[i + 2]), pixelLab(b.data[j], b.data[j + 1], b.data[j + 2])));
    }
  }
  if (!values.length) return { p99: null, changedShare: null, pixels: 0 };
  values.sort((p, q) => p - q);
  return { p99: round(values[Math.floor(0.99 * (values.length - 1))], 2), changedShare: round(values.filter(value => value > 2).length / values.length, 3), pixels: values.length };
}

/**
 * Worst-case contrast of text colour fg (alpha composited) over one line box
 * of a text-free screenshot: the 10th and 90th luminance percentiles of the
 * pixels under the box stand for the darkest and lightest background the line
 * crosses. null when the box is (nearly) outside the image.
 */
export function lineContrast(image, line, fg) {
  const left = Math.max(0, Math.floor(line.left));
  const right = Math.min(image.width, Math.ceil(line.right));
  const top = Math.max(0, Math.floor(line.top));
  const bottom = Math.min(image.height, Math.ceil(line.bottom));
  if (right - left < 2 || bottom - top < 2) return null;
  const step = (right - left) * (bottom - top) > 60_000 ? 2 : 1;
  const pixels = [];
  const { data, width, channels } = image;
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const i = (y * width + x) * channels;
      pixels.push([luminanceOf(data[i], data[i + 1], data[i + 2]), data[i], data[i + 1], data[i + 2]]);
    }
  }
  pixels.sort((p, q) => p[0] - q[0]);
  const at = q => { const p = pixels[Math.round(q * (pixels.length - 1))]; return { r: p[1], g: p[2], b: p[3] }; };
  const range = [at(0.1), at(0.9)];
  let worst = null;
  for (const bg of range) {
    const alpha = Math.min(1, Math.max(0, fg.a ?? 1));
    const text = { r: fg.r * alpha + bg.r * (1 - alpha), g: fg.g * alpha + bg.g * (1 - alpha), b: fg.b * alpha + bg.b * (1 - alpha) };
    const [hi, lo] = [luminanceOf(text.r, text.g, text.b), luminanceOf(bg.r, bg.g, bg.b)].sort((p, q) => q - p);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (!worst || ratio < worst.ratio) worst = { ratio, fg: toHex(text), bg: toHex(bg) };
  }
  return { ...worst, range: range.map(toHex), pixels: pixels.length };
}

// --- W10: contrast from pixels ------------------------------------------------

const CONTRAST_MARGIN = 0.12; // share of the viewport kept clear at top and bottom (fixed bars)
const MAX_CONTRAST_SHOTS = 60;

/**
 * Settle evalContrast()'s pending (indeterminate) nodes from screenshots: hide
 * all text (hideText), scroll band by band, and for each node take the worst
 * of its line boxes' 10th/90th-percentile background against its declared
 * colour (lineContrast). Nodes are batched per scroll position; a node not
 * fully in view (or under a pinned layer) in its batch is retried centred in
 * the viewport; only then does it stay indeterminate, with the reason. Mutates
 * and returns the evalContrast() result.
 */
async function resolveContrastPixels(page, result) {
  if (!result || result.error) return result;
  const pending = result.pending ?? [];
  delete result.pending;
  if (!pending.length) return result;
  const verdicts = new Map();
  const unresolved = new Map();
  let shots = 0;
  try {
    await page.evaluate(hideText, true);
    const layout = await page.evaluate(contrastLayout);
    const margin = CONTRAST_MARGIN * layout.vh;
    const clampY = y => Math.max(0, Math.min(layout.maxScroll, Math.round(y)));
    for (const box of layout.boxes) if (box.missing) unresolved.set(box.i, 'no line box');
    const frameAt = async (y, ids) => {
      const frame = await page.evaluate(contrastFrame, { y, ids });
      const image = await decodeShot(await page.screenshot({ caret: 'hide', timeout: 30000 }));
      shots++;
      const missed = [];
      for (const item of frame.items) {
        const lines = item.lines.map(line => lineContrast(image, line, pending[item.i].fg)).filter(Boolean);
        if (!lines.length) { missed.push(item); continue; }
        verdicts.set(item.i, { ...lines.reduce((p, q) => (q.ratio < p.ratio ? q : p)), lines: lines.length });
      }
      return missed;
    };
    const queue = layout.boxes.filter(box => !box.missing).sort((p, q) => p.top - q.top);
    const retry = [];
    while (queue.length && shots < MAX_CONTRAST_SHOTS) {
      const y = clampY(queue[0].top - margin);
      const low = y === 0 ? 0 : y + margin;
      const high = y >= layout.maxScroll ? y + layout.vh : y + layout.vh - margin;
      let batch = queue.filter(box => box.top >= low - 1 && box.bottom <= high + 1);
      if (!batch.length) batch = [queue[0]];
      const ids = new Set(batch.map(box => box.i));
      for (let k = queue.length - 1; k >= 0; k--) if (ids.has(queue[k].i)) queue.splice(k, 1);
      for (const item of await frameAt(y, [...ids])) retry.push(item.i);
    }
    for (const box of queue) unresolved.set(box.i, `screenshot budget (${MAX_CONTRAST_SHOTS}) spent`);
    for (const i of retry) {
      const box = layout.boxes[i];
      if (shots >= MAX_CONTRAST_SHOTS) { unresolved.set(i, `screenshot budget (${MAX_CONTRAST_SHOTS}) spent`); continue; }
      for (const item of await frameAt(clampY((box.top + box.bottom) / 2 - layout.vh / 2), [i])) unresolved.set(item.i, item.covered ? 'under a fixed or sticky layer' : 'line box not in the screenshot');
    }
  } catch (error) {
    result.pixels = { error: String(error?.message ?? error).split('\n')[0].slice(0, 300) };
  } finally {
    await page.evaluate(hideText, false).catch(() => {});
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
  }
  let passed = 0;
  let failed = 0;
  const excludedNodes = [];
  for (const [i, verdict] of verdicts) {
    const meta = pending[i];
    const bucket = meta.excluded === 'aria-hidden' ? result.ariaHidden : meta.excluded === 'picture' ? result.picture : result;
    bucket.indeterminate = Math.max(0, bucket.indeterminate - 1);
    bucket.checked++;
    if (!meta.excluded && result.reasons[meta.reason]) { result.reasons[meta.reason]--; if (!result.reasons[meta.reason]) delete result.reasons[meta.reason]; }
    const entry = { text: meta.text, ratio: round(verdict.ratio), required: meta.required, fg: verdict.fg, bg: verdict.bg, bgRange: verdict.range, fontSize: meta.fontSize, weight: meta.weight, selector: meta.selector, method: 'pixels', over: meta.reason };
    const pass = verdict.ratio >= meta.required;
    if (pass) passed++; else { failed++; bucket.failing++; }
    if (meta.excluded) {
      // Reported, never counted: the five lowest ratios per bucket, so a reader sees what was excluded.
      excludedNodes.push({ ...entry, excluded: meta.excluded, pass });
    } else if (pass) {
      result.passing++;
      result.tightestPasses.push({ ...entry, margin: verdict.ratio / meta.required });
    } else if (result.failingNodes.length < 200) {
      result.failingNodes.push({ ...entry, declared: toHex(meta.fg) + (meta.fg.a < 1 ? ` @${round(meta.fg.a)}` : '') });
    }
  }
  result.excludedLowest = [...(result.excludedLowest ?? []), ...excludedNodes].sort((p, q) => p.ratio / p.required - q.ratio / q.required).slice(0, 5);
  result.tightestPasses = result.tightestPasses.sort((p, q) => p.margin - q.margin).slice(0, 5);
  result.indeterminateNodes = result.indeterminateNodes.filter(node => node.pending === undefined || !verdicts.has(node.pending))
    .map(node => (node.pending !== undefined && unresolved.has(node.pending) ? { ...node, pixels: unresolved.get(node.pending) } : node));
  const why = {};
  for (const reason of unresolved.values()) why[reason] = (why[reason] ?? 0) + 1;
  result.pixels = { ...(result.pixels ?? {}), method: 'glyphs hidden (text-fill transparent, no text-shadow), viewport screenshots; worst of the 10th/90th-percentile background under each line box against the declared colour', pending: pending.length, resolved: verdicts.size, passed, failed, unresolved: why, shots };
  return result;
}

// Two ground classes within this share of the page's colour samples are a
// near-tie, decided by the first screen (what a visitor sees first).
export const GROUND_TIE = 0.05;

/**
 * D2 ground by CLASS share: colour samples are summed per ground class, so a
 * dark page painted in several close shades of navy is still dark. The page's
 * largest class wins; when the top two are within GROUND_TIE, the class with
 * the larger share of the first screen's samples wins. The ground colour is
 * the most common colour of the winning class on the page.
 */
export function groundByClass(pageCounts, firstScreenCounts) {
  const tally = counts => {
    const classes = {};
    let total = 0;
    for (const [hex, n] of Object.entries(counts ?? {})) {
      const name = classifyGround(hex);
      if (!name) continue;
      const entry = classes[name] ??= { n: 0, colours: {} };
      entry.n += n;
      entry.colours[hex] = n;
      total += n;
    }
    return { classes, total, ranked: Object.entries(classes).sort((p, q) => q[1].n - p[1].n) };
  };
  const page = tally(pageCounts);
  const first = tally(firstScreenCounts);
  if (!page.ranked.length) return null;
  const share = (part, whole) => round(part / Math.max(1, whole), 3);
  let chosen = page.ranked[0][0];
  let how = 'largest ground class on the page';
  if (page.ranked.length > 1 && share(page.ranked[0][1].n, page.total) - share(page.ranked[1][1].n, page.total) < GROUND_TIE) {
    const tied = [page.ranked[0][0], page.ranked[1][0]];
    const pick = first.ranked.find(([name]) => tied.includes(name));
    if (pick) {
      chosen = pick[0];
      how = `near-tie on the page (${tied.map(name => `${name} ${share(page.classes[name].n, page.total)}`).join(' vs ')}), decided by the first screen (${chosen} ${share(pick[1].n, first.total)})`;
    }
  }
  const colour = topKey(page.classes[chosen].colours);
  return {
    class: chosen, hex: colour[0], how, classShare: share(page.classes[chosen].n, page.total), colourShareOfClass: share(colour[1], page.classes[chosen].n),
    classShares: Object.fromEntries(page.ranked.map(([name, entry]) => [name, share(entry.n, page.total)])),
    firstScreenClassShares: Object.fromEntries(first.ranked.map(([name, entry]) => [name, share(entry.n, first.total)])),
  };
}

// Accent candidates darker than this L*, or within ACCENT_INK_DELTA_E of the
// ink, read as ink (a navy or near-black button), not as the accent.
export const ACCENT_MIN_L = 20;
export const ACCENT_INK_DELTA_E = 10;

/**
 * Accent: the most-used saturated colour (HSL s ≥ 25% and C* ≥ 15) on
 * interactive elements, else on any text. Colours with L* < ACCENT_MIN_L or
 * within ΔE00 ACCENT_INK_DELTA_E of the ink are passed over; only when nothing
 * else is saturated does the accent fall back to them (accentSource says so).
 */
export function decideAccent(accent, textColours, inkHex) {
  // Saturated = HSL saturation ≥ 25% (QUALITY_BAR) and Lab chroma ≥ 15, because HSL
  // saturation explodes near white and black (#f1eadf is "39% saturated").
  const saturated = ([hex]) => { const c = describeColour(hex); return c && c.hsl.s >= 0.25 && c.chroma >= 15; };
  const inkLab = inkHex ? hexToLab(inkHex) : null;
  const excluded = [];
  const distinct = ([hex, weight]) => {
    const lab = hexToLab(hex);
    if (lab.L < ACCENT_MIN_L) { excluded.push({ hex, weight, why: `L* ${round(lab.L, 1)} < ${ACCENT_MIN_L}` }); return false; }
    const fromInk = inkLab ? ciede2000(lab, inkLab) : Infinity;
    if (fromInk <= ACCENT_INK_DELTA_E) { excluded.push({ hex, weight, why: `ΔE00 ${round(fromInk, 1)} from the ink ${inkHex}` }); return false; }
    return true;
  };
  const interactive = Object.entries(accent ?? {}).filter(saturated).sort((p, q) => q[1] - p[1]);
  const text = Object.entries(textColours ?? {}).filter(saturated).sort((p, q) => q[1] - p[1]);
  const options = [
    [interactive.filter(distinct), 'interactive'],
    [text.filter(distinct), 'text'],
    [interactive, 'interactive (fallback: only dark or ink-like saturated colours)'],
    [text, 'text (fallback: only dark or ink-like saturated colours)'],
  ];
  const [candidates, source] = options.find(([list]) => list.length) ?? [[], null];
  return { accent: candidates[0]?.[0] ?? null, source, candidates: candidates.slice(0, 5).map(([hex, weight]) => ({ hex, weight })), excluded: [...new Map(excluded.map(entry => [entry.hex, entry])).values()].slice(0, 5) };
}

/**
 * Ground, ink, accent, fonts and archetype from measureIdentity() output.
 * The sampled ground is decided by class share (groundByClass). groundCheck
 * compares it with the painted pixels. As a last resort (sampling still
 * blind: ≥ 50% media on the first screen or the page, or no colour sample at
 * all) the dominant painted colour of the page replaces the sampled ground
 * when they differ by more than TEXTURE_DELTA_E and that colour covers ≥ 30%
 * of the page's pixels; groundSource says which was used.
 */
function decideIdentity(raw) {
  const ground = groundByClass(raw.samples.page.counts, raw.samples.firstScreen.counts);
  const firstGround = topKey(raw.samples.firstScreen.counts);
  const ink = topKey(raw.ink);
  const accent = decideAccent(raw.accent, raw.textColours, ink?.[0] ?? null);
  const sampledGround = ground?.hex ?? firstGround?.[0] ?? null;
  const firstScreenMediaShare = round(raw.samples.firstScreen.media / Math.max(1, raw.samples.firstScreen.total));
  const pageMediaShare = round(raw.samples.page.media / Math.max(1, raw.samples.page.total));
  const painted = raw.pixels?.page ?? null;
  const pageDelta = deltaE(sampledGround, painted?.hex);
  const blind = !sampledGround || firstScreenMediaShare >= 0.5 || pageMediaShare >= 0.5;
  const fromPixels = !!painted && painted.share >= 0.3 && blind && (!sampledGround || pageDelta > TEXTURE_DELTA_E);
  const groundHex = fromPixels ? painted.hex : sampledGround;
  const archetype = scoreArchetypes(raw.firstScreen, raw.samples.firstScreen);
  const fonts = decideFonts(raw.fonts, raw.renderedFonts);
  return {
    ground: groundHex,
    groundSource: fromPixels ? 'pixels' : 'samples',
    groundShare: fromPixels ? painted.share : ground ? round((raw.samples.page.counts[ground.hex] ?? 0) / Math.max(1, raw.samples.page.total)) : null,
    groundClassDecision: fromPixels ? { class: classifyGround(groundHex), how: 'dominant painted colour of the page (sampling blind)' } : ground,
    firstScreenGround: firstGround?.[0] ?? null,
    firstScreenGroundShare: firstGround ? round(firstGround[1] / Math.max(1, raw.samples.firstScreen.total)) : null,
    firstScreenMediaShare,
    pageMediaShare,
    groundCheck: {
      sampled: sampledGround, pixelsFirstScreen: raw.pixels?.firstScreen ?? null, pixelsPage: painted,
      deltaEFirstScreen: deltaE(firstGround?.[0], raw.pixels?.firstScreen?.hex), deltaEPage: pageDelta,
      agrees: pageDelta === null ? null : pageDelta <= TEXTURE_DELTA_E,
      layeredSamples: raw.texture?.byKind ?? {}, layeredExamples: raw.texture?.examples ?? [],
      bands: raw.samples.bands ?? null, ...(raw.pixels?.error ? { pixelError: raw.pixels.error } : {}),
    },
    groundClass: groundHex ? classifyGround(groundHex) : null,
    ink: ink?.[0] ?? null,
    accent: accent.accent,
    accentSource: accent.source,
    accentCandidates: accent.candidates,
    accentExcluded: accent.excluded,
    colours: Object.fromEntries([['ground', groundHex], ['ink', ink?.[0]], ['accent', accent.accent]].map(([role, hex]) => [role, hex ? describeColour(hex) : null])),
    fonts,
    textureCheck: raw.textureCheck ?? null,
    archetype: archetype.archetype,
    archetypeScores: archetype.scores,
    archetypeNotes: archetype.notes,
    firstScreen: raw.firstScreen,
  };
}

// --- merging both motion modes --------------------------------------------

const IMPACTS = ['critical', 'serious', 'moderate', 'minor'];

function mergeAxe(byWidth) {
  const counts = Object.fromEntries(IMPACTS.map(impact => [impact, 0]));
  const rules = new Map();
  const seenNodes = new Set();
  const perWidth = {};
  for (const [width, modes] of Object.entries(byWidth)) {
    perWidth[width] = {};
    for (const [mode, result] of Object.entries(modes)) {
      if (result.error) { perWidth[width][mode] = result; continue; }
      const tally = Object.fromEntries(IMPACTS.map(impact => [impact, 0]));
      for (const violation of result.violations) {
        tally[violation.impact] = (tally[violation.impact] ?? 0) + violation.nodes.length;
        const rule = rules.get(violation.id) ?? { id: violation.id, impact: violation.impact, help: violation.help, nodes: 0, targets: [], widths: [], modes: [] };
        rule.nodes = Math.max(rule.nodes, violation.nodes.length);
        for (const node of violation.nodes) {
          const target = node.target.join(' ');
          const key = `${violation.id}|${target}`;
          if (!seenNodes.has(key)) { seenNodes.add(key); counts[violation.impact] = (counts[violation.impact] ?? 0) + 1; }
          if (rule.targets.length < 3 && !rule.targets.includes(target)) rule.targets.push(target);
        }
        if (!rule.widths.includes(Number(width))) rule.widths.push(Number(width));
        if (!rule.modes.includes(mode)) rule.modes.push(mode);
        rules.set(violation.id, rule);
      }
      perWidth[width][mode] = tally;
    }
  }
  return { counts, violations: [...rules.values()].sort((p, q) => IMPACTS.indexOf(p.impact) - IMPACTS.indexOf(q.impact)), byWidth: perWidth };
}

function mergeContrast(byWidth) {
  const failing = new Map();
  const indeterminate = new Map();
  const perWidth = {};
  const tightest = [];
  const excluded = [];
  const excludedCounts = { ariaHidden: { checked: 0, failing: 0, indeterminate: 0 }, picture: { checked: 0, failing: 0, indeterminate: 0 } };
  let checked = 0;
  for (const [width, modes] of Object.entries(byWidth)) {
    perWidth[width] = {};
    for (const [mode, result] of Object.entries(modes)) {
      if (result.error) { perWidth[width][mode] = result; continue; }
      const { failingNodes, indeterminateNodes, tightestPasses, excludedLowest = [], ...counts } = result;
      perWidth[width][mode] = counts;
      checked = Math.max(checked, result.checked);
      for (const node of tightestPasses) tightest.push({ ...node, width: Number(width), mode });
      for (const node of excludedLowest) excluded.push({ ...node, width: Number(width), mode });
      for (const kind of ['ariaHidden', 'picture']) for (const key of ['checked', 'failing', 'indeterminate']) excludedCounts[kind][key] = Math.max(excludedCounts[kind][key], result[kind]?.[key] ?? 0);
      for (const node of failingNodes) {
        const key = `${node.selector}|${node.text}`;
        const entry = failing.get(key) ?? { ...node, widths: [], modes: [] };
        entry.ratio = Math.min(entry.ratio, node.ratio);
        if (!entry.widths.includes(Number(width))) entry.widths.push(Number(width));
        if (!entry.modes.includes(mode)) entry.modes.push(mode);
        failing.set(key, entry);
      }
      for (const node of indeterminateNodes) {
        const key = `${node.selector}|${node.text}`;
        if (!indeterminate.has(key)) indeterminate.set(key, { ...node, width: Number(width), mode });
      }
    }
  }
  const failingNodes = [...failing.values()].sort((p, q) => p.ratio - q.ratio);
  const maxIndeterminate = Math.max(0, ...Object.values(perWidth).flatMap(modes => Object.values(modes).map(m => m.indeterminate ?? 0)));
  const tightestPasses = [...new Map(tightest.sort((p, q) => p.margin - q.margin).map(node => [`${node.selector}|${node.text}`, node])).values()].slice(0, 5)
    .map(node => ({ text: node.text, ratio: node.ratio, required: node.required, fg: node.fg, bg: node.bg, ...(node.bgRange ? { bgRange: node.bgRange } : {}), fontSize: node.fontSize, weight: node.weight, selector: node.selector, width: node.width, mode: node.mode, method: node.method ?? 'dom' }));
  // Pixel pass totals over every width × mode (resolveContrastPixels).
  const pixels = { pending: 0, resolved: 0, passed: 0, failed: 0, unresolved: {}, shots: 0, errors: [] };
  for (const modes of Object.values(perWidth)) {
    for (const counts of Object.values(modes)) {
      const p = counts.pixels;
      if (!p) continue;
      if (p.error) pixels.errors.push(p.error);
      for (const key of ['pending', 'resolved', 'passed', 'failed', 'shots']) pixels[key] += p[key] ?? 0;
      for (const [reason, n] of Object.entries(p.unresolved ?? {})) pixels.unresolved[reason] = (pixels.unresolved[reason] ?? 0) + n;
    }
  }
  // Excluded text (aria-hidden decoration, text inside role="img" pictures): counted per width × mode
  // (max shown), never in W10; the lowest ratios are listed so nothing hides.
  const excludedLowest = [...new Map(excluded.sort((p, q) => p.ratio / p.required - q.ratio / q.required).map(node => [`${node.selector}|${node.text}`, node])).values()].slice(0, 5);
  return { failing: failingNodes.length, indeterminate: maxIndeterminate, checked, failingNodes, indeterminateNodes: [...indeterminate.values()].slice(0, 40), tightestPasses, pixels, excluded: { ...excludedCounts, lowest: excludedLowest }, byWidth: perWidth };
}

/**
 * W9 per width and mode. Two numbers: script-reachable (scrollWidth −
 * clientWidth, what scrollTo() can reach) and user-reachable (what a visitor
 * can pan or scroll to). They differ only when the root clips overflow-x: a
 * mouse or keyboard cannot scroll a hidden root, but on a touch phone the
 * layout viewport may still widen to the content (measured at TOUCH_WIDTHS
 * with isMobile + hasTouch: innerWidth − clientWidth). W9 passes on the
 * user-reachable number and the unclipped offenders.
 */
function mergeOverflow(byWidth, touch = {}) {
  const perWidth = {};
  const offenders = new Map();
  let maxPx = 0;
  let scriptMaxPx = 0;
  for (const [width, modes] of Object.entries(byWidth)) {
    const failedModes = [];
    let worstPx = 0;
    let worstScriptPx = 0;
    const entries = {};
    for (const [mode, result] of Object.entries(modes)) {
      if (result.error) { entries[mode] = result; continue; }
      const touched = touch[width]?.[mode];
      const user = !result.rootClips ? { px: result.overflowPx, how: 'document scroll' }
        : touched && !touched.error ? { px: touched.userPx, how: `touch emulation (isMobile, hasTouch): layout viewport ${touched.layoutViewport} − client width ${touched.clientWidth}` }
          : touched?.error ? { px: result.overflowPx, how: `touch check failed (${touched.error}); script-reachable used` }
            : { px: 0, how: `root clips overflow-x (${result.rootOverflowX.html}/${result.rootOverflowX.body}); a mouse or keyboard cannot scroll it at this width` };
      entries[mode] = { ...result, scriptPx: result.overflowPx, userPx: user.px, userHow: user.how, ...(touched ? { touch: touched } : {}) };
      worstPx = Math.max(worstPx, user.px);
      worstScriptPx = Math.max(worstScriptPx, result.overflowPx);
      if (user.px > 0 || result.offenderCount > 0) failedModes.push(mode);
      for (const offender of result.offenders) {
        const entry = offenders.get(offender.selector) ?? { ...offender, widths: [], modes: [] };
        if (!entry.widths.includes(Number(width))) entry.widths.push(Number(width));
        if (!entry.modes.includes(mode)) entry.modes.push(mode);
        offenders.set(offender.selector, entry);
      }
    }
    maxPx = Math.max(maxPx, worstPx);
    scriptMaxPx = Math.max(scriptMaxPx, worstScriptPx);
    perWidth[width] = { ...entries, worstPx, worstScriptPx, failedModes };
  }
  return { maxPx, userMaxPx: maxPx, scriptMaxPx, offenderCount: offenders.size, offenders: [...offenders.values()].slice(0, 10), byWidth: perWidth };
}

/* W9 touch check: the layout viewport against the client width. */
function evalTouchViewport() {
  const doc = document.documentElement;
  const vv = window.visualViewport;
  return { layoutViewport: innerWidth, clientWidth: doc.clientWidth, scrollWidth: doc.scrollWidth, visualViewport: vv ? { width: Math.round(vv.width * 10) / 10, scale: Math.round(vv.scale * 1000) / 1000 } : null, userPx: Math.max(0, Math.round(innerWidth - doc.clientWidth)) };
}

/**
 * W7 from every load: per width × mode the CLS of each load, its median and
 * maximum and the share of loads ≥ the threshold; site-wide the same over all
 * loads. W7 fails when any load reaches the threshold (a shift visitors see in
 * a share of loads is real), so clsMax decides.
 */
function summariseVitals(rawVitals, threshold = WEBSITE.W7.max) {
  const byWidth = {};
  const all = [];
  for (const [width, modes] of Object.entries(rawVitals)) {
    byWidth[width] = {};
    for (const [mode, loads] of Object.entries(modes)) {
      const ok = loads.filter(load => !load.error && Number.isFinite(load.cls));
      const values = ok.map(load => load.cls);
      all.push(...values);
      if (!ok.length) { byWidth[width][mode] = { error: loads.find(load => load.error)?.error ?? 'no CLS reading', loads: loads.length }; continue; }
      const lcp = ok.map(load => load.lcpMs).filter(Number.isFinite);
      byWidth[width][mode] = {
        loads: loads.length, cls: Math.max(...values), clsMedian: round(median(values), 4), clsLoads: values,
        shareAtOrAbove: round(values.filter(value => value >= threshold).length / values.length, 3),
        lcpMs: lcp.length ? Math.round(median(lcp)) : null, lcpLoads: lcp,
        source: ok[0].source, ...(loads.length > ok.length ? { failedLoads: loads.filter(load => load.error || !Number.isFinite(load.cls)).map(load => load.error ?? 'no CLS reading') } : {}),
      };
    }
  }
  const lcpValues = Object.values(byWidth).flatMap(modes => Object.values(modes).flatMap(entry => entry.lcpLoads ?? [])).filter(Number.isFinite);
  return {
    byWidth, threshold, loadsPerWidthMode: VITALS_LOADS,
    clsMax: all.length ? Math.max(...all) : null,
    clsMedian: all.length ? round(median(all), 4) : null,
    loads: all.length,
    loadsAtOrAbove: all.filter(value => value >= threshold).length,
    shareAtOrAbove: all.length ? round(all.filter(value => value >= threshold).length / all.length, 3) : null,
    lcpMaxMs: lcpValues.length ? Math.max(...lcpValues) : null,
  };
}

/** One extra W7 load: open, scroll top → bottom → top, settle, read CLS/LCP. */
async function vitalsLoad(session) {
  const { context, page } = await openSession(session);
  try {
    await attempt(() => page.evaluate(scrollThrough));
    await page.waitForTimeout(SETTLE_MS);
    return await readVitals(page);
  } finally {
    await context.close().catch(() => {});
  }
}

/** W9 touch check of one width × mode (isMobile + hasTouch), after the same full scroll as the main load. */
async function touchOverflow(session) {
  const { context, page } = await openSession({ ...session, contextOptions: { ...session.contextOptions, isMobile: true, hasTouch: true } });
  try {
    await attempt(() => page.evaluate(scrollThrough));
    await page.waitForTimeout(SETTLE_MS);
    return await page.evaluate(evalTouchViewport);
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Measure one served page.
 * @param {object} options
 * @param {import('playwright').Browser} [options.browser] used when no newContext factory is given
 * @param {string} options.url page URL (local server, or the captured URL replayed from a HAR)
 * @param {number[]} [options.widths] default WIDTHS (360, 390, 820, 1440)
 * @param {string|object} [options.brief] brief text or object; contact details found in it are honest (W17)
 * @param {string} [options.shotsDir] screenshots: <w>-first.png, <w>-full.png, unstyled-1440-first.png
 * @param {string} [options.axeDir] raw axe results: axe-<w>.json
 * @param {object} [options.contextOptions] extra BrowserContext options (viewport and reducedMotion are set here)
 * @param {(context, info: {width, mode}) => Promise<void>} [options.onContext] e.g. context.routeFromHAR(har)
 * @param {(options, info: {width, mode}) => Promise<import('playwright').BrowserContext>} [options.newContext] full control over context creation
 * @param {(pathname: string) => Promise<number>} [options.requestStatus] HTTP status for internal routes (default: fetch from the page)
 * @param {number} [options.vitalsLoads] W7 loads per width × mode at 390 and 1440 (default VITALS_LOADS = 3)
 * @returns {Promise<{url, widths, desktopWidth, durationMs, axe, vitals, overflow, contrast, links, images, tells, firstScreen, honesty, identity, runtimeErrors, shots}>}
 */
export async function measurePage({ browser, url, widths = WIDTHS, brief, shotsDir, axeDir, contextOptions = {}, onContext, newContext, requestStatus, vitalsLoads = VITALS_LOADS } = {}) {
  if (!browser && !newContext) throw new Error('measurePage needs a browser or a newContext factory');
  const started = Date.now();
  const desktopWidth = widths.includes(1440) ? 1440 : Math.max(...widths);
  const serifs = serifFamilies();
  const runtime = [];
  const raw = { axe: {}, contrast: {}, overflow: {}, touch: {}, vitals: {}, firstScreen: {}, tellsByMode: {} };
  const once = { shots: [] };
  const vitalsOf = (width, mode) => ((raw.vitals[width] ??= {})[mode] ??= []);

  for (const width of widths) {
    for (const key of ['axe', 'contrast', 'overflow']) raw[key][width] = {};
    for (const mode of MODES) {
      let session;
      try {
        session = await openSession({ browser, url, width, mode, contextOptions, onContext, newContext, runtime });
      } catch (error) {
        const failure = { error: `load failed: ${error.message.split('\n')[0]}` };
        for (const key of ['axe', 'contrast', 'overflow']) raw[key][width][mode] = failure;
        if (VITALS_WIDTHS.includes(width)) vitalsOf(width, mode).push(failure);
        continue;
      }
      const { context, page } = session;
      try {
        const reduced = mode === 'reduce';
        // First screen is what a visitor sees on arrival, before any scrolling.
        if (reduced && FIRST_SCREEN_WIDTHS.includes(width)) raw.firstScreen[width] = await attempt(() => page.evaluate(evalFirstScreen));
        await attempt(() => page.evaluate(scrollThrough));
        await page.waitForTimeout(SETTLE_MS);
        if (VITALS_WIDTHS.includes(width)) vitalsOf(width, mode).push(await attempt(() => readVitals(page)));
        raw.axe[width][mode] = await attempt(() => runAxe(page));
        raw.contrast[width][mode] = await attempt(async () => resolveContrastPixels(page, await page.evaluate(evalContrast)));
        raw.overflow[width][mode] = await attempt(() => page.evaluate(evalOverflow));
        if (width === desktopWidth) {
          if (reduced) once.identity = await attempt(async () => decideIdentity(await measureIdentity(page)));
          raw.tellsByMode[mode] = await attempt(() => page.evaluate(evalTells, { serifs }));
        }
        if (reduced && width === desktopWidth) {
          once.images = await attempt(() => page.evaluate(evalImages));
          once.honesty = await attempt(async () => honestyFindings(await page.evaluate(evalHonestyText), brief));
        }
        if (reduced && shotsDir) {
          for (const [suffix, fullPage] of [['first', false], ['full', true]]) {
            const shot = await attempt(() => shoot(page, path.join(shotsDir, `${width}-${suffix}.png`), fullPage));
            once.shots.push(typeof shot === 'string' ? { width, kind: suffix, file: shot } : { width, kind: suffix, ...shot });
          }
        }
        if (reduced && width === desktopWidth) {
          // Links last: verifying fragments clicks and reloads the page.
          once.links = await attempt(() => checkLinks(page, url, { requestStatus }));
          if (shotsDir) {
            const shot = await attempt(async () => {
              await page.goto(url, { waitUntil: 'load' });
              await settle(page);
              await page.evaluate(unstyle);
              return shoot(page, path.join(shotsDir, `unstyled-${desktopWidth}-first.png`), false);
            });
            once.shots.push(typeof shot === 'string' ? { width, kind: 'unstyled', file: shot } : { width, kind: 'unstyled', ...shot });
          }
        }
      } finally {
        await context.close().catch(() => {});
      }
    }
    const sessionFor = mode => ({ browser, url, width, mode, contextOptions, onContext, newContext, runtime });
    // W7: further loads, so an intermittent shift is seen in the share of loads it happens in.
    if (VITALS_WIDTHS.includes(width)) {
      for (const mode of MODES) for (let load = 1; load < vitalsLoads; load++) vitalsOf(width, mode).push(await attempt(() => vitalsLoad(sessionFor(mode))));
    }
    // W9: a clipped root on a phone width is re-measured as a touch visitor gets it.
    if (TOUCH_WIDTHS.includes(width) && Object.values(raw.overflow[width]).some(result => result?.rootClips)) {
      raw.touch[width] = {};
      for (const mode of MODES) raw.touch[width][mode] = await attempt(() => touchOverflow(sessionFor(mode)));
    }
    if (axeDir) {
      const modes = raw.axe[width];
      await attempt(async () => writeJson(path.join(axeDir, `axe-${width}.json`), { url, width, tags: AXE_TAGS, testEngine: Object.values(modes).find(m => m.testEngine)?.testEngine ?? null, modes }));
    }
  }

  const vitals = summariseVitals(raw.vitals);

  const firstScreen = { byWidth: raw.firstScreen };
  const screens = Object.values(raw.firstScreen);
  firstScreen.ok = screens.length > 0 && screens.every(s => !s.error && s.h1.visible && s.valueLine.visible && s.primaryAction.visible);

  const runtimeErrors = (() => {
    const unique = new Map();
    for (const entry of runtime) {
      const key = `${entry.kind}|${entry.message}`;
      const found = unique.get(key) ?? { ...entry, occurrences: 0, widths: [], modes: [] };
      found.occurrences++;
      if (!found.widths.includes(entry.width)) found.widths.push(entry.width);
      if (!found.modes.includes(entry.mode)) found.modes.push(entry.mode);
      unique.set(key, found);
    }
    const errors = [...unique.values()].map(entry => ({ kind: entry.kind, message: entry.message, url: entry.url ?? null, occurrences: entry.occurrences, widths: entry.widths, modes: entry.modes }));
    return { count: errors.length, pageErrors: errors.filter(e => e.kind === 'pageerror').length, errors };
  })();

  const identity = once.identity ?? { error: 'desktop width not measured' };
  const requests = briefStyleRequests(brief);
  const tellsByMode = Object.fromEntries(Object.entries(raw.tellsByMode).map(([mode, result]) => [mode, result.error ? result : decideTells(result, identity.ground ?? null, requests)]));

  return {
    url,
    widths: [...widths],
    desktopWidth,
    durationMs: Date.now() - started,
    axe: mergeAxe(raw.axe),
    vitals,
    overflow: mergeOverflow(raw.overflow, raw.touch),
    contrast: mergeContrast(raw.contrast),
    links: once.links ?? { error: 'desktop width not measured' },
    images: once.images ?? { error: 'desktop width not measured' },
    tells: Object.keys(tellsByMode).length ? { ...mergeTells(tellsByMode), briefRequests: requests } : { error: 'desktop width not measured' },
    firstScreen,
    honesty: once.honesty ?? { error: 'desktop width not measured' },
    identity,
    runtimeErrors,
    shots: once.shots,
  };
}

// ---------------------------------------------------------------------------
// Self-test: node scripts/eval/lib/instruments/web.mjs --selftest

const SELFTEST_SITES = {
  restaurant: 'Build a complete premium restaurant website for Saffron Table, a contemporary neighborhood restaurant in Bristol. Warm editorial art direction, exceptional typography, original CSS/SVG food-inspired art (image API is unavailable), seasonal menu with prices, opening hours, location, accessible mobile navigation and reservation enquiry form with real validation. Do not pretend a reservation has been sent without a backend. Make all navigation and buttons useful. No template or fake awards.',
  saas: 'Build a complete polished B2B SaaS website for Relay Operations: a shared handoff and issue tracker for small logistics teams. Distinctive precise industrial design, interactive product demonstration built from real HTML and CSS, clear features, transparent fictional sample pricing, FAQ and accessible mobile menu. Demo request form must validate and honestly state when it is only a demo. No fake customer logos, unsupported claims, or stock gradients everywhere. Use original SVG illustrations; image API unavailable.',
  portfolio: 'Build a complete editorial portfolio and enquiry website for Mira Objects, an independent ceramic artist. Warm ivory and charcoal, oversized serif typography, asymmetric but readable layout, original SVG illustrations of ceramic objects with distinct silhouettes, collection filtering, work detail interaction and commission enquiry form with accessible validation. All links useful, outstanding mobile layout. No fake form delivery, no image API available. Make it visually distinct from typical SaaS sites.',
};

/** Pure checks: W17 phone tokenisation and the brief-request keywords of W15. */
function unitChecks() {
  const phones = (text, brief = '') => honestyFindings({ text }, brief).phones.map(phone => phone.text);
  assert.deepEqual(phones('Step\n01\n02\n03\n04\n05\n06'), [], 'step counters on separate lines are not a phone');
  assert.deepEqual(phones('Paid\n400.00\n12\n615.40\n05'), [], 'an amount column is not a phone');
  assert.deepEqual(phones('June\n6\n7\n8\n9\n10\n11\n12\n13\n14'), [], 'calendar days are not a phone');
  assert.deepEqual(phones('Mon\t0900\t1700\t1800'), [], 'table cells are not a phone');
  assert.deepEqual(phones('Call 0113 496 0000 today'), ['0113 496 0000']);
  assert.deepEqual(phones('Call +44 (0)113 496 0000\nor write'), ['+44 (0)113 496 0000']);
  const nbsp = String.fromCharCode(0xa0);
  assert.deepEqual(phones(`Call 0113${nbsp}496${nbsp}0000`), [`0113${nbsp}496${nbsp}0000`], 'no-break spaces join a phone');
  assert.deepEqual(phones('Call 0113 496 0000', 'Our number is 0113 496 0000.'), [], 'a number from the brief is honest');
  const groups = brief => { const found = briefStyleRequests(brief); return [found.warmGround.length > 0, found.serifOrEditorial.length > 0, found.marqueeOrWordmark.length > 0]; };
  assert.deepEqual(groups('It should feel warm and confident, with exceptional typography.'), [false, false, false], '"warm" as a mood is not a ground');
  assert.deepEqual(groups('Three products: a cream blush, a lip oil and a brow gel.'), [false, false, false], '"cream" as a product is not a ground');
  assert.deepEqual(groups('Body set in a clean sans-serif, cool greys.'), [false, false, false], 'sans-serif is not serif');
  assert.deepEqual(groups('Editorial look, warm skin-tone palette, subtle animation.'), [true, true, false]);
  assert.deepEqual(groups('Warm ivory and charcoal, oversized serif typography.'), [true, true, false]);
  assert.deepEqual(groups('Charcoal and cream, with a marquee of dates.'), [true, false, true]);
  assert.equal(briefStyleRequests('').provided, false);
  const raw = { equalCardRows: [], centredHero: {}, h1Family: 'Georgia', serifH1: true, italicAccents: [{ text: 'by hand' }], pills: [{ text: 'Book' }], pillCount: 1, platformPills: [], platformPillCount: 0, marquees: [{ selector: 'div' }], wordmarks: [{ text: 'Brina' }], text: '', headings: [], controls: [] };
  const merged = mergeTells({ reduce: decideTells(raw, '#f6efe3', briefStyleRequests('A marquee of the month\'s dates.')) });
  assert.deepEqual(merged.present, ['creamSerifItalicPill', 'marqueeAndWordmark']);
  assert.deepEqual([merged.requested, merged.unrequested], [['marqueeAndWordmark'], ['creamSerifItalicPill']], 'a marquee request covers only the marquee tell');
  assert.equal(mergeTells({ reduce: decideTells(raw, '#f6efe3', briefStyleRequests('')) }).creamSerifItalicPill.requestedByBrief, null, 'no brief: unknown');
  const editorial = mergeTells({ reduce: decideTells(raw, '#f6efe3', briefStyleRequests('Warm editorial art direction, exceptional typography.')) });
  assert.deepEqual([editorial.creamSerifItalicPill.requestedByBrief, editorial.marqueeAndWordmark.requestedByBrief], [true, false], '"editorial" requests the serif look, never the marquee/wordmark devices');

  // W17: tel: targets in E.164 form are the brief's national number; repeats are one finding.
  const honest = (text, hrefs, brief) => honestyFindings({ text, hrefs }, brief);
  assert.equal(samePhone('17085341077', '7085341077'), true);
  assert.equal(samePhone('441134960000', '01134960000'), true, 'country code and trunk 0');
  assert.equal(samePhone('17085341077', '2193658696'), false);
  assert.equal(samePhone('123456', '9123456'), false, 'fewer than 7 digits never match by suffix');
  assert.deepEqual(honest('Call (708) 534-1077', ['tel:+17085341077', 'tel:+12193658696'], 'Main office (708) 534-1077, Crete office 219-365-8696.').phones, [], 'E.164 tel: targets of brief numbers are honest');
  assert.deepEqual(honest('', ['tel:+17085341077'], 'Phone: 708.534.1077').phones, []);
  const invented = honest('Call (708) 534-1077 or (708) 534-1077', ['tel:+17085341077'], 'No contact details given.');
  assert.deepEqual(invented.phones.map(phone => [phone.digits, phone.occurrences]), [['7085341077', 3]], 'one invented number found three times is one finding');
  assert.equal(honest('Call 0113 496 0000', [], '').briefProvided, false);

  // W15 (c) cream and D2 classes (B, C): near-white and grey grounds are neither cream nor warm.
  for (const [hex, cream, ground] of [['#f8f7f4', false, 'cool-light'], ['#e9dfce', true, 'warm-light'], ['#f2e8d8', true, 'warm-light'], ['#eff0ea', false, 'cool-light'], ['#e8e7e2', false, 'cool-light'], ['#f6efe3', true, 'warm-light'], ['#f5f7fa', false, 'cool-light'], ['#162026', false, 'dark']]) {
    assert.equal(isCreamGround(hex), cream, `${hex} cream`);
    assert.equal(classifyGround(hex), ground, `${hex} class`);
  }
  // D2 ground by class share: navy shades add up; a near-tie goes to the first screen.
  const saltwater = groundByClass({ '#162026': 20, '#1b2830': 15, '#0f171c': 13, '#e9dfce': 30, '#f2e8d8': 17, '#8a8f93': 5 }, { '#162026': 92, '#e9dfce': 8 });
  assert.deepEqual([saltwater.class, saltwater.hex], ['dark', '#162026'], 'split dark shades vs one light colour, near-tie decided by a dark first screen');
  assert.equal(groundByClass({ '#162026': 30, '#f2e8d8': 70 }, { '#162026': 100 }).class, 'warm-light', 'a clear page majority is not overruled by the first screen');
  assert.equal(groundByClass({ '#162026': 25, '#1b2830': 25, '#f2e8d8': 30, '#e9dfce': 20 }, { '#e9dfce': 100 }).class, 'warm-light', 'tie decided by a light first screen');

  // Accent (E): a navy or ink-like button colour is passed over for the visible accent.
  assert.equal(decideAccent({ '#0e1a2f': 42, '#1d4ed8': 3 }, {}, '#47536a').accent, '#1d4ed8', 'L* < 20 is ink, not accent');
  assert.equal(decideAccent({ '#6b4434': 137, '#a3432d': 69 }, {}, '#6a5145').accent, '#a3432d', 'within ΔE00 10 of the ink');
  const onlyNavy = decideAccent({ '#0e1a2f': 42 }, {}, '#47536a');
  assert.deepEqual([onlyNavy.accent, /fallback/.test(onlyNavy.source)], ['#0e1a2f', true], 'falls back when nothing else is saturated');

  // Fonts (F): rendered family wins; a declared family with no @font-face that did not render is missing.
  const fonts = decideFonts(
    { display: 'Fraunces', text: 'Instrument Sans', declared: { display: { family: 'Fraunces', fontFace: 'loaded', loadedFamily: 'Fraunces' }, text: { family: 'Instrument Sans', fontFace: null, loadedFamily: null } } },
    { display: [{ family: 'Fraunces 72pt', custom: true, glyphs: 40 }], text: [{ family: 'Segoe UI', custom: false, glyphs: 900 }, { family: 'Segoe UI Symbol', custom: false, glyphs: 2 }] },
  );
  assert.deepEqual([fonts.display, fonts.text, fonts.declared.text], ['Fraunces', 'Segoe UI', 'Instrument Sans']);
  assert.deepEqual(fonts.missing.map(entry => [entry.role, entry.declared, entry.rendered, entry.fontFace]), [['text', 'Instrument Sans', 'Segoe UI', null]]);
  assert.equal(decideFonts({ display: 'ui-serif', text: 'system-ui', declared: { display: { family: 'ui-serif' }, text: { family: 'system-ui' } } }, { display: [{ family: 'Cambria', custom: false, glyphs: 5 }], text: [{ family: 'Segoe UI', custom: false, glyphs: 5 }] }).missing.length, 0, 'generic families are never missing');

  // Archetypes (G): a texture layer neither damps type-as-image nor makes a visual.
  const typeScreen = visuals => scoreArchetypes({ vw: 1440, h1: { fontSize: 130, textWidth: 1100, boxWidth: 1200, centred: false }, visuals, uiMock: null, indexRows: 0 }, null);
  const grain = { kind: 'svg', area: 0.92, selector: 'div.grain', behind: true, beside: false };
  assert.equal(typeScreen([grain]).scores['type-as-image'] < typeScreen([]).scores['type-as-image'], true, 'an untested layer still competes');
  assert.equal(typeScreen([{ ...grain, texture: true, textureDeltaE: 1.2 }]).scores['type-as-image'], typeScreen([]).scores['type-as-image'], 'a texture does not');
  // A full-bleed backdrop behind the h1 counts with what it paints apart from the ground (Saltwater & Smoke).
  const backdrop = { kind: 'svg', area: 0.92, selector: 'svg.hero__art', behind: true, beside: false };
  assert.equal(typeScreen([{ ...backdrop, paintedArea: 0.05, paintedRelation: { behind: false, beside: true, below: false } }]).scores['type-as-image'], typeScreen([]).scores['type-as-image'], 'a backdrop painting 5% beyond the ground does not damp the type');
  const besideSplit = scoreArchetypes({ vw: 1440, h1: { fontSize: 112, textWidth: 480, boxWidth: 560, centred: false }, visuals: [{ ...backdrop, paintedArea: 0.2, paintedRelation: { behind: false, beside: true, below: false } }], uiMock: null, indexRows: 0 }, null);
  assert.equal(besideSplit.archetype, 'editorial-split', 'the picture a backdrop draws beside the h1 makes an editorial split');
  assert.equal(scoreArchetypes({ vw: 1440, h1: { fontSize: 112, textWidth: 480, boxWidth: 560, centred: false }, visuals: [backdrop], uiMock: null, indexRows: 0 }, null).scores['editorial-split'], 0, 'by its box alone the backdrop is behind, not beside');
  assert.deepEqual(relationTo({ left: 760, top: 450, right: 1440, bottom: 900 }, { left: 113, top: 290, right: 595, bottom: 720 }), { behind: false, beside: true, below: false }, 'a lower-right picture is beside a left h1');

  // W10 pixels: worst of the 10th/90th-percentile background.
  const plain = (w, h, rgb) => ({ data: Buffer.from(Array.from({ length: w * h }, () => rgb).flat()), width: w, height: h, channels: 3 });
  // paintedRegion: only pixels that change when the layer is hidden AND leave the ground count.
  const shown = plain(30, 30, [22, 32, 38]);
  for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) shown.data.fill(200, (y * 30 + x) * 3, (y * 30 + x) * 3 + 3);
  for (let x = 0; x < 6; x++) shown.data.fill(240, x * 3, x * 3 + 3); // "text" drawn over the layer: the same in both shots
  const hidden = plain(30, 30, [18, 26, 31]);
  for (let x = 0; x < 6; x++) hidden.data.fill(240, x * 3, x * 3 + 3);
  const region = paintedRegion(shown, hidden, { left: 0, top: 0, right: 30, bottom: 30 }, '#162026', 1);
  assert.equal(region.share, round(100 / 900, 3), 'the 10 × 10 block, not the backdrop shade or the text');
  assert.deepEqual([region.rect.left, region.rect.top], [20, 20]);
  assert.equal(round(lineContrast(plain(20, 10, [255, 255, 255]), { left: 0, top: 0, right: 20, bottom: 10 }, { r: 118, g: 118, b: 118, a: 1 }).ratio), 4.54, '#767676 on white');
  const split = { ...plain(20, 10, [255, 255, 255]) };
  for (let i = 0; i < 20 * 10; i++) if (i % 20 >= 10) split.data.fill(17, i * 3, i * 3 + 3);
  assert.ok(lineContrast(split, { left: 0, top: 0, right: 20, bottom: 10 }, { r: 255, g: 255, b: 255, a: 1 }).ratio < 1.01, 'white text over a half-white background fails at the light end');
  return 'ok';
}

const NOISE = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.17 0 0 0 0 0.11 0 0 0 0 0.09 0 0 0 0.07 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>')}")`;
// Osteria Brina's case: a cream body under a 7% noise image, plus a fixed
// pointer-events:none grain layer over everything, a dark band and a band
// painted by a strong gradient (a picture-like layer, which stays media).
const TEXTURE_PAGE = `<!doctype html><html lang="en"><head><title>Texture</title><style>
body{margin:0;background:#ede3d3 ${NOISE};font:18px/1.5 Georgia,serif;color:#2b1d18}
section{min-height:900px;padding:80px}.dark{min-height:600px;background:#2b1d18;color:#f5efe6}
.wash{min-height:600px;background-image:linear-gradient(90deg,#102030,#c04020)}
.grain{position:fixed;inset:0;pointer-events:none;background-image:${NOISE};opacity:.6}
</style></head><body><section><h1>Pasta rolled by hand</h1><p>Twenty-eight seats and a wood oven.</p></section>
<section><p>This month's menu.</p></section><section class="dark"><p>Private dining.</p></section><section class="wash"></section><div class="grain"></div></body></html>`;
const pillPage = radius => `<!doctype html><html lang="en"><head><title>Badge</title><style>
body{margin:0;background:#f6efe3;font:18px/1.5 system-ui,sans-serif}main{padding:80px}h1{font:64px/1.1 Georgia,serif;color:#2b1d18}
h1 em{color:#b4441c}.book{display:inline-block;padding:12px 20px;background:#2b1d18;color:#fff;border-radius:${radius}}
</style></head><body><main><h1>Bread <em>by hand</em></h1><a class="book" href="#book">Book a table</a><p id="book">Call us.</p></main></body></html>`;
// W10 pixel pass: grey text on a pale gradient fails (#777 on #fff is 4.48);
// white text on a dark gradient passes; a far-off section makes the pass
// scroll; an SVG label on a pill painted in currentColor keeps its pill when
// glyphs are hidden (passes); a faint label inside a role="img" picture is
// measured into the picture bucket and never counted.
const CONTRAST_PAGE = `<!doctype html><html lang="en"><head><title>Contrast</title><style>
body{margin:0;font:16px/1.5 Arial,sans-serif;color:#111;background:#fff}.bar{position:fixed;top:0;left:0;right:0;height:60px;background:#222;color:#fff}
.pale{background:linear-gradient(90deg,#ffffff,#eeeeee);padding:120px 40px 40px}.pale p{color:#777;margin:0}
.dark{background:linear-gradient(#111111,#333333);padding:40px}.dark p{color:#fff;margin:0}.gap{height:2200px}
</style></head><body><div class="bar">Bar</div><section class="pale"><p>Grey words on a pale wash</p></section><section class="dark"><p>White words on a dark wash</p></section>
<svg width="300" height="60" style="color:#0e1a2f;display:block"><rect width="300" height="60" fill="currentColor"/><text x="20" y="38" fill="#f5f7fa" font-size="16">Night shift label</text></svg>
<svg role="img" aria-label="A chart" width="300" height="60" style="display:block"><text x="10" y="30" fill="#cccccc" font-size="12">faint chart label</text></svg>
<div class="gap"></div><section class="dark"><p>Far down the page, white on dark</p></section></body></html>`;
// W9: a clipped root with an element 8 px too wide (Osteria Brina's case).
const OVERFLOW_PAGE = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overflow</title><style>
body{margin:0;overflow-x:hidden;font:16px/1.5 Arial,sans-serif}.wide{width:calc(100vw + 8px);height:40px;background:#c04020}
</style></head><body><p>Content</p><div class="wide"></div><p>More content</p></body></html>`;
// Archetype (G), Saltwater & Smoke's case: a full-bleed SVG behind the h1 that
// repaints the dark ground and draws one picture (a disc of radius r) in the
// lower right. Its box covers the screen; what it paints apart from the ground
// is the disc. blockEm: the h1 ends in a display:block <em> as wide as the
// 760 px column (Saltwater's markup), so the h1's element boxes reach past
// its glyphs, towards a disc that sits beside the type.
const backdropPage = (r, { cx = 1150, blockEm = false } = {}) => `<!doctype html><html lang="en"><head><title>Backdrop</title><style>
body{margin:0;background:#162026}section{position:relative;height:900px;overflow:hidden}
svg.art{position:absolute;inset:0;width:100%;height:100%}.copy{position:relative;padding:280px 0 0 110px;max-width:${blockEm ? 760 : 560}px}
h1{font:112px/1 Georgia,serif;color:#f4ece0;margin:0}h1 em{display:block}p{font:20px/1.5 Georgia,serif;color:#c9c2b8}
</style></head><body><section><svg class="art" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true"><rect width="1440" height="900" fill="#141d22"/><circle cx="${cx}" cy="690" r="${r}" fill="#c8642d"/></svg>
<div class="copy"><h1>${blockEm ? 'Caught at dawn.<em>Over fire.</em>' : 'Caught this morning.'}</h1><p>A small wood-fired kitchen on the coast.</p></div></section></body></html>`;
// Fonts (F): a declared family with no @font-face that is not installed.
const FONT_PAGE = `<!doctype html><html lang="en"><head><title>Fonts</title><style>
body{margin:0;background:#fff;color:#111}main{padding:80px}h1{font:64px/1.1 Georgia,serif}p{font:18px/1.5 "Instrument Sans Not Installed",sans-serif}
</style></head><body><main><h1>Measured type</h1><p>Body copy set in a family the page never loads, so the browser falls back.</p><p>A second paragraph of body copy for good measure here.</p></main></body></html>`;

/** Browser checks on synthetic pages: textured ground (D2), contrast pixels (W10), touch overflow (W9), rendered fonts and the platform badge (W15). */
async function syntheticChecks(browser) {
  const out = {};
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const open = async (html, target = context) => {
    const page = await target.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(installHelpers, { platformSelector: PLATFORM_SELECTOR });
    return page;
  };
  try {
    const identity = decideIdentity(await measureIdentity(await open(TEXTURE_PAGE)));
    const layered = identity.groundCheck.layeredSamples;
    out.texture = { ground: identity.ground, groundSource: identity.groundSource, groundClass: identity.groundClass, firstScreenMediaShare: identity.firstScreenMediaShare, layered, agrees: identity.groundCheck.agrees, texturesIgnored: identity.archetypeNotes.texturesIgnored ?? [] };
    assert.equal(identity.ground, '#ede3d3', 'the ground under a noise texture is the cream colour');
    assert.equal(identity.groundSource, 'samples');
    assert.ok(identity.firstScreenMediaShare < 0.2, 'a texture is not media');
    assert.ok(layered.image?.colour > 0 && layered.overlay?.colour > 0 && layered.gradient?.media > 0, 'texture and grain settle to colour, a strong gradient stays media');
    assert.equal(identity.groundCheck.agrees, true);
    assert.ok((identity.archetypeNotes.texturesIgnored ?? []).length >= 1, 'the noise layers are textures, not visuals');
    assert.ok(identity.archetypeNotes['type-as-image'].competingVisual < 0.12, 'a texture does not compete with the type');

    out.backdrop = {};
    for (const [name, radius, expected, options] of [['disc beside the h1', 260, 'editorial-split'], ['small disc', 90, 'type-as-image'], ['disc beside an h1 with a block <em>', 260, 'editorial-split', { cx: 1030, blockEm: true }]]) {
      const backdrop = decideIdentity(await measureIdentity(await open(backdropPage(radius, options))));
      const layer = (backdrop.archetypeNotes.paintedLayers ?? []).find(entry => /svg/.test(entry.selector));
      out.backdrop[name] = { archetype: backdrop.archetype, scores: backdrop.archetypeScores, ground: backdrop.ground, layer, competingVisual: backdrop.archetypeNotes['type-as-image']?.competingVisual, h1: { textRect: backdrop.firstScreen.h1?.textRect, inkRect: backdrop.firstScreen.h1?.inkRect } };
      assert.ok(layer && layer.boxArea > 0.9 && layer.paintedArea < 0.25, `${name}: the full-bleed SVG counts with its painted area (${layer?.paintedArea}), not its box (${layer?.boxArea})`);
      assert.equal(backdrop.archetype, expected, `${name}: ${expected}`);
      if (options?.blockEm) assert.equal(relationTo(layer.paintedRect, backdrop.firstScreen.h1.textRect).beside, false, `${name}: against the h1's element boxes the disc would not be beside it, against its glyphs it is`);
    }

    const contrastPage = await open(CONTRAST_PAGE);
    const contrast = await resolveContrastPixels(contrastPage, await contrastPage.evaluate(evalContrast));
    out.contrast = { checked: contrast.checked, failing: contrast.failing, indeterminate: contrast.indeterminate, picture: contrast.picture, pixels: contrast.pixels, failingNodes: contrast.failingNodes.map(node => `${node.text} ${node.ratio} (${node.method})`), excludedLowest: contrast.excludedLowest };
    assert.equal(contrast.indeterminate, 0, 'gradient and SVG text is resolved from pixels');
    assert.deepEqual(contrast.failingNodes.map(node => [node.text, node.method]), [['Grey words on a pale wash', 'pixels']], 'only the grey line fails');
    // The line spans the left of the wash (#fff → about #fb fb fb under it): 4.48 down to about 4.3.
    assert.ok(contrast.failingNodes[0].ratio > 3.9 && contrast.failingNodes[0].ratio < 4.5, `worst case below 4.5 (${contrast.failingNodes[0].ratio})`);
    assert.deepEqual([contrast.picture.checked, contrast.picture.failing], [1, 1], 'the faint picture label is measured into its own bucket');
    assert.equal(contrast.pixels.resolved, 5);

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    try {
      const touchPage = await open(OVERFLOW_PAGE, phone);
      const touch = await touchPage.evaluate(evalTouchViewport);
      const script = await touchPage.evaluate(evalOverflow);
      out.overflow = { touch, rootClips: script.rootClips, scriptPx: script.overflowPx };
      assert.equal(script.rootClips, true);
      assert.equal(touch.userPx, 8, 'a touch visitor can pan the 8 px a hidden body clips');
    } finally {
      await phone.close();
    }

    const fontIdentity = decideIdentity(await measureIdentity(await open(FONT_PAGE)));
    out.fonts = { display: fontIdentity.fonts.display, text: fontIdentity.fonts.text, declared: fontIdentity.fonts.declared, missing: fontIdentity.fonts.missing };
    assert.equal(fontIdentity.fonts.declared.text, 'Instrument Sans Not Installed');
    assert.notEqual(fontIdentity.fonts.text, 'Instrument Sans Not Installed', 'the rendered family is reported');
    assert.deepEqual(fontIdentity.fonts.missing.map(entry => [entry.role, entry.declared, entry.fontFace]), [['text', 'Instrument Sans Not Installed', null]]);
    // The real badge from the site Worker's policy, appended as on a published page.
    const emit = process.emitWarning;
    process.emitWarning = function quiet(warning, ...rest) { if ((typeof rest[0] === 'object' ? rest[0]?.code : rest[1]) !== 'MODULE_TYPELESS_PACKAGE_JSON') emit.call(this, warning, ...rest); };
    let policy;
    try { policy = await import(pathToFileURL(path.join(REPO, 'infra', 'customer-sites', 'site-policy.js')).href); } finally { process.emitWarning = emit; }
    const serifs = serifFamilies();
    for (const [name, radius, sitePills] of [['square', '4px', 0], ['pill', '999px', 1]]) {
      const page = await open(policy.composeSiteDocument(pillPage(radius), { interactive: false, branding: true }));
      const raw = await page.evaluate(evalTells, { serifs });
      const cream = decideTells(raw, '#f6efe3', briefStyleRequests('')).creamSerifItalicPill;
      out[`badge-${name}`] = { pillCount: raw.pillCount, platformPillCount: raw.platformPillCount, creamSerifItalicPill: cream.present };
      assert.equal(raw.platformPillCount, 1, 'the badge is found as a platform pill');
      assert.equal(raw.pillCount, sitePills, 'the badge is not a site pill');
      assert.equal(cream.present, sitePills > 0, 'the badge alone never makes the cream/serif/italic/pill tell');
      assert.ok(!/Made with Makeborne/.test(raw.text), 'badge text is not site copy');
    }
  } finally {
    await context.close();
  }
  return out;
}

async function selftest() {
  const { chromium } = await import('playwright');
  const { serve } = await import('../serve.mjs');
  const { runLighthouse } = await import('./lighthouse.mjs');
  const { validateHtml } = await import('./htmlvalidate.mjs');
  const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const names = only.length ? only : Object.keys(SELFTEST_SITES);
  console.log(JSON.stringify({ unit: unitChecks() }));
  const browser = await chromium.launch();
  const summary = [];
  try {
    const synthetic = await syntheticChecks(browser);
    console.log(JSON.stringify({ synthetic }));
    writeJson(path.join(ensureDir(path.join(OUT, 'selftest', 'web')), 'synthetic.json'), synthetic);
    for (const name of names) {
      const dir = ensureDir(path.join(OUT, 'selftest', 'web', name));
      // Serve each single-file publish HTML as the root of its own site, like hosting does.
      const site = ensureDir(path.join(dir, 'site'));
      copyFileSync(path.join(REPO, 'outputs', 'product-qualification', `${name}.html`), path.join(site, 'index.html'));
      const server = await serve(site);
      try {
        const url = `${server.url}/`;
        const requestStatus = async pathname => (await fetch(new URL(pathname, server.url))).status;
        const metrics = await measurePage({ browser, url, brief: SELFTEST_SITES[name], shotsDir: path.join(dir, 'shots'), axeDir: dir, requestStatus });
        // --skip-lighthouse: the page instruments only (Lighthouse is slow and CPU-sensitive).
        const lighthouse = process.argv.includes('--skip-lighthouse') ? { error: 'skipped (--skip-lighthouse)' } : await attempt(() => runLighthouse(url, { runs: 1, outFile: path.join(dir, 'lighthouse.json') }));
        const htmlvalidate = await attempt(async () => {
          const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
          try {
            const page = await context.newPage();
            await page.goto(url, { waitUntil: 'load' });
            await settle(page);
            return validateHtml(await page.content(), { outFile: path.join(dir, 'htmlvalidate.json') });
          } finally { await context.close(); }
        });
        writeJson(path.join(dir, 'metrics.json'), { ...metrics, lighthouse, htmlvalidate: htmlvalidate.error ? htmlvalidate : { errors: htmlvalidate.errors, warnings: htmlvalidate.warnings, byRule: htmlvalidate.byRule } });
        summary.push({
          site: name,
          seconds: Math.round(metrics.durationMs / 1000),
          axe: metrics.axe.counts,
          cls: { max: metrics.vitals.clsMax, median: metrics.vitals.clsMedian, shareAtOrAbove: metrics.vitals.shareAtOrAbove, loads: metrics.vitals.loads },
          overflow: { userPx: metrics.overflow.userMaxPx, scriptPx: metrics.overflow.scriptMaxPx, elements: metrics.overflow.offenderCount },
          contrast: { failing: metrics.contrast.failing, indeterminate: metrics.contrast.indeterminate, checked: metrics.contrast.checked, pixelsResolved: metrics.contrast.pixels?.resolved ?? 0 },
          deadLinks: metrics.links.dead ?? metrics.links.error,
          images: metrics.images.error ?? { total: metrics.images.total, broken: metrics.images.brokenCount, missingAlt: metrics.images.missingAltCount, missingDims: metrics.images.missingDimsCount },
          tells: metrics.tells.error ?? { present: metrics.tells.present, requestedByBrief: metrics.tells.requested, platformPills: metrics.tells.creamSerifItalicPill?.evidence?.platformPillCount ?? 0 },
          firstScreen: metrics.firstScreen.ok,
          honesty: metrics.honesty.ok ?? metrics.honesty.error,
          identity: metrics.identity.error ?? { ground: metrics.identity.ground, groundSource: metrics.identity.groundSource, groundClass: metrics.identity.groundClass, pixelsAgree: metrics.identity.groundCheck?.agrees, ink: metrics.identity.ink, accent: metrics.identity.accent, fonts: [metrics.identity.fonts.display, metrics.identity.fonts.text], missingFonts: metrics.identity.fonts.missing?.length ?? 0, archetype: metrics.identity.archetype },
          runtimeErrors: metrics.runtimeErrors.count,
          lighthouse: lighthouse.error ?? lighthouse.median,
          html: htmlvalidate.error ?? { errors: htmlvalidate.errors, warnings: htmlvalidate.warnings },
        });
      } finally {
        await server.close();
      }
    }
  } finally {
    await browser.close();
  }
  writeJson(path.join(OUT, 'selftest', 'web', 'summary.json'), summary);
  for (const row of summary) console.log(JSON.stringify(row));
}

if (process.argv.includes('--selftest') && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  selftest().catch(error => { console.error(error); process.exitCode = 1; });
}
