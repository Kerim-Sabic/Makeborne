/* eslint-disable @typescript-eslint/no-require-imports */
/** Trusted, pure font selection shared by browser rendering, exports and builds. */
const catalog = require("./font-catalog.json");
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = new Map(catalog.map(font => {
  const name = escape(font.family);
  return [font.id, [
    new RegExp(`["'\`]\\s*${name}\\s*["'\`,]`, "i"),
    new RegExp(`(?:font-family|font|fontFamily|--[\\w-]+)\\s*:\\s*[^;{}\\n]*?(?<![\\w-])${name}\\s*(?=[,;}\\n"'\`]|$)`, "i"),
    new RegExp(`@makeborne/fonts/${escape(font.id)}(?:\\.css)?["']`),
  ]];
}));

/** @param {Iterable<[string, string]>} files */
function detectFonts(files) {
  const used = new Set(); let italic = false;
  for (const [path, content] of files) {
    if (!/\.(?:css|tsx?|jsx?|html)$/i.test(path)) continue;
    if (!italic && /\bitalic\b|<(?:em|i|cite|address|dfn|var)\b/.test(content)) italic = true;
    for (const [id, tests] of patterns) if (!used.has(id) && tests.some(test => test.test(content))) used.add(id);
  }
  return {fonts: catalog.filter(font => used.has(font.id)), italic};
}

/** Fontsource's Google Fonts subset ranges; identical for every catalogue family
 * (prepare-builder-runtime.mjs and check-font-coverage.cjs compare each
 * package's unicode.json). latin-ext complements latin: neither file covers the
 * other's letters (latin lacks ć č š đ ž Ł ź ő ű ğ ş, several latin-ext files
 * lack ASCII), so every face is declared from both files. latin-ext comes
 * first, as in Google Fonts CSS, so the later latin rule wins where they overlap. */
const UNICODE_RANGES = Object.freeze({
  "latin-ext": "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  latin: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
});
const FONT_SUBSETS = Object.freeze(["latin-ext", "latin"]);
const parseRange = range => range.split(",").map(part => part.slice(2).split("-").map(value => parseInt(value, 16))).map(([low, high = low]) => [low, high]);
const RANGES = Object.fromEntries(FONT_SUBSETS.map(subset => [subset, parseRange(UNICODE_RANGES[subset])]));
const inRanges = (point, ranges) => ranges.some(([low, high]) => point >= low && point <= high);
const hex = point => `\\u{${point.toString(16)}}`;
// Code points that only the latin-ext file serves (U+0304/0308/0329 and U+2020 stay with latin).
const EXT_ONLY = new RegExp(`[${RANGES["latin-ext"].flatMap(([low, high]) => {
  const parts = []; let start = null;
  for (let point = low; point <= high + 1; point++) {
    const only = point <= high && !inRanges(point, RANGES.latin);
    if (only && start === null) start = point;
    if (!only && start !== null) { parts.push(start === point - 1 ? hex(start) : `${hex(start)}-${hex(point - 1)}`); start = null; }
  }
  return parts;
}).join("")}]`, "u");

/** Subsets a self-contained output must embed for this text (outputs that link
 * files, like the portable build, always declare both: browsers fetch by range). */
function fontSubsets(texts) {
  for (const text of texts) if (EXT_ONLY.test(text)) return [...FONT_SUBSETS];
  return ["latin"];
}

/** @param {"latin" | "latin-ext"} [subset] adds its unicode-range; omitted, the rule claims every character (legacy form). */
function fontFaceRule(font, style, source, subset) {
  return `@font-face{font-family:"${font.family}";font-style:${style};font-weight:${font.weight};${font.stretch ? `font-stretch:${font.stretch};` : ""}font-display:swap;src:url(${source}) format("woff2")${subset ? `;unicode-range:${UNICODE_RANGES[subset]}` : ""}}`;
}
/** File inside the Fontsource package's files/ folder. */
const packageFontFile = (font, style, subset = "latin") => `${font.id}-${subset}-${font.axis}-${style}.woff2`;
/** Same-origin copy in public/builder-runtime/fonts (latin keeps its original name). */
const runtimeFontFile = (font, style, subset = "latin") => `${font.id}-${subset === "latin" ? "" : `${subset}-`}${style}.woff2`;

const FONT_CSS = "makeborne-fonts.css";
const FONT_MARKER = "makeborne-font-marker.css";
const fontPackage = font => `${/^\d+$/.test(font.axis) ? "@fontsource" : "@fontsource-variable"}/${font.id}`;

/** Derived build files only: never mutate the saved files or their identity.
 * Dependencies are installed from the trusted lock; Vite emits local WOFF2.
 * @param {{path: string, content: string}[]} input
 */
function portableFontFiles(input) {
  const {fonts, italic} = detectFonts(input.map(file => [file.path, file.content]));
  if (!fonts.length) return {files: input.map(file => ({...file})), fonts: [], styles: []};
  if (input.some(file => [FONT_CSS, FONT_MARKER].some(path => file.path.toLowerCase() === path || file.path.toLowerCase().startsWith(`${path}/`)))) throw new Error("The project uses the reserved portable font stylesheet path.");
  const styles = fonts.flatMap(font => (italic && font.italic ? ["normal", "italic"] : ["normal"]).map(style => ({font, style})));
  // Both subsets, always: browsers download latin-ext only for text that needs it.
  const css = styles.flatMap(({font, style}) => FONT_SUBSETS.map(subset => fontFaceRule(font, style,
    `./node_modules/${fontPackage(font)}/files/${packageFontFile(font, style, subset)}`, subset))).join("\n");
  const files = input.map(file => {
    // These optional imports are browser-runtime markers, not npm packages.
    const relative = `${"../".repeat(file.path.split("/").length - 1) || "./"}${FONT_MARKER}`;
    let content = file.content;
    if (/\.(?:css|tsx?|jsx?)$/i.test(file.path)) {
      content = content.replace(/((?:\bimport\s*(?:\(\s*)?|@import\s+(?:url\(\s*)?))["']@makeborne\/fonts\/([a-z0-9-]+)(?:\.css)?["']/g, (_match, prefix, id) => {
        if (!fonts.some(font => font.id === id)) throw new Error(`Unknown portable font marker: ${id}`);
        return `${prefix}"${relative}"`;
      });
    }
    if (file.path === "index.html") {
      const link = `<link rel="stylesheet" href="/${FONT_CSS}">`;
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, () => `${link}</head>`)
        : /<body\b/i.test(content) ? content.replace(/<body\b/i, () => `<head>${link}</head><body`) : `${link}${content}`;
    }
    return {path: file.path, content};
  });
  files.push({path: FONT_CSS, content: `/* Self-hosted OFL-1.1 fonts; license texts: /makeborne-font-licenses/ */\n${css}\n`});
  files.push({path: FONT_MARKER, content: "/* Optional font imports are markers; index.html loads makeborne-fonts.css once. */\n"});
  return {files, fonts, styles};
}

module.exports = {catalog, detectFonts, fontFaceRule, fontPackage, fontSubsets, packageFontFile, runtimeFontFile, portableFontFiles, FONT_CSS, FONT_MARKER, FONT_SUBSETS, UNICODE_RANGES};
