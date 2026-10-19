// Book instrument: K1 (KDP interior preflight), K2 (KDP cover geometry) and
// K3 (book overflow), from QUALITY_BAR.md §4.
//
// K1 reads the exported PDF itself (pdf-lib for objects, pdfjs-dist for text
// positions), turns what it finds into observations and hands them to the
// repo's own reviewed validator (src/lib/artifacts/print.ts
// validatePaperbackMetadata), so the KDP rules live in one place. Anything this
// instrument cannot observe is left out of the observation, which the
// validator then reports as "unknown" instead of a silent pass. Two rules the
// validator cannot see are gated here as harness findings (kdp.harnessFindings,
// severity "error"): the front cover printed as interior page 1, and a
// page-filling background tint that reaches the trim edge in the no-bleed
// profile (rendered pixel check at the page edges). Fonts in the PDF that are
// not the theme's embedded faces are flagged "machine-dependent export".
// K2 compares a wrap cover against calculatePrintGeometry(); the app never
// produces one (the front cover is page 1 of the interior PDF), so K2 fails
// until a wrap cover exists.
// K3 renders bookHtml(print) in Chromium, the way check-book-layout-browser.cjs
// does, and maps every overflowing element back to its PDF page.
//
// Offline: no network, no providers. Page PNGs are drawn by pdfjs inside
// Chromium from routed local files.
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFRawStream, PDFStream, StandardFonts, rgb, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DOCUMENTS } from '../thresholds.mjs';
import { OUT, REPO, ensureDir, exists, readJson, rel, writeJson } from '../paths.mjs';

const require = createRequire(import.meta.url);
const { loadApp } = require('../app-modules.cjs');
const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));

const PT_PER_IN = 72;
const PX_PER_IN = 96;
/** Text block of the printed interior (BOOK_TRIM in render-book.ts: 6 in − 0.82 in − 0.62 in). */
const TEXT_BLOCK_IN = 4.56;
/** A fill whose channels differ by more than this is colour, not a tinted neutral (#16181D ink is 0.027). */
const CHROMA_COLOUR = 0.06;
/** Strings the app writes while content is missing; their presence is a placeholder. */
const PLACEHOLDERS = [/this chapter is being written/i, /chapters appear here as they are written/i, /lorem ipsum/i];
/** KDP's minimum type size, and the one tolerance every font-size report uses (pdfjs transform heights carry ~0.003 pt noise). */
const FONT_FLOOR_PT = 7;
const FONT_TOLERANCE_PT = 0.01;
const belowFloor = sizePt => sizePt < FONT_FLOOR_PT - FONT_TOLERANCE_PT;
/** Edge pixel check: a pixel is ink when its darkest channel is more than this far below white (0–255). */
const EDGE_INK_LEVEL = 8;
/** A page whose four edges are at least this share ink carries a page-filling background. */
const FULL_BLEED_SHARE = 0.9;
/** Any edge at least this share ink is reported (not gated) as ink at the trim edge. */
const EDGE_INK_SHARE = 0.25;

let modules;
function app() {
  modules ??= {
    schema: loadApp('src/lib/documents/schema.ts'),
    book: loadApp('src/lib/documents/render-book.ts'),
    theme: loadApp('src/lib/documents/theme.ts'),
    faces: loadApp('src/lib/documents/fonts.ts'),
    fonts: loadApp('src/lib/documents/fonts-server.ts'),
    print: loadApp('src/lib/artifacts/print.ts'),
  };
  return modules;
}

// ---------------------------------------------------------------------------
// Font provenance
// ---------------------------------------------------------------------------

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'emoji', 'math']);
const fontKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
let familyTable;
/**
 * The open-licensed faces the documents embed (fonts.ts DOCUMENT_FACES) and the
 * system faces their CSS stacks and Office mappings name (theme.ts FONTS). The
 * stacks list system faces first (e.g. "Georgia, Newsreader"), so a machine that
 * has them installed prints them instead of the embedded face; the production
 * exporter (serverless Chromium) has only the embedded faces.
 */
