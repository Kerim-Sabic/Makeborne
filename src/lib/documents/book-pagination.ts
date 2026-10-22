import type { Book } from "./schema";
import type { BookPages } from "./render-book";
import { parseBookMarkup, plainText, smartPunctuation } from "./book-markup";

/** Print pagination for books, measured rather than guessed. Chromium cannot
 * resolve target-counter() (contents page numbers) or honour
 * break-before:right (recto chapter openers), so the PDF exporter prints
 * twice: the first PDF's bookmarks (one per heading, with its page) give each
 * chapter's first page, and the second print adds the contents page numbers
 * and a blank verso before any opener that would fall on a left-hand page.
 * Neither changes how the text flows, so the measured pages hold. */

/** Bookmarks of a Chromium (Skia) PDF in reading order, with 1-based page numbers. */
export function pdfOutline(pdf: Buffer): { title: string; page: number; level: number }[] {
  const text = pdf.toString("latin1").replace(/stream\r?\n[\s\S]*?\r?\nendstream/g, "stream endstream");
  const objects = new Map<number, string>();
  for (const match of text.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) objects.set(Number(match[1]), match[2]);
  const ref = (dict: string | undefined, key: string) => { const m = dict && new RegExp(`/${key} (\\d+) 0 R`).exec(dict); return m ? Number(m[1]) : undefined; };
  const catalog = [...objects.values()].find(dict => /\/Type\s*\/Catalog/.test(dict));
  const pageIndex = new Map<number, number>();
  const walk = (num: number | undefined, depth = 0) => {
    const dict = num === undefined ? undefined : objects.get(num);
    if (!dict || depth > 32) return;
    if (/\/Type\s*\/Pages/.test(dict)) for (const kid of (/\/Kids\s*\[([^\]]*)\]/.exec(dict)?.[1] ?? "").matchAll(/(\d+) 0 R/g)) walk(Number(kid[1]), depth + 1);
    else pageIndex.set(num!, pageIndex.size + 1);
  };
  walk(ref(catalog, "Pages"));
  const out: { title: string; page: number; level: number }[] = [];
  const seen = new Set<number>();
  const visit = (num: number | undefined, level: number) => {
    while (num !== undefined && !seen.has(num) && seen.size < 10_000) {
      seen.add(num);
      const dict = objects.get(num) ?? "";
      const dest = /\/Dest\s*\[\s*(\d+) 0 R/.exec(dict), title = pdfString(dict, "Title");
      if (dest && title !== null && pageIndex.has(Number(dest[1]))) out.push({ title, page: pageIndex.get(Number(dest[1]))!, level });
      visit(ref(dict, "First"), level + 1);
      num = ref(dict, "Next");
    }
  };
  visit(ref(objects.get(ref(catalog, "Outlines") ?? -1), "First"), 1);
  return out;
}

/** A PDF string value (literal or UTF-16 hex) of `/key`. */
function pdfString(dict: string, key: string): string | null {
  const at = dict.indexOf(`/${key}`);
  if (at < 0) return null;
  let i = at + key.length + 1;
  while (dict[i] === " " || dict[i] === "\n" || dict[i] === "\r") i++;
  if (dict[i] === "<") {
    const hex = dict.slice(i + 1, dict.indexOf(">", i)).replace(/\s/g, "");
    const bytes = Buffer.from(hex, "hex");
    return bytes[0] === 0xfe && bytes[1] === 0xff ? Buffer.from(bytes.subarray(2)).swap16().toString("utf16le") : bytes.toString("latin1");
  }
  if (dict[i] !== "(") return null;
  let depth = 0, out = "";
  for (i++; i < dict.length; i++) {
    const c = dict[i];
    if (c === "\\") {
      const next = dict[++i];
      if (/[0-7]/.test(next)) { let oct = next; while (oct.length < 3 && /[0-7]/.test(dict[i + 1])) oct += dict[++i]; out += String.fromCharCode(parseInt(oct, 8)); }
      else out += ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[next] ?? next;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") { if (!depth) break; depth--; }
    out += c;
  }
  return out;
}

const norm = (value: string) => plainText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The headings a book's PDF bookmarks are made from, as written (Chromium takes them from painted text,
 * so a soft line break loses its word space and a text-shadow repeats the title). */
