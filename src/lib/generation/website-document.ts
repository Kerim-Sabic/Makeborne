import sanitizeHtml from "sanitize-html";
import { WebsiteDesignSchema, type WebsiteDesign } from "./website-contract";
import { isApprovedWebsiteImage, websiteImageCsp } from "./website-assets";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function cleanWebsite(input: WebsiteDesign): WebsiteDesign {
  const website = WebsiteDesignSchema.parse(input);
  const html = sanitizeHtml(website.html, {
    allowedTags: [
      "header", "nav", "main", "section", "article", "aside", "footer", "div", "span",
      "h1", "h2", "h3", "h4", "p", "a", "ul", "ol", "li", "details", "summary",
      "figure", "figcaption", "img", "dl", "dt", "dd", "strong", "em", "small",
      "br", "hr", "blockquote", "table", "thead", "tbody", "tr", "th", "td",
    ],
    allowedAttributes: {
      "*": ["class", "id", "aria-label", "aria-hidden"],
      a: ["href"],
      img: ["src", "alt", "width", "height", "loading", "decoding"],
      details: ["open"],
      th: ["scope"],
    },
    transformTags: {
      a: (_tag, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, href: /^#[a-zA-Z][\w-]*$/.test(attributes.href ?? "") ? attributes.href : "#" },
      }),
      img: (_tag, attributes) => ({
        tagName: "img",
        attribs: { ...attributes, src: isApprovedWebsiteImage(attributes.src ?? "") ? attributes.src : "", decoding: "async" },
      }),
    },
    exclusiveFilter: frame => frame.tag === "img" && !frame.attribs.src,
  });

  // CSS stays isolated in a sandbox; only curated public images may load.
  const css = website.css.replace(/</g, "").replace(/@import[^;]*;?/gi, "");
  if (!/<h1[\s>]/i.test(html) || !/<main[\s>]/i.test(html)) {
    throw new Error("Website needs a main landmark and a primary heading.");
  }
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const link of html.matchAll(/\bhref="#([^"]*)"/g)) {
    if (link[1] && !ids.has(link[1])) throw new Error("Website navigation contains a missing destination.");
  }
  return { ...website, html, css };
}

function publicationMetadata(title: string, description: string, canonicalUrl?: string) {
  if (canonicalUrl === undefined) return "";
  const url = new URL(canonicalUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error("Use an HTTPS website address without credentials, query or fragment.");
  }
  return [
    `<link rel="canonical" href="${escapeHtml(url.href)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url.href)}">`,
    '<meta property="og:type" content="website">',
  ].join("");
}

/** One static document renderer for preview, download and publication. */
export function websiteDocument(title: string, input: WebsiteDesign, preview = false, canonicalUrl?: string) {
  const site = cleanWebsite(input);
  const html = preview ? site.html.replaceAll('href="#', 'href="about:srcdoc#') : site.html;
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src ${websiteImageCsp}; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`,
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(site.description)}">`,
    publicationMetadata(title, site.description, canonicalUrl),
    '<style>*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;overflow-wrap:break-word}img{max-width:100%}',
    site.css,
    '\n@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}:focus-visible{outline:3px solid currentColor;outline-offset:4px}</style>',
    `</head><body>${html}</body></html>`,
  ].join("");
}