export function documentFamilies() {
  if (familyTable) return familyTable;
  const { theme, faces } = app();
  const embedded = Object.values(faces.DOCUMENT_FACES).map(face => face.family);
  const system = new Set(['Consolas', 'Segoe UI Symbol', 'Segoe UI Emoji', 'Times New Roman', 'Calibri', 'Cambria', 'Cambria Math', 'Courier New', 'Tahoma', 'Open Sans']);
  for (const spec of Object.values(theme.FONTS)) {
    for (const stack of [spec.heading, spec.body]) {
      for (const part of stack.split(',')) {
        const family = part.trim().replace(/^["']|["']$/g, '');
        if (family && !GENERIC_FAMILIES.has(family.toLowerCase()) && !embedded.includes(family)) system.add(family);
      }
    }
    system.add(spec.pptxHeading);
    system.add(spec.pptxBody);
  }
  const keyed = list => [...list].map(family => ({ family, key: fontKey(family) })).sort((a, b) => b.key.length - a.key.length);
  familyTable = { embedded: keyed(embedded), system: keyed(system) };
  return familyTable;
}

/** Which family a font name belongs to: a document face, a named system face, or neither. */
export function fontSource(name) {
  const { embedded, system } = documentFamilies();
  const key = fontKey(String(name ?? '').replace(/^[A-Z]{6}\+/, ''));
  const face = embedded.find(entry => key.startsWith(entry.key));
  if (face) return { family: face.family, source: 'embedded face' };
  const installed = system.find(entry => key.startsWith(entry.key));
  return installed ? { family: installed.family, source: 'system font' } : { family: null, source: 'other (not a document face)' };
}

/**
 * The fonts a PDF carries, by provenance. Anything that is not one of the
 * document faces came from the machine that printed it, so the export is
 * machine-dependent: the production exporter would set that text differently.
 */
export function pdfFontFaces(fonts) {
  const byName = new Map();
  let unnamed = 0;
  for (const font of fonts) {
    const baseFont = String(font.baseFont ?? '').replace(/^[A-Z]{6}\+/, '');
    if (!baseFont) { unnamed++; continue; }
    if (byName.has(baseFont)) continue;
    byName.set(baseFont, { baseFont, ...fontSource(baseFont), fileEmbedded: font.embedded });
  }
  const faces = [...byName.values()];
  const families = source => [...new Set(faces.filter(face => face.source === source).map(face => face.family ?? face.baseFont))];
  const notDocument = faces.filter(face => face.source !== 'embedded face');
  return {
    faces, embeddedFaces: families('embedded face'), systemFonts: families('system font'), otherFonts: families('other (not a document face)'),
    // Chromium writes variable faces (the embedded document faces, and e.g. Bahnschrift) as nameless Type3 glyph fonts.
    unnamedFonts: unnamed,
    ...(unnamed ? { unnamedNote: `${unnamed} font(s) carry no name (Type3 glyph procedures, as Chromium writes variable faces), so their provenance is not visible in the PDF.` } : {}),
    // Named system faces settle it; with only nameless fonts besides document faces it cannot be told.
    machineDependent: notDocument.length > 0 ? true : unnamed ? null : false,
    ...(notDocument.length ? { flag: 'machine-dependent export', note: `The PDF uses ${[...new Set(notDocument.map(face => face.family ?? face.baseFont))].join(', ')}, which the theme's CSS stacks list before the embedded faces; the production exporter has only the embedded faces, so its PDF would be set differently.` } : {}),
  };
}

const round = (value, digits = 3) => value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
const name = value => value?.toString().replace(/^\//, '');
const num = value => value instanceof PDFNumber ? value.asNumber() : undefined;

/** Stable UUID-shaped id from the file hash (the validator needs a uuid; this one names the bytes). */
function fileUuid(bytes) {
  const hex = createHash('sha256').update(bytes).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// PDF objects (pdf-lib)
// ---------------------------------------------------------------------------

/** Visit every dictionary in the file once: indirect objects and the direct dictionaries nested in them. */
function* dictionaries(context) {
  const visit = function* (value) {
    if (value instanceof PDFDict) {
      yield value;
      for (const [, child] of value.entries()) yield* visit(child);
    } else if (value instanceof PDFArray) {
      for (const child of value.asArray()) yield* visit(child);
    } else if (value instanceof PDFStream) {
      yield* visit(value.dict);
    }
  };
  for (const [, object] of context.enumerateIndirectObjects()) yield* visit(object);
}

function decodeStream(stream) {
  try {
    if (stream instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    return Buffer.from(stream.getContents()).toString('latin1');
  } catch {
    return null; // an unsupported filter; the colour scan then reports it as unread
  }
}

/** Fill/stroke colours set by a content stream: rg/RG (RGB), k/K (CMYK), sc/scn with three components. */
function colourOps(content) {
  const fills = [];
  for (const match of content.matchAll(/(?:^|\s)(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(rg|RG|sc|scn|SC|SCN)(?=\s)/g)) {
    const [r, g, b] = [match[1], match[2], match[3]].map(Number);
    fills.push(Math.max(r, g, b) - Math.min(r, g, b));
  }
  for (const match of content.matchAll(/(?:^|\s)(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(k|K)(?=\s)/g)) {
    const [c, m, y] = [match[1], match[2], match[3]].map(Number);
    fills.push(Math.max(c, m, y) - Math.min(c, m, y));
  }
  return fills;
}

/**
 * Object-level facts about a PDF: page boxes, fonts, transparency, annotations,
 * outlines, encryption, raster images and the colours its content streams set.
 * Exported so the deck instrument can summarise its PDF the same way.
 */
export async function pdfObjects(bytes) {
  const header = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const context = doc.context;
  const pages = doc.getPages().map((page, index) => {
    const media = page.getMediaBox();
    const has = key => page.node.get(PDFName.of(key)) !== undefined;
    const trim = has('TrimBox') ? page.getTrimBox() : null;
    const annots = page.node.Annots();
    return {
      page: index + 1, widthPt: round(media.width, 2), heightPt: round(media.height, 2),
      trimBox: trim ? [trim.x, trim.y, trim.width, trim.height].map(v => round(v, 2)) : null,
      bleedBox: has('BleedBox'), annotations: annots instanceof PDFArray ? annots.size() : 0,
    };
  });

  const fonts = [];
  const transparency = { alphaLt1: 0, alphaValues: [], groups: 0, softMasks: 0, imageSoftMasks: 0, blendModes: 0, blendModeNames: [] };
  const images = [];
  for (const dict of dictionaries(context)) {
    const type = name(dict.get(PDFName.of('Type')));
    const subtype = name(dict.get(PDFName.of('Subtype')));
    if (type === 'Font' && subtype !== 'Type0') {
      // Type0 fonts carry their glyphs in the descendant CIDFont, which is visited on its own.
      const descriptor = dict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      const file = ['FontFile', 'FontFile2', 'FontFile3'].find(key => descriptor?.get(PDFName.of(key)));
      fonts.push({ baseFont: name(dict.get(PDFName.of('BaseFont'))) ?? null, subtype, embedded: subtype === 'Type3' || Boolean(file), fontFile: file ?? null });
    }
    if (name(dict.get(PDFName.of('S'))) === 'Transparency') transparency.groups++;
    // ExtGState dictionaries rarely carry /Type; recognise them by their keys.
    const ca = num(dict.get(PDFName.of('ca'))), CA = num(dict.get(PDFName.of('CA')));
    if ((ca !== undefined && ca < 1) || (CA !== undefined && CA < 1)) {
      transparency.alphaLt1++;
      for (const value of [ca, CA]) if (value !== undefined && value < 1 && !transparency.alphaValues.includes(round(value))) transparency.alphaValues.push(round(value));
    }
    const smask = dict.get(PDFName.of('SMask'));
    if (smask && name(smask) !== 'None') {
      if (subtype === 'Image') transparency.imageSoftMasks++;
      else transparency.softMasks++;
    }
    const bm = dict.get(PDFName.of('BM'));
    const modes = bm instanceof PDFArray ? bm.asArray().map(name) : bm ? [name(bm)] : [];
    if (modes.some(mode => mode !== 'Normal' && mode !== 'Compatible')) {
      transparency.blendModes++;
      for (const mode of modes) if (!transparency.blendModeNames.includes(mode)) transparency.blendModeNames.push(mode);
    }
    if (subtype === 'Image') {
      const space = dict.get(PDFName.of('ColorSpace'));
      const spaceName = space instanceof PDFArray ? name(space.get(0)) : name(space) ?? null;
      images.push({ width: num(dict.get(PDFName.of('Width'))) ?? null, height: num(dict.get(PDFName.of('Height'))) ?? null, colorSpace: spaceName, softMask: Boolean(smask && name(smask) !== 'None') });
    }
  }

  // Colours drawn by page content and form XObjects.
  const colour = { streamsRead: 0, streamsUnread: 0, colourOps: 0, maxChroma: 0, colourPages: [], inlineImages: 0 };
  const scan = content => {
    if (content === null) { colour.streamsUnread++; return 0; }
    colour.streamsRead++;
    if (/(?:^|\s)BI\s[\s\S]*?\sID\s/.test(content)) colour.inlineImages++;
    let count = 0;
    for (const chroma of colourOps(content)) {
      colour.maxChroma = Math.max(colour.maxChroma, chroma);
      if (chroma > CHROMA_COLOUR) count++;
    }
    colour.colourOps += count;
    return count;
  };
  doc.getPages().forEach((page, index) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => context.lookup(ref)) : contents ? [contents] : [];
    let count = 0;
    for (const stream of streams) if (stream instanceof PDFStream) count += scan(decodeStream(stream));
    if (count) colour.colourPages.push(index + 1);
  });
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFStream && name(object.dict.get(PDFName.of('Subtype'))) === 'Form') scan(decodeStream(object));
  }
  colour.maxChroma = round(colour.maxChroma);

  const outlinesDict = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  const outlines = Boolean(outlinesDict && (outlinesDict.get(PDFName.of('First')) || (num(outlinesDict.get(PDFName.of('Count'))) ?? 0) !== 0));
  const sizes = new Set(pages.map(page => `${page.widthPt}x${page.heightPt}`));
  return {
    header: header.replace(/[^\x20-\x7e]/g, '').trim(), version: /%PDF-(\d\.\d)/.exec(header)?.[1] ?? null,
    pages, pageCount: pages.length, consistentSize: sizes.size === 1,
    fonts, unembeddedFonts: fonts.filter(font => !font.embedded).map(font => font.baseFont ?? '(unnamed)'),
    type3Fonts: fonts.filter(font => font.subtype === 'Type3').length,
    transparency, images, colour,
    annotations: pages.reduce((sum, page) => sum + page.annotations, 0),
    outlines, encrypted: doc.isEncrypted,
  };
}

// ---------------------------------------------------------------------------
// Text positions (pdfjs-dist)
// ---------------------------------------------------------------------------

/** Every non-blank text item per page as a page-space box (points, origin bottom-left). */
export async function pdfTextBoxes(bytes) {
  const pdf = await getDocument({
    data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0,
    standardFontDataUrl: path.join(PDFJS_DIR, 'standard_fonts') + path.sep, cMapUrl: path.join(PDFJS_DIR, 'cmaps') + path.sep, cMapPacked: true,
  }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      const content = await page.getTextContent();
      const items = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [a, b, c, d, e, f] = item.transform;
        const size = Math.hypot(c, d);
        if (!(size > 0)) continue;
        // Box from the font's ascent/descent (pdfjs reports them per font); generous for tall faces.
        const style = content.styles[item.fontName] ?? {};
        const ascent = Number.isFinite(style.ascent) && style.ascent > 0 ? style.ascent : 0.8;
        const descent = Number.isFinite(style.descent) && style.descent < 0 ? style.descent : -0.2;
        const along = Math.hypot(a, b) || 1, ux = a / along, uy = b / along, vx = c / size, vy = d / size;
        const corners = [[0, descent], [item.width, descent], [0, ascent], [item.width, ascent]].map(([u, v]) => {
          const up = v === descent || v === ascent ? v * size : v;
          return [e + ux * u + vx * up, f + uy * u + vy * up];
        });
        items.push({
          str: item.str, size,
          left: Math.min(...corners.map(p => p[0])), right: Math.max(...corners.map(p => p[0])),
          bottom: Math.min(...corners.map(p => p[1])), top: Math.max(...corners.map(p => p[1])),
        });
      }
      pages.push({ page: n, width: x1 - x0, height: y1 - y0, items });
      page.cleanup();
    }
    // Every outline entry at every depth (chapter titles nest under the book's top-level entry).
    const outline = await pdf.getOutline();
    const count = items => (items ?? []).reduce((sum, item) => sum + 1 + count(item.items), 0);
    return { pages, outlineEntries: count(outline), outlineTopLevel: outline?.length ?? 0 };
  } finally {
    await pdf.destroy();
  }
}

/** Letters and digits only, so spacing, tracking, hyphenation and quote styles never break a text match. */
const squash = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Margins of one page from its text boxes; recto pages (odd, page 1 recto) have the gutter on the left. */
function pageMargins(page) {
  const recto = page.page % 2 === 1;
  if (!page.items.length) return { page: page.page, side: recto ? 'recto' : 'verso', textItems: 0, leftIn: null, rightIn: null, topIn: null, bottomIn: null, insideIn: null, outsideIn: null };
  const left = Math.min(...page.items.map(item => item.left)) / PT_PER_IN;
  const right = (page.width - Math.max(...page.items.map(item => item.right))) / PT_PER_IN;
  const top = (page.height - Math.max(...page.items.map(item => item.top))) / PT_PER_IN;
  const bottom = Math.min(...page.items.map(item => item.bottom)) / PT_PER_IN;
  return {
    page: page.page, side: recto ? 'recto' : 'verso', textItems: page.items.length,
    leftIn: round(left), rightIn: round(right), topIn: round(top), bottomIn: round(bottom),
    insideIn: round(recto ? left : right), outsideIn: round(recto ? right : left),
  };
}

/**
 * Display pages are the full-page sections bookHtml prints on `@page full`
 * (cover, title, rights, contents, chapter openers): they carry no folio.
 * Body pages print their number in the bottom margin.
 */
function classifyPages(text, book) {
  const titles = (book?.chapters ?? []).map(chapter => squash(chapter.title).slice(0, 40)).filter(Boolean);
  return text.pages.map(page => {
    const folio = page.items.some(item => item.str.trim() === String(page.page) && item.top < page.height * 0.15);
    const joined = squash(page.items.map(item => item.str).join(''));
    let kind = 'body';
    if (!folio) {
      if (page.page === 1) kind = 'cover';
      else if (/^contents/.test(joined)) kind = 'contents';
      else if (titles.some(title => joined.includes(title))) kind = 'opener';
      else kind = 'front';
    }
    return { page: page.page, folio, display: !folio, kind, joined };
  });
}

// ---------------------------------------------------------------------------
// Chromium: overflow (K3) and page pictures
// ---------------------------------------------------------------------------

const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

const PDFJS_ORIGIN = 'http://pdfjs.invalid';

/** A Chromium page that serves only the PDF and pdfjs's own files (build, cmaps, standard fonts); `fn` gets the page. */
async function withPdfPage(browser, bytes, fn) {
  const origin = PDFJS_ORIGIN;
  const context = await browser.newContext({ viewport: { width: 900, height: 1100 }, serviceWorkers: 'block' });
  try {
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#fff"><canvas id="page"></canvas></body></html>' });
      if (url.pathname === '/document.pdf') return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(bytes) });
      // Only pdfjs's own build, cmaps and standard fonts are served.
      const file = path.resolve(PDFJS_DIR, '.' + decodeURIComponent(url.pathname));
      const allowed = ['build', 'cmaps', 'standard_fonts'].some(dir => file.startsWith(path.join(PDFJS_DIR, dir) + path.sep));
      if (!allowed || !exists(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: MIME[path.extname(file)] ?? 'application/octet-stream', body: await readFile(file) });
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    return await fn(page);
  } finally {
    await context.close();
  }
}

