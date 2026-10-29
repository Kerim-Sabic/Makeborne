/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* PowerPoint (.pptx): slides in presentation order with title, body text,
 * tables, saved chart data, SmartArt text, speaker notes and embedded pictures.
 * Slides are not rendered to images in this version: coverage says so. */
const { openPackage, packageFindings, assertKind, readChart } = require('./ooxml.cjs');
const { kids, kid, attr, relId, find, textOf, local, elements } = require('./xml.cjs');
const { Output } = require('./output.cjs');
const { IngestError } = require('./common.cjs');

const FALLBACK = new Set(['Fallback']);
const TITLE = new Set(['title', 'ctrTitle']);

function parsePptx(bytes, limits) {
  const pkg = openPackage(bytes, limits);
  assertKind(pkg, 'pptx');
  const out = new Output(limits);
  const main = [...pkg.rels('').values()].find(rel => rel.type === 'officeDocument' && !rel.external)?.path || 'ppt/presentation.xml';
  const presentation = pkg.xml(main);
  const rels = pkg.rels(main);
  const ids = kids(kid(presentation, 'sldIdLst'), 'sldId');
  const total = ids.length;
  if (!total) throw new IngestError('malformed', 'This presentation has no slides.');
  const readable = Math.min(total, limits.slides);
  let read = 0, hidden = 0, notesCount = 0;
  for (let index = 0; index < readable; index++) {
    const number = index + 1;
    const rel = rels.get(relId(ids[index]));
    const slide = { index: number, title: '', hidden: false, body: [], notes: '', tables: [], images: [] };
    out.slides.push(slide);
    try {
      if (!rel || rel.external || !rel.path || !pkg.has(rel.path)) throw new Error('missing slide part');
      const root = pkg.xml(rel.path);
      slide.hidden = attr(root, 'show') === '0';
      if (slide.hidden) hidden++;
      const tree = kid(kid(root, 'cSld'), 'spTree');
      const location = `slide ${number}`;
      const shapes = [];
      collectShapes(tree, shapes);
      const titleShape = shapes.find(shape => local(shape.n) === 'sp' && TITLE.has(placeholder(shape)));
      slide.title = titleShape ? shapeText(titleShape) : '';
      out.heading(`Slide ${number}${slide.hidden ? ' (hidden)' : ''}${slide.title ? `: ${slide.title.replace(/\n/g, ' ')}` : ''}`, 2, location);
      const slideRels = pkg.rels(rel.path);
      for (const shape of shapes) {
        const kind = local(shape.n);
        if (shape === titleShape) continue;
        if (kind === 'sp') {
          if (['sldNum', 'dt', 'ftr'].includes(placeholder(shape))) continue;
          for (const paragraph of find(kid(shape, 'txBody'), 'p')) {
            const text = runText(paragraph);
            if (!text.trim()) continue;
            const level = Number(attr(kid(paragraph, 'pPr'), 'lvl') || 0);
            slide.body.push(text);
            out.paragraph(text, { location, ...(level ? { list: level + 1 } : {}) });
          }
        } else if (kind === 'graphicFrame') {
          for (const table of find(shape, 'tbl', FALLBACK)) {
            const rows = kids(table, 'tr').map(row => kids(row, 'tc').map(cell => find(kid(cell, 'txBody'), 'p').map(runText).filter(Boolean).join('\n')));
            const id = out.table(`Slide ${number} table`, rows, 1, location);
            if (id) slide.tables.push(id);
          }
          for (const chart of find(shape, 'chart', FALLBACK)) {
            const target = slideRels.get(relId(chart));
            if (!target || target.external || !target.path || !pkg.has(target.path)) continue;
            try {
              const data = readChart(pkg, target.path);
              if (data) { const id = out.table(`Slide ${number} chart${data.title ? `: ${data.title}` : ''} (saved chart data)`, [data.header, ...data.rows], 1, location); if (id) slide.tables.push(id); }
              else out.unsupported.push({ kind: 'chart', count: 1, detail: `A chart on slide ${number} has no saved data and wasn’t read.` });
            } catch (error) { out.missed(`A chart on slide ${number} couldn’t be read (${error.message || 'damaged'}).`); }
          }
          const diagram = find(shape, 'relIds', FALLBACK)[0];
          if (diagram) {
            const data = slideRels.get(relId(diagram, 'dm'));
            if (data && !data.external && data.path && pkg.has(data.path)) {
              try {
                const items = find(pkg.xml(data.path), 'pt').map(point => find(point, 't').map(textOf).join('').trim()).filter(Boolean);
                for (const item of items) { slide.body.push(item); out.paragraph(item, { location, list: 1 }); }
              } catch (error) { out.missed(`A diagram on slide ${number} couldn’t be read (${error.message || 'damaged'}).`); }
            }
          }
        } else if (kind === 'pic') {
          const blip = find(shape, 'blip', FALLBACK)[0];
          const target = blip ? slideRels.get(relId(blip, 'embed')) : undefined;
          if (target && !target.external && target.path && pkg.has(target.path)) {
            const id = out.images.add(pkg.read(target.path), target.path, location);
            if (id) { slide.images.push(id); out.image(id, location); }
          }
        }
      }
      const notesRel = [...slideRels.values()].find(item => item.type === 'notesSlide' && !item.external);
      if (notesRel?.path && pkg.has(notesRel.path)) {
        try {
          const notesShapes = [];
          collectShapes(kid(kid(pkg.xml(notesRel.path), 'cSld'), 'spTree'), notesShapes);
          slide.notes = notesShapes.filter(shape => local(shape.n) === 'sp' && placeholder(shape) === 'body').map(shapeText).filter(Boolean).join('\n');
          if (slide.notes) { notesCount++; out.note(`Speaker notes, slide ${number}`, slide.notes, location); }
        } catch (error) { out.missed(`Speaker notes on slide ${number} couldn’t be read (${error.message || 'damaged'}).`); }
      }
      read++;
    } catch (error) {
      if (error instanceof IngestError && error.problem === 'archive-limit') throw error;
      slide.error = error instanceof IngestError ? error.message : 'This slide is damaged and couldn’t be read.';
      out.missed(`Slide ${number} couldn’t be read.`);
    }
  }
  if (total > readable) out.missed(`Only the first ${readable} of ${total} slides were read (limit ${limits.slides} slides per file). Split the presentation to include the rest.`);
  if (hidden) out.warn(`${hidden} hidden slide${hidden === 1 ? ' is' : 's are'} included and marked “hidden”.`);
  packageFindings(pkg, out.unsupported);
  out.images.report(out.unsupported);
  out.details.pptx = { slides: total, hiddenSlides: hidden, slidesWithNotes: notesCount };
  out.coverage = { unit: 'slides', total, read, visual: 'not-rendered',
    notes: ['Slides were not rendered as pictures: layout, colours and drawn shapes aren’t seen. Text, tables, chart data, notes and embedded pictures are.'] };
  return out;
}

function collectShapes(tree, shapes) {
  for (const node of tree ? elements(tree) : []) {
    const name = local(node.n);
    if (name === 'grpSp') collectShapes(node, shapes);
    else if (name === 'AlternateContent') { const choice = kid(node, 'Choice') || kid(node, 'Fallback'); if (choice) collectShapes(choice, shapes); }
    else if (name === 'sp' || name === 'graphicFrame' || name === 'pic') shapes.push(node);
  }
}
function placeholder(shape) {
  const properties = kid(shape, 'nvSpPr') || kid(shape, 'nvPicPr') || kid(shape, 'nvGraphicFramePr');
  const ph = kid(kid(properties, 'nvPr'), 'ph');
  return ph ? (attr(ph, 'type') || 'body') : '';
}
function runText(paragraph) {
  let text = '';
  for (const child of paragraph.c) {
    if (typeof child === 'string') continue;
    const name = local(child.n);
    if (name === 'r' || name === 'fld') text += textOf(kid(child, 't'));
    else if (name === 'br') text += '\n';
  }
  return text;
}
const shapeText = shape => find(kid(shape, 'txBody'), 'p').map(runText).filter(text => text.trim()).join('\n');

module.exports = { parsePptx };
