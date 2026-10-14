/**
 * Reads a brand from a website's own HTML and CSS without AI: colours (weighted
 * by where they are used), fonts mapped onto the curated library, logo
 * candidates and the business name. Pure functions; the fetching (with the
 * public-address guard) lives in server.ts.
 */
import { BRAND_FONTS, saturation, toHex } from "./kit";

export type ExtractedBrand = {
  name: string; tagline: string;
  colors: { primary: string | null; secondary: string | null; accent: string | null; background: string | null; text: string | null };
  fonts: { heading: string | null; body: string | null };
  /** The site's own heading and body families, as written (for the "closest match" note). */
  fontSources: { heading: string | null; body: string | null };
  detectedFonts: string[];
  logoCandidates: { url: string; svg?: string }[];
};

const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;|&#x27;|&apos;/gi, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16))).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => { const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag); return match ? decode(match[1] ?? match[2] ?? match[3] ?? "") : ""; };
function meta(html: string, name: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) if ([attr(tag, "property"), attr(tag, "name")].some(value => value.toLowerCase() === name)) return attr(tag, "content");
  return "";
}
/** Brand text never contains angle brackets (the kit schema refuses them). */
const clean = (value: string, max: number) => value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max).trim();

// ---------------------------------------------------------------- colours

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000" };
export function parseColor(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (NAMED[value]) return NAMED[value];
  let match = /^#([0-9a-f]{3,8})$/.exec(value);
  if (match) {
    const h = match[1];
    if (h.length === 3 || h.length === 4) { if (h.length === 4 && parseInt(h[3], 16) < 8) return null; return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`; }
    if (h.length === 6) return `#${h}`;
    if (h.length === 8) return parseInt(h.slice(6), 16) < 128 ? null : `#${h.slice(0, 6)}`;
    return null;
  }
  match = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (match) {
    const alpha = match[4] ? (match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4])) : 1;
    if (alpha < 0.5 || [match[1], match[2], match[3]].some(part => Number(part) > 255)) return null;
    return toHex(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (match) {
    const alpha = match[4] ? (match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4])) : 1;
    if (alpha < 0.5) return null;
    const h = (parseFloat(match[1]) % 360) / 360, s = Math.min(1, parseFloat(match[2]) / 100), l = Math.min(1, parseFloat(match[3]) / 100);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const channel = (t: number) => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
    return toHex(channel(h + 1 / 3), channel(h), channel(h - 1 / 3));
  }
  return null;
}
const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|rgba?\([^)]{5,60}\)|hsla?\([^)]{5,60}\)/gi;

export function hue(value: string) {
  const n = parseInt(value.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const distinct = (a: string, b: string) => {
  const dh = Math.abs(hue(a) - hue(b)), hueGap = Math.min(dh, 360 - dh);
  return hueGap >= 24 || Math.abs(saturation(a).l - saturation(b).l) >= 0.22;
};
const neutral = (value: string) => { const { s, l } = saturation(value); return s < 0.14 || l > 0.95 || l < 0.05; };

type Tally = Map<string, { score: number; background: number; text: number }>;
function add(tally: Tally, color: string | null, score: number, use: "background" | "text" | "other") {
  if (!color) return;
  const item = tally.get(color) ?? { score: 0, background: 0, text: 0 };
  item.score += score;
  if (use === "background") item.background += score; else if (use === "text") item.text += score;
  tally.set(color, item);
}

/** Every colour declaration, weighted by property and selector. */
export function colorTally(css: string, themeColor = "") {
  const tally: Tally = new Map();
  add(tally, parseColor(themeColor), 40, "other");
  const vars = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]{1,60})\s*:\s*([^;{}]{1,120})/g)) vars.set(match[1], match[2].trim());
  for (const rule of css.matchAll(/([^{}]{0,400})\{([^{}]{0,6000})\}/g)) {
    const selector = rule[1].trim().toLowerCase(), body = rule[2];
    const root = /(^|,)\s*(html|body|:root)\s*(,|$)/.test(selector);
    const action = /\b(button|btn|cta|primary|nav a|a:hover|\ba\b)/.test(selector);
    for (const declaration of body.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      let value = declaration.slice(colon + 1).trim();
      value = value.replace(/var\((--[\w-]+)[^)]*\)/g, (_, name: string) => vars.get(name) ?? "");
      const tokens = value.match(COLOR_TOKEN) ?? (NAMED[value.toLowerCase()] ? [value] : []);
      if (!tokens.length) continue;
      if (property.startsWith("--")) {
        const named = /brand|primary|accent|main|secondary|highlight|cta|theme/.test(property);
        for (const token of tokens) add(tally, parseColor(token), named ? 14 : 2, /bg|background|surface|canvas|paper/.test(property) ? "background" : /text|ink|fg|foreground|body/.test(property) ? "text" : "other");
        continue;
      }
      const use = /^background(-color)?$/.test(property) ? "background" : property === "color" ? "text" : /^(border|fill|stroke|outline|box-shadow|text-decoration)/.test(property) ? "other" : null;
      if (!use) continue;
      const weight = root ? 18 : action ? 5 : use === "other" ? 1 : 2;
      for (const token of tokens) add(tally, parseColor(token), weight, use);
    }
  }
  return tally;
}

