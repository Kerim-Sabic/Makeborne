import sanitizeHtml from "sanitize-html";

const escapeSiteText = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const MAX_SNAPSHOT_BYTES = 3_900_000;
const DATA_IMAGE = /^data:image\/(?:webp|png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
/** Self-hosted library fonts embedded by the builder as data: URLs. */
const DATA_FONT = /^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/;
const SVG_TAGS = ["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "defs", "lineargradient", "linearGradient", "radialgradient", "radialGradient", "stop", "clippath", "clipPath", "mask", "pattern", "symbol", "use", "title", "desc", "text", "tspan", "textpath", "textPath"];
const SVG_ATTRIBUTES = ["viewbox", "viewBox", "xmlns", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "fill-opacity", "fill-rule", "clip-rule", "opacity", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "width", "height", "points", "transform", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "fx", "fy", "patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits", "preserveAspectRatio", "clip-path", "mask", "href", "text-anchor", "dominant-baseline", "font-size", "font-weight", "letter-spacing", "startOffset", "dx", "dy", "font-family", "font-style", "textLength"];
/** The editor marks the project's own compiled stylesheet in captured snapshots. */
const BUNDLE_STYLE = /\bdata-makeborne-bundle\b/i;
const ROOT_ATTRIBUTES = ["class", "id", "style", "role", "title", "lang", "dir", "hidden", "tabindex", "data-*", "aria-*"];

/** Keep document-level theme, language and layout attributes through the same
 * allowlist as body content. Parse attributes rather than copying raw markup:
 * event handlers and document/navigation attributes must never survive. */
function documentAttributes(snapshot: string, cleanStyle: (value: string) => string) {
  const roots: Record<string, Record<string, string>> = {};
  sanitizeHtml(snapshot, {
    allowedTags: ["html", "body"],
    allowedAttributes: { html: ROOT_ATTRIBUTES, body: ROOT_ATTRIBUTES },
    transformTags: {
      "*": (tagName, attribs) => ({ tagName, attribs: { ...attribs, ...(attribs.style ? { style: cleanStyle(attribs.style) } : {}) } }),
    },
    exclusiveFilter: frame => {
      if ((frame.tag === "html" || frame.tag === "body") && !roots[frame.tag]) roots[frame.tag] = { ...frame.attribs };
      return false;
    },
  });
  const html = roots.html ?? {}, body = roots.body ?? {};
  if (!html.lang || html.lang.length > 100 || !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(html.lang)) html.lang = "en";
  for (const attrs of [html, body]) {
    if (attrs.dir && !/^(?:ltr|rtl|auto)$/i.test(attrs.dir)) delete attrs.dir;
  }
  const serialize = (attrs: Record<string, string>) => Object.entries(attrs).map(([name, value]) => ` ${name}="${escapeSiteText(value)}"`).join("");
  return { html: serialize(html), body: serialize(body) };
}

export type SnapshotOptions = {
  /** Site name for og:site_name. */
  siteName?: string;
  /** Absolute https URL of the share image (og:image). */
  image?: string;
  /** schema.org JSON from seo.structuredData (already safe for a data script). */
  jsonLd?: string | null;
  /** Published project images (`/images/hero.webp`) that the snapshot may reference. */
  assetPaths?: ReadonlySet<string>;
  /** Same-origin compiled stylesheet that replaces the captured bundle <style>. */
  stylesheet?: string | null;
  /** Exact manifest-listed styles emitted by a trusted compiler. */
  stylesheets?: readonly string[];
  /** React publication needs a painted root, not a truncated/loading snapshot. */
  requireReactRoot?: boolean;
};

/** Combined embedded image bytes in a portable copy (the existing static host's limit). */
export const PORTABLE_IMAGE_BUDGET = 2_500_000;

/**
 * Makes a captured snapshot portable: project images referenced as
 * `/images/<name>.webp` are embedded as data URLs (in `src` and CSS `url()`),
 * in order, until the byte budget is used. Images over budget are reported and
 * left as paths, which the sanitiser then drops.
 */
export function inlineSnapshotImages(snapshot: string, images: readonly { path: string; bytes: Uint8Array }[], budget = PORTABLE_IMAGE_BUDGET) {
  let used = 0, html = snapshot;
  const embedded: string[] = [], omitted: string[] = [];
  for (const image of images) {
    if (!/^\/images\/[a-z0-9][a-z0-9-]{0,62}\.webp$/.test(image.path)) { omitted.push(image.path); continue; }
    const escaped = image.path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const pattern = new RegExp(`(["'(]\\s*)${escaped}(?=\\s*["')])`, "g");
    if (!pattern.test(html)) continue;
    if (used + image.bytes.length > budget) { omitted.push(image.path); continue; }
    used += image.bytes.length;
    const url = `data:image/webp;base64,${Buffer.from(image.bytes).toString("base64")}`;
    html = html.replace(pattern, (_match, prefix: string) => `${prefix}${url}`);
    embedded.push(image.path);
  }
  return { snapshot: html, embedded, omitted, bytes: used };
}

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
  const cleanStyle = (value: string) => value
    .replace(/<\/?style/gi, "").replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (match: string, _quote: string, target: string) => allowedStyleUrl(target.trim()) ? match : "none");
  const styles = cleanStyle([...snapshot.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi)].filter(match => !(stylesheet && BUNDLE_STYLE.test(match[1]))).map(match => match[2]).join("\n"));
  const roots = documentAttributes(snapshot, cleanStyle);
  const body = /<body\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*)<\/body>/i.exec(snapshot)?.[1] ?? "";
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
  if (options.requireReactRoot && !/<div\b[^>]*\bid="root"[^>]*>(?!\s*<\/div>)/i.test(clean)) {
    throw new Error("The website preview is incomplete. Wait for it to finish loading and publish again.");
  }
  const e = escapeSiteText;
  const links = [...new Set([...(stylesheet ? [stylesheet] : []), ...(options.stylesheets ?? [])])];
  if ((options.stylesheets ?? []).some(path => !assets.has(path) || !/^\/[A-Za-z0-9_./-]+\.css$/.test(path))) throw new Error("The compiled website stylesheet is unavailable.");
  const link = links.map(path => `<link rel="stylesheet" href="${e(path)}">`).join("");
  const image = options.image && /^https:\/\/[^\s"'<>]+$/.test(options.image) ? options.image : null;
  // A data block, never executed; it must not be able to close its own element.
  if (options.jsonLd && (!options.jsonLd.startsWith("{") || /[<>]/.test(options.jsonLd))) throw new Error("Invalid structured data.");
  const share = `${options.siteName ? `<meta property="og:site_name" content="${e(options.siteName)}">` : ""}${image ? `<meta property="og:image" content="${e(image)}"><meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}`;
  const data = options.jsonLd ? `<script type="application/ld+json">${options.jsonLd}</script>` : "";
  return `<!doctype html><html${roots.html}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${e(url)}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(url)}"><meta property="og:type" content="website">${share}${data}${link}<style>${styles}</style></head><body${roots.body}>${clean}</body></html>`;
}
