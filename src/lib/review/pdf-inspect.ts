import { inflateSync } from "node:zlib";

/**
 * Minimal, dependency-free reader for the PDFs Makeborne itself exports
 * (Chromium/Skia: plain object dictionaries, Flate content streams, a page
 * tree and an outline). It measures what the review needs from the ACTUAL
 * exported file: page count, each page's MediaBox, the outline (chapter
 * titles and the pages they land on) and per-page ink (glyphs shown and
 * images drawn). It is not a general PDF parser: anything it cannot read
 * (object streams, encryption, unknown filters) returns null so the checks
 * report not_checked instead of guessing.
 */
export type PdfInspection = {
  pageCount: number;
  pages: { page: number; width: number; height: number; glyphs: number; images: number }[];
  outline: { title: string; page: number }[];
};

type PdfObject = { id: number; dict: string; stream: Buffer | null; unreadable: boolean };

function objects(bytes: Buffer): Map<number, PdfObject> {
  const text = bytes.toString("latin1"), out = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj\s*<<([\s\S]*?)>>\s*(stream\r?\n|endobj)/g;
  for (let match = header.exec(text); match; match = header.exec(text)) {
    const id = Number(match[1]), dict = match[2];
    let stream: Buffer | null = null, unreadable = false;
    if (match[3].startsWith("stream")) {
      // Only a direct length is read; an indirect one (/Length 12 0 R) makes the stream unreadable here.
      const length = /\/Length (\d+)(?!\d)(?! \d+ R)/.exec(dict);
      const start = match.index + match[0].length;
      if (length) stream = bytes.subarray(start, start + Number(length[1]));
      else unreadable = true;
    }
    out.set(id, { id, dict, stream, unreadable });
  }
  return out;
}

/** A PDF literal or hex string as text (outline titles are PDFDocEncoding or UTF-16BE). */
function pdfString(raw: string): string {
  if (raw.startsWith("<")) {
    const hex = raw.slice(1, -1).replace(/\s/g, "");
    const buffer = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
    return buffer[0] === 0xfe && buffer[1] === 0xff ? buffer.subarray(2).swap16().toString("utf16le") : buffer.toString("latin1");
  }
  const body = raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, escape: string) =>
    ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[escape] ?? String.fromCharCode(parseInt(escape, 8)));
  const buffer = Buffer.from(body, "latin1");
  return buffer[0] === 0xfe && buffer[1] === 0xff ? buffer.subarray(2).swap16().toString("utf16le") : body;
}

function ink(stream: Buffer | null, dict: string): { glyphs: number; images: number } | null {
  if (!stream) return { glyphs: 0, images: 0 };
  let content: string;
  try { content = (/\/FlateDecode/.test(dict) ? inflateSync(stream) : /\/Filter/.test(dict) ? null : stream)?.toString("latin1") ?? ""; }
  catch { return null; }
  if (!content && /\/Filter/.test(dict) && !/\/FlateDecode/.test(dict)) return null;
  let glyphs = 0;
  // Text shown inside BT…ET: hex glyph runs (2-byte CIDs) and literal strings.
  for (const block of content.match(/BT[\s\S]*?ET/g) ?? []) {
    for (const hex of block.match(/<([0-9A-Fa-f\s]+)>/g) ?? []) glyphs += Math.floor(hex.replace(/[<>\s]/g, "").length / 4);
    for (const literal of block.match(/\((?:\\.|[^\\)])*\)\s*T[jJ']/g) ?? []) glyphs += literal.length;
  }
  const images = (content.match(/\/[A-Za-z0-9]+\s+Do\b/g) ?? []).length;
  return { glyphs, images };
}

export function inspectPdf(bytes: Buffer): PdfInspection | null {
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
  const text = bytes.subarray(0, Math.min(bytes.length, 4096)).toString("latin1");
  if (/\/Encrypt\b/.test(bytes.toString("latin1")) || /\/ObjStm\b/.test(text)) return null;
  const table = objects(bytes);
  const root = [...table.values()].find(object => /\/Type\s*\/Pages\b/.test(object.dict) && !/\/Parent\b/.test(object.dict));
  if (!root) return null;
  // Depth-first page order from the page tree.
  const order: number[] = [];
  const walk = (id: number, depth: number) => {
    const node = table.get(id);
    if (!node || depth > 20) return;
    if (/\/Type\s*\/Page\b/.test(node.dict)) { order.push(id); return; }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(node.dict)?.[1] ?? "";
    for (const kid of kids.matchAll(/(\d+) 0 R/g)) walk(Number(kid[1]), depth + 1);
  };
  walk(root.id, 0);
  const count = Number(/\/Count (\d+)/.exec(root.dict)?.[1] ?? -1);
  if (count !== order.length) return null;
  const pages: PdfInspection["pages"] = [];
  for (const [index, id] of order.entries()) {
    const page = table.get(id)!;
    const box = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(page.dict) ?? /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(root.dict);
    if (!box) return null;
    let glyphs = 0, images = 0;
    const contents = /\/Contents\s*(?:(\d+) 0 R|\[([^\]]*)\])/.exec(page.dict);
    const refs = contents ? (contents[1] ? [contents[1]] : [...(contents[2] ?? "").matchAll(/(\d+) 0 R/g)].map(match => match[1])) : [];
    for (const ref of refs) {
      const stream = table.get(Number(ref));
      const measured = stream && !stream.unreadable ? ink(stream.stream, stream.dict) : null;
      if (!measured) return null;
      glyphs += measured.glyphs; images += measured.images;
    }
    pages.push({ page: index + 1, width: Math.round((Number(box[3]) - Number(box[1])) * 100) / 100, height: Math.round((Number(box[4]) - Number(box[2])) * 100) / 100, glyphs, images });
  }
  const pageOf = new Map(order.map((id, index) => [id, index + 1] as const));
  const outline: PdfInspection["outline"] = [];
  for (const object of table.values()) {
    const title = /\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/.exec(object.dict);
    const dest = /\/Dest\s*\[\s*(\d+) 0 R/.exec(object.dict);
    if (!title || !dest || !/\/Parent\b/.test(object.dict)) continue;
    const page = pageOf.get(Number(dest[1]));
    if (page) outline.push({ title: pdfString(title[1]).trim().slice(0, 200), page });
  }
  outline.sort((a, b) => a.page - b.page);
  return { pageCount: order.length, pages, outline };
}