export function bookHeadings(book: Pick<Book, "title" | "chapters">) {
  const out = [book.title, "Contents", "Contents, continued"];
  for (const chapter of book.chapters) {
    out.push(chapter.title);
    for (const block of parseBookMarkup(chapter.text)) if (block.type === "subheading") out.push(smartPunctuation(block.text));
  }
  return out.map(value => plainText(value).replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Rewrite the bookmark titles of a Chromium PDF with the headings as written, then rebuild its
 * cross-reference table. Any structure this does not expect (object or xref streams, incremental
 * updates) leaves the PDF unchanged. */
export function fixPdfBookmarks(pdf: Buffer, headings: string[]): Buffer {
  const text = pdf.toString("latin1");
  if (/\/ObjStm|\/XRefStm|\/Type\s*\/XRef/.test(text) || (text.match(/%%EOF/g) ?? []).length !== 1) return pdf;
  const xrefAt = text.lastIndexOf("\nxref\n"), trailerAt = text.indexOf("trailer", xrefAt);
  if (xrefAt < 0 || trailerAt < 0) return pdf;
  const byNorm = new Map(headings.map(heading => [norm(heading), heading] as const));
  const correct = (title: string) => {
    const n = norm(title);
    if (byNorm.has(n)) return byNorm.get(n)!;
    // A shadowed heading is painted (and bookmarked) twice or more.
    for (const [key, heading] of byNorm) if (key && n.length % key.length === 0 && n.length > key.length && key.repeat(n.length / key.length) === n) return heading;
    return null;
  };
  const hex = (value: string) => `<FEFF${Buffer.from(value, "utf16le").swap16().toString("hex").toUpperCase()}>`;
  let changed = false;
  const body = text.slice(0, xrefAt + 1).replace(/(\d+ 0 obj\s*<<\/Title )(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)(\s*\/Dest)/g, (whole, head: string, value: string, tail: string) => {
    const current = pdfString(`/Title ${value}`, "Title"), fixed = current === null ? null : correct(current);
    if (fixed === null || fixed === current) return whole;
    changed = true;
    return `${head}${hex(fixed)}${tail}`;
  });
  if (!changed) return pdf;
  const size = Number(/\/Size (\d+)/.exec(text.slice(trailerAt))?.[1]);
  if (!Number.isSafeInteger(size) || size <= 0) return pdf;
  const offsets = new Map<number, number>();
  for (const match of body.matchAll(/(?:^|\n)(\d+) 0 obj\b/g)) offsets.set(Number(match[1]), match.index! + (match[0].startsWith("\n") ? 1 : 0));
  if ([...offsets.keys()].some(num => num >= size)) return pdf;
  const rows = Array.from({ length: size }, (_, num) => num === 0 ? "0000000000 65535 f \n" : offsets.has(num) ? `${String(offsets.get(num)).padStart(10, "0")} 00000 n \n` : "0000000000 00000 f \n");
  const xref = `xref\n0 ${size}\n${rows.join("")}`;
  const trailer = text.slice(trailerAt).replace(/startxref\s+\d+/, `startxref\n${body.length}`);
  return Buffer.from(`${body}${xref}${trailer}`, "latin1");
}

/** Each chapter's first page and the recto blanks, from the bookmarks of a print without blanks. Null when a chapter cannot be found. */
export function bookPagesFromOutline(book: Pick<Book, "title" | "chapters">, outline: { title: string; page: number }[]): BookPages | null {
  // Chapter headings follow the title page and the contents in the bookmarks.
  let at = 0;
  outline.forEach((entry, index) => { if (/^contents(continued)?$/.test(norm(entry.title))) at = index + 1; });
  if (!at) at = Math.max(0, outline.findIndex(entry => norm(entry.title) === norm(book.title) && entry.page > 1)) + 1;
  const first: number[] = [];
  for (const chapter of book.chapters) {
    const want = norm(chapter.title);
    while (at < outline.length && norm(outline[at].title) !== want) at++;
    if (at >= outline.length) return null;
    first.push(outline[at++].page);
  }
  let shift = 0;
  const pages: BookPages = { chapters: {}, blankBefore: [] };
  book.chapters.forEach((chapter, index) => {
    let page = first[index] + shift;
    if (chapter.opening !== "inline" && page % 2 === 0) { pages.blankBefore.push(chapter.id); shift++; page++; }
    pages.chapters[chapter.id] = page;
  });
  return pages;
}
