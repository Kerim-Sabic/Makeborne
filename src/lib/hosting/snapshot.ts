import sanitizeHtml from "sanitize-html";

const escapeSiteText = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const MAX_SNAPSHOT_BYTES = 3_900_000;
const DATA_IMAGE = /^data:image\/(?:webp|png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const SVG_TAGS = ["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "symbol", "use", "title", "desc", "text", "tspan"];
const SVG_ATTRIBUTES = ["viewbox", "viewBox", "xmlns", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "fill-opacity", "fill-rule", "clip-rule", "opacity", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "width", "height", "points", "transform", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "preserveAspectRatio", "clip-path", "mask", "href", "text-anchor", "dominant-baseline", "font-size", "font-weight", "letter-spacing"];

/** Publish a rendered React website as static HTML on the script-free host.
 * Everything executable is removed; the host CSP (sandbox, script-src 'none')
 * is a second, independent barrier. */
export function renderHostedSnapshot(snapshot: string, title: string, description: string, url: string) {
  if (Buffer.byteLength(snapshot) > MAX_SNAPSHOT_BYTES) throw new Error("This website exceeds the 4 MB publishing limit. Use fewer or smaller images.");
  const styles = [...snapshot.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join("\n")
    .replace(/<\/?style/gi, "").replace(/@import[^;]*;?/gi, "").replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\1\s*\)/gi, "none");
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
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, ...(attribs.href && !attribs.href.startsWith("#") ? { rel: "noopener noreferrer", target: "_blank" } : {}) } }),
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, src: DATA_IMAGE.test(attribs.src ?? "") ? attribs.src : "" } }),
      form: (_tagName, attribs) => ({ tagName: "form", attribs: { ...attribs, action: "#" } }),
      use: (tagName, attribs) => ({ tagName, attribs: { ...attribs, href: (attribs.href ?? "").startsWith("#") ? attribs.href : "" } }),
    },
    exclusiveFilter: frame => frame.tag === "img" && !frame.attribs.src,
  });
  const e = escapeSiteText;
  return `<!doctype html><html lang="${e(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${e(url)}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(url)}"><meta property="og:type" content="website"><style>${styles}</style></head><body>${clean}</body></html>`;
}
