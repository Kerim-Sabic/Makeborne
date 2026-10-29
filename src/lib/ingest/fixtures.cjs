/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* Test fixture builders for the ingestion checks: every file is generated in
 * memory, including deliberately hostile ones (lying sizes, bombs, external
 * relationships, encrypted containers). Never used by application code. */
const zlib = require('node:zlib');

/** entries: [{ name, data, store?, declaredSize?, flags? }] → ZIP bytes. */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8');
    const compressed = entry.store ? data : zlib.deflateRawSync(data);
    const name = Buffer.from(entry.name, 'utf8');
    const size = entry.declaredSize ?? data.length;
    const crc = zlib.crc32(data) >>> 0;
    const flags = (entry.flags ?? 0) | 0x800;
    const method = entry.store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const RELS = items => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target, external]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${escape(target)}"${external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
const TYPES = overrides => `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([part, type]) => `<Override PartName="/${part}" ContentType="${type}"/>`).join('')}</Types>`;
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';

const para = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;
const table = rows => `<w:tbl>${rows.map(row => `<w:tr>${row.map(cell => `<w:tc>${para(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
const STYLES = `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`;

/** body: inner XML of <w:body>; rels: extra [id, type, target, external]; parts: extra { name: data }. */
function docx({ body, rels = [], parts = {}, extraEntries = [] } = {}) {
  return zip([
    { name: '[Content_Types].xml', data: TYPES([['word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml']]) },
    { name: '_rels/.rels', data: RELS([['rId1', 'officeDocument', 'word/document.xml']]) },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body ?? para('Hello')}</w:body></w:document>` },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/_rels/document.xml.rels', data: RELS([['rIdStyles', 'styles', 'styles.xml'], ...rels]) },
    ...Object.entries(parts).map(([name, data]) => ({ name, data })),
    ...extraEntries,
  ]);
}

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
const shape = (text, type) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${type ? `<p:ph type="${type}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${String(text).split('\n').map(line => `<a:p><a:r><a:t>${escape(line)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
/** slides: [{ title, body, notes, hidden, extra (inner spTree XML), rels: [[id,type,target,external]], raw (whole slide XML) }] */
function pptx({ slides, parts = {} }) {
  const entries = [
    { name: '[Content_Types].xml', data: TYPES([['ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml']]) },
    { name: '_rels/.rels', data: RELS([['rId1', 'officeDocument', 'ppt/presentation.xml']]) },
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0"?><p:presentation ${P}><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: RELS(slides.map((_, index) => [`rId${index + 1}`, 'slide', `slides/slide${index + 1}.xml`])) },
  ];
  slides.forEach((slide, index) => {
    const n = index + 1;
    entries.push({ name: `ppt/slides/slide${n}.xml`, data: slide.raw ?? `<?xml version="1.0"?><p:sld ${P}${slide.hidden ? ' show="0"' : ''}><p:cSld><p:spTree>${slide.title ? shape(slide.title, 'title') : ''}${slide.body ? shape(slide.body) : ''}${slide.extra ?? ''}</p:spTree></p:cSld></p:sld>` });
    const rels = [...(slide.rels ?? [])];
    if (slide.notes) {
      rels.push(['rIdNotes', 'notesSlide', `../notesSlides/notesSlide${n}.xml`]);
      entries.push({ name: `ppt/notesSlides/notesSlide${n}.xml`, data: `<?xml version="1.0"?><p:notes ${P}><p:cSld><p:spTree>${shape(slide.notes, 'body')}</p:spTree></p:cSld></p:notes>` });
    }
    if (rels.length) entries.push({ name: `ppt/slides/_rels/slide${n}.xml.rels`, data: RELS(rels) });
  });
  for (const [name, data] of Object.entries(parts)) entries.push({ name, data });
  return zip(entries);
}

const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
/** sheets: [{ name, rows: [[cellXml...]] | raw, state }] with cell helpers below. */
function xlsx({ sheets, strings = [], numFmts = [], xfs = [0], date1904 = false, parts = {}, rels = [] }) {
  const entries = [
    { name: '[Content_Types].xml', data: TYPES([['xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml']]) },
    { name: '_rels/.rels', data: RELS([['rId1', 'officeDocument', 'xl/workbook.xml']]) },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0"?><workbook ${S}>${date1904 ? '<workbookPr date1904="1"/>' : ''}<sheets>${sheets.map((sheet, index) => `<sheet name="${escape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"${sheet.state ? ` state="${sheet.state}"` : ''}/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: RELS([...sheets.map((_, index) => [`rId${index + 1}`, 'worksheet', `worksheets/sheet${index + 1}.xml`]), ['rIdS', 'sharedStrings', 'sharedStrings.xml'], ['rIdT', 'styles', 'styles.xml'], ...rels]) },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0"?><sst ${S} count="${strings.length}">${strings.map(text => `<si><t xml:space="preserve">${escape(text)}</t></si>`).join('')}</sst>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0"?><styleSheet ${S}><numFmts>${numFmts.map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${escape(code)}"/>`).join('')}</numFmts><cellXfs>${xfs.map(id => `<xf numFmtId="${id}"/>`).join('')}</cellXfs></styleSheet>` },
  ];
  sheets.forEach((sheet, index) => entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheet.raw ?? `<?xml version="1.0"?><worksheet ${S}><sheetData>${sheet.rows.map((row, r) => `<row r="${r + 1}">${row.join('')}</row>`).join('')}</sheetData></worksheet>` }));
  for (const [name, data] of Object.entries(parts)) entries.push({ name, data });
  return zip(entries);
}
const cell = {
  n: (ref, value, style) => `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`,
  s: (ref, index) => `<c r="${ref}" t="s"><v>${index}</v></c>`,
  str: (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${escape(text)}</t></is></c>`,
  f: (ref, formula, cached, type) => `<c r="${ref}"${type ? ` t="${type}"` : ''}><f>${escape(formula)}</f>${cached === undefined ? '' : `<v>${escape(cached)}</v>`}</c>`,
  b: (ref, value) => `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`,
};

function pdfObjects(objects, trailerExtra = '') {
  let body = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const parts = [Buffer.from(body, 'latin1')];
  let length = parts[0].length;
  objects.forEach((object, index) => {
    const head = Buffer.from(`${index + 1} 0 obj\n`, 'latin1');
    const content = Buffer.isBuffer(object) ? object : Buffer.from(object, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    parts.push(head, content, tail); length += head.length + content.length + tail.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
const stream = (dict, data, compress = true) => {
  const bytes = compress ? zlib.deflateSync(Buffer.from(data, 'latin1')) : Buffer.from(data, 'latin1');
  return Buffer.concat([Buffer.from(`<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${bytes.length} >>\nstream\n`, 'latin1'), bytes, Buffer.from('\nendstream', 'latin1')]);
};
/** pages: number; textual: page streams with text operators (else an image XObject per page). */
function pdf({ pages = 1, textual = true, encrypted = false, script = false } = {}) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R' + (script ? ' /OpenAction << /S /JavaScript /JS (app.alert(1)) >>' : '') + ' >>'];
  const kids = Array.from({ length: pages }, (_, index) => `${3 + index * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let index = 0; index < pages; index++) {
    const content = 4 + index * 2;
    objects.push(textual
      ? `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${content} 0 R >>`
      : `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ${3 + pages * 2} 0 R >> >> /Contents ${content} 0 R >>`);
    objects.push(stream('', textual ? `BT /F1 24 Tf 72 700 Td (Page ${index + 1}) Tj ET` : 'q 612 0 0 792 0 0 cm /Im1 Do Q'));
  }
  if (!textual) objects.push(stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', '\x80'));
  if (encrypted) objects.push('<< /Filter /Standard /V 2 /R 3 /O <00> /U <00> /P -4 >>');
  return pdfObjects(objects, encrypted ? `/Encrypt ${objects.length} 0 R ` : '');
}

/** A compound-file container like Office's password-protected packages (header + stream names). */
function encryptedOffice() {
  const header = Buffer.alloc(1536);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header, 0);
  Buffer.from('EncryptionInfo', 'utf16le').copy(header, 512);
  Buffer.from('EncryptedPackage', 'utf16le').copy(header, 640);
  return header;
}
function legacyOffice() { const bytes = Buffer.alloc(1024); Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(bytes, 0); Buffer.from('WordDocument', 'utf16le').copy(bytes, 512); return bytes; }

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

module.exports = { zip, docx, para, table, pptx, shape, xlsx, cell, pdf, pdfObjects, stream, encryptedOffice, legacyOffice, PNG_1PX, RELS, escape, W, P, S };
