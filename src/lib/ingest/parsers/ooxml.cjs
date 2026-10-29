/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* Office Open XML package helpers shared by DOCX, PPTX and XLSX. Only parts
 * reached through internal relationships are read. External relationships
 * (TargetMode="External": linked images, remote templates, linked workbooks,
 * hyperlinks) are never followed or fetched; non-link ones are reported. Macro
 * projects, ActiveX controls and embedded objects are reported as present and
 * ignored. Nothing here executes or evaluates document content. */
const { openZip } = require('./zip.cjs');
const { parseXml, kids, kid, attr, find, textOf } = require('./xml.cjs');
const { IngestError } = require('./common.cjs');

const MAIN_PARTS = { docx: 'word/document.xml', pptx: 'ppt/presentation.xml', xlsx: 'xl/workbook.xml' };
const KIND_LABEL = { docx: 'a Word document', pptx: 'a PowerPoint presentation', xlsx: 'an Excel workbook' };

/** Which Office document a ZIP package actually is (by its parts), or null. */
function packageKind(zip) {
  for (const [kind, part] of Object.entries(MAIN_PARTS)) if (zip.has(part)) return kind;
  return null;
}

function resolveTarget(source, target) {
  if (target.startsWith('/')) return normalise(target.slice(1));
  const folder = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
  // Relationship parts live in "<folder>/_rels/<part>.rels" and point relative to <folder>.
  return normalise(folder + target);
}
function normalise(path) {
  const parts = [];
  for (const part of decodeURIComponentSafe(path).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join('/');
}
function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch { return value; } }
const shortType = type => (type || '').split('/').pop() || 'link';

function openPackage(bytes, limits) {
  const zip = openZip(bytes, limits);
  const xmlCache = new Map();
  const report = { externalLinks: 0, externalOther: new Map(), parts: zip.names.length };
  function xml(part) {
    if (xmlCache.has(part)) return xmlCache.get(part);
    const root = parseXml(zip.read(part), limits);
    xmlCache.set(part, root);
    return root;
  }
  const relsCache = new Map();
  /** Internal relationships of a part; external ones are counted, never returned as readable. */
  function rels(part) {
    if (relsCache.has(part)) return relsCache.get(part);
    const folder = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : '';
    const relsPart = `${folder}_rels/${part.slice(folder.length)}.rels`;
    const result = new Map();
    if (zip.has(relsPart)) {
      for (const rel of kids(xml(relsPart), 'Relationship')) {
        const id = attr(rel, 'Id'), type = attr(rel, 'Type') || '', target = attr(rel, 'Target') || '';
        if (!id) continue;
        if ((attr(rel, 'TargetMode') || '').toLowerCase() === 'external') {
          if (shortType(type) === 'hyperlink') report.externalLinks++;
          else report.externalOther.set(shortType(type), (report.externalOther.get(shortType(type)) || 0) + 1);
          result.set(id, { id, type: shortType(type), external: true, path: null });
          continue;
        }
        result.set(id, { id, type: shortType(type), external: false, path: resolveTarget(part, target) });
      }
    }
    relsCache.set(part, result);
    return result;
  }
  return { zip, xml, rels, report, has: name => zip.has(name), read: name => zip.read(name) };
}