/** Draw selected PDF pages with pdfjs inside Chromium (canvas) and save them as PNGs. */
async function pdfPagePictures(browser, bytes, wanted, shotsDir) {
  return withPdfPage(browser, bytes, async page => {
    const files = [];
    for (const { page: number, role } of wanted) {
      await page.evaluate(async n => {
        const pdfjs = await import('/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/build/pdf.worker.mjs';
        window.mbPdf ??= await pdfjs.getDocument({ url: '/document.pdf', cMapUrl: '/cmaps/', cMapPacked: true, standardFontDataUrl: '/standard_fonts/' }).promise;
        const pdfPage = await window.mbPdf.getPage(n);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const canvas = document.getElementById('page');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }, number);
      const file = path.join(shotsDir, `page-${String(number).padStart(2, '0')}-${role}.png`);
      await page.locator('#page').screenshot({ path: file });
      files.push({ page: number, role, file: rel(file) });
    }
    return files;
  });
}

/**
 * Ink at the trim edge, per page: every page is drawn by pdfjs on a white
 * canvas (72 px per inch) and the pixel rows/columns one pixel inside each edge
 * are read. The share of edge pixels that are not white, per edge, plus the
 * colour in the middle of the top edge.
 */
async function pdfEdgeInk(browser, bytes) {
  return withPdfPage(browser, bytes, page => page.evaluate(async level => {
    const pdfjs = await import('/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/build/pdf.worker.mjs';
    window.mbPdf ??= await pdfjs.getDocument({ url: '/document.pdf', cMapUrl: '/cmaps/', cMapPacked: true, standardFontDataUrl: '/standard_fonts/' }).promise;
    const canvas = document.createElement('canvas');
    const pages = [];
    for (let n = 1; n <= window.mbPdf.numPages; n++) {
      const pdfPage = await window.mbPdf.getPage(n);
      const viewport = pdfPage.getViewport({ scale: 1 });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, viewport }).promise;
      const { width, height } = canvas;
      const data = context.getImageData(0, 0, width, height).data;
      const ink = (x, y) => { const i = (y * width + x) * 4; return 255 - Math.min(data[i], data[i + 1], data[i + 2]) > level; };
      const share = points => points.filter(([x, y]) => ink(x, y)).length / Math.max(1, points.length);
      const across = Array.from({ length: width }, (_, x) => x), down = Array.from({ length: height }, (_, y) => y);
      const mid = (Math.floor(width / 2) + width) * 4;
      pages.push({
        page: n,
        top: share(across.map(x => [x, 1])), bottom: share(across.map(x => [x, height - 2])),
        left: share(down.map(y => [1, y])), right: share(down.map(y => [width - 2, y])),
        topColour: `#${[data[mid], data[mid + 1], data[mid + 2]].map(v => v.toString(16).padStart(2, '0')).join('')}`,
      });
      pdfPage.cleanup();
    }
    return pages;
  }, EDGE_INK_LEVEL));
}

/**
 * Render bookHtml(print) the way the PDF exporter does and list every element
 * that leaves its box. The body is set to the printed text block (4.56 in), so
 * chapter text wraps exactly as on the page; full-page sections keep their own
 * 6 × 9 in size and are checked against it.
 */