export function pickColors(tally: Tally): ExtractedBrand["colors"] {
  const ranked = [...tally.entries()].sort((a, b) => b[1].score - a[1].score);
  // Pale tints are surfaces and borders, not brand colours; and a supporting colour must be used for real, not once.
  const chromatic = ranked.filter(([color]) => !neutral(color) && saturation(color).l <= 0.85);
  const chosen: string[] = [];
  for (const [color, use] of chromatic) {
    if (chosen.length && use.score < chromatic[0][1].score * 0.12) break;
    if (chosen.every(other => distinct(color, other))) chosen.push(color);
    if (chosen.length === 3) break;
  }
  const background = ranked.filter(([color, use]) => use.background > 0 && saturation(color).l > 0.85).sort((a, b) => b[1].background - a[1].background)[0]?.[0]
    ?? ranked.filter(([color, use]) => use.background > 0 && saturation(color).l < 0.15).sort((a, b) => b[1].background - a[1].background)[0]?.[0] ?? null;
  const dark = background ? saturation(background).l < 0.5 : false;
  const text = ranked.filter(([color, use]) => use.text > 0 && neutral(color) && (dark ? saturation(color).l > 0.7 : saturation(color).l < 0.35)).sort((a, b) => b[1].text - a[1].text)[0]?.[0] ?? null;
  // A monochrome brand: its strongest dark neutral is the main colour.
  const primary = chosen[0] ?? ranked.find(([color]) => color !== background && saturation(color).l < 0.3)?.[0] ?? null;
  return { primary, secondary: chosen[1] ?? null, accent: chosen[2] ?? null, background, text };
}

// ---------------------------------------------------------------- fonts

