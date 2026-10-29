/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* A deliberately small ZIP reader for Office packages. It reads the central
 * directory only, refuses anything ambiguous (ZIP64, multi-disk, duplicate or
 * escaping names, encrypted entries), checks every declared and actual size
 * against the limits before and while inflating, and verifies each CRC-32.
 * A lying header cannot make it inflate more than the per-entry limit. */
const zlib = require('node:zlib');
const { IngestError } = require('./common.cjs');

const bomb = detail => new IngestError('archive-limit', `This file expands far beyond its size (${detail}), so it was not opened. It may be damaged or built to exhaust the reader.`);
const malformed = detail => new IngestError('malformed', `This file’s package structure is damaged (${detail}). Save a fresh copy from the original app and attach that.`);

function u16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function u32(bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) + bytes[offset + 3] * 0x1000000; }

function findEnd(bytes) {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= min; offset--) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06
      && offset + 22 + u16(bytes, offset + 20) === bytes.length) return offset;
  }
  return -1;
}

/** @returns {{ entries: Map<string, object>, names: string[], read: (name: string) => Buffer, has: (name: string) => boolean, inflated: () => number }} */
function openZip(input, limits) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 22) throw malformed('too short');
  const end = findEnd(bytes);
  if (end < 0) throw malformed('no end record');
  const disk = u16(bytes, end + 4), cdDisk = u16(bytes, end + 6), onDisk = u16(bytes, end + 8), count = u16(bytes, end + 10);
  const cdSize = u32(bytes, end + 12), cdOffset = u32(bytes, end + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new IngestError('unsupported', 'This file uses a ZIP64 package, which isn’t supported for AI sources. Save a smaller copy.');
  if (disk !== 0 || cdDisk !== 0 || onDisk !== count) throw malformed('split archive');
  if (count > limits.zipEntries) throw bomb(`${count.toLocaleString('en-US')} parts; the limit is ${limits.zipEntries.toLocaleString('en-US')}`);
  if (cdOffset + cdSize > end) throw malformed('directory outside the file');
  const entries = new Map();
  let offset = cdOffset, declaredTotal = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || u32(bytes, offset) !== 0x02014b50) throw malformed('directory entry');
    const flags = u16(bytes, offset + 8), method = u16(bytes, offset + 10), crc = u32(bytes, offset + 16) >>> 0;
    const compressed = u32(bytes, offset + 20), size = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28), extraLength = u16(bytes, offset + 30), commentLength = u16(bytes, offset + 32);
    const local = u32(bytes, offset + 42);
    if (offset + 46 + nameLength > end) throw malformed('entry name');
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = (flags & 0x800) ? new TextDecoder('utf-8', { fatal: false }).decode(rawName) : Buffer.from(rawName).toString('latin1');
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name || name.length > 1024 || name.startsWith('/') || name.includes('\\') || name.includes('\u0000') || name.split('/').some(part => part === '..' || part === '.')) throw malformed('unsafe part name');
    if (entries.has(name)) throw malformed('duplicate part name');
    if (flags & 0x1) throw new IngestError('encrypted', 'This file is password-protected, so AI can’t read it. Remove the password, save a copy and attach that.');
    if (compressed === 0xffffffff || size === 0xffffffff) throw new IngestError('unsupported', 'This file uses a ZIP64 package, which isn’t supported for AI sources. Save a smaller copy.');
    if (local >= cdOffset) throw malformed('entry outside the file');
    if (size > limits.zipEntryBytes) throw bomb(`one part declares ${size.toLocaleString('en-US')} bytes`);
    if (size > limits.zipRatioFloorBytes && size > Math.max(1, compressed) * limits.zipRatio) throw bomb(`one part is ${Math.round(size / Math.max(1, compressed))}× its stored size`);
    declaredTotal += size;
    if (declaredTotal > limits.zipTotalBytes) throw bomb(`parts declare more than ${limits.zipTotalBytes.toLocaleString('en-US')} bytes`);
    entries.set(name, { name, flags, method, crc, compressed, size, local });
  }
  let inflated = 0;
  function read(name) {
    const entry = entries.get(name);
    if (!entry) throw malformed(`missing part ${name}`);
    const at = entry.local;
    if (at + 30 > bytes.length || u32(bytes, at) !== 0x04034b50) throw malformed('local header');
    const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
    const stop = start + entry.compressed;
    if (stop > bytes.length || stop > cdOffset) throw malformed('entry data outside the file');
    const data = bytes.subarray(start, stop);
    let output;
    if (entry.method === 0) {
      if (entry.compressed !== entry.size) throw malformed('stored size');
      output = Buffer.from(data);
    } else if (entry.method === 8) {
      try { output = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) }); }
      catch (error) {
        if (error && (error.code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError)) throw bomb('a part inflates past its declared size');
        throw malformed('compressed data');
      }
    } else throw new IngestError('unsupported', 'This file uses a compression method AI sources don’t support. Save a fresh copy from the original app.');
    if (output.length !== entry.size) throw malformed('size mismatch');
    if ((zlib.crc32(output) >>> 0) !== entry.crc) throw malformed('checksum mismatch');
    inflated += output.length;
    if (inflated > limits.zipTotalBytes) throw bomb('total expanded size');
    return output;
  }
  return { entries, names: [...entries.keys()], read, has: name => entries.has(name), inflated: () => inflated };
}

module.exports = { openZip };