async function bookOverflow(browser, book, images, controlCss) {
  const { book: render, theme, fonts: fontServer } = app();
  let fontSources;
  try { fontSources = await fontServer.embeddedFontSources(theme.FONTS[book.theme.fonts].faces, REPO); } catch { fontSources = undefined; }
  // controlCss exists only for the self-test's negative control (it must make the detector fire).
  const html = render.bookHtml(book, images, 'print', fontSources).replace('</head>', `<style>body{width:${TEXT_BLOCK_IN}in}${controlCss ?? ''}</style></head>`);
  const context = await browser.newContext({ viewport: { width: Math.ceil(TEXT_BLOCK_IN * PX_PER_IN), height: 864 }, javaScriptEnabled: false, serviceWorkers: 'block' });
  try {
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return await page.evaluate(() => {
      const px = value => Math.round(value * 10) / 10;
      const snippet = element => (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const found = [];
      // Full pages: cover, title, rights, contents, openers. They clip (overflow:hidden), so text
      // outside the page is lost. Decorative discs and rings bleed on purpose, so only text counts.
      document.querySelectorAll('section.full').forEach((section, index) => {
        const kind = section.classList.contains('authored-cover') ? 'cover' : ['cover', 'title-page', 'rights', 'contents', 'opener', 'waiting'].find(name => section.classList.contains(name)) ?? 'full';
        const box = section.getBoundingClientRect();
        const outside = new Map();
        const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            if (!r.width || !r.height) continue;
            const beyond = Math.max(r.right - box.right, box.left - r.left, r.bottom - box.bottom, box.top - r.top);
            const element = node.parentElement;
            if (beyond > 1 && beyond > (outside.get(element) ?? 0)) outside.set(element, beyond);
          }
        }
        for (const [element, beyond] of outside) found.push({ kind, section: index, tag: element.tagName.toLowerCase(), reason: `text runs ${px(beyond)}px off the page`, text: snippet(element), beyondPx: px(beyond) });
        // Authored covers place each text in a fixed box (like slide text): it must fit that box.
        for (const element of section.querySelectorAll('[data-cover-text]')) {
          const height = element.style.height, boxHeight = element.getBoundingClientRect().height;
          element.style.height = 'auto';
          const natural = element.getBoundingClientRect().height;
          element.style.height = height;
          if (natural > boxHeight + 2) found.push({ kind, section: index, tag: element.tagName.toLowerCase(), reason: `cover text needs ${Math.round(natural)}px in a ${Math.round(boxHeight)}px box`, text: snippet(element), beyondPx: px(natural - boxHeight) });
        }
        if (kind === 'contents') {
          // The contents harness rule: every row ends above the bottom padding.
          const contentBottom = box.bottom - parseFloat(getComputedStyle(section).paddingBottom);
          for (const row of section.querySelectorAll('li')) {
            const r = row.getBoundingClientRect();
            if (r.bottom > contentBottom + 1) found.push({ kind, section: index, tag: 'li', reason: `contents row ends ${px(r.bottom - contentBottom)}px into the bottom margin`, text: snippet(row), beyondPx: px(r.bottom - contentBottom) });
          }
        }
      });
      // Chapter bodies: nothing may be wider than the text block (check-book-layout-browser.cjs rule, plus images and headings).
      document.querySelectorAll('section.chapter').forEach((chapter, index) => {
        const style = getComputedStyle(chapter), box = chapter.getBoundingClientRect();
        const inner = { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) };
        for (const element of chapter.querySelectorAll('p,li,td,th,table,.table,figure,img,figcaption,blockquote,h2,h3,aside,.ph')) {
          const r = element.getBoundingClientRect();
          const beyond = Math.max(r.right - inner.right, inner.left - r.left, element.scrollWidth - element.clientWidth);
          if (beyond > 1) found.push({ kind: 'chapter', chapter: index, tag: element.tagName.toLowerCase(), reason: `${px(beyond)}px wider than the text block`, text: snippet(element), beyondPx: px(beyond) });
        }
      });
      const fontStacks = [...new Set([...document.querySelectorAll('h1,h2,p')].map(element => getComputedStyle(element).fontFamily))];
      return { found, fontStacks };
    });
  } finally {
    await context.close();
  }
}

function imageUrls(images = {}) {
  const urls = {};
  for (const [key, value] of Object.entries(images)) {
    if (typeof value === 'string') urls[key] = value;
    else if (value) urls[key] = `data:${value[0] === 0x89 ? 'image/png' : 'image/jpeg'};base64,${Buffer.from(value).toString('base64')}`;
  }
  return urls;
}

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

/**
 * Measure one book.
 * @param {object} input
 * @param {object} input.document      book DocumentSource (content.document of a saved version)
 * @param {string} input.pdfPath       exported book PDF (documentPdf in export-server.ts)
 * @param {import('playwright').Browser} [input.browser]  Chromium; launched and closed here when absent
 * @param {string} [input.shotsDir]    where page PNGs go; no pictures when absent
 * @param {string} [input.coverPdfPath] a separate wrap cover PDF, when one ever exists
 * @param {object} [input.images]      generated images by name (Buffer or data: URL); placeholders otherwise
 * @param {'white'|'cream'} [input.paper='white']
 */
