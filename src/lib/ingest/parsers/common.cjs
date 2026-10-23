'use strict';
/* Shared pieces of the source parsers. Every parser in this folder is pure:
 * bytes in, a plain extraction object out. No file system, network, timers,
 * eval or dynamic module loading; the only Node built-in used is zlib (inflate).
 * The same files run in a worker thread locally and in the sandbox pattern in
 * production (docs/AGENT_HANDOFF.md, 23 Oct source-ingestion entry). */

/** Bump when any parser changes what it extracts for the same bytes. */
const EXTRACTION_VERSION = 'ingest-2026-10-23.1';

/** Processing limits. The worker host may lower (never raise) them per request. */
const DEFAULT_LIMITS = Object.freeze({
  // Archive (DOCX/PPTX/XLSX are ZIP packages).
  zipEntries: 2000, zipTotalBytes: 120_000_000, zipEntryBytes: 40_000_000,
  zipRatio: 200, zipRatioFloorBytes: 262_144,
  // XML.
  xmlNodes: 3_000_000, xmlDepth: 200,
  // Documents.
  pages: 100, slides: 200, sheets: 50, cells: 200_000, rows: 100_000, columns: 2000, csvFieldChars: 100_000,
  // Extracted output.
  textCharacters: 200_000, images: 12, imageBytes: 3_750_000, imagesTotalBytes: 15_000_000, imagePixels: 8000,
  // PDF scanning.
  pdfStreams: 20_000, pdfInflatedBytes: 80_000_000, pdfStreamBytes: 20_000_000,
});

class IngestError extends Error {
  /** @param {string} problem @param {string} message */
  constructor(problem, message) { super(message); this.name = 'IngestError'; this.problem = problem; }
}

function mergeLimits(overrides) {
  const limits = { ...DEFAULT_LIMITS };
  if (overrides && typeof overrides === 'object') for (const [key, value] of Object.entries(overrides)) {
    if (key in DEFAULT_LIMITS && Number.isSafeInteger(value) && value > 0) limits[key] = Math.min(value, DEFAULT_LIMITS[key]);
  }
  return Object.freeze(limits);
}

/** Column letters for a 0-based index (0 → A, 26 → AA). */
function columnName(index) {
  let name = '', n = index + 1;
  while (n > 0) { const r = (n - 1) % 26; name = String.fromCharCode(65 + r) + name; n = Math.floor((n - 1) / 26); }
  return name;
}
/** A1 reference → {row, col} (0-based) or null. */
function parseRef(ref) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref);
  if (!match) return null;
  let col = 0;
  for (const char of match[1]) col = col * 26 + (char.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}
const cellRef = (row, col) => `${columnName(col)}${row + 1}`;

/** Text that a spreadsheet application would run as a formula if pasted into a cell. */
const FORMULA_LIKE = /^[=+\-@\t\r]/;

function sniffImage(bytes) {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mediaType: 'image/png', width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { mediaType: 'image/gif', width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mediaType: 'image/jpeg', ...jpegSize(bytes) };
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { mediaType: 'image/webp', ...webpSize(bytes) };
  return null;
}
function readU32BE(bytes, offset) { return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]; }
function ascii(bytes, start, end) { let text = ''; for (let i = start; i < end && i < bytes.length; i++) text += String.fromCharCode(bytes[i]); return text; }
function jpegSize(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
    }
    offset += 2 + length;
  }
  return { width: 0, height: 0 };
}
function webpSize(bytes) {
  const chunk = ascii(bytes, 12, 16);
  if (chunk === 'VP8X') return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
  if (chunk === 'VP8L') { const b = bytes.subarray(21, 25); return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) }; }
  if (chunk === 'VP8 ') return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
  return { width: 0, height: 0 };
}

/** Collects embedded pictures under the image limits; everything refused is reported, never dropped silently. */
class ImageCollector {
  constructor(limits) { this.limits = limits; this.images = []; this.total = 0; this.skipped = { limit: 0, format: 0, size: 0 }; this.formats = new Set(); this.seen = new Map(); }
  add(bytes, part, location) {
    if (this.seen.has(part)) { const id = this.seen.get(part); if (id && location) { const image = this.images.find(item => item.id === id); if (image && !image.locations.includes(location)) image.locations.push(location); } return id; }
    const info = sniffImage(bytes);
    if (!info) { this.skipped.format++; this.formats.add((/\.([a-z0-9]{1,5})$/i.exec(part)?.[1] ?? 'unknown').toLowerCase()); this.seen.set(part, null); return null; }
    if (bytes.length > this.limits.imageBytes || !info.width || !info.height || info.width > this.limits.imagePixels || info.height > this.limits.imagePixels) { this.skipped.size++; this.seen.set(part, null); return null; }
    if (this.images.length >= this.limits.images || this.total + bytes.length > this.limits.imagesTotalBytes) { this.skipped.limit++; this.seen.set(part, null); return null; }
    const id = `image-${this.images.length + 1}`;
    this.total += bytes.length;
    this.images.push({ id, part, mediaType: info.mediaType, width: info.width, height: info.height, bytes: bytes.length, data: Buffer.from(bytes).toString('base64'), locations: location ? [location] : [] });
    this.seen.set(part, id);
    return id;
  }
  report(unsupported) {
    if (this.skipped.format) unsupported.push({ kind: 'image-format', count: this.skipped.format, detail: `${this.skipped.format} picture${this.skipped.format === 1 ? '' : 's'} in a format AI can’t view (${[...this.formats].join(', ')}) ${this.skipped.format === 1 ? 'was' : 'were'} not shown to AI.` });
    if (this.skipped.size) unsupported.push({ kind: 'image-size', count: this.skipped.size, detail: `${this.skipped.size} picture${this.skipped.size === 1 ? ' is' : 's are'} too large to show to AI and ${this.skipped.size === 1 ? 'was' : 'were'} not included.` });
    if (this.skipped.limit) unsupported.push({ kind: 'image-limit', count: this.skipped.limit, detail: `${this.skipped.limit} more picture${this.skipped.limit === 1 ? '' : 's'} beyond the ${this.limits.images}-picture limit ${this.skipped.limit === 1 ? 'was' : 'were'} not shown to AI.` });
  }
}

module.exports = { EXTRACTION_VERSION, DEFAULT_LIMITS, IngestError, mergeLimits, columnName, parseRef, cellRef, FORMULA_LIKE, sniffImage, ImageCollector };
