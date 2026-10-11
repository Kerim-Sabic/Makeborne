import sanitizeHtml from "sanitize-html";

const escapeSiteText = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const MAX_SNAPSHOT_BYTES = 3_900_000;
const DATA_IMAGE = /^data:image\/(?:webp|png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
/** Self-hosted library fonts embedded by the builder as data: URLs. */
const DATA_FONT = /^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/;
const SVG_TAGS = ["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "symbol", "use", "title", "desc", "text", "tspan", "textpath", "textPath"];
const SVG_ATTRIBUTES = ["viewbox", "viewBox", "xmlns", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "fill-opacity", "fill-rule", "clip-rule", "opacity", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "width", "height", "points", "transform", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "preserveAspectRatio", "clip-path", "mask", "href", "text-anchor", "dominant-baseline", "font-size", "font-weight", "letter-spacing", "startOffset", "dx", "dy", "font-family", "font-style", "textLength"];
/** The editor marks the project's own compiled stylesheet in captured snapshots. */
const BUNDLE_STYLE = /\bdata-makeborne-bundle\b/i;

export type SnapshotOptions = {
  /** Published project images (`/images/hero.webp`) that the snapshot may reference. */
  assetPaths?: ReadonlySet<string>;
  /** Same-origin compiled stylesheet that replaces the captured bundle <style>. */
  stylesheet?: string | null;
};

/** Publish a rendered React website as sanitised static HTML: the first paint,
 * the SEO/no-JS fallback and the starting point the site bundle re-renders.
 * Everything executable is removed here; the host CSP is an independent barrier. */
export function renderHostedSnapshot(snapshot: string, title: string, description: string, url: string, options: SnapshotOptions = {}) {
  if (Buffer.byteLength(snapshot) > MAX_SNAPSHOT_BYTES) throw new Error("This website exceeds the 4 MB publishing limit. Use fewer or smaller images.");
  const assets = options.assetPaths ?? new Set<string>();
  const stylesheet = options.stylesheet && /^\/_mb\/app-[0-9a-f]{16}\.css$/.test(options.stylesheet) ? options.stylesheet : null;
  const allowedImage = (value: string) => DATA_IMAGE.test(value) || assets.has(value);
  // CSS may also reference the builder's embedded library fonts (font-src data:).
  const allowedStyleUrl = (value: string) => allowedImage(value) || DATA_FONT.test(value);
  const styles = [...snapshot.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi)].filter(match => !(stylesheet && BUNDLE_STYLE.test(match[1]))).map(match => match[2]).join("\n")
    .replace(/<\/?style/gi, "").replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (match: string, _quote: string, target: string) => allowedStyleUrl(target.trim()) ? match : "none");
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(snapshot)?.[1] ?? "";
  const lang = /<html[^>]*\blang=["']([a-zA-Z-]{2,12})["']/i.exec(snapshot)?.[1] ?? "en";
  const clean = sanitizeHtml(body, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "header", "footer", "main", "nav", "section", "article", "aside", "figure", "figcaption", "img", "picture", "details", "summary", "button", "label", "input", "textarea", "select", "option", "form", "fieldset", "legend", "dialog", "time", "mark", "small", "sup", "sub", "video", "source", ...SVG_TAGS],
    allowedAttributes: {
      "*": ["class", "id", "style", "role", "title", "lang", "dir", "hidden", "tabindex", "data-*", "aria-*"],
      a: ["href", "target", "rel"], img: ["src", "alt", "width", "height", "loading", "decoding", "sizes"],
      input: ["type", "name", "placeholder", "value", "checked", "disabled", "required", "min", "max", "step"],
      textarea: ["name", "placeholder", "rows", "disabled", "required"], select: ["name", "disabled"], option: ["value", "selected"],
      button: ["type", "disabled"], label: ["for"], details: ["open"], dialog: ["open"], time: ["datetime"], th: ["scope", "colspan", "rowspan"], td: ["colspan", "rowspan"],
      ...Object.fromEntries(SVG_TAGS.map(tag => [tag, SVG_ATTRIBUTES])),
    },
    allowedSchemes: ["https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    parser: { lowerCaseAttributeNames: false },
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, ...(attribs.href && /^[a-z][a-z0-9+.-]*:/i.test(attribs.href) ? { rel: "noopener noreferrer", target: "_blank" } : {}) } }),
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, src: allowedImage(attribs.src ?? "") ? attribs.src : "" } }),
      form: (_tagName, attribs) => ({ tagName: "form", attribs: { ...attribs, action: "#" } }),
      use: (tagName, attribs) => ({ tagName, attribs: { ...attribs, href: (attribs.href ?? "").startsWith("#") ? attribs.href : "" } }),
      textpath: (tagName, attribs) => ({ tagName, attribs: { ...attribs, href: (attribs.href ?? "").startsWith("#") ? attribs.href : "" } }),
      textPath: (tagName, attribs) => ({ tagName, attribs: { ...attribs, href: (attribs.href ?? "").startsWith("#") ? attribs.href : "" } }),
    },
    exclusiveFilter: frame => frame.tag === "img" && !frame.attribs.src,
  });
  const e = escapeSiteText;
  const link = stylesheet ? `<link rel="stylesheet" href="${stylesheet}">` : "";
  return `<!doctype html><html lang="${e(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${e(url)}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(url)}"><meta property="og:type" content="website">${link}<style>${styles}</style></head><body>${clean}</body></html>`;
}