export async function measureBook({ document, pdfPath, browser, shotsDir, coverPdfPath, images, paper = 'white', controlCss } = {}) {
  const errors = [];
  const attempt = async (step, fn, fallback = null) => {
    try { return await fn(); } catch (error) { errors.push({ step, message: String(error?.message ?? error).slice(0, 500) }); return fallback; }
  };
  const { schema, print } = app();
  const parsed = schema.DocumentSourceSchema.safeParse(document);
  if (!parsed.success) errors.push({ step: 'parse', message: parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
  const book = parsed.success ? parsed.data : document;
  if (book?.kind !== 'book') errors.push({ step: 'parse', message: `expected a book document, got ${book?.kind}` });

  const bytes = await attempt('read pdf', () => readFile(pdfPath));
  const objects = bytes ? await attempt('pdf objects', () => pdfObjects(bytes)) : null;
  const text = bytes ? await attempt('pdf text', () => pdfTextBoxes(bytes)) : null;

  // Chromium draws the PDF pages (edge ink, pictures) and renders bookHtml (K3).
  let chromium;
  if (!browser && (bytes || book?.kind === 'book')) chromium = await attempt('launch chromium', async () => (await import('playwright')).chromium.launch({ headless: true }));
  const activeBrowser = browser ?? chromium;
  try {
    const edgeInk = bytes && activeBrowser ? await attempt('edge ink', () => pdfEdgeInk(activeBrowser, bytes)) : null;

    // ---- K1: interior preflight -------------------------------------------------
    const kdp = { pages: null, effectivePages: null, widthIn: null, heightIn: null, consistentSize: null, fontsEmbedded: null, unembeddedFonts: [], type3Fonts: null, transparency: null, annotations: null, outlines: null, encrypted: null, minFontPt: null, margins: null, inkProfile: 'unknown', findings: [], status: null };
    let pageKinds = [];
    if (objects) {
      const first = objects.pages[0];
      const trim = first?.trimBox;
      Object.assign(kdp, {
        pdfVersion: objects.version, pages: objects.pageCount, effectivePages: Math.ceil(objects.pageCount / 2) * 2,
        widthIn: round((trim ? trim[2] : first?.widthPt) / PT_PER_IN, 4), heightIn: round((trim ? trim[3] : first?.heightPt) / PT_PER_IN, 4),
        consistentSize: objects.consistentSize, trimBoxes: objects.pages.filter(page => page.trimBox).length, bleedBoxes: objects.pages.filter(page => page.bleedBox).length,
        fonts: objects.fonts, fontsEmbedded: objects.unembeddedFonts.length === 0, unembeddedFonts: objects.unembeddedFonts, type3Fonts: objects.type3Fonts,
        pdfFonts: pdfFontFaces(objects.fonts),
        transparency: objects.transparency, annotations: objects.annotations, outlines: objects.outlines, encrypted: objects.encrypted,
        images: { count: objects.images.length, inline: objects.colour.inlineImages, items: objects.images },
      });
      // Ink guess: vector colour is decisive; RGB rasters could be colour or grey, so they leave it open.
      const rgbImages = objects.images.filter(image => image.colorSpace !== 'DeviceGray' && image.colorSpace !== 'CalGray').length;
      kdp.inkProfile = objects.colour.colourOps > 0 ? 'colour' : rgbImages ? 'unknown' : objects.colour.streamsUnread ? 'unknown' : 'black';
      kdp.inkEvidence = { ...objects.colour, threshold: CHROMA_COLOUR, rgbImages };
    }
    let pageOneText = '';
    if (text) {
      pageKinds = classifyPages(text, book);
      pageOneText = pageKinds[0]?.joined ?? '';
      const glyphs = text.pages.flatMap(page => page.items.map(item => ({ ...item, page: page.page })));
      const words = glyphs.filter(item => /[\p{L}\p{N}]/u.test(item.str));
      const smallest = list => list.reduce((min, item) => (!min || item.size < min.size ? item : min), null);
      const minWord = smallest(words), minAny = smallest(glyphs);
      // KDP's 7 pt floor is about readable text: ornaments (◆ breaks) are reported but do not set it.
      // One rule everywhere: below the floor means more than FONT_TOLERANCE_PT under 7 pt.
      kdp.minFontPt = minWord ? round(minWord.size, 3) : null;
      kdp.minFont = {
        text: minWord ? { pt: round(minWord.size, 3), page: minWord.page, sample: minWord.str.slice(0, 40), belowFloor: belowFloor(minWord.size) } : null,
        anyGlyph: minAny ? { pt: round(minAny.size, 3), page: minAny.page, sample: minAny.str.slice(0, 40) } : null,
        itemsBelow7pt: words.filter(item => belowFloor(item.size)).length,
        rule: `below ${FONT_FLOOR_PT} pt means smaller than ${FONT_FLOOR_PT - FONT_TOLERANCE_PT} pt (${FONT_TOLERANCE_PT} pt measurement tolerance); the validator gets ${FONT_FLOOR_PT} pt when the minimum is within it`,
        method: 'pdfjs text item transform height (approximate)',
      };
      const perPage = text.pages.map((page, index) => ({ ...pageMargins(page), display: pageKinds[index].display, kind: pageKinds[index].kind }));
      let basis = perPage.filter(page => !page.display && page.textItems);
      let basisNote = 'numbered body pages (pages with a folio); display pages (no folio: cover, title, rights, contents, openers) are reported but excluded';
      if (!basis.length) {
        basis = perPage.filter(page => page.page > 1 && page.textItems);
        basisNote = 'no folios found: every page after page 1';
      }
      const minOf = key => basis.length ? round(Math.min(...basis.map(page => page[key]))) : null;
      const worst = key => basis.length ? basis.reduce((min, page) => (page[key] < min[key] ? page : min)).page : null;
      kdp.margins = {
        insideIn: minOf('insideIn'), outsideIn: minOf('outsideIn'), topIn: minOf('topIn'), bottomIn: minOf('bottomIn'),
        worstPage: { inside: worst('insideIn'), outside: worst('outsideIn'), top: worst('topIn'), bottom: worst('bottomIn') },
        basis: basisNote, measuredPages: basis.length, method: 'text item boxes (pdfjs; font ascent/descent), not images or rules',
        displayPages: perPage.filter(page => page.display).map(({ page, kind, insideIn, outsideIn, topIn, bottomIn }) => ({ page, kind, insideIn, outsideIn, topIn, bottomIn })),
        perPage,
      };
      kdp.outlineEntries = text.outlineEntries;
      kdp.outlineTopLevel = text.outlineTopLevel;
      const all = text.pages.map(page => page.items.map(item => item.str).join(' ')).join('\n');
      kdp.placeholders = PLACEHOLDERS.filter(pattern => pattern.test(all)).map(pattern => pattern.source);
      kdp.placeholderScan = { ran: true, textItems: glyphs.length, patterns: PLACEHOLDERS.map(pattern => pattern.source) };
    }

    // Trim edge: what the pages print at their outer edge (no-bleed profile: nothing may reach it).
    if (edgeInk) {
      const shareOf = page => Math.min(page.top, page.bottom, page.left, page.right);
      const fullBleed = edgeInk.filter(page => shareOf(page) >= FULL_BLEED_SHARE);
      const edgeOnly = edgeInk.filter(page => shareOf(page) < FULL_BLEED_SHARE && Math.max(page.top, page.bottom, page.left, page.right) >= EDGE_INK_SHARE);
      kdp.trimEdge = {
        method: `pdfjs page render at 72 px/in on white; pixel rows/columns 1 px inside each edge; ink = darkest channel more than ${EDGE_INK_LEVEL}/255 below white`,
        fullBleedPages: fullBleed.map(page => page.page), fullBleedColours: [...new Set(fullBleed.map(page => page.topColour))],
        edgeInkPages: edgeOnly.map(page => ({ page: page.page, top: round(page.top, 2), right: round(page.right, 2), bottom: round(page.bottom, 2), left: round(page.left, 2) })),
        perPage: edgeInk.map(page => ({ page: page.page, top: round(page.top, 3), right: round(page.right, 3), bottom: round(page.bottom, 3), left: round(page.left, 3), topColour: page.topColour })),
      };
    }

    // ---- K1 harness findings: rules the validator cannot see ---------------------
    const harness = [];
    const add = (code, severity, message, evidence) => harness.push({ code, severity, message, source: 'eval harness (scripts/eval/lib/instruments/book.mjs)', ...(evidence ? { evidence } : {}) });
    const titleKey = squash(book?.title ?? '').slice(0, 30);
    const pageOneIsCover = pageKinds[0]?.kind === 'cover' && Boolean(titleKey) && pageOneText.includes(titleKey);
    if (pageOneIsCover) {
      add('cover_in_interior', 'error', 'The front cover is printed as interior page 1. A paperback interior starts with the book block; KDP takes the cover as a separate one-page wrap PDF (back, spine, front).',
        { page: 1, folio: false, titleOnPage: true, fullBleed: Boolean(kdp.trimEdge?.fullBleedPages.includes(1)), colour: edgeInk?.[0]?.topColour ?? null });
    }
    if (kdp.trimEdge?.fullBleedPages.length) {
      const pages = kdp.trimEdge.fullBleedPages;
      add('full_bleed_background', 'error', `${pages.length} of ${edgeInk.length} pages carry a page-filling background (${kdp.trimEdge.fullBleedColours.slice(0, 4).join(', ')}) that reaches the trim edge, but the profile is no-bleed: backgrounds that touch the edge need the bleed profile (0.125 in past the trim), or trimming leaves uneven white slivers.`,
        { pages: pages.length > 24 ? [...pages.slice(0, 24), '…'] : pages });
    }
    if (kdp.trimEdge?.edgeInkPages.length) add('ink_at_trim_edge', 'warning', `${kdp.trimEdge.edgeInkPages.length} pages have ink along part of an edge (not page-filling); check they do not need bleed.`, { pages: kdp.trimEdge.edgeInkPages.map(page => page.page) });
    if (kdp.pages && kdp.pages % 2) add('odd_page_count', 'error', `${kdp.pages} pages; QUALITY_BAR K1 requires an even count.`);
    const displayDesigned = kdp.margins?.displayPages?.filter(page => page.kind === 'cover' || page.kind === 'opener').length ?? 0;
    if (displayDesigned) add('display_pages_unchecked', 'info', `${displayDesigned} cover/opener pages are full-page designs; their text margins are reported, not gated.`);
    if (kdp.pdfFonts?.machineDependent) add('machine_dependent_export', 'warning', `Machine-dependent export: ${kdp.pdfFonts.note}`, { systemFonts: kdp.pdfFonts.systemFonts, otherFonts: kdp.pdfFonts.otherFonts, embeddedFaces: kdp.pdfFonts.embeddedFaces });
    kdp.harnessFindings = harness;

    const ink = kdp.inkProfile === 'colour' ? 'premium_color' : 'black';
    const profile = objects ? { ruleVersion: print.KDP_RULE_VERSION, binding: 'paperback', trimWidthIn: 6, trimHeightIn: 9, bleed: false, ink, paper, pageCount: objects.pageCount } : null;
    const profileOk = profile ? print.KdpPaperbackProfileSchema.safeParse(profile).success : false;
    kdp.profile = profile ? { ...profile, inkAssumed: kdp.inkProfile === 'unknown' ? 'black (ink could not be determined)' : kdp.inkProfile === 'colour' ? 'premium_color (colour content found; standard colour needs 72+ pages)' : null } : null;
    if (objects && text && kdp.margins?.insideIn !== null && kdp.margins) {
      const transparencyFlattened = !(kdp.transparency.alphaLt1 || kdp.transparency.softMasks || kdp.transparency.imageSoftMasks || kdp.transparency.blendModes || kdp.transparency.groups);
      // Crop and trim marks sit outside the trim; a page box equal to the trim has no room for them.
      const trimPt = [profile.trimWidthIn * PT_PER_IN, profile.trimHeightIn * PT_PER_IN];
      const mediaIsTrim = objects.pages.every(page => Math.abs(page.widthPt - trimPt[0]) <= 0.01 && Math.abs(page.heightPt - trimPt[1]) <= 0.01);
      const minimumFontSizePt = kdp.minFontPt === null ? undefined : belowFloor(kdp.minFontPt) ? kdp.minFontPt : Math.max(FONT_FLOOR_PT, kdp.minFontPt);
      // Only what was observed goes in; unobserved keys stay out so the validator reports them as unknown.
      const interior = {
        fileId: fileUuid(bytes), mime: kdp.pdfVersion ? 'application/pdf' : 'application/octet-stream', byteLength: bytes.length,
        pageCount: objects.pageCount, widthIn: kdp.widthIn, heightIn: kdp.heightIn,
        pagesHaveConsistentDimensions: objects.consistentSize,
        singlePages: objects.pages.every(page => page.widthPt < page.heightPt),
        fontsEmbedded: kdp.fontsEmbedded, encrypted: kdp.encrypted, transparencyFlattened,
        containsAnnotationsOrBookmarks: kdp.annotations > 0 || kdp.outlines,
        ...(mediaIsTrim ? { containsCropOrTrimMarks: false } : {}),
        ...(kdp.placeholderScan?.ran ? { containsPlaceholderOrCreationMarks: kdp.placeholders.length > 0 } : {}),
        ...(minimumFontSizePt !== undefined ? { minimumFontSizePt } : {}),
      };
      kdp.observationNotes = {
        containsCropOrTrimMarks: mediaIsTrim ? 'observed false: every MediaBox equals the 6 × 9 in trim, so nothing can print outside it' : 'not observed: the MediaBox is larger than the trim',
        containsPlaceholderOrCreationMarks: kdp.placeholderScan?.ran ? `observed ${kdp.placeholders.length > 0}: text scan for ${PLACEHOLDERS.length} placeholder patterns` : 'not observed',
        minimumFontSizePt: kdp.minFont?.rule ?? null,
      };
      const noRasters = objects.images.length === 0 && objects.colour.inlineImages === 0 && objects.colour.streamsUnread === 0;
      const input = {
        profile, interior, aiGeneratedText: true,
        margins: { insideIn: kdp.margins.insideIn, outsideIn: kdp.margins.outsideIn, topIn: kdp.margins.topIn, bottomIn: kdp.margins.bottomIn },
        // An empty inventory is a fact only when the file holds no raster image at all.
        ...(noRasters ? { imagePlacements: [], imagePlacementInventoryComplete: true } : {}),
      };
      const coverObservation = coverPdfPath ? await attempt('cover pdf', async () => {
        const coverBytes = await readFile(coverPdfPath);
        const cover = await pdfObjects(coverBytes);
        return { fileId: fileUuid(coverBytes), mime: cover.version ? 'application/pdf' : 'application/octet-stream', byteLength: coverBytes.length, pageCount: cover.pageCount, widthIn: round(cover.pages[0].widthPt / PT_PER_IN, 4), heightIn: round(cover.pages[0].heightPt / PT_PER_IN, 4), pagesHaveConsistentDimensions: cover.consistentSize, fontsEmbedded: cover.unembeddedFonts.length === 0, encrypted: cover.encrypted, containsAnnotationsOrBookmarks: cover.annotations > 0 || cover.outlines };
      }) : null;
      if (coverObservation) input.cover = coverObservation;
      const result = await attempt('validatePaperbackMetadata', () => print.validatePaperbackMetadata(input));
      if (result) Object.assign(kdp, { status: result.status, findings: result.findings, geometry: result.geometry, ruleVersion: result.ruleVersion, observations: input });
      // A book under 24 pages is rejected at the profile and the validator stops there. Re-run it at the
      // minimum supported count purely to list what else it would say; this is labelled, never gated.
      if (result && !profileOk && objects.pageCount < 24) {
        const whatIf = await attempt('validatePaperbackMetadata (what-if)', () => print.validatePaperbackMetadata({ ...input, profile: { ...profile, pageCount: 24 }, interior: { ...interior, pageCount: 24 } }));
        if (whatIf) kdp.findingsAtMinimumPageCount = { note: 'Validator re-run with pageCount raised to 24 only to surface the remaining rules; not a measurement.', status: whatIf.status, counts: severityCounts(whatIf.findings), findings: whatIf.findings };
      }
    } else if (objects) {
      errors.push({ step: 'kdp', message: 'margins could not be measured; validator not run' });
    }

    // ---- K2: wrap cover geometry -------------------------------------------------
    const expected = profileOk ? await attempt('calculatePrintGeometry', () => print.calculatePrintGeometry(profile)) : null;
    const cover = { wrapPresent: false, reason: 'No wrap cover PDF exists: documentPdf (export-server.ts) prints the front cover as page 1 of the interior PDF, and no spine or back cover is generated anywhere.', expected };
    if (coverPdfPath && kdp.observations?.cover && expected) {
      const observed = kdp.observations.cover;
      const tolerance = DOCUMENTS.K2.toleranceIn;
      Object.assign(cover, {
        wrapPresent: true, reason: null, observed: { pages: observed.pageCount, widthIn: observed.widthIn, heightIn: observed.heightIn },
        deltaIn: { width: round(observed.widthIn - expected.coverWidthIn, 4), height: round(observed.heightIn - expected.coverHeightIn, 4) },
        withinTolerance: observed.pageCount === 1 && Math.abs(observed.widthIn - expected.coverWidthIn) <= tolerance && Math.abs(observed.heightIn - expected.coverHeightIn) <= tolerance,
      });
    }
    if (!expected && profile) cover.expectedNote = 'Profile rejected by KdpPaperbackProfileSchema (see kdp.findings), so print.ts gives no geometry.';

    // ---- K3: overflow and pictures --------------------------------------------
    const overflow = { count: null, pagesAffected: null, pages: [], method: 'bookHtml(print) in Chromium, body at the 4.56 in text block; full pages checked against 6 × 9 in' };
    let shots = [];
    if (activeBrowser && book?.kind === 'book') {
      const measured = await attempt('book overflow', () => bookOverflow(activeBrowser, book, imageUrls(images), controlCss));
      if (measured) {
        // Find each element's PDF page by its opening text, looking first at pages of the same kind
        // (a chapter title also appears on the contents page).
        const sameKind = item => item.kind === 'chapter' ? entry => !entry.display
          : item.kind === 'title-page' || item.kind === 'rights' ? entry => entry.kind === 'front' : entry => entry.kind === item.kind;
        overflow.pages = measured.found.map(item => {
          const needle = squash(item.text).slice(0, 30);
          const match = entry => entry.joined.includes(needle);
          const page = item.kind === 'cover' ? 1 : needle ? (pageKinds.find(entry => sameKind(item)(entry) && match(entry)) ?? pageKinds.find(match))?.page ?? null : null;
          return { page, ...item };
        });
        overflow.count = overflow.pages.length;
        overflow.pagesAffected = new Set(overflow.pages.map(item => item.page ?? `${item.kind}-${item.section ?? item.chapter}`)).size;
        overflow.fontStacks = measured.fontStacks;
      }
      if (shotsDir && bytes && text) {
        ensureDir(shotsDir);
        const opener = pageKinds.find(page => page.kind === 'opener')?.page ?? pageKinds.find(page => page.display && page.page > 1)?.page;
        const body = text.pages.filter(page => !pageKinds[page.page - 1].display && (!opener || page.page > opener)).sort((a, b) => b.items.length - a.items.length)[0]?.page;
        const wanted = [{ page: 1, role: 'cover' }, opener && { page: opener, role: 'opener' }, body && { page: body, role: 'body' }, { page: text.pages.length, role: 'last' }]
          .filter(Boolean).filter((entry, index, list) => list.findIndex(other => other.page === entry.page) === index);
        shots = await attempt('page pictures', () => pdfPagePictures(activeBrowser, bytes, wanted, shotsDir), []);
      }
    }
    for (const page of pageKinds) delete page.joined;

    const validatorErrors = kdp.findings.filter(finding => finding.severity === 'error').length;
    const harnessErrors = harness.filter(finding => finding.severity === 'error');
    // The validator stops at a rejected profile, so its unknowns are not a count of anything then.
    const profileRejected = Boolean(profile) && !profileOk;
    const pass = {
      // A harness error fails K1 even when the validator could not run; otherwise no validator run means not measured.
      K1: harnessErrors.length ? false : kdp.status === null ? null : validatorErrors <= DOCUMENTS.K1.maxErrors,
      K2: cover.wrapPresent ? Boolean(cover.withinTolerance) : false,
      K3: overflow.count === null ? null : overflow.count <= DOCUMENTS.K3.max,
    };
    const passDetail = {
      K1: {
        validatorErrors, harnessErrors: harnessErrors.length, harnessErrorCodes: harnessErrors.map(finding => finding.code),
        unknowns: profileRejected ? null : kdp.findings.filter(finding => finding.severity === 'unknown').length,
        warnings: profileRejected ? null : kdp.findings.filter(finding => finding.severity === 'warning').length,
        ...(profileRejected ? { profileRejected: true, unknownsNote: 'n/a: the validator stops at the rejected profile; see findingsAtMinimumPageCount', findingsAtMinimumPageCount: kdp.findingsAtMinimumPageCount?.counts ?? null } : {}),
        evenPageCount: kdp.pages ? kdp.pages % 2 === 0 : null,
        machineDependentExport: kdp.pdfFonts?.machineDependent ?? null,
      },
      K2: cover.wrapPresent ? 'measured' : 'fails: no wrap cover exists',
      K3: overflow.count === null ? 'not measured' : `${overflow.count} overflowing elements`,
    };
    const flags = kdp.pdfFonts?.machineDependent ? ['machine-dependent export'] : [];
    return { kind: 'book', title: book?.title ?? null, kdp, pageKinds: pageKinds.map(({ page, kind }) => ({ page, kind })), cover, overflow, shots, pass, passDetail, flags, errors };
  } finally {
    if (chromium) await chromium.close();
  }
}

function severityCounts(findings = []) {
  const count = severity => findings.filter(finding => finding.severity === severity).length;
  return { errors: count('error'), unknowns: count('unknown'), warnings: count('warning') };
}

// ---------------------------------------------------------------------------
// Self-test over the fixture books
// ---------------------------------------------------------------------------

const FIXTURES = [
  { id: 'pq-book-v3', document: () => readJson(path.join(REPO, 'outputs/product-qualification/book.json'))[0].content.document, pdf: 'outputs/product-qualification/book.pdf' },
  { id: 'fresh-book', document: () => readJson(path.join(REPO, 'outputs/fresh-product-quality-ac4b08bd-b91f-47bb-9956-c6d719505738/book/saved-version.json')).content.document, pdf: 'outputs/fresh-product-quality-ac4b08bd-b91f-47bb-9956-c6d719505738/book/document.pdf' },
  { id: 'derived-book-openings', document: () => readJson(path.join(REPO, 'outputs/derived-book-openings-ac4b08bd-b91f-47bb-9956-c6d719505738/saved-version.json')).content.document, pdf: 'outputs/derived-book-openings-ac4b08bd-b91f-47bb-9956-c6d719505738/document.pdf' },
];

/** One-line-per-fact summary of a book result (self-test and fixture runs). */
export function bookSummary(id, result, ms, file) {
  const k = result.kdp, t = k.transparency ?? {};
  const severities = severityCounts(k.findings);
  const lines = [
    `\n${id}: "${result.title}"${ms === undefined ? '' : ` (${ms} ms)`}${file ? ` -> ${rel(file)}` : ''}`,
    `  pdf ${k.pdfVersion}, ${k.pages} pages (effective ${k.effectivePages}), ${k.widthIn}x${k.heightIn} in, consistent=${k.consistentSize}, fonts ${k.fonts?.length}, unembedded=${k.unembeddedFonts.length}, type3=${k.type3Fonts}`,
    `  pdf fonts: embedded faces [${k.pdfFonts?.embeddedFaces?.join(', ')}], system [${k.pdfFonts?.systemFonts?.join(', ')}], other [${k.pdfFonts?.otherFonts?.join(', ')}], unnamed ${k.pdfFonts?.unnamedFonts}${k.pdfFonts?.machineDependent ? ' -> MACHINE-DEPENDENT EXPORT' : ''}`,
    `  transparency: ca/CA<1 x${t.alphaLt1} [${t.alphaValues}], groups ${t.groups}, smasks ${t.softMasks}+${t.imageSoftMasks}img, blend ${t.blendModes}; annots ${k.annotations}, outlines ${k.outlines} (${k.outlineEntries} entries, ${k.outlineTopLevel} top-level), encrypted ${k.encrypted}`,
    `  min font ${k.minFontPt} pt (below floor ${k.minFont?.text?.belowFloor}, items below 7 pt ${k.minFont?.itemsBelow7pt}; any glyph ${k.minFont?.anyGlyph?.pt} pt "${k.minFont?.anyGlyph?.sample}"); ink ${k.inkProfile} (colour ops ${k.inkEvidence?.colourOps}, max chroma ${k.inkEvidence?.maxChroma})`,
    `  margins (min over ${k.margins?.measuredPages} body pages): inside ${k.margins?.insideIn} outside ${k.margins?.outsideIn} top ${k.margins?.topIn} bottom ${k.margins?.bottomIn} in; display pages ${k.margins?.displayPages?.map(page => `${page.page}:${page.kind}`).join(' ')}`,
    `  trim edge: full-bleed pages ${k.trimEdge?.fullBleedPages?.length ?? 'n/a'}/${k.pages} (${k.trimEdge?.fullBleedColours?.join(', ') ?? ''}), partial edge ink ${k.trimEdge?.edgeInkPages?.length ?? 'n/a'}`,
    `  observations: cropOrTrimMarks=${k.observations?.interior?.containsCropOrTrimMarks}, placeholders=${k.observations?.interior?.containsPlaceholderOrCreationMarks}, minimumFontSizePt=${k.observations?.interior?.minimumFontSizePt}`,
    `  KDP validator: ${k.status} ${JSON.stringify(severities)}${k.findingsAtMinimumPageCount ? `; at 24 pages: ${k.findingsAtMinimumPageCount.status} ${JSON.stringify(k.findingsAtMinimumPageCount.counts)}` : ''}`,
    ...k.findings.map(finding => `    [${finding.severity}] ${finding.code}: ${finding.message}`),
    `  harness findings: ${k.harnessFindings.length}`,
    ...k.harnessFindings.map(finding => `    [${finding.severity}] ${finding.code}: ${finding.message.slice(0, 160)}`),
    `  cover: wrapPresent=${result.cover.wrapPresent}; expected ${result.cover.expected ? `${round(result.cover.expected.coverWidthIn, 4)} x ${result.cover.expected.coverHeightIn} in, spine ${round(result.cover.expected.spineWidthIn, 4)} in` : 'n/a'}`,
    `  overflow: ${result.overflow.count} elements on ${result.overflow.pagesAffected} pages${result.overflow.pages.slice(0, 3).map(item => `\n    p${item.page ?? '?'} ${item.kind} ${item.tag ?? ''}: ${item.reason} "${item.text.slice(0, 50)}"`).join('')}`,
    `  shots: ${result.shots.map(shot => path.basename(shot.file)).join(', ')}`,
    `  pass ${JSON.stringify(result.pass)}; K1 detail ${JSON.stringify(result.passDetail.K1)}; flags ${JSON.stringify(result.flags)}; errors ${result.errors.length}${result.errors.map(error => `\n    ${error.step}: ${error.message}`).join('')}`,
  ];
  console.log(lines.join('\n'));
}

/**
 * A synthetic 6 × 9 in interior for the K1 controls: `pages` pages of body
 * text inside 0.75 in margins with a folio, optionally a tinted page fill, a
 * title-only first page and one line at `smallPt`.
 */
async function controlPdf({ pages = 24, tint = null, coverTitle = null, smallPt = null, mediaIn = [6, 9] } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const [w, h] = mediaIn.map(value => value * PT_PER_IN);
  const ox = (w - 6 * PT_PER_IN) / 2, oy = (h - 9 * PT_PER_IN) / 2;
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage([w, h]);
    if (tint) page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(...tint) });
    if (n === 1 && coverTitle) {
      page.drawText(coverTitle, { x: ox + 54, y: oy + 400, size: 24, font });
      continue;
    }
    for (let line = 0; line < 30; line++) page.drawText(`Body line ${line + 1} on page ${n} of the control interior.`, { x: ox + 54, y: oy + 590 - line * 17, size: 10, font });
    if (smallPt && n === 3) page.drawText('Small print control line', { x: ox + 54, y: oy + 70, size: smallPt, font });
    page.drawText(String(n), { x: ox + 210, y: oy + 40, size: 9, font });
  }
  return Buffer.from(await pdf.save());
}