const GENERIC = /^(inherit|initial|unset|revert|serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|segoe ui|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|var\(.*)$/i;
/** Popular families outside the library and their closest library font. */
const NEAREST: Record<string, string> = {
  montserrat: "outfit", poppins: "outfit", raleway: "outfit", "josefin sans": "outfit", quicksand: "outfit", futura: "outfit", jost: "outfit", lexend: "outfit", urbanist: "outfit",
  "open sans": "inter", roboto: "inter", helvetica: "inter", "helvetica neue": "inter", arial: "inter", "inter tight": "inter", "source sans pro": "inter", "source sans 3": "inter", "noto sans": "inter",
  lato: "dm-sans", nunito: "dm-sans", "nunito sans": "dm-sans", "work sans": "dm-sans", karla: "dm-sans", "gill sans": "dm-sans",
  mulish: "manrope", avenir: "manrope", "avenir next": "manrope", satoshi: "manrope", "general sans": "manrope",
  rubik: "plus-jakarta-sans", figtree: "plus-jakarta-sans", epilogue: "plus-jakarta-sans", "red hat display": "plus-jakarta-sans",
  "ibm plex sans": "geist", "instrument sans": "geist", "hanken grotesk": "geist", "neue montreal": "geist",
  oswald: "archivo", barlow: "archivo", "barlow condensed": "archivo", "archivo black": "archivo", "libre franklin": "archivo", "schibsted grotesk": "archivo",
  anton: "bebas-neue", "big shoulders display": "bebas-neue", "clash display": "syne", "cabinet grotesk": "bricolage-grotesque",
  merriweather: "newsreader", lora: "newsreader", "libre baskerville": "newsreader", "pt serif": "newsreader", "source serif pro": "newsreader", "source serif 4": "newsreader",
  "crimson pro": "newsreader", "crimson text": "newsreader", "roboto slab": "newsreader", georgia: "newsreader", "times new roman": "newsreader", spectral: "newsreader", literata: "newsreader", alegreya: "newsreader", "noto serif": "newsreader",
  "eb garamond": "cormorant", "cormorant garamond": "cormorant", garamond: "cormorant", cinzel: "cormorant",
  "bodoni moda": "playfair-display", "libre bodoni": "playfair-display", "abril fatface": "dm-serif-display", "dm serif text": "dm-serif-display", "young serif": "fraunces",
  "ibm plex mono": "jetbrains-mono", "space mono": "jetbrains-mono", "fira code": "jetbrains-mono", "source code pro": "jetbrains-mono", "geist mono": "jetbrains-mono", "roboto mono": "jetbrains-mono",
};
const SERIFISH = /serif|garamond|baskerville|bodoni|didot|times|georgia|slab|caslon|playfair|merriweather|lora|antiqua|book/i;

/** Closest library font id for a family name, or null for script and unknown faces. */
export function libraryFont(family: string): string | null {
  const key = family.toLowerCase().replace(/\s+/g, " ").trim();
  const exact = BRAND_FONTS.find(font => font.family.toLowerCase() === key);
  if (exact) return exact.id;
  if (NEAREST[key]) return NEAREST[key];
  if (/script|hand|brush|caveat|pacifico|dancing|vibes|marker|icon|awesome|material|symbols|emoji/i.test(key)) return null;
  return SERIFISH.test(key) ? "newsreader" : "inter";
}

const firstFamily = (stack: string) => stack.split(",").map(part => part.trim().replace(/^["']|["']$/g, "").replace(/\s*!important$/i, "").trim()).find(part => part && !GENERIC.test(part)) ?? null;

export function fontUsage(html: string, css: string) {
  const score = new Map<string, { score: number; heading: number; body: number }>();
  const add = (family: string | null, weight: number, role: "heading" | "body" | "other") => {
    if (!family || family.length > 60) return;
    const item = score.get(family) ?? { score: 0, heading: 0, body: 0 };
    item.score += weight; if (role === "heading") item.heading += weight; if (role === "body") item.body += weight;
    score.set(family, item);
  };
  const vars = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]{1,60})\s*:\s*([^;{}]{1,200})/g)) vars.set(match[1], match[2].trim());
  for (const link of html.match(/https?:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s>]+/gi) ?? [])
    for (const family of decode(link).matchAll(/family=([^:&]+)/g)) add(decodeURIComponent(family[1].replace(/\+/g, " ")), 3, "other");
  for (const rule of css.matchAll(/([^{}]{0,400})\{([^{}]{0,6000})\}/g)) {
    const selector = rule[1].trim().toLowerCase();
    const role = /(^|[\s,>])(h1|h2|h3)\b|head|title|display|hero/.test(selector) ? "heading" : /(^|,)\s*(html|body|:root|p)\s*(,|$)/.test(selector) ? "body" : "other";
    for (const match of rule[2].matchAll(/(?:^|;)\s*(--[\w-]*font[\w-]*|font-family|font)\s*:\s*([^;]+)/gi)) {
      let value = match[2].replace(/var\((--[\w-]+)[^)]*\)/g, (_, name: string) => vars.get(name) ?? "");
      if (match[1].toLowerCase() === "font") value = value.replace(/^.*?[\d.]+(?:px|r?em|pt|%|vw|vh|ch)(?:\s*\/\s*[\w.%]+)?\s+/i, "");
      const custom = match[1].startsWith("--");
      add(firstFamily(value), custom ? 4 : role === "other" ? 1 : 6, custom ? (/head|display|title/i.test(match[1]) ? "heading" : /body|text|base|sans/i.test(match[1]) ? "body" : "other") : role);
    }
  }
  const ranked = [...score.entries()].sort((a, b) => b[1].score - a[1].score);
  const heading = [...ranked].sort((a, b) => b[1].heading - a[1].heading).find(([, use]) => use.heading > 0)?.[0] ?? null;
  const body = [...ranked].sort((a, b) => b[1].body - a[1].body).find(([, use]) => use.body > 0)?.[0] ?? ranked.find(([family]) => family !== heading)?.[0] ?? null;
  return { heading: heading ?? (body && ranked[0]?.[0] !== body ? ranked[0]?.[0] ?? null : null), body, detected: ranked.map(([family]) => family).slice(0, 6) };
}

// ---------------------------------------------------------------- name and logo

export function siteName(html: string, url: URL) {
  const og = meta(html, "og:site_name");
  if (og) return clean(og, 80);
  const ld = /"@type"\s*:\s*"(?:Organization|LocalBusiness|Restaurant|Store|Corporation|ProfessionalService)"[^{}]*?"name"\s*:\s*"([^"]{1,80})"/i.exec(html)?.[1];
  if (ld) return clean(ld, 80);
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const parts = title.split(/\s+[|–—·:-]\s+/).map(part => part.trim()).filter(part => part && !/^(home|homepage|welcome|official (web)?site)$/i.test(part));
  const label = url.hostname.replace(/^www\./, "").split(".")[0].replace(/-/g, "").toLowerCase();
  const match = parts.find(part => part.toLowerCase().replace(/[^a-z0-9]/g, "").includes(label) || label.includes(part.toLowerCase().replace(/[^a-z0-9]/g, "")));
  return clean(match ?? parts[0] ?? url.hostname.replace(/^www\./, ""), 80);
}

