/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* PDF inspection only. AI keeps reading PDFs natively (every page is sent as
 * a document); this scan adds what the native path can't report: the page
 * count, whether a text layer exists (image-only scans are read visually),
 * encryption, and present-but-ignored scripts, actions and attachments.
 * Streams are inflated under strict limits; nothing is rendered or executed. */
const zlib = require('node:zlib');
const { IngestError } = require('./common.cjs');
const { Output } = require('./output.cjs');

function inspectPdf(bytes, limits) {
  const out = new Output(limits);
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  if (!raw.startsWith('%PDF-')) throw new IngestError('mime-mismatch', 'This file isn’t a PDF.');
  const encrypted = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(raw);
  const texts = [raw];
  let streams = 0, inflated = 0, textOperators = false, unreadableStreams = 0;
  const objectPattern = /\d+\s+\d+\s+obj\b/g;
  let match;
  while (!encrypted && (match = objectPattern.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endobj', start);
    const keyword = raw.indexOf('stream', start);
    if (keyword < 0 || (end >= 0 && keyword > end)) continue;
    const dict = raw.slice(start, keyword);
    let dataStart = keyword + 6;
    if (raw[dataStart] === '\r') dataStart++;
    if (raw[dataStart] === '\n') dataStart++;
    const dataEnd = raw.indexOf('endstream', dataStart);
    if (dataEnd < 0) break;
    objectPattern.lastIndex = dataEnd;
    if (++streams > limits.pdfStreams) { out.warn('This PDF has more internal streams than were checked; the page count and text check cover the first part.'); break; }
    // Pictures, fonts, attachments and metadata never hold page text: not inflated.
    if (/\/Subtype\s*\/(Image|Type1C|CIDFontType0C|OpenType)\b|\/Type\s*\/(EmbeddedFile|Metadata)\b|\/Length[123]\b/.test(dict)) continue;
    const filters = (/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dict)?.[1] || '').match(/\/[A-Za-z0-9]+/g) || [];
    let content = null;
    if (!filters.length) content = raw.slice(dataStart, dataEnd);
    else if (filters.length === 1 && filters[0] === '/FlateDecode') {
      const data = bytes.subarray(dataStart, dataEnd);
      try { content = zlib.inflateSync(data, { maxOutputLength: limits.pdfStreamBytes }).toString('latin1'); }
      catch (error) {
        if (error && (error.code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError)) throw new IngestError('archive-limit', 'Part of this PDF expands far beyond its size, so it was not opened. It may be damaged or built to exhaust the reader.');
        try { content = zlib.inflateSync(data, { maxOutputLength: limits.pdfStreamBytes, finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1'); }
        catch { unreadableStreams++; }
      }
      if (content) {
        inflated += content.length;
        if (inflated > limits.pdfInflatedBytes) { out.warn('This PDF is very large inside; the page count and text check cover the first part. AI still receives the whole PDF.'); content = null; break; }
      }
    }
    if (content === null) continue;
    if (/\/Type\s*\/ObjStm\b/.test(dict)) texts.push(content);
    else if (!/\/Subtype\s*\/(Image|XML|Form)\b/.test(dict) && /\bBT\b/.test(content) && /(?:\bTj|\bTJ|'|")\s/.test(content)) textOperators = true;
  }
  const all = texts.join('\n');
  const pageObjects = (all.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
  let counted = 0;
  // The page tree root carries the total: read /Count from each /Type /Pages dictionary.
  for (const found of all.matchAll(/\/Type\s*\/Pages(?![A-Za-z])/g)) {
    const open = all.lastIndexOf('<<', found.index), close = all.indexOf('>>', found.index);
    if (open < 0 || close < 0 || found.index - open > 4000 || close - found.index > 4000) continue;
    const count = /\/Count\s+(\d{1,7})/.exec(all.slice(open, close));
    if (count) counted = Math.max(counted, Number(count[1]));
  }
  const pages = counted || pageObjects;
  const fonts = /\/Font\b|\/BaseFont\b/.test(all);
  const images = /\/Subtype\s*\/Image\b/.test(all);
  if (!raw.slice(-2048).includes('%%EOF')) out.warn('This PDF doesn’t end cleanly and may be incomplete. If pages are missing, save it again.');
  if (/\/(JavaScript|JS)\b/.test(all)) out.unsupported.push({ kind: 'script', count: 1, detail: 'Scripts inside the PDF were not run.' });
  if (/\/(Launch|SubmitForm|ImportData|GoToR|GoToE)\b/.test(all)) out.unsupported.push({ kind: 'action', count: 1, detail: 'Actions that open programs, other files or send data were ignored.' });
  if (/\/EmbeddedFile\b/.test(all)) out.unsupported.push({ kind: 'embedded-object', count: 1, detail: 'Files attached inside the PDF were not opened.' });
  if (/\/URI\b/.test(all)) out.unsupported.push({ kind: 'hyperlink', count: 1, detail: 'Web links are kept as text only; no link was opened.' });
  if (unreadableStreams) out.warn(`${unreadableStreams} internal part${unreadableStreams === 1 ? '' : 's'} couldn’t be decompressed for this check; AI still receives the whole PDF.`);
  const textLayer = encrypted ? 'unknown' : textOperators ? 'present' : images ? 'absent' : fonts ? 'present' : 'unknown';
  out.details.pdf = { pages, textLayer, encrypted, pageObjects, countedPages: counted };
  const notes = [];
  if (textLayer === 'absent') notes.push('Scanned: no text layer was found, so AI reads the text visually, page by page. Check names and numbers that matter.');
  else if (textLayer === 'present') notes.push('A text layer was found. Pictures, charts and handwriting are read visually.');
  else notes.push('Whether every page has a text layer couldn’t be confirmed; AI reads each page visually as well.');
  out.coverage = { unit: 'pages', total: pages, read: pages, visual: 'native', notes };
  return { out, encrypted, pages, textLayer };
}

module.exports = { inspectPdf };
