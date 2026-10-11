import type { Book } from "./schema";
import { FONTS, mix, readableOn } from "./theme";
import { inlineHtml, parseBookMarkup, type BookBlock } from "./book-markup";
import { esc } from "./chart-svg";
import type { ImageMap } from "./render-deck";

/** 6 × 9 in trim with a wider inside (gutter) margin. */
export const BOOK_TRIM = { width: 6, height: 9, top: 0.75, bottom: 0.85, inside: 0.82, outside: 0.62 } as const;
/** CSS string literal that can never close the surrounding <style> element. */
const cssString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\00003C").replace(/>/g, "\\00003E").replace(/[\n\r]+/g, " ")}"`;
const ordinal = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
export const chapterLabel = (book: Book, index: number) => book.chapters[index].label ?? `Chapter ${ordinal[index] ?? index + 1}`;

function blockHtml(block: BookBlock, book: Book, images: ImageMap) {
  switch (block.type) {
    case "paragraph": return `<p>${inlineHtml(block.text)}</p>`;
    case "subheading": return `<h3>${inlineHtml(block.text)}</h3>`;
    case "quote": return `<blockquote><p>${inlineHtml(block.text)}</p>${block.attribution ? `<span class="attr">\u2014 ${inlineHtml(block.attribution)}</span>` : ""}</blockquote>`;
    case "list": return `<${block.ordered ? "ol" : "ul"}>${block.items.map(item => `<li>${inlineHtml(item)}</li>`).join("")}</${block.ordered ? "ol" : "ul"}>`;
    case "break": return `<div class="break" aria-hidden="true">\u25C6\u2003\u25C6\u2003\u25C6</div>`;
    case "note": return `<aside class="note">${block.title ? `<strong>${inlineHtml(block.title)}</strong>` : ""}<p>${inlineHtml(block.text)}</p></aside>`;
    case "figure": {
      const src = images[block.image], alt = book.assets.find(asset => asset.name === block.image)?.alt ?? block.caption ?? "";
      return `<figure>${src ? `<img src="${esc(src)}" alt="${esc(alt)}">` : `<div class="ph">${esc(alt || block.image)}</div>`}${block.caption ? `<figcaption>${inlineHtml(block.caption)}</figcaption>` : ""}</figure>`;
    }
  }
}

export function bookHtml(book: Book, images: ImageMap, mode: "preview" | "print" = "preview") {
  const fonts = FONTS[book.theme.fonts], p = book.theme.palette;
  const coverArt = book.cover.image ? images[book.cover.image] : undefined;
  const coverInk = coverArt ? "#FFFFFF" : readableOn(p.dark, p.background, "#FFFFFF");
  const cover = `<section class="full cover${coverArt ? " has-art" : ""}">
${coverArt ? `<img class="cover-art" src="${esc(coverArt)}" alt="${esc(book.assets.find(asset => asset.name === book.cover.image)?.alt ?? "")}"><div class="scrim"></div>` : `<div class="disc"></div><div class="ring"></div>`}
<div class="cover-top">${book.cover.tagline ? `<p class="tagline">${inlineHtml(book.cover.tagline)}</p>` : ""}<h1>${inlineHtml(book.title)}</h1>${book.subtitle ? `<p class="subtitle">${inlineHtml(book.subtitle)}</p>` : ""}</div>
${book.author ? `<p class="cover-author">${inlineHtml(book.author)}</p>` : ""}</section>`;
  const titlePage = `<section class="full front title-page"><div><h2>${inlineHtml(book.title)}</h2>${book.subtitle ? `<p class="subtitle">${inlineHtml(book.subtitle)}</p>` : ""}<div class="rule"></div>${book.author ? `<p class="by">${inlineHtml(book.author)}</p>` : ""}</div></section>`;
  const year = new Date().getFullYear();
  const rights = `<section class="full front rights">${book.dedication ? `<p class="dedication">${inlineHtml(book.dedication)}</p>` : "<span></span>"}<div class="legal"><p>Copyright \u00A9 ${year}${book.author ? ` ${esc(book.author)}` : ""}. All rights reserved.</p><p>Designed and typeset with Makeborne.</p></div></section>`;
  const contents = book.chapters.length > 1 ? `<section class="full front contents"><h2>Contents</h2><ol>${book.chapters.map((chapter, index) => `<li><span>${esc(chapterLabel(book, index))}</span>${inlineHtml(chapter.title)}</li>`).join("")}</ol></section>` : "";
  const chapters = book.chapters.map((chapter, index) => {
    const art = chapter.image ? images[chapter.image] : undefined;
    const opener = `<section class="full opener${chapter.image ? " has-art" : ""}" id="chapter-${esc(chapter.id)}">
