/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* Word (.docx): body text with headings, lists, tables, text boxes, saved chart
 * data and embedded pictures; then headers, footers, footnotes, endnotes and
 * comments. Field codes are never evaluated (their last saved result is kept),
 * tracked deletions are left out, linked content is never fetched. */
const { openPackage, packageFindings, assertKind, readChart } = require('./ooxml.cjs');
const { kids, kid, attr, relId, find, textOf, local, elements } = require('./xml.cjs');
const { Output } = require('./output.cjs');
const { IngestError } = require('./common.cjs');

function parseDocx(bytes, limits) {
  const pkg = openPackage(bytes, limits);
  assertKind(pkg, 'docx');
  const out = new Output(limits);
  const rootRels = pkg.rels('');
  const main = [...rootRels.values()].find(rel => rel.type === 'officeDocument' && !rel.external)?.path || 'word/document.xml';
  if (!pkg.has(main)) throw new IngestError('malformed', 'This Word file has no document body. Save a fresh copy and attach that.');
  const document = pkg.xml(main);
  const body = kid(document, 'body');
  if (!body) throw new IngestError('malformed', 'This Word file has no document body. Save a fresh copy and attach that.');
  const styles = readStyles(pkg, main);
  const counters = { deletions: 0, fields: 0, altChunks: 0, smartArt: 0, equations: 0, paragraphs: 0, hidden: 0 };
  const context = { pkg, out, part: main, styles, counters };
  walkBlocks(body, context);

  const rels = pkg.rels(main);
  const extra = [['header', 'Header'], ['footer', 'Footer'], ['footnotes', 'Footnote'], ['endnotes', 'Endnote'], ['comments', 'Comment']];
  const seen = new Set();
  for (const [type, label] of extra) {
    for (const rel of rels.values()) {
      if (rel.type !== type || rel.external || !rel.path || !pkg.has(rel.path)) continue;
      try {
        const root = pkg.xml(rel.path);
        const items = type === 'footnotes' || type === 'endnotes' ? kids(root, type === 'footnotes' ? 'footnote' : 'endnote').filter(node => !/separator/i.test(attr(node, 'type') || ''))
          : type === 'comments' ? kids(root, 'comment') : [root];
        for (const item of items) {
          const text = find(item, 'p').map(paragraph => paragraphText(paragraph, { ...context, part: rel.path })).filter(Boolean).join('\n');
          if (text && !seen.has(`${label}\u0000${text}`)) { seen.add(`${label}\u0000${text}`); out.note(label, text); }
        }
      } catch (error) {
        if (error instanceof IngestError && error.problem === 'archive-limit') throw error;
        out.missed(`The ${label.toLowerCase()} part couldn’t be read (${error.message || 'damaged'}).`); }
    }
  }
  if (counters.hidden) out.warn(`${counters.hidden} passage${counters.hidden === 1 ? ' is' : 's are'} hidden in the document (formatted as hidden text) and may not be meant for readers; ${counters.hidden === 1 ? 'it is' : 'they are'} marked “[hidden in the document: …]”.`);
  if (counters.deletions) out.warn(`${counters.deletions} tracked deletion${counters.deletions === 1 ? '' : 's'} left out; inserted text is included.`);
  if (counters.fields) out.warn(`${counters.fields} field${counters.fields === 1 ? '' : 's'} (such as page numbers or cross-references) shown as last saved; fields were not updated.`);
  if (counters.altChunks) out.unsupported.push({ kind: 'embedded-object', count: counters.altChunks, detail: `${counters.altChunks} imported content block${counters.altChunks === 1 ? '' : 's'} (HTML or RTF inside the document) not read.` });
  if (counters.equations) out.unsupported.push({ kind: 'equation', count: counters.equations, detail: `${counters.equations} equation${counters.equations === 1 ? '' : 's'} read as plain text only.` });
  packageFindings(pkg, out.unsupported);
  out.images.report(out.unsupported);
  const pages = Number(textOf(find(safeXml(pkg, 'docProps/app.xml'), 'Pages')[0]) || 0);
  out.details.docx = { paragraphs: counters.paragraphs, tables: out.tables.length, ...(pages > 0 ? { savedPageCount: pages } : {}) };
  out.coverage = { unit: 'paragraphs', total: counters.paragraphs, read: counters.paragraphs, visual: 'not-rendered',
    notes: [pages > 0 ? `About ${pages} page${pages === 1 ? '' : 's'} when last saved (page layout isn’t reproduced).` : 'Page layout isn’t reproduced.'] };
  return out;
}

function safeXml(pkg, part) { try { return pkg.has(part) ? pkg.xml(part) : null; } catch { return null; } }

function readStyles(pkg, main) {
  const map = new Map();
  const rel = [...pkg.rels(main).values()].find(item => item.type === 'styles' && !item.external);
  const root = rel?.path ? safeXml(pkg, rel.path) : safeXml(pkg, 'word/styles.xml');
  for (const style of kids(root, 'style')) {
    const id = attr(style, 'styleId');
    if (!id) continue;
    const name = (attr(kid(style, 'name'), 'val') || '').toLowerCase();
    const outline = attr(kid(kid(style, 'pPr'), 'outlineLvl'), 'val');
    let level = 0;
    if (name === 'title') level = 1;
    else if (/^heading \d$/.test(name)) level = Number(name.slice(8));
    else if (outline !== undefined && Number(outline) < 9) level = Number(outline) + 1;
    map.set(id, { level, list: /list/.test(name) });
  }
  return map;
}