/** A static document face (fonts.ts DOCUMENT_FACES "Instrument Serif", @fontsource): Chromium embeds it as a named TrueType subset. */
const CONTROL_FACE = { family: 'Instrument Serif', file: path.join(REPO, 'node_modules', '@fontsource', 'instrument-serif', 'files', 'instrument-serif-latin-400-normal.woff2') };

/**
 * The K1 positive control: a 6 × 9 in interior that should pass K1. pdf-lib
 * cannot make it: without fontkit it embeds only the 14 standard fonts, which
 * it writes without a font file (unembedded, which the validator rightly
 * fails), and the Fontsource packages ship .woff/.woff2 only, which pdf-lib
 * cannot read. So Chromium prints it (page.pdf, as the app's exporter does)
 * from an HTML page whose only face is CONTROL_FACE, as a woff2 data: URL in
 * @font-face: white pages, 0.75 in margins, a folio on every page, no
 * outline, no links (no annotations), nothing translucent.
 */
async function embeddedFontControlPdf(browser, { pages = 24 } = {}) {
  const font = (await readFile(CONTROL_FACE.file)).toString('base64');
  const body = Array.from({ length: pages }, (_, index) => `<section class="page">${Array.from({ length: 28 }, (_, line) => `<p>Body line ${line + 1} on page ${index + 1} of the embedded-font control interior.</p>`).join('')}<div class="folio">${index + 1}</div></section>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Control</title><style>
@font-face{font-family:"${CONTROL_FACE.family}";font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${font}) format("woff2")}
@page{size:6in 9in;margin:0}
html,body{margin:0;background:#fff}
body{font:10pt/14pt "${CONTROL_FACE.family}";color:#000}
.page{position:relative;width:6in;height:9in;box-sizing:border-box;padding:0.75in;overflow:hidden;break-after:page}
.page:last-child{break-after:auto}
p{margin:0}
.folio{position:absolute;left:0;right:0;bottom:0.5in;text-align:center;font-size:9pt}
</style></head><body>${body}</body></html>`;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const loaded = await page.evaluate(family => document.fonts.check(`10pt "${family}"`), CONTROL_FACE.family);
    if (!loaded) throw new Error(`control face ${CONTROL_FACE.family} did not load`);
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: false, outline: false, tagged: false }));
  } finally {
    await context.close();
  }
}