export function tagline(html: string) {
  const description = meta(html, "og:description") || meta(html, "description");
  const first = /^(.{12,140}?[.!?])(\s|$)/.exec(description)?.[1] ?? (description.length <= 140 ? description : "");
  return clean(first, 140);
}

const SVG_MAX = 60_000;
/** Inline or fetched SVG is only rasterised when it cannot reference anything outside itself. */
export const safeSvg = (svg: string) => svg.length <= SVG_MAX && /^\s*(<\?xml[^>]*>\s*)?<svg\b/i.test(svg) && !/<!ENTITY|<!DOCTYPE|<script|<foreignObject|\bon\w+\s*=|(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(?:png|jpeg|webp);)|url\(\s*["']?\s*(?!#)|@import/i.test(svg);

export function logoCandidates(html: string, base: URL) {
  const out: { url: string; svg?: string; rank: number }[] = [];
  const push = (raw: string, rank: number) => {
    if (!raw || raw.startsWith("data:")) return;
    try { const url = new URL(raw, base); if (["http:", "https:"].includes(url.protocol) && !out.some(item => item.url === url.href)) out.push({ url: url.href, rank }); } catch { /* ignore */ }
  };
  for (const match of html.matchAll(/"logo"\s*:\s*(?:\{[^{}]*?"url"\s*:\s*)?"(https?:[^"]{1,500})"/gi)) push(match[1].replace(/\\\//g, "/"), 0);
  const headerEnd = html.search(/<\/header>/i);
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0], text = `${attr(tag, "src")} ${attr(tag, "alt")} ${attr(tag, "class")} ${attr(tag, "id")}`;
    if (!/logo|brand|wordmark/i.test(text) || /partner|client|sponsor|award|badge|payment|footer-logo-\d/i.test(text)) continue;
    push(attr(tag, "src") || attr(tag, "data-src"), headerEnd > 0 && (match.index ?? 0) < headerEnd ? 1 : 2);
  }
  for (const match of html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)) {
    const open = /<svg\b[^>]*>/i.exec(match[0])![0];
    if (!/logo|brand|wordmark/i.test(`${attr(open, "class")} ${attr(open, "id")} ${attr(open, "aria-label")}`) || !safeSvg(match[0])) continue;
    const svg = /\sxmlns=/.test(open) ? match[0] : match[0].replace(/^<svg\b/i, "<svg xmlns=\"http://www.w3.org/2000/svg\"");
    out.push({ url: `inline:${out.length}`, svg, rank: 1.5 });
    break;
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, "rel").toLowerCase(), size = Number(/(\d+)x\d+/.exec(attr(tag, "sizes"))?.[1] ?? 0);
    if (rel.includes("apple-touch-icon")) push(attr(tag, "href"), 3);
    else if (/\bicon\b/.test(rel) && (size >= 96 || /\.svg(\?|$)/i.test(attr(tag, "href")))) push(attr(tag, "href"), 4);
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 4).map(({ url, svg }) => svg ? { url, svg } : { url });
}

/** Same-site stylesheet links worth reading (font CDNs are read by name only). */
export function stylesheetLinks(html: string, base: URL, limit = 3) {
  const site = base.hostname.split(".").slice(-2).join(".");
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\bstylesheet\b/i.test(attr(tag, "rel"))) continue;
    try {
      const url = new URL(attr(tag, "href"), base);
      if (["http:", "https:"].includes(url.protocol) && (url.hostname === site || url.hostname.endsWith(`.${site}`)) && !out.includes(url.href)) out.push(url.href);
    } catch { /* ignore */ }
    if (out.length === limit) break;
  }
  return out;
}

export function inlineCss(html: string) {
  const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]);
  // Inline style attributes become rules on a neutral selector.
  const inline = [...html.matchAll(/\sstyle\s*=\s*"([^"]{1,600})"/gi)].slice(0, 400).map(match => `x{${decode(match[1])}}`);
  return [...blocks, ...inline].join("\n");
}

/** Everything the page and its stylesheets say about the brand. */
export function extractBrand(html: string, css: string, url: URL): ExtractedBrand {
  const allCss = `${inlineCss(html)}\n${css}`;
  const fonts = fontUsage(html, allCss);
  return {
    name: siteName(html, url), tagline: tagline(html),
    colors: pickColors(colorTally(allCss, meta(html, "theme-color"))),
    fonts: { heading: fonts.heading ? libraryFont(fonts.heading) : null, body: fonts.body ? libraryFont(fonts.body) : null },
    fontSources: { heading: fonts.heading, body: fonts.body }, detectedFonts: fonts.detected,
    logoCandidates: logoCandidates(html, url),
  };
}