function walkBlocks(container, context) {
  for (const node of elements(container)) {
    const name = local(node.n);
    if (name === 'p') paragraphBlock(node, context);
    else if (name === 'tbl') tableBlock(node, context);
    else if (name === 'sdt') walkBlocks(kid(node, 'sdtContent') || { c: [] }, context);
    else if (name === 'customXml' || name === 'smartTag' || name === 'ins') walkBlocks(node, context);
    else if (name === 'altChunk') context.counters.altChunks++;
    else if (name === 'AlternateContent') { const choice = kid(node, 'Choice') || kid(node, 'Fallback'); if (choice) walkBlocks(choice, context); }
  }
}

function paragraphBlock(node, context) {
  context.counters.paragraphs++;
  const properties = kid(node, 'pPr');
  const styleId = attr(kid(properties, 'pStyle'), 'val');
  const style = styleId ? context.styles.get(styleId) : undefined;
  const outline = attr(kid(properties, 'outlineLvl'), 'val');
  const level = style?.level || (outline !== undefined && Number(outline) < 9 ? Number(outline) + 1 : 0);
  const numbered = kid(properties, 'numPr');
  const pending = [];
  const text = paragraphText(node, context, pending);
  if (level) context.out.heading(text, level);
  else if (numbered || style?.list) context.out.paragraph(text, { list: Number(attr(kid(numbered, 'ilvl'), 'val') || 0) + 1 });
  else context.out.paragraph(text);
  for (const item of pending) item();
}

/** A run formatted as hidden text (w:vanish / w:specVanish, unless switched off with val 0/false/off). */
function hiddenRun(run) {
  const properties = kid(run, 'rPr');
  const vanish = kid(properties, 'vanish') || kid(properties, 'specVanish');
  return Boolean(vanish) && !['0', 'false', 'off'].includes(String(attr(vanish, 'val') ?? '').toLowerCase());
}

/** Text of one paragraph. Pictures, charts and text boxes found inside are queued after it. */
function paragraphText(node, context, pending = []) {
  let text = '';
  const visit = current => {
    for (const child of current.c) {
      if (typeof child === 'string') continue;
      const name = local(child.n);
      if (name === 't') text += textOf(child);
      else if (name === 'tab') text += '\t';
      else if (name === 'br' || name === 'cr') text += '\n';
      else if (name === 'noBreakHyphen') text += '-';
      else if (name === 'del' || name === 'moveFrom') context.counters.deletions++;
      else if (name === 'delText' || name === 'pPr' || name === 'rPr') continue;
      else if (name === 'instrText') context.counters.fields++;
      else if (name === 'oMath' || name === 'oMathPara') { context.counters.equations++; text += find(child, 't').map(textOf).join(''); }
      else if (name === 'drawing' || name === 'pict' || name === 'object') pending.push(...drawing(child, context));
      else if (name === 'r' && hiddenRun(child)) {
        // Hidden text (w:vanish) is not shown to readers of the document: mark it so the model never takes it as ordinary content.
        const before = text; text = ''; visit(child); const hidden = text; text = before;
        if (hidden.trim()) { context.counters.hidden = (context.counters.hidden ?? 0) + 1; text += `[hidden in the document: ${hidden}]`; }
      }
      else if (name === 'AlternateContent') { const choice = kid(child, 'Choice') || kid(child, 'Fallback'); if (choice) visit(choice); }
      else if (name === 'footnoteReference' || name === 'endnoteReference') text += '*';
      else visit(child);
    }
  };
  visit(node);
  return text;
}

/** Office stores a modern drawing plus a legacy fallback copy of it: read only the first. */
const FALLBACK = new Set(['Fallback']);
function drawing(node, context) {
  const queued = [];
  const rels = context.pkg.rels(context.part);
  for (const box of find(node, 'txbxContent', FALLBACK)) queued.push(() => walkBlocks(box, context));
  for (const blip of [...find(node, 'blip', FALLBACK), ...find(node, 'imagedata', FALLBACK)]) {
    const rel = rels.get(relId(blip, 'embed') || relId(blip, 'id'));
    if (!rel || rel.external || !rel.path || !context.pkg.has(rel.path)) continue;
    const path = rel.path;
    queued.push(() => { try { context.out.image(context.out.images.add(context.pkg.read(path), path)); } catch { context.out.images.skipped.format++; } });
  }
  for (const chart of find(node, 'chart', FALLBACK)) {
    const rel = rels.get(relId(chart));
    if (!rel || rel.external || !rel.path || !context.pkg.has(rel.path)) continue;
    const path = rel.path;
    queued.push(() => {
      try {
        const data = readChart(context.pkg, path);
        if (data) context.out.table(`Chart${data.title ? `: ${data.title}` : ''} (saved chart data)`, [data.header, ...data.rows]);
        else context.out.unsupported.push({ kind: 'chart', count: 1, detail: 'A chart without saved data wasn’t read.' });
      } catch (error) { context.out.missed(`A chart couldn’t be read (${error.message || 'damaged'}).`); }
    });
  }
  if (find(node, 'relIds', FALLBACK).length) context.out.unsupported.push({ kind: 'smartart', count: 1, detail: 'A SmartArt diagram was read as its text only.' });
  return queued;
}

function tableBlock(node, context) {
  const rows = [];
  let headerRows = 0;
  for (const [index, row] of kids(node, 'tr').entries()) {
    if (index === headerRows && kid(kid(row, 'trPr'), 'tblHeader')) headerRows++;
    rows.push(kids(row, 'tc').map(cell => kids(cell, 'p').map(paragraph => paragraphText(paragraph, context)).filter(Boolean).join('\n')
      + find(cell, 'tbl').map(inner => `\n${kids(inner, 'tr').map(r => kids(r, 'tc').map(c => textOf(c).trim()).join(' | ')).join('\n')}`).join('')));
  }
  context.counters.paragraphs++;
  context.out.table('Table', rows, headerRows || 1);
}

module.exports = { parseDocx };
