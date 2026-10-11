import { ArtifactContentSchema, StyleProfileSchema } from "@/lib/domain";
import { artifactDesignCss } from "@/lib/artifact-design";
import { websiteDocument } from "@/lib/generation/website-document";

export function escapeSiteText(value: string) {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Static publication: generated designs use the same sanitised renderer as
 * preview/download. Outline-only legacy documents retain their trusted renderer.
 */
export function renderHostedSite(contentInput: unknown, styleInput: unknown, url: string, artwork: ReadonlyMap<string, string>) {
  const content = ArtifactContentSchema.parse(contentInput);
  if (content.kind !== "website") throw new Error("Only websites can be published here.");
  if (content.websiteSource) throw new Error("Full-source websites require a verified isolated build before publication.");
  if (content.website) return websiteDocument(content.title, content.website, false, url);
  const style = StyleProfileSchema.parse(styleInput);
  if (!content.sections.length || content.sections.length > 40 || content.sections.flatMap(s => s.blocks).length > 150) throw new Error("Publish a website with 1–40 sections and at most 150 blocks.");
  if (!content.sections.some(s => s.blocks.some(b => b.text.trim() || b.assetId))) throw new Error("Add website content before publishing.");
  const e = escapeSiteText;
  const accent = style.colors.accent ?? "#3358d4", canvas = style.colors.canvas ?? "#faf9f6", ink = style.colors.ink ?? "#191b23";
  const heading = /serif|georgia/i.test(style.typography.headingFont) ? "Georgia,serif" : "Arial,Helvetica,sans-serif";
  const description = content.sections.flatMap(s => s.blocks).find(b => b.type === "paragraph" && b.text.trim())?.text.slice(0,160) ?? content.title;
  const sections = content.sections.map((section, index) => `<section id="section-${index + 1}" class="site-section"><h2>${e(section.title)}</h2>${section.blocks.map(block => {
    if (block.type === "image") {
      const image = block.assetId ? artwork.get(block.assetId) : null;
      if (!image || !/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(image)) throw new Error("An image is missing. Replace it before publishing.");
      return `<figure><img src="${image}" alt="${e(block.text)}" loading="lazy" decoding="async">${block.text ? `<figcaption>${e(block.text)}</figcaption>` : ""}</figure>`;
    }
    if (block.assetId || ["chart", "table"].includes(block.type)) throw new Error("This website includes a block that the static publisher cannot preserve yet.");
    if (block.type === "heading") return `<h3>${e(block.text)}</h3>`;
    if (block.type === "quote") return `<blockquote>${e(block.text)}</blockquote>`;
    if (block.type === "list") return `<ul>${block.text.split(/\r?\n/).filter(Boolean).map(t => `<li>${e(t)}</li>`).join("")}</ul>`;
    return `<p${block.type === "callout" ? ' class="callout"' : ""}>${e(block.text)}</p>`;
  }).join("")}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(content.title)}</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${e(url)}"><meta property="og:title" content="${e(content.title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(url)}"><meta property="og:type" content="website"><style>
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{--artifact-accent:${accent};margin:0;background:${canvas};color:${ink};font:17px/1.75 Arial,Helvetica,sans-serif}a{color:inherit;text-decoration:none}a:focus-visible{outline:3px solid ${accent};outline-offset:5px}.skip{position:absolute;left:-9999px}.skip:focus{left:20px;top:10px;background:${canvas};padding:12px}.site-nav{max-width:1200px;margin:auto;padding:28px 6%;display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid color-mix(in srgb,${ink} 15%,transparent)}.site-nav nav{display:flex;gap:20px;font-size:13px}.site-hero{max-width:1200px;margin:auto;padding:clamp(60px,10vw,150px) 6% 60px}.site-hero h1{max-width:16ch;font-size:clamp(40px,7vw,88px);line-height:1.04;letter-spacing:-.055em;margin:0}.site-hero p{max-width:54ch;margin:24px 0 0;opacity:.8}h1,h2,h3{font-family:${heading}}.site-section{max-width:1200px;margin:auto;padding:48px 6%;border-top:1px solid color-mix(in srgb,${ink} 15%,transparent)}h2{font-size:clamp(27px,4vw,44px);line-height:1.15;letter-spacing:-.035em}h3{font-size:25px;line-height:1.3}p,blockquote,li{white-space:pre-wrap;overflow-wrap:anywhere}p{max-width:70ch}blockquote,.callout{border-left:3px solid ${accent};padding:16px 24px;margin:28px 0}figure{margin:32px 0}img{display:block;max-width:100%;height:auto;border-radius:12px}figcaption{font-size:13px;opacity:.7;margin-top:12px}.site-footer{padding:30px 6%;max-width:1200px;margin:auto;font-size:12px;opacity:.65} @media(max-width:600px){.site-nav{display:block}.site-nav nav{margin-top:16px;flex-wrap:wrap}.site-section{padding-top:34px;padding-bottom:34px}} @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  ${artifactDesignCss(style.id,"website")}</style></head><body><a class="skip" href="#main">Skip to content</a><header class="site-nav"><a href="#main"><strong>${e(content.title)}</strong></a><nav aria-label="Page sections">${content.sections.slice(0,6).map((s,i)=>`<a href="#section-${i+1}">${e(s.title || `Section ${i+1}`)}</a>`).join("")}</nav></header><main id="main"><div class="site-hero"><h1>${e(content.title)}</h1><p>${e(description)}</p></div>${sections}</main><footer class="site-footer">Published with <a href="https://makeborne.com" rel="noopener noreferrer">Makeborne</a></footer></body></html>`;
}
