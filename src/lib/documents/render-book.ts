import type { Book } from "./schema";
import { FONTS, contrast, mix, motifOf, readableOn } from "./theme";
import { fontFaceCss, type FontSources } from "./fonts";
import { bodyHtml, checkItem, inlineHtml, noteBlocks, parseBookMarkup, plainText, type BookBlock } from "./book-markup";
import { esc } from "./chart-svg";
import type { ImageMap } from "./render-deck";
import { authoredBookCover } from "./render-book-cover";
import { estimateLines } from "./slide-scene";

/** 6 × 9 in trim with a wider inside (gutter) margin. */
export const BOOK_TRIM = { width: 6, height: 9, top: 0.75, bottom: 0.85, inside: 0.82, outside: 0.62 } as const;
/** CSS string literal that can never close the surrounding <style> element. */
const cssString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\00003C").replace(/>/g, "\\00003E").replace(/[\n\r]+/g, " ")}"`;
const ordinal = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
/** The chapter's number among the numbered chapters: an Introduction or Appendix with its own label takes no number. */
export const chapterNumber = (book: Pick<Book, "chapters">, index: number) => book.chapters.slice(0, index + 1).filter(chapter => chapter.label === undefined).length;
export const chapterLabel = (book: Book, index: number) => { const n = chapterNumber(book, index); return book.chapters[index].label ?? `Chapter ${ordinal[n - 1] ?? n}`; };
/** Print pagination measured from a first PDF pass (export-server.ts): each chapter's first page, and the chapters whose opener needs a blank page before it to fall on a right-hand page. */
export type BookPages = { chapters: Record<string, number>; blankBefore: string[] };

/** Cells wrap anywhere so no table is wider than the page, but auto layout would then
 * hand one long cell nearly all the width. Each column instead keeps room for its
 * longest ordinary word (up to 12 characters), scaled down when the columns can't
 * all fit the 4.56 in text block. Widths are in points. */
function tableColumnMinimums(rows: string[][]) {
  const columns = Math.max(...rows.map(row => row.length));
  const longest = Array.from({ length: columns }, (_, column) => Math.min(12, Math.max(0, ...rows.map(row =>
    Math.max(0, ...plainText(row[column] ?? "").split(/[\s\-–—/]+/).map(word => word.length))))));
  // Header capitals (7pt, tracked) and body text (8.6pt) both run about 5pt per character.
  // Header capitals are tracked and bold, so they need a little more room per character than body text.
  const headerLongest = Array.from({ length: columns }, (_, column) => Math.min(12, Math.max(0, ...plainText(rows[0]?.[column] ?? "").split(/[\s\-–—/]+/).map(word => word.length))));
  const wanted = longest.map((chars, column) => Math.max(chars * 5, headerLongest[column] * 5.8)), padding = 10, available = (BOOK_TRIM.width - BOOK_TRIM.inside - BOOK_TRIM.outside) * 72 * 0.94;
  const total = wanted.reduce((sum, width) => sum + width + padding, 0);
  const scale = total > available ? Math.max(0, (available - columns * padding) / wanted.reduce((sum, width) => sum + width, 0)) : 1;
  // Cells are border-box, so the minimum includes the cell padding the total already reserved;
  // without it a tracked header such as "ACCOUNT" broke mid-word.
  return wanted.map(width => Math.floor(width * scale + padding));
}

/** Body type size: fixed for readability; a length target is never met by shrinking it (book-pagination.ts BOOK LENGTH RULE). */
export const BODY_TYPE_PT = 10.6;
/** A drop cap needs a paragraph long enough to wrap around it. */
const LEAD_MIN_CHARS = 180;
const RUN_IN = /^\*\*[^*\n]{1,80}\*\*[:.]?$/;
/** Tables up to this many body rows are kept on one page. */
const KEEP_TABLE_ROWS = 10;
const linesHtml = (text: string) => text.split("\n").map(line => bodyHtml(line)).join("<br>");
/** Lists; "[ ] item" / "[x] item" entries render as a checklist with boxes. */
function listHtml(ordered: boolean, items: string[], start?: number) {
  const checks = items.map(checkItem), checklist = checks.every(Boolean);
  const li = (item: string, index: number) => { const check = checks[index]; return check ? `<li class="check${check.done ? " done" : ""}"><span class="box" aria-hidden="true">${check.done ? "☑" : "☐"}</span>${bodyHtml(check.text)}</li>` : `<li>${bodyHtml(item)}</li>`; };
  if (checklist) return `<ul class="checklist">${items.map(li).join("")}</ul>`;
  return ordered ? `<ol${start ? ` start="${start}"` : ""}>${items.map(li).join("")}</ol>` : `<ul>${items.map(li).join("")}</ul>`;
}
function blockHtml(block: BookBlock, book: Book, images: ImageMap, lead = false) {
  switch (block.type) {
    // A short all-bold paragraph is a run-in subhead: it stays with the text it introduces.
    case "paragraph": return `<p${lead ? ' class="lead"' : RUN_IN.test(block.text) ? ' class="runin"' : ""}>${bodyHtml(block.text)}</p>`;
    case "subheading": return `<h3>${bodyHtml(block.text)}</h3>`;
    case "quote": return `<blockquote>${block.text.split(/\n{2,}/).map(paragraph => `<p>${linesHtml(paragraph)}</p>`).join("")}${block.attribution ? `<span class="attr">\u2014 ${bodyHtml(block.attribution)}</span>` : ""}</blockquote>`;
    case "list": return listHtml(block.ordered, block.items, block.start);
    case "table": {
      const widths = tableColumnMinimums(block.header ? [block.header, ...block.rows] : block.rows);
      const cells = (row: string[], tag: "th" | "td") => `<tr>${row.map((cell, column) => `<${tag}${widths[column] ? ` style="min-width:${widths[column]}pt"` : ""}>${bodyHtml(cell)}</${tag}>`).join("")}</tr>`;
      // A short table stays whole; a long one breaks between rows and repeats its header row on the next page.
      return `<div class="table${block.rows.length > KEEP_TABLE_ROWS ? " long" : ""}"><table>${block.header ? `<thead>${cells(block.header, "th")}</thead>` : ""}<tbody>${block.rows.map(row => cells(row, "td")).join("")}</tbody></table></div>`;
    }
    case "break": return `<div class="break" aria-hidden="true">\u25C6\u2003\u25C6\u2003\u25C6</div>`;
    case "note": return `<aside class="note">${block.title ? `<strong>${bodyHtml(block.title)}</strong>` : ""}${noteBlocks(block.text).map(part => part.type === "list" ? listHtml(part.ordered, part.items) : `<p>${part.lines.map(line => bodyHtml(line)).join("<br>")}</p>`).join("")}</aside>`;
    case "pullquote": return `<aside class="pullquote"><p>${bodyHtml(block.text)}</p>${block.attribution ? `<span>— ${bodyHtml(block.attribution)}</span>` : ""}</aside>`;
    case "figure": {
      const src = images[block.image], alt = book.assets.find(asset => asset.name === block.image)?.alt ?? block.caption ?? "";
      return `<figure>${src ? `<img src="${esc(src)}" alt="${esc(alt)}">` : `<div class="ph">${esc(alt || block.image)}</div>`}${block.caption ? `<figcaption>${bodyHtml(block.caption)}</figcaption>` : ""}</figure>`;
    }
  }
}

/** Contents geometry in points. Pages have a fixed height, so entries are packed by
 * their estimated wrapped height (deliberately generous) rather than by count. */
const CONTENTS = {
  // Less the page-number column (.contents .pg), so numbered and unnumbered contents paginate alike.
  width: (BOOK_TRIM.width - 2 * (BOOK_TRIM.outside + 0.1) - 0.42) * 72,
  roomy: { list: (BOOK_TRIM.height - 1.35 - 1 - 0.5) * 72, title: 12.5, label: 7, pad: 0.22 * 72 + 0.04 * 72 + 1 },
  compact: { list: (BOOK_TRIM.height - 1 - 1 - 0.36) * 72, title: 10.5, label: 6.5, pad: 0.13 * 72 + 1, labelWidth: 1.25 * 72, gap: 0.14 * 72 },
  lineHeight: 1.3, fill: 0.95,
};
/** Body labels are uppercase and tracked .18em; 0.6 covers the widest body face (Verdana). */
const LABEL_CHAR = 0.6 * 1.18 + 0.18;

function paginateContents(book: Book) {
  if (book.chapters.length < 2) return { compact: false, pages: [] as number[][] };
  const heading = FONTS[book.theme.fonts].width * 0.85;
  const lines = (text: string, width: number, size: number, char: number) => estimateLines(text, width, size, char);
  const height = (index: number, compact: boolean) => {
    const title = plainText(book.chapters[index].title), label = chapterLabel(book, index), C = CONTENTS, L = C.lineHeight;
    if (!compact) return C.roomy.pad + lines(label, C.width, C.roomy.label, LABEL_CHAR) * C.roomy.label * L + lines(title, C.width, C.roomy.title, heading) * C.roomy.title * L;
    const titleWidth = C.width - C.compact.labelWidth - C.compact.gap;
    return C.compact.pad + Math.max(lines(label, C.compact.labelWidth, C.compact.label, LABEL_CHAR) * C.compact.label * L, lines(title, titleWidth, C.compact.title, heading) * C.compact.title * L);
  };
  const pack = (compact: boolean) => {
    const limit = (compact ? CONTENTS.compact.list : CONTENTS.roomy.list) * CONTENTS.fill, pages: number[][] = [[]];
    let used = 0;
    book.chapters.forEach((_, index) => {
      const h = height(index, compact);
      if (used + h > limit && pages[pages.length - 1].length) { pages.push([]); used = 0; }
      pages[pages.length - 1].push(index); used += h;
    });
    return pages;
  };
  // Roomy rows when the whole contents fits one page; otherwise compact rows over as many pages as needed.
  const roomy = pack(false);
  return roomy.length === 1 ? { compact: false, pages: roomy } : { compact: true, pages: pack(true) };
}

/** `fonts` maps embedded faces to data: URLs where the page cannot fetch same-origin files (the PDF printer). */
export function bookHtml(book: Book, images: ImageMap, mode: "preview" | "print" = "preview", fontSources?: FontSources, pages?: BookPages) {
  const fonts = FONTS[book.theme.fonts], p = book.theme.palette, motif = motifOf(book.theme);
  const coverArt = book.cover.image ? images[book.cover.image] : undefined;
  const coverInk = coverArt ? "#FFFFFF" : readableOn(p.dark, p.background, "#FFFFFF");
  // Typographic covers per motif; "orbit" keeps the original disc and ring.
  const coverMarks = motif === "grid" ? `<div class="m-rule top"></div><div class="m-rule bottom"></div><div class="m-square"></div>`
    : motif === "band" ? `<div class="m-band"></div>` : motif === "frame" ? `<div class="m-frame"></div>` : motif === "quiet" ? "" : `<div class="disc"></div><div class="ring"></div>`;
  const cover = book.cover.composition ? authoredBookCover(book, images) : `<section class="full cover${coverArt ? " has-art" : ""}${coverArt || motif === "orbit" ? "" : ` motif-${motif}`}">
