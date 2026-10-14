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

function fontFaceRule(font, style, source) {
  return `@font-face{font-family:"${font.family}";font-style:${style};font-weight:${font.weight};${font.stretch ? `font-stretch:${font.stretch};` : ""}font-display:swap;src:url(${source}) format("woff2")}`;
}

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
  const css = styles.map(({font, style}) => fontFaceRule(font, style,
    `./node_modules/${fontPackage(font)}/files/${font.id}-latin-${font.axis}-${style}.woff2`)).join("\n");
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

module.exports = {catalog, detectFonts, fontFaceRule, fontPackage, portableFontFiles, FONT_CSS, FONT_MARKER};