async function selftest() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const base = path.join(OUT, 'selftest', 'docs');
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'makeborne-eval-book-controls-'));
  let failures = 0;
  try {
    for (const fixture of FIXTURES) {
      const pdfPath = path.join(REPO, fixture.pdf);
      if (!exists(pdfPath)) { console.log(`${fixture.id}: fixture missing (${fixture.pdf}), skipped`); continue; }
      const dir = path.join(base, fixture.id);
      const started = Date.now();
      const result = await measureBook({ document: fixture.document(), pdfPath, browser, shotsDir: path.join(dir, 'shots') });
      writeJson(path.join(dir, 'metrics.json'), result);
      bookSummary(fixture.id, result, Date.now() - started, path.join(dir, 'metrics.json'));
      if (result.errors.length) failures++;
      // Consistency of the one font-size rule: the reported minimum, the count below 7 pt and the validator agree.
      const k = result.kdp, validatorFindings = profileAccepted(k) ? k.findings : k.findingsAtMinimumPageCount?.findings ?? [];
      const fontError = validatorFindings.some(finding => finding.code === 'font_too_small');
      const consistent = k.minFont?.text ? k.minFont.text.belowFloor === (k.minFont.itemsBelow7pt > 0) && fontError === k.minFont.text.belowFloor : true;
      console.log(`  font-size rule consistent: ${consistent}`);
      if (!consistent) failures++;
    }
    // Negative control: paragraphs forced wider than the text block must be reported.
    const fixture = FIXTURES.find(entry => exists(path.join(REPO, entry.pdf)));
    if (fixture) {
      const control = await measureBook({ document: fixture.document(), pdfPath: path.join(REPO, fixture.pdf), browser, controlCss: '.chapter p{width:5in!important}' });
      const fired = control.overflow.count > 0;
      console.log(`\nnegative control (${fixture.id}, paragraphs at 5 in): ${control.overflow.count} overflowing elements -> ${fired ? 'detector fires' : 'DETECTOR DID NOT FIRE'}`);
      if (!fired) failures++;

      // K1 controls on synthetic 6 × 9 in interiors (written to the OS temp folder, never outputs/).
      const document = fixture.document();
      const controls = [
        // The one control that must PASS K1: an embedded document face, 24 white pages, nothing else wrong.
        { id: 'embedded font, 24 white pages (positive control: K1 passes)', make: () => embeddedFontControlPdf(browser), passesK1: true,
          expect: k => k.fontsEmbedded === true && k.pdfFonts.embeddedFaces.includes(CONTROL_FACE.family) && k.pdfFonts.machineDependent === false && k.pages === 24
            && k.harnessFindings.every(finding => finding.severity !== 'error') && k.findings.every(finding => finding.severity !== 'error') && k.status !== null
            && k.observations?.interior?.transparencyFlattened === true && k.observations?.interior?.containsAnnotationsOrBookmarks === false && k.trimEdge?.fullBleedPages.length === 0 },
        { id: 'white interior, folios, 7 pt floor respected (Helvetica, not embedded)', options: { smallPt: 6.995 }, expect: k => !hasCode(k, 'full_bleed_background') && !hasCode(k, 'cover_in_interior') && !k.findings.some(finding => finding.code === 'font_too_small') && k.minFont.itemsBelow7pt === 0 && k.observations?.interior?.containsCropOrTrimMarks === false && k.observations?.interior?.containsPlaceholderOrCreationMarks === false && k.fontsEmbedded === false },
        { id: 'page-filling tint in a no-bleed profile', options: { tint: [0.965, 0.945, 0.906] }, expect: k => hasCode(k, 'full_bleed_background') && k.trimEdge.fullBleedPages.length === 24, failsK1: true },
        { id: 'cover printed as interior page 1', options: { coverTitle: document.title, tint: null }, expect: k => hasCode(k, 'cover_in_interior'), failsK1: true },
        { id: '6.5 pt text', options: { smallPt: 6.5 }, expect: k => k.minFont.text.belowFloor && k.minFont.itemsBelow7pt > 0 && k.findings.some(finding => finding.code === 'font_too_small'), failsK1: true },
        { id: 'MediaBox larger than the trim (marks possible)', options: { mediaIn: [6.5, 9.5] }, expect: k => k.observations?.interior?.containsCropOrTrimMarks === undefined },
      ];
      for (const control of controls) {
        const file = path.join(tmp, `${control.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`);
        await writeFile(file, control.make ? await control.make() : await controlPdf(control.options));
        const result = await measureBook({ document, pdfPath: file, browser });
        const k = result.kdp;
        const ok = Boolean(control.expect(k)) && (!control.failsK1 || result.pass.K1 === false) && (!control.passesK1 || result.pass.K1 === true);
        const codes = [...k.harnessFindings.filter(finding => finding.severity === 'error').map(finding => finding.code), ...k.findings.filter(finding => finding.severity === 'error').map(finding => finding.code)];
        console.log(`control (${control.id}): K1=${result.pass.K1}; validator ${k.status}; errors [${[...new Set(codes)].join(', ')}]; fonts embedded ${k.fontsEmbedded} [${k.pdfFonts?.embeddedFaces?.join(', ') ?? ''}${k.unembeddedFonts.length ? `; not embedded: ${k.unembeddedFonts.join(', ')}` : ''}]; min font ${k.minFontPt} (below 7 pt: ${k.minFont?.itemsBelow7pt}); cropOrTrimMarks=${k.observations?.interior?.containsCropOrTrimMarks} -> ${ok ? 'as expected' : 'NOT AS EXPECTED'}`);
        if (!ok && control.passesK1) console.log(`  positive control detail: ${JSON.stringify({ findings: k.findings.map(finding => `${finding.severity} ${finding.code}: ${finding.message.slice(0, 120)}`), harness: k.harnessFindings.map(finding => `${finding.severity} ${finding.code}`), transparency: k.transparency, annotations: k.annotations, outlines: k.outlines, margins: k.margins && { insideIn: k.margins.insideIn, outsideIn: k.margins.outsideIn, topIn: k.margins.topIn, bottomIn: k.margins.bottomIn }, pdfFonts: k.pdfFonts, errors: result.errors })}`);
        if (!ok) failures++;
      }
    }
  } finally {
    await browser.close();
    await rm(tmp, { recursive: true, force: true });
  }
  if (failures) process.exitCode = 1;
}

const hasCode = (kdp, code) => kdp.harnessFindings.some(finding => finding.code === code && finding.severity === 'error');
const profileAccepted = kdp => !kdp.findings.some(finding => finding.code === 'invalid_profile_or_observation');

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv.includes('--selftest')) {
  selftest().catch(error => { console.error(error); process.exitCode = 1; });
}