${chapter.image ? art ? `<img class="opener-art" src="${esc(art)}" alt="${esc(book.assets.find(asset => asset.name === chapter.image)?.alt ?? "")}">` : `<div class="opener-art ph">${esc(chapter.image)}</div>` : `<div class="numeral">${index + 1}</div>`}
<div class="opener-text"><p class="label">${esc(chapterLabel(book, index))}</p><h2>${inlineHtml(chapter.title)}</h2>${chapter.epigraph ? `<blockquote class="epigraph"><p>${inlineHtml(chapter.epigraph.text)}</p>${chapter.epigraph.attribution ? `<span>\u2014 ${inlineHtml(chapter.epigraph.attribution)}</span>` : ""}</blockquote>` : ""}</div></section>`;
    const blocks = parseBookMarkup(chapter.text);
    const body = blocks.length ? blocks.map(block => blockHtml(block, book, images)).join("") : `<p class="pending">This chapter is being written\u2026</p>`;
    const head = mode === "preview" ? `<div class="runhead"><span>${esc(book.title)}</span><span>${esc(chapter.title)}</span></div>` : "";
    return `${opener}<section class="chapter" style="page:ch-${index}">${head}${body}</section>`;
  }).join("");
  const empty = !book.chapters.length ? `<section class="full front waiting"><p>Chapters appear here as they are written.</p></section>` : "";

  const T = BOOK_TRIM, muted = p.muted;
  const runningHeads = book.chapters.map((chapter, index) => `@page ch-${index}:right{@top-right{content:${cssString(chapter.title.length > 60 ? `${chapter.title.slice(0, 58)}…` : chapter.title)}}}`).join("");
  const marginBox = `font-family:${fonts.body};font-size:7pt;letter-spacing:.14em;text-transform:uppercase;color:${muted};vertical-align:bottom;padding-bottom:.18in`;
  const folio = `font-family:${fonts.body};font-size:8.5pt;color:${muted};vertical-align:top;padding-top:.22in`;
  const none = "@top-left{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-right{content:none}";
  const shared = `*{box-sizing:border-box}html,body{margin:0}