${coverArt ? `<img class="cover-art" src="${esc(coverArt)}" alt="${esc(book.assets.find(asset => asset.name === book.cover.image)?.alt ?? "")}"><div class="scrim"></div>` : coverMarks}
<div class="cover-top">${book.cover.tagline ? `<p class="tagline">${inlineHtml(book.cover.tagline)}</p>` : ""}<h1>${inlineHtml(book.title)}</h1>${book.subtitle ? `<p class="subtitle">${inlineHtml(book.subtitle)}</p>` : ""}</div>
${book.author ? `<p class="cover-author">${inlineHtml(book.author)}</p>` : ""}</section>`;
  const titlePage = `<section class="full front title-page"><div><h2>${inlineHtml(book.title)}</h2>${book.subtitle ? `<p class="subtitle">${inlineHtml(book.subtitle)}</p>` : ""}<div class="rule"></div>${book.author ? `<p class="by">${inlineHtml(book.author)}</p>` : ""}</div></section>`;
  const year = new Date().getFullYear();
  const rights = `<section class="full front rights">${book.dedication ? `<p class="dedication">${inlineHtml(book.dedication)}</p>` : "<span></span>"}<div class="legal"><p>Copyright \u00A9 ${year}${book.author ? ` ${esc(book.author)}` : ""}. All rights reserved.</p><p>Designed and typeset with Makeborne.</p></div></section>`;
  const toc = paginateContents(book);
  // Page numbers only where a measured print pass supplied them (the preview has no pages).
  const pageOf = (index: number) => { const page = mode === "print" ? pages?.chapters[book.chapters[index].id] : undefined; return page ? `<b class="pg">${page}</b>` : ""; };
  const contents = toc.pages.map((entries, page) => `<section class="full front contents${toc.compact ? " compact" : ""}"><h2>${page ? "Contents, continued" : "Contents"}</h2><ol start="${entries[0] + 1}">${entries.map(index => `<li><a href="#chapter-${esc(book.chapters[index].id)}"><span>${esc(chapterLabel(book, index))}</span>${pageOf(index)}${inlineHtml(book.chapters[index].title)}</a></li>`).join("")}</ol></section>`).join("");
  const chapters = book.chapters.map((chapter, index) => {
    const art = chapter.image ? images[chapter.image] : undefined;
    const inline = chapter.opening === "inline";
    const artwork = chapter.image ? art ? `<img class="opener-art" src="${esc(art)}" alt="${esc(book.assets.find(asset => asset.name === chapter.image)?.alt ?? "")}">` : `<div class="opener-art ph">${esc(chapter.image)}</div>` : "";
    const heading = `<p class="label">${esc(chapterLabel(book, index))}</p><h2>${inlineHtml(chapter.title)}</h2>${chapter.epigraph ? `<blockquote class="epigraph"><p>${inlineHtml(chapter.epigraph.text)}</p>${chapter.epigraph.attribution ? `<span>\u2014 ${inlineHtml(chapter.epigraph.attribution)}</span>` : ""}</blockquote>` : ""}`;
    const opener = inline ? `<header class="inline-opener">${artwork}${heading}</header>` : `<section class="full opener${chapter.image ? " has-art" : ""}${chapter.label !== undefined ? " custom-label" : ""}" id="chapter-${esc(chapter.id)}">
