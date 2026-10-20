/* eslint-disable @typescript-eslint/no-require-imports -- Minimal, dependency-free sfnt/WOFF2 reader for offline font checks: the
 * character map (cmap formats 4 and 12) and the name table's family. WOFF2
 * never transforms cmap or name, so only the Brotli stream is decoded (node's
 * zlib has Brotli). Test-only: not imported by the application. */
const zlib = require("node:zlib");

const TAG = (bytes, at) => bytes.toString("latin1", at, at + 4);

function base128(bytes, state) {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    const byte = bytes[state.at++];
    if (index === 0 && byte === 0x80) throw new Error("WOFF2: leading zero in UIntBase128");
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error("WOFF2: UIntBase128 too long");
}

const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

/** Untransformed tables of a WOFF2 file: Map<tag, Buffer>. */
function woff2Tables(bytes) {
  if (TAG(bytes, 0) !== "wOF2") throw new Error("Not a WOFF2 file");
  const numTables = bytes.readUInt16BE(12), compressedLength = bytes.readUInt32BE(20);
  const state = {at: 48}, entries = [];
  for (let index = 0; index < numTables; index++) {
    const flags = bytes[state.at++];
    const tag = (flags & 0x3f) === 0x3f ? TAG(bytes, (state.at += 4) - 4) : KNOWN_TAGS[flags & 0x3f];
    const origLength = base128(bytes, state);
    const version = flags >> 6;
    // glyf/loca are transformed unless version 3; every other table unless version 0 (hmtx: 1).
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? base128(bytes, state) : origLength;
    entries.push({tag, length, transformed});
  }
  const stream = zlib.brotliDecompressSync(bytes.subarray(state.at, state.at + compressedLength));
  const tables = new Map();
  let offset = 0;
  for (const entry of entries) {
    if (!entry.transformed) tables.set(entry.tag, stream.subarray(offset, offset + entry.length));
    offset += entry.length;
  }
  return tables;
}

/** Tables of a TrueType/OpenType file (first font of a .ttc collection). */
function sfntTables(bytes, fontIndex = 0) {
  let base = 0;
  if (TAG(bytes, 0) === "ttcf") base = bytes.readUInt32BE(12 + 4 * fontIndex);
  const numTables = bytes.readUInt16BE(base + 4), tables = new Map();
  for (let index = 0; index < numTables; index++) {
    const record = base + 12 + 16 * index;
    const offset = bytes.readUInt32BE(record + 8), length = bytes.readUInt32BE(record + 12);
    tables.set(TAG(bytes, record), bytes.subarray(offset, offset + length));
  }
  return tables;
}

const fontTables = bytes => TAG(bytes, 0) === "wOF2" ? woff2Tables(bytes) : sfntTables(bytes);

/** Every code point mapped to a non-zero glyph by the best Unicode subtable. */
function codePoints(cmap) {
  const count = cmap.readUInt16BE(2), subtables = [];
  for (let index = 0; index < count; index++) {
    const platform = cmap.readUInt16BE(4 + 8 * index), encoding = cmap.readUInt16BE(6 + 8 * index), offset = cmap.readUInt32BE(8 + 8 * index);
    if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) subtables.push(offset);
  }
  const points = new Set();
  for (const offset of subtables) {
    const format = cmap.readUInt16BE(offset);
    if (format === 4) {
      const segments = cmap.readUInt16BE(offset + 6) / 2;
      const ends = offset + 14, starts = ends + 2 * segments + 2, deltas = starts + 2 * segments, ranges = deltas + 2 * segments;
      for (let segment = 0; segment < segments; segment++) {
        const end = cmap.readUInt16BE(ends + 2 * segment), start = cmap.readUInt16BE(starts + 2 * segment);
        const delta = cmap.readInt16BE(deltas + 2 * segment), rangeAt = ranges + 2 * segment, range = cmap.readUInt16BE(rangeAt);
        for (let point = start; point <= end && point !== 0xffff; point++) {
          let glyph;
          if (range === 0) glyph = (point + delta) & 0xffff;
          else {
            const raw = cmap.readUInt16BE(rangeAt + range + 2 * (point - start));
            glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
          }
          if (glyph) points.add(point);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12);
      for (let group = 0; group < groups; group++) {
        const at = offset + 16 + 12 * group, start = cmap.readUInt32BE(at), end = cmap.readUInt32BE(at + 4), glyph = cmap.readUInt32BE(at + 8);
        for (let point = start; point <= end; point++) if (glyph + point - start) points.add(point);
      }
    }
  }
  return points;
}

/** Family name (name ID 16, else 1) from the name table. */
function familyName(name) {
  const count = name.readUInt16BE(2), strings = name.readUInt16BE(4), found = {};
  for (let index = 0; index < count; index++) {
    const at = 6 + 12 * index, platform = name.readUInt16BE(at), id = name.readUInt16BE(at + 6);
    const length = name.readUInt16BE(at + 8), offset = name.readUInt16BE(at + 10);
    if ((id === 1 || id === 16) && (platform === 3 || platform === 0)) {
      const raw = name.subarray(strings + offset, strings + offset + length);
      let text = "";
      for (let char = 0; char + 1 < raw.length; char += 2) text += String.fromCharCode(raw.readUInt16BE(char));
      found[id] ??= text;
    }
  }
  return found[16] ?? found[1] ?? null;
}

function inspectFont(bytes) {
  const tables = fontTables(bytes);
  if (!tables.has("cmap")) throw new Error("Font has no cmap table");
  return {codePoints: codePoints(tables.get("cmap")), family: tables.has("name") ? familyName(tables.get("name")) : null};
}

module.exports = {inspectFont, woff2Tables, sfntTables, codePoints, familyName};