body{font-family:${fonts.body};color:${p.ink};-webkit-font-smoothing:antialiased;font-kerning:normal;font-variant-ligatures:common-ligatures}
.full{position:relative;width:${T.width}in;height:${T.height}in;overflow:hidden;background:${p.background}}
.cover{background:${p.dark};color:${coverInk};display:flex;flex-direction:column;justify-content:space-between;padding:.72in .6in .62in}
.cover-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.62) 0%,rgba(0,0,0,.18) 34%,rgba(0,0,0,0) 52%,rgba(0,0,0,.08) 72%,rgba(0,0,0,.6) 100%)}
.disc{position:absolute;width:5.4in;height:5.4in;border-radius:50%;background:${p.accent};right:-2.1in;bottom:1.1in;opacity:.92}
.ring{position:absolute;width:2.6in;height:2.6in;border-radius:50%;border:2pt solid ${p.accent2};left:-.9in;bottom:-.7in}
.cover-top,.cover-author{position:relative}
.cover h1{font-family:${fonts.heading};font-weight:${fonts.headingWeight};font-size:36pt;line-height:1.02;letter-spacing:${fonts.headingTracking};margin:.12in 0 0;max-width:4.6in;text-wrap:balance}
.cover .tagline{font-size:8pt;letter-spacing:.2em;text-transform:uppercase;margin:0;opacity:.92}
.cover .subtitle{font-family:${fonts.heading};font-style:italic;font-size:13pt;line-height:1.3;margin:.16in 0 0;max-width:4.4in;opacity:.95}
.cover-author{font-size:9.5pt;letter-spacing:.24em;text-transform:uppercase;margin:0}
.has-art .cover-top,.has-art .cover-author{text-shadow:0 1px 12px rgba(0,0,0,.35)}
.front{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1in ${T.outside + 0.1}in;text-align:center}
.title-page h2{font-family:${fonts.heading};font-weight:${fonts.headingWeight};font-size:27pt;line-height:1.08;letter-spacing:${fonts.headingTracking};margin:0;text-wrap:balance}
.title-page .subtitle{font-family:${fonts.heading};font-style:italic;font-size:12pt;color:${muted};margin:.18in 0 0}
.rule{width:.5in;height:1.5pt;background:${p.accent};margin:.34in auto}
.by{font-size:9pt;letter-spacing:.24em;text-transform:uppercase;margin:0}
.rights{justify-content:space-between;padding-top:2.2in;padding-bottom:.9in}
.dedication{font-family:${fonts.heading};font-style:italic;font-size:11.5pt;line-height:1.55;max-width:3.6in;margin:0}
.legal{font-size:7.5pt;line-height:1.6;color:${muted}}.legal p{margin:0}
.contents{justify-content:flex-start;align-items:stretch;text-align:left;padding-top:1.35in}
.contents h2{font-family:${fonts.body};font-size:8pt;letter-spacing:.26em;text-transform:uppercase;color:${p.accent};margin:0 0 .36in;font-weight:700}
.contents ol{list-style:none;margin:0;padding:0}.contents li{font-family:${fonts.heading};font-size:12.5pt;line-height:1.3;padding:.11in 0;border-bottom:.5pt solid ${mix(muted, p.background, 0.6)}}
.contents li span{display:block;font-family:${fonts.body};font-size:7pt;letter-spacing:.18em;text-transform:uppercase;color:${muted};margin-bottom:.04in}
.opener{display:flex;flex-direction:column}
.opener-art{width:100%;height:56%;object-fit:cover;display:block;flex:none}
.opener .numeral{font-family:${fonts.heading};font-size:76pt;line-height:1;color:${p.accent};padding:2in ${T.outside}in 0 ${T.inside}in}
.opener-text{padding:.42in ${T.outside}in 0 ${T.inside}in}
.opener:not(.has-art) .opener-text{padding-top:.2in}
.opener .label{font-size:7.5pt;letter-spacing:.26em;text-transform:uppercase;color:${p.accent};font-weight:700;margin:0 0 .14in}
.opener h2{font-family:${fonts.heading};font-weight:${fonts.headingWeight};font-size:23pt;line-height:1.1;letter-spacing:${fonts.headingTracking};margin:0;text-wrap:balance}
.epigraph{margin:.3in 0 0;max-width:3.7in;font-family:${fonts.heading};font-style:italic;font-size:9.5pt;line-height:1.5;color:${muted}}.epigraph p{margin:0}
.epigraph span{display:block;font-style:normal;font-family:${fonts.body};font-size:7pt;letter-spacing:.16em;text-transform:uppercase;margin-top:.08in}
.chapter{font-size:10.6pt;line-height:1.52;text-align:justify;hyphens:auto;-webkit-hyphens:auto;orphans:2;widows:2;hanging-punctuation:first}
.chapter p{margin:0;text-indent:1.35em}
.chapter>p:first-of-type,.chapter h3+p,.chapter .break+p,.chapter figure+p,.chapter blockquote+p,.chapter ul+p,.chapter ol+p,.chapter .note+p,.chapter .runhead+p{text-indent:0}
.chapter>p:first-of-type::first-letter{initial-letter:3;-webkit-initial-letter:3;font-family:${fonts.heading};color:${p.accent};margin-right:.07em;font-weight:${fonts.headingWeight}}
.chapter>p:first-of-type::first-line{font-variant-caps:small-caps;letter-spacing:.04em}
.chapter h3{font-family:${fonts.heading};font-weight:${fonts.headingWeight};font-size:12.5pt;line-height:1.25;text-align:left;margin:1.5em 0 .55em;break-after:avoid;color:${p.ink}}
.chapter blockquote{margin:.9em 1.2em;font-style:italic;text-align:left}.chapter blockquote p{text-indent:0}
.chapter blockquote .attr{display:block;font-style:normal;font-size:7.5pt;letter-spacing:.16em;text-transform:uppercase;color:${muted};margin-top:.35em;text-align:right}
.break{text-align:center;color:${p.accent};font-size:6pt;margin:1.1em 0;text-indent:0;break-after:avoid}
.chapter figure{margin:1.2em 0;break-inside:avoid;text-align:center}
.chapter figure img,.chapter figure .ph{width:100%;max-height:4.4in;object-fit:cover;display:block;border-radius:1.5pt}
.chapter figcaption{font-size:8pt;line-height:1.4;font-style:italic;color:${muted};margin-top:.55em;text-align:center}
.chapter ul,.chapter ol{margin:.6em 0 .7em 1.25em;padding:0;text-align:left}.chapter li{margin:.22em 0}
.note{background:${p.surface};border-left:2.5pt solid ${p.accent};padding:.75em .95em;margin:1em 0;font-size:9.4pt;line-height:1.45;text-align:left;break-inside:avoid}
.note strong{display:block;font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase;color:${p.accent};margin-bottom:.3em}.note p{text-indent:0}
.ph{display:flex;align-items:center;justify-content:center;min-height:2in;background:repeating-linear-gradient(135deg,${mix(p.surface, p.muted, 0.12)} 0 10px,${p.surface} 10px 20px);color:${muted};font-size:9pt}
.pending{color:${muted};font-style:italic}.waiting{color:${muted};font-style:italic}`;
  const css = mode === "print"
    ? `${shared}