/** Present-but-ignored package content, in customer words. */
function packageFindings(pkg, unsupported) {
  const names = pkg.zip.names;
  // Count every relationship part so links from parts we never open are still reported.
  for (const name of names) if (name.endsWith('.rels')) {
    const owner = name.replace(/_rels\/([^/]+)\.rels$/, '$1');
    try { pkg.rels(owner === name ? '' : owner); } catch { /* A damaged relationship part is reported where it is needed. */ }
  }
  const macros = names.filter(name => /vbaProject\.bin$/i.test(name) || /vbaData\.xml$/i.test(name)).length;
  if (macros) unsupported.push({ kind: 'macros', count: 1, detail: 'Macros are present. They were not run and their code was not read.' });
  const activeX = names.filter(name => /\/activeX\/[^/]+\.(xml|bin)$/i.test(name)).length;
  if (activeX) unsupported.push({ kind: 'activex', count: activeX, detail: `${activeX} interactive control${activeX === 1 ? '' : 's'} (ActiveX) ignored.` });
  const embedded = names.filter(name => /\/embeddings\/[^/]+$/i.test(name)).length;
  if (embedded) unsupported.push({ kind: 'embedded-object', count: embedded, detail: `${embedded} embedded file${embedded === 1 ? '' : 's'} or object${embedded === 1 ? '' : 's'} (such as another workbook or document) not opened.` });
  if (pkg.report.externalOther.size) {
    const total = [...pkg.report.externalOther.values()].reduce((sum, value) => sum + value, 0);
    unsupported.push({ kind: 'external-relationship', count: total, detail: `${total} link${total === 1 ? '' : 's'} to outside content (${[...pkg.report.externalOther.keys()].join(', ')}) ignored; nothing was downloaded.` });
  }
  if (pkg.report.externalLinks) unsupported.push({ kind: 'hyperlink', count: pkg.report.externalLinks, detail: `${pkg.report.externalLinks} web link${pkg.report.externalLinks === 1 ? '' : 's'} kept as text only; no link was opened.` });
}

/** Saved chart data (the cached values Office stores with every chart) as a table. */
function readChart(pkg, part) {
  const root = pkg.xml(part);
  const titleNode = kid(kid(root, 'chart'), 'title');
  const title = titleNode ? find(titleNode, 't').map(textOf).join('').trim() : '';
  const plot = kid(kid(root, 'chart'), 'plotArea');
  const series = [];
  let chartType = '';
  for (const group of plot ? plot.c.filter(child => typeof child !== 'string' && /Chart$/.test(child.n.split(':').pop())) : []) {
    chartType ||= group.n.split(':').pop().replace(/Chart$/, '');
    for (const ser of kids(group, 'ser')) {
      const name = find(kid(ser, 'tx') || { c: [] }, 'v').map(textOf).join('').trim() || `Series ${series.length + 1}`;
      const cats = cache(kid(ser, 'cat') || kid(ser, 'xVal'));
      const vals = cache(kid(ser, 'val') || kid(ser, 'yVal'));
      series.push({ name, categories: cats, values: vals });
    }
  }
  if (!series.length) return null;
  const length = Math.max(...series.map(item => Math.max(item.categories.length, item.values.length)));
  const header = ['Category', ...series.map(item => item.name)];
  const rows = [];
  for (let index = 0; index < length; index++) rows.push([series[0].categories[index] ?? String(index + 1), ...series.map(item => item.values[index] ?? '')]);
  return { title, chartType, header, rows };
}
function cache(node) {
  if (!node) return [];
  const container = find(node, 'numCache')[0] || find(node, 'strCache')[0] || find(node, 'multiLvlStrCache')[0];
  if (!container) return [];
  const values = [];
  for (const pt of find(container, 'pt')) {
    const index = Number(attr(pt, 'idx'));
    if (Number.isSafeInteger(index) && index >= 0 && index < 100_000) values[index] = textOf(kid(pt, 'v')).trim();
  }
  return Array.from(values, value => value ?? '');
}

/** OLE compound file (legacy .doc/.xls/.ppt, or an encrypted OOXML package). */
function isCompoundFile(bytes) {
  return bytes.length >= 512 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 && bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1;
}
/** Encrypted Office files are CFB containers with "EncryptionInfo" and "EncryptedPackage" streams (names stored as UTF-16LE). */
function isEncryptedPackage(bytes) {
  const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return haystack.includes(Buffer.from('EncryptedPackage', 'utf16le')) && haystack.includes(Buffer.from('EncryptionInfo', 'utf16le'));
}
function assertKind(pkg, expected) {
  const actual = packageKind(pkg.zip);
  if (actual !== expected) throw new IngestError('mime-mismatch', actual
    ? `This file is named as ${KIND_LABEL[expected]} but its contents are ${KIND_LABEL[actual]}. Rename it with the right extension, or save it again.`
    : `This file is named as ${KIND_LABEL[expected]} but its contents are a different kind of ZIP archive. AI can’t read archives; attach the document itself.`);
}

module.exports = { openPackage, packageFindings, packageKind, readChart, isCompoundFile, isEncryptedPackage, assertKind, KIND_LABEL, MAIN_PARTS };