${artwork || (chapter.label === undefined ? `<div class="numeral">${chapterNumber(book, index)}</div>` : "")}
<div class="opener-text">${heading}</div></section>`;
    const blocks = parseBookMarkup(chapter.text);
    const body = blocks.length ? blocks.map((block, at) => blockHtml(block, book, images, at === 0 && block.type === "paragraph" && block.text.length >= LEAD_MIN_CHARS)).join("") : `<p class="pending">This chapter is being written\u2026</p>`;
    const head = mode === "preview" ? `<div class="runhead"><span>${esc(book.title)}</span><span>${esc(chapter.title)}</span></div>` : "";
    // A recto opener: a blank verso goes before an opener that would otherwise land on a left-hand page.
    const blank = mode === "print" && !inline && pages?.blankBefore.includes(chapter.id) ? `<section class="full blank" aria-hidden="true"></section>` : "";
    return `${blank}${inline ? "" : opener}<section class="chapter"${inline ? ` id="chapter-${esc(chapter.id)}"` : ""} style="page:ch-${index}">${head}${inline ? opener : ""}${body}</section>`;
  }).join("");
  const empty = !book.chapters.length ? `<section class="full front waiting"><p>Chapters appear here as they are written.</p></section>` : "";

  const T = BOOK_TRIM, muted = p.muted;
  const runningHeads = book.chapters.map((chapter, index) => `@page ch-${index}:right{@top-right{content:${cssString(chapter.title.length > 60 ? `${chapter.title.slice(0, 58)}…` : chapter.title)}}}`).join("");
  const marginBox = `font-family:${fonts.body};font-size:7pt;letter-spacing:.14em;text-transform:uppercase;color:${muted};vertical-align:bottom;padding-bottom:.18in`;
  const folio = `font-family:${fonts.body};font-size:8.5pt;color:${muted};vertical-align:top;padding-top:.22in`;
  const none = "@top-left{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-right{content:none}";
  const bandInk = readableOn(p.accent, "#FFFFFF", "#111111");
  // Small labels (7–8 pt) need 4.5:1; the brand accent may only reach 3:1, so they take a deeper form of the same hue.
  const smallAccent = (bg: string) => [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1].map(amount => mix(p.accent, p.ink, amount)).find(value => contrast(value, bg) >= 4.5) ?? p.ink;
  const labelInk = smallAccent(p.background), noteInk = smallAccent(p.surface);
  const shared = `${fontFaceCss(fonts.faces, fontSources)}*{box-sizing:border-box}html,body{margin:0}
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
.motif-grid{justify-content:flex-end;padding:.95in .6in .7in}.motif-grid .cover-top{margin-bottom:auto;order:0}.motif-grid h1{font-size:44pt;line-height:.98;max-width:4.8in;margin-top:2.1in}
.m-rule{position:absolute;left:.6in;right:.6in;height:1pt;background:${mix(coverInk, p.dark, 0.6)}}.m-rule.top{top:.7in}.m-rule.bottom{bottom:1.05in}.m-square{position:absolute;left:.6in;top:.9in;width:.2in;height:.2in;background:${p.accent}}
.motif-grid .cover-top{padding-top:.3in}.motif-grid .cover-author{padding-top:.18in}
.motif-band .m-band{position:absolute;left:0;right:0;bottom:0;height:2.2in;background:${p.accent}}.motif-band .cover-author{color:${bandInk}}.motif-band h1{font-size:42pt;max-width:4.8in;margin-top:2.6in}
.motif-frame{align-items:center;text-align:center;justify-content:center;gap:.5in}.motif-frame .m-frame{position:absolute;inset:.32in;border:1pt solid ${mix(coverInk, p.dark, 0.55)}}.motif-frame h1,.motif-frame .subtitle{margin-left:auto;margin-right:auto}.motif-frame h1{font-size:38pt}.motif-frame .cover-top::after{content:"";display:block;width:.5in;height:1.5pt;background:${p.accent};margin:.3in auto 0}
.motif-quiet{justify-content:center;gap:.6in}.motif-quiet h1{font-size:46pt;line-height:.98;max-width:4.9in}
.front{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1in ${T.outside + 0.1}in;text-align:center}
.title-page h2{font-family:${fonts.heading};font-weight:${fonts.headingWeight};font-size:27pt;line-height:1.08;letter-spacing:${fonts.headingTracking};margin:0;text-wrap:balance}
.title-page .subtitle{font-family:${fonts.heading};font-style:italic;font-size:12pt;color:${muted};margin:.18in 0 0}
.rule{width:.5in;height:1.5pt;background:${p.accent};margin:.34in auto}
.by{font-size:9pt;letter-spacing:.24em;text-transform:uppercase;margin:0}
.rights{justify-content:space-between;padding-top:2.2in;padding-bottom:.9in}
.dedication{font-family:${fonts.heading};font-style:italic;font-size:11.5pt;line-height:1.55;max-width:3.6in;margin:0}
.legal{font-size:7.5pt;line-height:1.6;color:${muted}}.legal p{margin:0}
.contents{justify-content:flex-start;align-items:stretch;text-align:left;padding-top:1.35in}
.contents h2{font-family:${fonts.body};font-size:8pt;letter-spacing:.26em;text-transform:uppercase;color:${labelInk};margin:0 0 .36in;font-weight:700}
.contents ol{list-style:none;margin:0;padding:0}.contents li{overflow-wrap:anywhere;font-family:${fonts.heading};font-size:12.5pt;line-height:1.3;padding:.11in 0;border-bottom:.5pt solid ${mix(muted, p.background, 0.6)}}
.contents a{display:block;color:inherit;text-decoration:none}.contents a:focus-visible{outline:2px solid ${p.accent};outline-offset:3px}
.contents.compact{padding-top:1in}.contents.compact h2{margin-bottom:.24in}.contents.compact li{font-size:10.5pt;padding:.065in 0}.contents.compact li a{display:flex;align-items:baseline;gap:.14in}
.contents.compact li span{display:inline;flex:none;width:1.25in;margin:0;font-size:6.5pt}
.contents .pg{float:right;margin-left:.2in;font-family:${fonts.body};font-size:9pt;font-weight:400;font-variant-numeric:tabular-nums;color:${muted};line-height:inherit}
.contents.compact .pg{float:none;order:3;margin-left:auto;padding-left:.16in}
.blank{background:${p.background}}
.contents li span{display:block;font-family:${fonts.body};font-size:7pt;letter-spacing:.18em;text-transform:uppercase;color:${muted};margin-bottom:.04in}
.opener{display:flex;flex-direction:column}
.opener-art{width:100%;height:56%;object-fit:cover;display:block;flex:none}
.opener .numeral{font-family:${fonts.heading};font-size:76pt;line-height:1;color:${p.accent};padding:2in ${T.outside}in 0 ${T.inside}in}
.opener-text{padding:.42in ${T.outside}in 0 ${T.inside}in}
.opener:not(.has-art) .opener-text{padding-top:.2in}
.opener.custom-label:not(.has-art) .opener-text{padding-top:2in}
.opener .label{font-size:7.5pt;letter-spacing:.26em;text-transform:uppercase;color:${labelInk};font-weight:700;margin:0 0 .14in}
.opener h2{font-family:${fonts.heading};font-weight:${fonts.headingWeight};font-size:23pt;line-height:1.1;letter-spacing:${fonts.headingTracking};margin:0;text-wrap:balance;overflow-wrap:anywhere}
.inline-opener{margin:0 0 .28in;text-align:left;break-inside:avoid;break-after:avoid}
.inline-opener .label{font-size:7.5pt;letter-spacing:.26em;text-transform:uppercase;color:${labelInk};font-weight:700;margin:0 0 .14in;text-indent:0}
.inline-opener h2{font-family:${fonts.heading};font-weight:${fonts.headingWeight};font-size:23pt;line-height:1.1;letter-spacing:${fonts.headingTracking};margin:0;text-wrap:balance;overflow-wrap:anywhere}
.inline-opener .opener-art{height:2in;margin-bottom:.24in}.inline-opener .epigraph{margin:.2in 0 0}.inline-opener .epigraph p{text-indent:0}
.epigraph{margin:.3in 0 0;max-width:3.7in;font-family:${fonts.heading};font-style:italic;font-size:9.5pt;line-height:1.5;color:${muted}}.epigraph p{margin:0}
.epigraph span{display:block;font-style:normal;font-family:${fonts.body};font-size:7pt;letter-spacing:.16em;text-transform:uppercase;margin-top:.08in}
.chapter{font-size:${BODY_TYPE_PT}pt;line-height:1.52;text-align:justify;overflow-wrap:break-word;hyphens:auto;-webkit-hyphens:auto;orphans:3;widows:3;hanging-punctuation:first}
.chapter p{margin:0;text-indent:1.35em}
.chapter>p:first-of-type,.chapter h3+p,.chapter .break+p,.chapter figure+p,.chapter blockquote+p,.chapter ul+p,.chapter .table+p,.chapter ol+p,.chapter .note+p,.chapter .runhead+p{text-indent:0}
.chapter>p.lead::first-letter{initial-letter:3;-webkit-initial-letter:3;font-family:${fonts.heading};color:${p.accent};margin-right:.07em;font-weight:${fonts.headingWeight}}
.chapter>p.lead::first-line{font-variant-caps:small-caps;letter-spacing:.04em}
/* A hyphen inside the small-caps first line reads as a typo; the lead paragraph is set without hyphenation. */
.chapter>p.lead{hyphens:manual;-webkit-hyphens:manual}
.chapter h3{font-family:${fonts.heading};font-weight:${fonts.headingWeight};font-size:13pt;line-height:1.25;text-align:left;margin:1.6em 0 .55em;break-after:avoid;break-inside:avoid;color:${p.ink}}
.chapter h3+p,.chapter h3+ul,.chapter h3+ol,.chapter .runin+*{break-before:avoid}
.chapter p.runin{break-after:avoid;break-inside:avoid;text-indent:0;margin-top:.5em}
.chapter h3::before{content:"";display:block;width:.3in;height:1.25pt;background:${p.accent};margin:0 0 .5em}
.chapter blockquote{margin:1em 0 1em .2em;padding-left:.95em;border-left:1.5pt solid ${mix(p.accent, p.background, 0.45)};font-style:italic;text-align:left}.chapter blockquote p{text-indent:0}
.pullquote{margin:1.5em .3in;padding:.85em 0;border-top:1pt solid ${p.accent};border-bottom:1pt solid ${p.accent};text-align:center;break-inside:avoid;text-indent:0}
.pullquote p{font-family:${fonts.heading};font-weight:${fonts.headingWeight};font-size:15.5pt;line-height:1.28;color:${p.ink};margin:0;text-indent:0;text-wrap:balance;hyphens:manual}
.pullquote span{display:block;font-size:7pt;letter-spacing:.18em;text-transform:uppercase;color:${muted};margin-top:.7em}
.chapter .pullquote+p{text-indent:0}
.chapter blockquote .attr{display:block;font-style:normal;font-size:7.5pt;letter-spacing:.16em;text-transform:uppercase;color:${muted};margin-top:.35em;text-align:right}
.break{text-align:center;color:${p.accent};font-size:6pt;margin:1.1em 0;text-indent:0;break-after:avoid}
.chapter figure{margin:1.2em 0;break-inside:avoid;text-align:center}
.chapter figure img,.chapter figure .ph{width:100%;max-height:4.4in;object-fit:cover;display:block;border-radius:1.5pt}
.chapter figcaption{font-size:8pt;line-height:1.4;font-style:italic;color:${muted};margin-top:.55em;text-align:center}
.chapter ul,.chapter ol{margin:.6em 0 .7em 1.25em;padding:0;text-align:left}.chapter li{margin:.22em 0;break-inside:avoid}
ul.checklist{list-style:none;margin-left:1.5em}li.check{position:relative}li.check .box{position:absolute;left:-1.35em;top:-.05em;color:${p.accent};font-size:1.1em;line-height:1.3}
/* Ordered markers can contain three digits; keep them inside the clipped page. */
.chapter ol{margin-left:2.75em}
.note{background:${p.surface};border-left:2.5pt solid ${p.accent};padding:.75em .95em;margin:1em 0;font-size:9.4pt;line-height:1.45;text-align:left;break-inside:avoid}
.note strong{display:block;font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase;color:${noteInk};margin-bottom:.3em}.note p{text-indent:0}.note p+p,.note ul+p,.note ol+p{margin-top:.45em}
.chapter .note ul,.chapter .note ol{margin:.35em 0 .35em 1.15em}.chapter .note ol{margin-left:1.6em}.chapter .note ul.checklist{margin-left:1.4em}.note li{margin:.12em 0}
.ph{display:flex;align-items:center;justify-content:center;min-height:2in;background:repeating-linear-gradient(135deg,${mix(p.surface, p.muted, 0.12)} 0 10px,${p.surface} 10px 20px);color:${muted};font-size:9pt}
.chapter .table{margin:1em 0;break-inside:avoid;text-align:left}
/* Long tables break between rows (never inside one) and repeat the header row; a whole-table keep left pages empty. */
.chapter .table.long{break-inside:auto}.chapter thead{display:table-header-group}.chapter tr{break-inside:avoid}
.chapter table{width:100%;max-width:100%;border-collapse:collapse;font-size:8.6pt;line-height:1.4;font-variant-numeric:tabular-nums}
.chapter th{font-family:${fonts.body};font-size:7pt;letter-spacing:.12em;text-transform:uppercase;color:${labelInk};font-weight:700;text-align:left;padding:.4em .55em;border-bottom:1pt solid ${p.accent}}
.chapter th,.chapter td{overflow-wrap:anywhere}
.chapter td{padding:.42em .55em;border-bottom:.5pt solid ${mix(muted, p.background, 0.6)};vertical-align:top}
.chapter tbody tr:last-child td{border-bottom:none}
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
.runhead span{min-width:0;overflow-wrap:anywhere}.runhead span:last-child{text-align:right}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(book.title)}</title><style>${css}</style></head><body>${cover}${titlePage}${rights}${contents}${chapters}${empty}</body></html>`;
}