@page{size:${T.width}in ${T.height}in;margin:${T.top}in ${T.outside}in ${T.bottom}in ${T.inside}in;background:${p.background}}
@page :left{margin-left:${T.outside}in;margin-right:${T.inside}in;@top-left{content:${cssString(book.title.length > 60 ? `${book.title.slice(0, 58)}…` : book.title)};${marginBox}}@bottom-left{content:counter(page);${folio}}}
@page :right{margin-left:${T.inside}in;margin-right:${T.outside}in;@bottom-right{content:counter(page);${folio}}@top-right{${marginBox}}}
@page full{margin:0;${none}}${runningHeads}
.full{page:full;height:calc(${T.height}in - 1px);break-before:page}.full:first-child{break-before:auto}
.chapter{page-break-before:always}
html,body{background:${p.background}}
.runhead{display:none}`
    : `${shared}
body{background:#E7E5E0;padding:28px 16px 64px}
.full,.chapter{margin:0 auto 26px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 14px 34px rgba(20,20,30,.13)}
.chapter{width:${T.width}in;background:${p.background};padding:${T.top}in ${T.outside}in ${T.bottom}in ${T.inside}in;min-height:3in}
.runhead{display:flex;justify-content:space-between;gap:1em;margin:-.42in 0 .3in;font-size:6.5pt;letter-spacing:.14em;text-transform:uppercase;color:${muted};text-indent:0}
.runhead span:last-child{text-align:right}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(book.title)}</title><style>${css}</style></head><body>${cover}${titlePage}${rights}${contents}${chapters}${empty}</body></html>`;
}
