// Deck instrument: P1–P6 from QUALITY_BAR.md §4.
//
// P1 editable text   word recall of the document's visible slide text among the
//                    VISIBLE native <a:t> runs of the exported .pptx (multiset, per
//                    slide). Not visible: shapes with hidden="1", boxes outside the
//                    slide (p:sldSz), runs under 6 pt, and text covered by a
//                    full-slide or opaque picture, or an opaque filled shape, above
//                    it in z-order. Plus an order check: per text shape, the longest
//                    common subsequence of its words with the slide's source words
//                    (≥ 0.95 on every slide).
// P2 native charts   document charts whose c:chart part carries the document's
//                    values (c:val numeric caches), categories and series names
// P3 overflow        deckHtml(print) in Chromium at 1280×720 with the embedded
//                    faces; the text-box check of scripts/render-document-quality.cjs,
//                    plus images, placeholders and charts past the canvas and any
//                    element entirely outside it. The faces Chromium actually used
//                    are read over CDP (CSS.getPlatformFontsForNode): a system
//                    fallback is flagged "machine-dependent render".
// P4 current fit warnings (today's composer)
//                    what DocumentEditor.problems() would accept on a second finish
//                    (scene fit issues + deckRhythmIssues, editor.ts), recomputed
//                    from the document with the current renderer
// P5 rotation        the same slide LAYOUT three slides in a row; composition repeats
//                    (planDeck ids, rotated by the renderer) are information only
// P6 speaker notes   content slides whose PPTX notes slide recalls ≥ 95% of the
//                    document's notes words
//
// The scene, plan and editor checks run the app's own modules (app-modules.cjs),
// so they describe the deck as the current renderer composes it; the .pptx and
// .pdf are read as exported. Offline: no network, no providers.
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { DOCUMENTS } from '../thresholds.mjs';
import { OUT, REPO, ensureDir, exists, readJson, rel, writeJson } from '../paths.mjs';
import { pdfFontFaces, pdfObjects } from './book.mjs';

const require = createRequire(import.meta.url);
const { loadApp } = require('../app-modules.cjs');

let modules;
function app() {
  modules ??= {
    schema: loadApp('src/lib/documents/schema.ts'),
    render: loadApp('src/lib/documents/render-deck.ts'),
    scene: loadApp('src/lib/documents/slide-scene.ts'),
    editor: loadApp('src/lib/documents/editor.ts'),
    fonts: loadApp('src/lib/documents/fonts-server.ts'),
    theme: loadApp('src/lib/documents/theme.ts'),
  };
  return modules;
}

/** Layouts that frame a deck rather than carry content (as deckRhythmIssues counts them). */
const FRAME_LAYOUTS = new Set(['cover', 'section', 'closing']);
const round = (value, digits = 4) => value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(digits));

/** Runs below this size (hundredths of a point) are not readable slide text. */
const MIN_RUN_SZ = 600;
/** A text box counts as covered when this share of it lies under an element above it. */
const COVER_SHARE = 0.95;
/** A picture over this share of the slide is a full-slide picture (covers whatever is under it). */
const FULL_SLIDE_SHARE = 0.9;
/** Text boxes may sit this share of the slide size past an edge (rounding) and still count as on the slide. */
const EDGE_TOLERANCE = 0.005;
/** P6: a notes slide counts when it recalls this share of the document's notes words. */
const NOTES_RECALL_MIN = 0.95;
/** P3: text boxes sampled for the CDP platform-font check. */
const FONT_SAMPLE = 400;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Words for recall: NFKC, curly apostrophes straightened, case-folded through
 * upper case (the PPTX writer upper-cases some text, and ß only round-trips
 * that way), tokens of letters, digits and inner apostrophes.
 */
export function words(text) {
  const folded = String(text ?? '').normalize('NFKC').replace(/[’‘ʼ]/g, "'").toUpperCase().toLowerCase();
  return (folded.match(/[\p{L}\p{N}']+/gu) ?? []).map(token => token.replace(/^'+|'+$/g, '')).filter(Boolean);
}

/** Multiset recall: each target word can satisfy one source word. */
export function recall(source, target) {
  const pool = new Map();
  for (const token of target) pool.set(token, (pool.get(token) ?? 0) + 1);
  let matched = 0, chars = 0, matchedChars = 0;
  const missing = [];
  for (const token of source) {
    chars += token.length;
    const left = pool.get(token) ?? 0;
    if (left > 0) { pool.set(token, left - 1); matched++; matchedChars += token.length; } else missing.push(token);
  }
  return { words: source.length, matched, chars, matchedChars, missing };
}

/** Length of the longest common subsequence of two word lists. */
export function lcs(a, b) {
  if (!a.length || !b.length) return 0;
  let previous = new Uint16Array(b.length + 1), current = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const unxml = value => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
  if (entity[0] === '#') return String.fromCodePoint(entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
  return ENTITIES[entity] ?? whole;
});
const runs = xml => [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(match => unxml(match[1]));
const attr = (tag, key) => new RegExp(`\\b${key}="([^"]*)"`).exec(tag ?? '')?.[1];

/** Everything a slide shows as text, from the document. Notes and chart labels are counted separately. */
export function visibleText(slide) {
  const out = [slide.eyebrow, slide.title, slide.subtitle, slide.body];
  for (const point of slide.points ?? []) out.push(point.title, point.text);
  for (const stat of slide.stats ?? []) out.push(stat.value, stat.label, stat.detail);
  if (slide.compare) for (const side of [slide.compare.left, slide.compare.right]) out.push(side.heading, ...side.points);
  if (slide.quote) out.push(slide.quote.text, slide.quote.attribution);
  if (slide.diagram) {
    for (const item of slide.diagram.items) out.push(item.label, item.detail);
    if (slide.diagram.axes) out.push(slide.diagram.axes.x, slide.diagram.axes.y);
  }
  for (const person of slide.people ?? []) out.push(person.name, person.role, person.detail);
  for (const tier of slide.tiers ?? []) out.push(tier.name, tier.price, tier.period, tier.description, ...(tier.features ?? []));
  if (slide.table) out.push(...slide.table.columns, ...slide.table.rows.flat());
  for (const block of slide.blocks ?? []) if (block.type === 'text') out.push(block.text);
  if (slide.chart?.source) out.push(slide.chart.source);
  return out.filter(value => typeof value === 'string' && value.trim());
}
const chartLabels = slide => slide.chart ? [...slide.chart.categories, ...slide.chart.series.map(series => series.name)] : [];

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

function relations(xml) {
  const map = {};
  for (const match of (xml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1], target = /\bTarget="([^"]+)"/.exec(match[0])?.[1], type = /\bType="([^"]+)"/.exec(match[0])?.[1];
    if (id && target) map[id] = { target, type: type ?? '' };
  }
  return map;
}
const resolvePart = (from, target) => target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), target));

/** An element's box in EMU from its own xfrm (a:xfrm for shapes and pictures, p:xfrm for graphic frames). */
function boxOf(xml) {
  const xfrm = /<(a|p):xfrm\b[^>]*>([\s\S]*?)<\/\1:xfrm>/.exec(xml)?.[2];
  if (!xfrm) return null;
  const off = /<a:off\b[^>]*>/.exec(xfrm)?.[0], ext = /<a:ext\b[^>]*>/.exec(xfrm)?.[0];
  const [x, y, w, h] = [attr(off, 'x'), attr(off, 'y'), attr(ext, 'cx'), attr(ext, 'cy')].map(Number);
  return [x, y, w, h].every(Number.isFinite) ? { x, y, w, h } : null;
}
const area = box => Math.max(0, box.w) * Math.max(0, box.h);
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Text runs (a:r and a:fld) in order, with their size in hundredths of a point (null when inherited). */
function textRuns(xml) {
  return [...xml.matchAll(/<a:(r|fld)\b[^>]*>([\s\S]*?)<\/a:\1>/g)].map(match => {
    const sz = Number(attr(/<a:rPr\b[^>]*>/.exec(match[2])?.[0], 'sz'));
    return { text: runs(match[2]).join(''), sz: sz > 0 ? sz : null };
  }).filter(run => run.text.trim());
}

/** Whether image bytes are opaque: JPEG always, PNG without an alpha channel or tRNS chunk; null when unknown. */
function imageOpaque(bytes) {
  if (!bytes || bytes.length < 26) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes.readUInt32BE(0) === 0x89504e47) return bytes[25] !== 4 && bytes[25] !== 6 && !bytes.includes(Buffer.from('tRNS'));
  return null;
}

/** Series of a chart part: name, categories and values from the caches PowerPoint displays. */
function chartSeries(xml) {
  const cache = block => {
    if (!block) return null;
    const level = /<c:lvl>([\s\S]*?)<\/c:lvl>/.exec(block)?.[1] ?? block;
    const count = Number(/<c:ptCount\b[^>]*\bval="(\d+)"/.exec(block)?.[1] ?? 0);
    const out = new Array(count).fill(null);
    for (const pt of level.matchAll(/<c:pt\b[^>]*\bidx="(\d+)"[^>]*>([\s\S]*?)<\/c:pt>/g)) {
      const value = /<c:v>([\s\S]*?)<\/c:v>/.exec(pt[2])?.[1];
      if (value !== undefined) out[Number(pt[1])] = unxml(value);
    }
    return out;
  };
  return [...xml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map(match => ({
    name: cache(/<c:tx>([\s\S]*?)<\/c:tx>/.exec(match[1])?.[1])?.filter(value => value !== null).join(' ') ?? null,
    categories: cache(/<c:cat>([\s\S]*?)<\/c:cat>/.exec(match[1])?.[1]) ?? [],
    values: (cache(/<c:val>([\s\S]*?)<\/c:val>/.exec(match[1])?.[1]) ?? []).map(value => value === null || value === '' ? null : Number(value)),
  }));
}

/** Does a chart part show the document chart: same series count, values, categories and names? */
function compareChart(chart, part) {
  const issues = [];
  const same = (a, b) => words(a).join(' ') === words(b).join(' ');
  if (part.series.length !== chart.series.length) issues.push(`${part.series.length} series in the part, ${chart.series.length} in the document`);
  chart.series.forEach((series, i) => {
    const native = part.series[i];
    if (!native) return;
    if (native.values.length !== series.values.length) issues.push(`series ${i + 1}: ${native.values.length} values, document has ${series.values.length}`);
    series.values.forEach((value, j) => {
      const got = native.values[j];
      if (!(got !== null && Number.isFinite(got) && Math.abs(got - value) <= 1e-9 * Math.max(1, Math.abs(value)))) issues.push(`series ${i + 1} value ${j + 1}: ${got} in the part, ${value} in the document`);
    });
    if (native.categories.length !== chart.categories.length || chart.categories.some((category, j) => !same(native.categories[j], category))) issues.push(`series ${i + 1}: categories [${native.categories.join(', ')}] vs [${chart.categories.join(', ')}]`);
    if (native.name !== null && !same(native.name, series.name)) issues.push(`series ${i + 1}: name "${native.name}" vs "${series.name}"`);
  });
  return { match: issues.length === 0, issues: issues.slice(0, 8) };
}

/** Slides in presentation order with their visible native text, shapes, pictures, charts and notes. */
async function readPptx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const text = async part => zip.file(part)?.async('string') ?? null;
  const number = part => Number(/(\d+)\.xml$/.exec(part)?.[1] ?? 0);
  let order = Object.keys(zip.files).filter(part => /^ppt\/slides\/slide\d+\.xml$/.test(part)).sort((a, b) => number(a) - number(b));
  // presentation.xml's sldIdLst is the authoritative order.
  const presentation = await text('ppt/presentation.xml');
  const presentationRels = relations(await text('ppt/_rels/presentation.xml.rels'));
  const listed = [...(presentation ?? '').matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map(match => presentationRels[match[1]] && resolvePart('ppt/presentation.xml', presentationRels[match[1]].target)).filter(part => part && zip.file(part));
  if (listed.length) order = listed;
  const sldSz = /<p:sldSz\b[^>]*>/.exec(presentation ?? '')?.[0];
  const size = { cx: Number(attr(sldSz, 'cx')) || 12192000, cy: Number(attr(sldSz, 'cy')) || 6858000, fromPresentation: Boolean(sldSz) };
  const slideBox = { x: 0, y: 0, w: size.cx, h: size.cy };
  const tol = { x: size.cx * EDGE_TOLERANCE, y: size.cy * EDGE_TOLERANCE };
  const onSlide = box => box.x >= -tol.x && box.y >= -tol.y && box.x + box.w <= size.cx + tol.x && box.y + box.h <= size.cy + tol.y;

  const typefaces = new Set();
  let autofitShapes = 0;
  const slides = [];
  for (const part of order) {
    const xml = await text(part);
    const rels = relations(await text(part.replace('slides/', 'slides/_rels/') + '.rels'));
    for (const match of xml.matchAll(/<a:(?:latin|ea|cs)\b[^>]*\btypeface="([^"]+)"/g)) if (!match[1].startsWith('+')) typefaces.add(match[1]);
    autofitShapes += (xml.match(/<a:normAutofit\b/g) ?? []).length;

    // Top-level elements of the shape tree in z-order (later = above). A group counts as one element.
    const elements = [];
    for (const match of xml.matchAll(/<p:(sp|pic|graphicFrame|cxnSp|grpSp)[\s>][\s\S]*?<\/p:\1>/g)) {
      const body = match[0], kind = match[1];
      const cNvPr = /<p:cNvPr\b[^>]*>/.exec(body)?.[0];
      const spPr = (/<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/.exec(body)?.[1] ?? '').replace(/<a:ln\b[^>]*\/>|<a:ln\b[\s\S]*?<\/a:ln>/g, '');
      const element = {
        z: elements.length, kind, name: attr(cNvPr, 'name') ?? null, hidden: /^(1|true)$/.test(attr(cNvPr, 'hidden') ?? ''),
        box: boxOf(body), runs: kind === 'pic' || kind === 'cxnSp' ? [] : textRuns(body),
        opaqueFill: kind === 'sp' && /<a:solidFill>/.test(spPr) && !/<a:alpha\b/.test(spPr),
        table: kind === 'graphicFrame' && /<a:tbl[\s>]/.test(body),
        chartId: kind === 'graphicFrame' && /drawingml\/2006\/chart/.test(body) ? /<c:chart\b[^>]*\br:id="([^"]+)"/.exec(body)?.[1] ?? null : undefined,
      };
      if (kind === 'pic') {
        const embed = attr(/<a:blip\b[^>]*>/.exec(body)?.[0], 'r:embed');
        const media = embed && rels[embed] ? await zip.file(resolvePart(part, rels[embed].target))?.async('nodebuffer') : null;
        const alpha = Number(attr(/<a:alphaModFix\b[^>]*>/.exec(body)?.[0], 'amt') ?? 100000);
        element.opaque = imageOpaque(media) === true && alpha >= 100000;
      }
      elements.push(element);
    }

    // What of the native text a viewer can actually see.
    const visibleShapes = [], excluded = [];
    for (const element of elements) {
      if (!element.runs.length) continue;
      const sample = element.runs.map(run => run.text).join(' ').slice(0, 60);
      let reason = null;
      if (element.hidden) reason = 'hidden="1"';
      else if (element.box && !onSlide(element.box)) reason = 'box outside the slide';
      else if (element.box) {
        const textArea = Math.max(1, area(element.box));
        const cover = elements.slice(element.z + 1).find(above => !above.hidden && above.box && overlap(element.box, above.box) >= COVER_SHARE * textArea
          && (above.kind === 'pic' ? overlap(above.box, slideBox) >= FULL_SLIDE_SHARE * area(slideBox) || above.opaque : above.kind === 'sp' && above.opaqueFill));
        if (cover) reason = `covered by ${cover.kind === 'pic' ? 'a picture' : 'a filled shape'} above it (${cover.name ?? `element ${cover.z}`})`;
      }
      if (reason) { excluded.push({ z: element.z, name: element.name, reason, words: words(sample).length, text: sample }); continue; }
      const tiny = element.runs.filter(run => run.sz !== null && run.sz < MIN_RUN_SZ);
      if (tiny.length) excluded.push({ z: element.z, name: element.name, reason: `${tiny.length} run(s) under ${MIN_RUN_SZ / 100} pt (smallest ${Math.min(...tiny.map(run => run.sz)) / 100} pt)`, text: tiny.map(run => run.text).join(' ').slice(0, 60) });
      const visible = element.runs.filter(run => run.sz === null || run.sz >= MIN_RUN_SZ);
      if (visible.length) visibleShapes.push({ z: element.z, kind: element.kind, table: element.table, text: visible.map(run => run.text) });
    }

    const chartParts = [];
    for (const element of elements.filter(item => item.chartId !== undefined)) {
      const chartPart = element.chartId && rels[element.chartId] ? resolvePart(part, rels[element.chartId].target) : null;
      const chartXml = chartPart ? await text(chartPart) : null;
      chartParts.push({ part: chartPart, present: Boolean(chartXml), series: chartXml ? chartSeries(chartXml) : [], text: chartXml ? [...[...chartXml.matchAll(/<c:v>([\s\S]*?)<\/c:v>/g)].map(match => unxml(match[1])), ...runs(chartXml)] : [] });
    }
    const notesRel = Object.values(rels).find(rel => /\/notesSlide$/.test(rel.type));
    const notesXml = notesRel ? await text(resolvePart(part, notesRel.target)) : null;
    const pictures = elements.filter(element => element.kind === 'pic').length;
    slides.push({
      part,
      text: visibleShapes.flatMap(shape => shape.text),
      shapesText: visibleShapes,
      allText: elements.flatMap(element => element.runs.map(run => run.text)),
      excluded,
      shapes: elements.filter(element => element.kind === 'sp').length,
      textShapes: visibleShapes.filter(shape => !shape.table).length,
      pictures,
      tables: elements.filter(element => element.table).length,
      charts: chartParts.length,
      chartsWithPart: chartParts.filter(chart => chart.present).length,
      chartParts,
      chartText: chartParts.flatMap(chart => chart.text),
      notes: notesXml ? runs(notesXml).join(' ') : null,
    });
  }

  // Fonts: faces the slides name, the theme's major/minor faces, and whether any font is embedded.
  const themePart = Object.keys(zip.files).find(part => /^ppt\/theme\/theme\d+\.xml$/.test(part));
  const themeXml = themePart ? await text(themePart) : '';
  const themeFaces = ['majorFont', 'minorFont'].map(key => attr(new RegExp(`<a:${key}>[\\s\\S]*?<a:latin\\b[^>]*>`).exec(themeXml ?? '')?.[0], 'typeface')).filter(Boolean);
  const fontParts = Object.keys(zip.files).filter(part => /^ppt\/fonts\/./.test(part) && !zip.files[part].dir);
  const embeddedList = [...(presentation ?? '').matchAll(/<p:embeddedFont>[\s\S]*?<p:font\b[^>]*\btypeface="([^"]+)"/g)].map(match => match[1]);
  const fonts = { faces: [...typefaces], themeFaces, embeddedFontParts: fontParts, embeddedFontList: embeddedList, embedded: fontParts.length > 0 || embeddedList.length > 0, autofitShapes };
  if (autofitShapes && !fonts.embedded) {
    fonts.finding = `${autofitShapes} text boxes use <a:normAutofit/> (shrink text on overflow) with ${fonts.faces.join(', ')} and no font is embedded (no ppt/fonts/ parts, no p:embeddedFontLst): PowerPoint sets the text in whatever faces the viewer's machine has and may shrink text that does not fit, so the PPTX can differ from the PDF and from P3's render.`;
  }
  return { slides, size, fonts };
}

function pptxMetrics(deck, read) {
  const { slides, size, fonts } = read;
  const perSlide = deck.slides.length === slides.length;
  const docWords = deck.slides.map(slide => words(visibleText(slide).join(' ')));
  const pptxWords = slides.map(slide => words(slide.text.join(' ')));
  // Per slide when the slide counts agree (stricter); otherwise against the whole file.
  const results = perSlide
    ? docWords.map((source, index) => recall(source, pptxWords[index]))
    : [recall(docWords.flat(), pptxWords.flat())];
  const sum = key => results.reduce((total, result) => total + result[key], 0);
  const sourceWords = sum('words'), matchedWords = sum('matched'), chars = sum('chars'), matchedChars = sum('matchedChars');

  // Order: each visible text shape's words (those the slide's source has) must follow the source order.
  // Slide furniture the renderer adds (the deck title, subtitle or author in a footer) is not the
  // slide's text and is skipped; it shares words with the slide by chance, not by order.
  const furniture = new Set([deck.title, deck.subtitle, deck.author].filter(Boolean).map(value => words(value).join(' ')));
  const orderOf = (source, shapes, index) => {
    const known = new Set(source);
    let counted = 0, ordered = 0;
    const outOfOrder = [];
    for (const shape of shapes) {
      if (furniture.has(words(shape.text.join(' ')).join(' '))) continue;
      const sequence = words(shape.text.join(' ')).filter(token => known.has(token));
      if (!sequence.length) continue;
      const common = lcs(sequence, source);
      counted += sequence.length;
      ordered += common;
      if (common < sequence.length) outOfOrder.push({ z: shape.z, inOrder: common, words: sequence.length, text: shape.text.join(' ').slice(0, 60) });
    }
    return { index, counted, ordered, rate: counted ? round(ordered / counted) : null, outOfOrder: outOfOrder.slice(0, 5) };
  };
  // Chart legends and labels drawn as text shapes follow the chart's own order, appended to the slide's.
  const orderSources = deck.slides.map((slide, index) => [...docWords[index], ...words(chartLabels(slide).join(' '))]);
  const order = perSlide
    ? slides.map((slide, index) => orderOf(orderSources[index], slide.shapesText, index + 1))
    : [orderOf(orderSources.flat(), slides.flatMap(slide => slide.shapesText), null)];
  const orderCounted = order.reduce((total, entry) => total + entry.counted, 0), orderOrdered = order.reduce((total, entry) => total + entry.ordered, 0);
  const orderFailing = order.filter(entry => entry.rate !== null && entry.rate < DOCUMENTS.P1.min);

  const labelResults = perSlide
    ? deck.slides.map((slide, index) => recall(words(chartLabels(slide).join(' ')), words(slides[index].chartText.join(' '))))
    : [recall(words(deck.slides.flatMap(chartLabels).join(' ')), words(slides.flatMap(slide => slide.chartText).join(' ')))];
  const chartLabelWords = labelResults.reduce((total, result) => total + result.words, 0);
  const chartLabelMatched = labelResults.reduce((total, result) => total + result.matched, 0);

  // P2: a document chart is native when a chart part on its slide carries its data.
  const docCharts = deck.slides.map((slide, index) => slide.chart ? index : -1).filter(index => index >= 0);
  const chartChecks = docCharts.map(index => {
    const candidates = perSlide ? slides[index].chartParts : slides.flatMap(slide => slide.chartParts);
    const compared = candidates.filter(part => part.present).map(part => ({ part: part.part, ...compareChart(deck.slides[index].chart, part) }));
    const best = compared.find(entry => entry.match) ?? compared[0] ?? null;
    return { slide: index + 1, type: deck.slides[index].chart.type, part: best?.part ?? null, partPresent: compared.length > 0, dataMatches: Boolean(best?.match), issues: best ? best.issues : ['no c:chart part on the slide'] };
  });
  const nativeCharts = chartChecks.filter(check => check.dataMatches).length;

  // P6: notes as exported, per content slide.
  const notesRecall = (slide, notes) => {
    const result = recall(words(slide.notes), words(notes ?? ''));
    return result.words ? result.matched / result.words : null;
  };
  const notesBySlide = deck.slides.map((slide, index) => {
    const content = !FRAME_LAYOUTS.has(slide.layout);
    const rate = perSlide ? notesRecall(slide, slides[index].notes) : Math.max(0, ...slides.map(native => notesRecall(slide, native.notes) ?? 0));
    return { index: index + 1, content, documentNotes: Boolean(slide.notes?.trim()), pptxNotes: perSlide ? Boolean(slides[index].notes?.trim()) : null, recall: round(rate), verified: Boolean(slide.notes?.trim()) && rate !== null && rate >= NOTES_RECALL_MIN };
  });

  const textShapes = slides.reduce((total, slide) => total + slide.textShapes, 0), pictures = slides.reduce((total, slide) => total + slide.pictures, 0);
  const excludedEntries = slides.flatMap((slide, index) => slide.excluded.map(entry => ({ slide: index + 1, ...entry })));
  const allWords = words(slides.flatMap(slide => slide.allText).join(' ')).length;
  return {
    slides: slides.length, documentSlides: deck.slides.length, matchedBy: perSlide ? 'slide' : 'deck',
    slideSize: size,
    editableTextRate: sourceWords ? round(matchedWords / sourceWords) : null,
    charRate: chars ? round(matchedChars / chars) : null,
    orderRate: orderCounted ? round(orderOrdered / orderCounted) : null,
    orderWorstSlide: order.filter(entry => entry.rate !== null).reduce((min, entry) => (!min || entry.rate < min.rate ? entry : min), null),
    orderFailingSlides: orderFailing.map(entry => ({ index: entry.index, rate: entry.rate, outOfOrder: entry.outOfOrder })),
    sourceWords, matchedWords, sourceChars: chars, matchedChars,
    missingBySlide: results.map((result, index) => ({ index: perSlide ? index + 1 : null, missing: result.missing.slice(0, 20), count: result.missing.length })).filter(entry => entry.count),
    visibility: {
      rule: `not counted: hidden="1"; box outside the ${size.cx}×${size.cy} EMU slide (±${EDGE_TOLERANCE * 100}%); runs under ${MIN_RUN_SZ / 100} pt; text under a full-slide (≥${FULL_SLIDE_SHARE * 100}%) or opaque picture or an opaque filled shape above it covering ≥${COVER_SHARE * 100}% of its box`,
      nativeWordsAll: allWords, nativeWordsVisible: pptxWords.flat().length,
      excludedShapes: excludedEntries.length, excluded: excludedEntries.slice(0, 30),
    },
    nativeTextShare: textShapes + pictures ? round(textShapes / (textShapes + pictures)) : null,
    textShapes, pictures, shapes: slides.reduce((total, slide) => total + slide.shapes, 0), tables: slides.reduce((total, slide) => total + slide.tables, 0),
    charts: slides.reduce((total, slide) => total + slide.charts, 0), chartSlides: slides.filter(slide => slide.charts > 0).length,
    chartParts: slides.reduce((total, slide) => total + slide.chartsWithPart, 0),
    documentCharts: docCharts.length, nativeCharts, nativeChartRate: docCharts.length ? round(nativeCharts / docCharts.length) : null, chartChecks,
    chartLabels: { words: chartLabelWords, matched: chartLabelMatched, rate: chartLabelWords ? round(chartLabelMatched / chartLabelWords) : null },
    notesSlides: slides.filter(slide => slide.notes !== null).length,
    notesNonEmpty: slides.filter(slide => slide.notes?.trim()).length,
    notesBySlide,
    fonts,
  };
}

// ---------------------------------------------------------------------------
// Chromium: slide pictures, per-slide overflow and rendered fonts (P3)
// ---------------------------------------------------------------------------

function imageUrls(images = {}) {
  const urls = {};
  for (const [key, value] of Object.entries(images)) {
    if (typeof value === 'string') urls[key] = value;
    else if (value) urls[key] = `data:${value[0] === 0x89 ? 'image/png' : 'image/jpeg'};base64,${Buffer.from(value).toString('base64')}`;
  }
  return urls;
}

/** The faces Chromium used for the sampled text boxes (CDP CSS.getPlatformFontsForNode). */
async function renderedFonts(context, page) {
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.slide .t' });
    const byFamily = new Map();
    const sampled = nodeIds.slice(0, FONT_SAMPLE);
    for (const nodeId of sampled) {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      for (const font of fonts) {
        const entry = byFamily.get(font.familyName) ?? { family: font.familyName, postScriptName: font.postScriptName ?? null, custom: font.isCustomFont, glyphs: 0, boxes: 0 };
        entry.glyphs += font.glyphCount;
        entry.boxes++;
        byFamily.set(font.familyName, entry);
      }
    }
    return { sampledBoxes: sampled.length, textBoxes: nodeIds.length, fonts: [...byFamily.values()].sort((a, b) => b.glyphs - a.glyphs) };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * Render deckHtml(print) like the PDF exporter, screenshot every slide and
 * measure every text box (natural height against its box, horizontal spill,
 * line boxes that leave the 1280×720 canvas) and every other element: images,
 * placeholders and charts may not reach past the canvas; decorative shapes and
 * SVG art may bleed (the orbit discs do by design) but not lie entirely outside.
 */
async function renderDeck(browser, deck, { shotsDir, images, controlCss, controlHtml }) {
  const { render, fonts } = app();
  let sources, fontNote = null;
  try { sources = await fonts.embeddedFontSources(render.deckFaces(deck), REPO); } catch (error) { fontNote = `embedded faces unavailable: ${error.message}`; }
  let html = render.deckHtml(deck, imageUrls(images), 'print', sources);
  // controlCss/controlHtml exist only for the self-test's negative controls (they must make the detector fire).
  if (controlCss) html = html.replace('</head>', `<style>${controlCss}</style></head>`);
  if (controlHtml) html = controlHtml(html);
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', viewport: { width: 1280, height: 720 } });
  try {
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const count = await page.locator('.slide').count();
    const shots = [];
    if (shotsDir) {
      ensureDir(shotsDir);
      for (let i = 0; i < count; i++) {
        const file = path.join(shotsDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
        await page.locator('.slide').nth(i).screenshot({ path: file });
        shots.push(rel(file));
      }
    }
    const slides = await page.evaluate(() => [...document.querySelectorAll('.slide')].map((slide, index) => {
      const s = slide.getBoundingClientRect();
      const boxes = [...slide.querySelectorAll('.t')].flatMap(element => {
        // Line boxes, not glyph areas: tall-ascender faces overhang a tight line-height without spilling.
        const box = element.getBoundingClientRect(), height = element.style.height;
        element.style.height = 'auto';
        const natural = element.getBoundingClientRect().height;
        element.style.height = height;
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0 || rect.height > 0);
        if (!rects.length) return [];
        const reasons = [];
        if (natural > box.height + 2) reasons.push(`needs ${Math.round(natural)}px in a ${Math.round(box.height)}px box (+${Math.round(natural - box.height)}px, ${new Set(rects.map(r => Math.round(r.top))).size} lines)`);
        // Hanging pre-wrap spaces extend the range but not the layout; scrollWidth does not count them.
        if (element.scrollWidth > element.clientWidth + 1) reasons.push(`runs ${element.scrollWidth - element.clientWidth}px past its box`);
        const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right)), top = Math.min(...rects.map(r => r.top));
        if (box.top + natural > s.bottom + 1 || right > s.right + 1 || left < s.left - 1 || top < s.top - 1) reasons.push('leaves the slide');
        return reasons.length ? [{ kind: 'text', text: element.textContent.slice(0, 80), naturalHeight: Math.round(natural), boxHeight: Math.round(box.height), reason: reasons.join('; ') }] : [];
      });
      // Every other primitive against the canvas.
      const kindOf = element => element.classList.contains('ph') ? 'placeholder' : element.tagName === 'IMG' ? 'image' : element.tagName.toLowerCase() === 'svg' ? 'svg' : element.querySelector('svg') ? 'chart' : 'shape';
      const bleeds = [];
      for (const element of slide.querySelectorAll(':scope > .p:not(.t)')) {
        const r = element.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        const kind = kindOf(element);
        const past = Math.max(s.left - r.left, r.right - s.right, s.top - r.top, r.bottom - s.bottom);
        if (past <= 1) continue;
        const inside = Math.max(0, Math.min(r.right, s.right) - Math.max(r.left, s.left)) * Math.max(0, Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top));
        const label = (element.getAttribute('alt') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        const entry = { kind, text: `[${kind}] ${label}`.trim(), pastPx: Math.round(past), insideShare: Math.round(inside / Math.max(1, r.width * r.height) * 100) / 100 };
        if (inside <= 0) boxes.push({ ...entry, reason: `${kind} lies entirely outside the canvas` });
        else if (kind === 'image' || kind === 'placeholder' || kind === 'chart') boxes.push({ ...entry, reason: `${kind} extends ${Math.round(past)}px past the canvas` });
        else bleeds.push(entry);
      }
      return { index: index + 1, boxes, bleeds };
    }));
    let fontsUsed = null;
    try { fontsUsed = await renderedFonts(context, page); } catch (error) { fontNote = [fontNote, `rendered fonts unavailable: ${error.message}`].filter(Boolean).join('; '); }
    return { count, shots, slides, embeddedFaces: Object.keys(sources ?? {}), fontsUsed, fontNote };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

/** Runs of three or more consecutive slides with the same value of `key`. */
function repeats(entries, key) {
  const out = [];
  for (let start = 0; start < entries.length;) {
    let end = start;
    while (end + 1 < entries.length && entries[start][key] != null && entries[end + 1][key] === entries[start][key]) end++;
    if (end - start + 1 >= 3) out.push({ from: start + 1, to: end + 1, value: entries[start][key] });
    start = end + 1;
  }
  return out;
}

/**
 * Measure one deck.
 * @param {object} input
 * @param {object} input.document     deck DocumentSource (content.document of a saved version)
 * @param {string} [input.pptxPath]   exported .pptx (deckPptx)
 * @param {string} [input.pdfPath]    exported .pdf (documentPdf); summarised only
 * @param {import('playwright').Browser} [input.browser]  Chromium; launched and closed here when absent
 * @param {string} [input.shotsDir]   slide-NN.png go here; none when absent
 * @param {object} [input.images]     generated images by name (Buffer or data: URL); placeholders otherwise
 */
export async function measureDeck({ document, pptxPath, pdfPath, browser, shotsDir, images, controlCss, controlHtml } = {}) {
  const errors = [];
  const attempt = async (step, fn, fallback = null) => {
    try { return await fn(); } catch (error) { errors.push({ step, message: String(error?.message ?? error).slice(0, 500) }); return fallback; }
  };
  const { schema, scene, editor, theme } = app();
  const parsed = schema.DocumentSourceSchema.safeParse(document);
  if (!parsed.success) errors.push({ step: 'parse', message: parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
  const deck = parsed.success ? parsed.data : document;
  if (deck?.kind !== 'deck' || !Array.isArray(deck.slides)) {
    errors.push({ step: 'parse', message: `expected a deck document, got ${deck?.kind}` });
    return { kind: 'deck', title: deck?.title ?? null, pptx: null, overflow: null, sceneIssues: null, fitWarnings: null, rotation: null, notes: null, compositions: [], flags: [], pass: { P1: null, P2: null, P3: null, P4: null, P5: null, P6: null }, errors };
  }
  const total = deck.slides.length;

  // ---- P1, P2, P6: the exported PPTX ---------------------------------------
  const read = pptxPath ? await attempt('read pptx', async () => readPptx(await readFile(pptxPath))) : null;
  if (!pptxPath) errors.push({ step: 'pptx', message: 'no pptxPath given' });
  const pptx = read ? await attempt('pptx metrics', () => pptxMetrics(deck, read)) : null;

  // ---- P4, P5: the deck as the current renderer composes it ----------------
  const plan = await attempt('planDeck', () => scene.planDeck(deck), null);
  const compositions = deck.slides.map((slide, index) => ({ index: index + 1, id: slide.id, layout: slide.layout, composition: plan?.[index]?.id ?? null }));
  const bySlide = plan ? plan.flatMap((entry, index) => entry.scene.issues.length ? [{ index: index + 1, id: deck.slides[index].id, composition: entry.id, issues: entry.scene.issues }] : []) : [];
  const sceneIssues = plan ? { count: bySlide.reduce((sum, entry) => sum + entry.issues.length, 0), bySlide } : null;

  // The editor's `fit` list (editor.ts problems()): first scene issue per slide plus rhythm issues,
  // recomputed from the document with today's composer (not what was saved with the deck).
  const fitWarnings = await attempt('fit warnings', () => {
    const items = [];
    deck.slides.forEach((slide, index) => {
      const issues = scene.composeSlide(deck, slide, index, total).issues;
      if (issues.length) items.push(`Slide ${index + 1} (${slide.id}): ${issues[0]}.`);
    });
    items.push(...editor.deckRhythmIssues(deck).map(issue => `${issue.message}.`));
    // Cross-check with the editor itself: its first finish blocks on fit (max 8), the second accepts it.
    const documentEditor = new editor.DocumentEditor(deck);
    const first = documentEditor.problems(), second = documentEditor.problems();
    return {
      label: DOCUMENTS.P4.label, basis: 'recomputed from the saved document with the current composer (slide-scene.ts, editor.ts); not the warnings stored at save time',
      count: items.length, items, reason: items.length ? `${DOCUMENTS.P4.label}: ${items.length}` : null,
      editorFirstFinish: first.length, editorAccepted: first.length - second.length, editorBlocking: second,
    };
  });

  // P5: the same layout three slides in a row. Compositions rotate by design (planDeck), so their
  // repeats are reported but never gated. `composition` on a violation repeats the layout for
  // readers that print it (measure.mjs).
  const rotation = {
    basis: 'layout',
    violations: repeats(compositions, 'layout').map(run => ({ from: run.from, to: run.to, layout: run.value, composition: run.value })),
    compositionRepeats: plan ? repeats(compositions, 'composition').map(run => ({ from: run.from, to: run.to, composition: run.value })) : null,
    note: 'Gated on slide layout; composition ids are information (the renderer rotates them, so their repeats cannot fail).',
  };

  // ---- P6: speaker notes on content slides, as exported -------------------
  const content = deck.slides.filter(slide => !FRAME_LAYOUTS.has(slide.layout));
  const documentWithNotes = content.filter(slide => slide.notes?.trim()).length;
  const verified = pptx ? pptx.notesBySlide.filter(entry => entry.content && entry.verified).length : null;
  const notes = {
    basis: pptx ? `PPTX notes slides recalling ≥ ${NOTES_RECALL_MIN * 100}% of the document notes words, over content slides` : 'no PPTX: not measured',
    contentSlides: content.length, withNotes: verified, rate: pptx && content.length ? round(verified / content.length) : null,
    documentWithNotes, documentRate: content.length ? round(documentWithNotes / content.length) : null,
    allSlidesWithNotes: deck.slides.filter(slide => slide.notes?.trim()).length,
    missing: pptx ? pptx.notesBySlide.filter(entry => entry.content && !entry.verified).map(entry => ({ index: entry.index, documentNotes: entry.documentNotes, pptxNotes: entry.pptxNotes, recall: entry.recall })) : null,
  };

  // ---- PDF summary ---------------------------------------------------------
  const pdf = pdfPath ? await attempt('pdf', async () => {
    const objects = await pdfObjects(await readFile(pdfPath));
    return { pages: objects.pageCount, pagesMatchSlides: objects.pageCount === total, widthPt: objects.pages[0]?.widthPt ?? null, heightPt: objects.pages[0]?.heightPt ?? null, consistentSize: objects.consistentSize, fonts: objects.fonts.length, fontsEmbedded: objects.unembeddedFonts.length === 0, unembeddedFonts: objects.unembeddedFonts, fontFaces: pdfFontFaces(objects.fonts) };
  }) : null;

  // ---- P3: overflow in Chromium --------------------------------------------
  let chromium;
  if (!browser) chromium = await attempt('launch chromium', async () => (await import('playwright')).chromium.launch({ headless: true }));
  let overflow = null, shots = [];
  try {
    const rendered = (browser ?? chromium) ? await attempt('render deck', () => renderDeck(browser ?? chromium, deck, { shotsDir, images, controlCss, controlHtml })) : null;
    if (rendered) {
      const slides = rendered.slides.filter(slide => slide.boxes.length).map(slide => ({ index: slide.index, title: deck.slides[slide.index - 1]?.title ?? null, boxes: slide.boxes }));
      const pairing = theme.FONTS[deck.theme.fonts];
      const usedFonts = rendered.fontsUsed?.fonts ?? null;
      const systemFonts = usedFonts ? usedFonts.filter(font => !font.custom).map(font => font.family) : null;
      overflow = {
        count: slides.length, boxes: slides.reduce((sum, slide) => sum + slide.boxes.length, 0), slides, renderedSlides: rendered.count, embeddedFaces: rendered.embeddedFaces,
        bleeds: rendered.slides.flatMap(slide => slide.bleeds.map(entry => ({ index: slide.index, ...entry }))),
        fonts: {
          stacks: { heading: pairing?.heading ?? null, body: pairing?.body ?? null },
          rendered: usedFonts, sampledBoxes: rendered.fontsUsed?.sampledBoxes ?? null,
          systemFonts, machineDependentRender: systemFonts ? systemFonts.length > 0 : null,
          ...(systemFonts?.length ? { note: `Chromium on this machine set text in ${systemFonts.join(', ')} (installed system faces listed before the embedded faces in the theme stacks); the production exporter has only the embedded faces, so its slides would be set differently.` } : {}),
        },
        ...(rendered.fontNote ? { fontNote: rendered.fontNote } : {}),
      };
      shots = rendered.shots;
    }
  } finally {
    if (chromium) await chromium.close();
  }

  const min = DOCUMENTS.P1.min;
  const pass = {
    P1: pptx?.editableTextRate == null ? null : pptx.editableTextRate >= min && pptx.charRate >= min && (pptx.orderRate ?? 0) >= min && pptx.orderFailingSlides.length === 0,
    // No chart in the document leaves nothing to fail.
    P2: pptx ? (pptx.nativeChartRate === null ? true : pptx.nativeChartRate >= DOCUMENTS.P2.min) : null,
    P3: overflow ? overflow.count <= DOCUMENTS.P3.max : null,
    P4: fitWarnings ? fitWarnings.count <= DOCUMENTS.P4.max : null,
    P5: rotation.violations.length <= DOCUMENTS.P5.max,
    P6: notes.rate === null ? null : notes.rate >= DOCUMENTS.P6.min,
  };
  const flags = [
    ...(overflow?.fonts?.machineDependentRender ? ['machine-dependent render'] : []),
    ...(pdf?.fontFaces?.machineDependent ? ['machine-dependent export'] : []),
    ...(pptx?.fonts?.finding ? ['pptx fonts not embedded (autofit may shrink text)'] : []),
  ];
  return { kind: 'deck', title: deck.title, slides: total, pptx, pdf, overflow, sceneIssues, fitWarnings, rotation, notes, compositions, shots, flags, pass, errors };
}

// ---------------------------------------------------------------------------
// Self-test over the fixture decks
// ---------------------------------------------------------------------------

const RUN = 'outputs/eval/runs/fixtures-20261018T110001Z';
const FIXTURES = [
  { id: 'pq-presentation-v2', document: () => readJson(path.join(REPO, 'outputs/product-qualification/presentation.json'))[0].content.document, pptx: 'outputs/product-qualification/presentation.pptx', pdf: 'outputs/product-qualification/presentation.pdf' },
  { id: 'fresh-deck', document: () => readJson(path.join(REPO, 'outputs/fresh-product-quality-ac4b08bd-b91f-47bb-9956-c6d719505738/deck/saved-version.json')).content.document, pptx: 'outputs/fresh-product-quality-ac4b08bd-b91f-47bb-9956-c6d719505738/deck/document.pptx', pdf: 'outputs/fresh-product-quality-ac4b08bd-b91f-47bb-9956-c6d719505738/deck/document.pdf' },
  { id: 'fx-lo-tidewater-seed-round', document: () => readJson(path.join(REPO, RUN, 'fx-lo-tidewater-seed-round/document.json')), pptx: `${RUN}/fx-lo-tidewater-seed-round/exports/document.pptx`, pdf: `${RUN}/fx-lo-tidewater-seed-round/exports/document.pdf` },
];

/** One-line-per-metric summary of a deck result (self-test and fixture runs). */
export function deckSummary(id, result, ms, file) {
  const p = result.pptx ?? {};
  const o = result.overflow ?? {};
  const lines = [
    `\n${id}: "${result.title}", ${result.slides} slides${ms === undefined ? '' : ` (${ms} ms)`}${file ? ` -> ${rel(file)}` : ''}`,
    `  P1 editable text ${p.matchedWords}/${p.sourceWords} words (${p.editableTextRate}), chars ${p.matchedChars}/${p.sourceChars} (${p.charRate}), order ${p.orderRate} (worst slide ${p.orderWorstSlide?.index ?? '-'}: ${p.orderWorstSlide?.rate ?? '-'}; failing ${p.orderFailingSlides?.length}), by ${p.matchedBy}; visible native words ${p.visibility?.nativeWordsVisible}/${p.visibility?.nativeWordsAll}, excluded shapes ${p.visibility?.excludedShapes}${(p.visibility?.excluded ?? []).slice(0, 2).map(entry => `\n    slide ${entry.slide}: ${entry.reason} "${entry.text.slice(0, 40)}"`).join('')}`,
    `  P2 charts: document ${p.documentCharts}, native with matching data ${p.nativeCharts} (rate ${p.nativeChartRate}), c:chart parts ${p.chartParts}; chart labels ${p.chartLabels?.matched}/${p.chartLabels?.words}${(p.chartChecks ?? []).filter(check => !check.dataMatches).map(check => `\n    slide ${check.slide}: ${check.issues.slice(0, 2).join('; ')}`).join('')}`,
    `  P3 overflow: ${o.count} slides, ${o.boxes} boxes (rendered ${o.renderedSlides}); decorative bleeds ${o.bleeds?.length}${(o.slides ?? []).slice(0, 3).map(slide => `\n    slide ${slide.index}: ${slide.boxes[0].reason} "${slide.boxes[0].text.slice(0, 40)}"`).join('')}`,
    `  P3 fonts: embedded faces ${o.embeddedFaces?.join(',')}; rendered ${(o.fonts?.rendered ?? []).map(font => `${font.family}${font.custom ? '' : ' (system)'}`).join(', ')}${o.fonts?.machineDependentRender ? ' -> MACHINE-DEPENDENT RENDER' : ''}`,
    `  P4 ${result.fitWarnings?.label}: ${result.fitWarnings?.count} (editor accepted ${result.fitWarnings?.editorAccepted}, blocking ${result.fitWarnings?.editorBlocking?.length}); scene issues ${result.sceneIssues?.count}`,
    `  P5 layout runs of 3+: ${result.rotation?.violations.length}${result.rotation?.violations.map(v => ` [${v.from}-${v.to} ${v.layout}]`).join('')}; composition repeats (info) ${result.rotation?.compositionRepeats?.length}; layouts ${result.compositions.map(entry => entry.layout).join(' ')}`,
    `  P6 notes in the PPTX ${result.notes?.withNotes}/${result.notes?.contentSlides} content slides (${result.notes?.rate}); document notes ${result.notes?.documentWithNotes} (${result.notes?.documentRate}); pptx notes slides ${p.notesSlides}, non-empty ${p.notesNonEmpty}`,
    `  pptx fonts: ${p.fonts?.faces?.join(', ')} (theme ${p.fonts?.themeFaces?.join('/')}), embedded ${p.fonts?.embedded}, autofit boxes ${p.fonts?.autofitShapes}${p.fonts?.finding ? ' -> finding' : ''}`,
    `  pdf ${result.pdf?.pages} pages ${result.pdf?.widthPt}x${result.pdf?.heightPt} pt, fonts ${result.pdf?.fonts} embedded=${result.pdf?.fontsEmbedded}; faces: document [${result.pdf?.fontFaces?.embeddedFaces?.join(', ')}] system [${result.pdf?.fontFaces?.systemFonts?.join(', ')}] unnamed ${result.pdf?.fontFaces?.unnamedFonts}; shots ${result.shots?.length ?? 0}`,
    `  flags ${JSON.stringify(result.flags)}`,
    `  pass ${JSON.stringify(result.pass)}; errors ${result.errors.length}${result.errors.map(error => `\n    ${error.step}: ${error.message}`).join('')}`,
  ];
  console.log(lines.join('\n'));
}

// --- Negative controls: each mutates a fixture PPTX (in the OS temp folder) or the deck so one metric must fail.

/** A valid 1×1 opaque PNG (RGB, no alpha). */
function opaquePng() {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

async function mutatePptx(source, target, mutate) {
  const zip = await JSZip.loadAsync(await readFile(source));
  await mutate(zip);
  await writeFile(target, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
const partsOf = (zip, pattern) => Object.keys(zip.files).filter(part => pattern.test(part));
async function edit(zip, pattern, fn) {
  for (const part of partsOf(zip, pattern)) zip.file(part, fn(await zip.file(part).async('string'), part));
}
const SLIDES = /^ppt\/slides\/slide\d+\.xml$/;

const PPTX_CONTROLS = [
  {
    id: 'P1: full-slide picture above all text', metric: 'P1',
    mutate: async zip => {
      zip.file('ppt/media/mb-control-cover.png', opaquePng());
      await edit(zip, /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/, xml => xml.replace('</Relationships>', '<Relationship Id="rIdMbControl" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/mb-control-cover.png"/></Relationships>'));
      await edit(zip, SLIDES, xml => xml.replace('</p:spTree>', '<p:pic><p:nvPicPr><p:cNvPr id="9999" name="Control cover"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdMbControl"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree>'));
    },
  },
  {
    id: 'P1: text boxes moved off the slide', metric: 'P1',
    mutate: zip => edit(zip, SLIDES, xml => xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, shape => /<a:t>/.test(shape) ? shape.replace(/(<a:off x=")(-?\d+)"/, (whole, head, x) => `${head}${Number(x) + 12192000}"`) : shape)),
  },
  {
    id: 'P1: every run at 1 pt in white', metric: 'P1',
    mutate: zip => edit(zip, SLIDES, xml => xml.replace(/(<a:rPr\b[^>]*\bsz=")\d+"/g, '$1100"').replace(/(<a:rPr\b[^>]*>\s*<a:solidFill>\s*<a:srgbClr val=")[0-9A-Fa-f]{6}"/g, '$1FFFFFF"')),
  },
  {
    id: 'P1: word order reversed in every run', metric: 'P1',
    mutate: zip => edit(zip, SLIDES, xml => xml.replace(/<a:t>([^<]*)<\/a:t>/g, (whole, value) => `<a:t>${value.split(' ').reverse().join(' ')}</a:t>`)),
  },
  {
    id: 'P2: every chart value set to 0', metric: 'P2',
    mutate: zip => edit(zip, /^ppt\/charts\/chart\d+\.xml$/, xml => xml.replace(/<c:val>[\s\S]*?<\/c:val>/g, block => block.replace(/<c:v>[^<]*<\/c:v>/g, '<c:v>0</c:v>'))),
  },
  {
    id: 'P6: notes slides removed', metric: 'P6',
    mutate: async zip => {
      for (const part of partsOf(zip, /^ppt\/notesSlides\//)) zip.remove(part);
      await edit(zip, /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/, xml => xml.replace(/<Relationship\b[^>]*\/notesSlide"[^>]*\/>/g, ''));
    },
  },
  {
    id: 'P6: notes text blanked', metric: 'P6',
    mutate: zip => edit(zip, /^ppt\/notesSlides\/notesSlide\d+\.xml$/, xml => xml.replace(/<a:t>[^<]*<\/a:t>/g, '<a:t></a:t>')),
  },
];

async function selftest() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const base = path.join(OUT, 'selftest', 'docs');
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'makeborne-eval-deck-controls-'));
  let failures = 0;
  const expectFail = (label, result, metric, detail) => {
    const failed = result.pass[metric] === false;
    console.log(`control (${label}): ${metric}=${result.pass[metric]}${detail ? `; ${detail}` : ''} -> ${failed ? 'fails as expected' : 'DID NOT FAIL'}`);
    if (!failed) failures++;
  };
  try {
    const available = FIXTURES.filter(fixture => exists(path.join(REPO, fixture.pptx)));
    for (const fixture of FIXTURES) {
      if (!available.includes(fixture)) { console.log(`${fixture.id}: fixture missing (${fixture.pptx}), skipped`); continue; }
      const dir = path.join(base, fixture.id);
      const started = Date.now();
      const result = await measureDeck({ document: fixture.document(), pptxPath: path.join(REPO, fixture.pptx), pdfPath: path.join(REPO, fixture.pdf), browser, shotsDir: path.join(dir, 'shots') });
      writeJson(path.join(dir, 'metrics.json'), result);
      deckSummary(fixture.id, result, Date.now() - started, path.join(dir, 'metrics.json'));
      if (result.errors.length) failures++;
      // The unmodified exports are the positive controls for the PPTX checks below.
      for (const metric of ['P1', 'P2', 'P6']) if (result.pass[metric] !== true) { console.log(`  positive control: ${metric} should pass on the unmodified export`); failures++; }
    }
    const fixture = available[0];
    if (fixture) {
      console.log('');
      // P3: titles three times larger must overflow.
      const titles = await measureDeck({ document: fixture.document(), pptxPath: path.join(REPO, fixture.pptx), browser, controlCss: '.slide .t.title{font-size:12cqw!important}' });
      expectFail(`${fixture.id}, titles at 12cqw`, titles, 'P3', `${titles.overflow?.count} slides`);
      // P3: SVGs (lines, art, paths) moved entirely off the canvas.
      const svgs = await measureDeck({ document: fixture.document(), pptxPath: path.join(REPO, fixture.pptx), browser, controlCss: '.slide>svg.p{transform:translate(1400px,0)!important}' });
      expectFail(`${fixture.id}, SVGs moved off the canvas`, svgs, 'P3', `${svgs.overflow?.count} slides; ${svgs.overflow?.slides?.[0]?.boxes?.[0]?.reason}`);
      // P3: an image and a placeholder hanging past the right edge of slide 1.
      const injected = '<img class="p" alt="control image" src="data:image/png;base64,' + opaquePng().toString('base64') + '" style="left:1180px;top:40px;width:240px;height:160px"><div class="p ph" style="left:40px;top:640px;width:240px;height:160px"><span>control placeholder</span></div>';
      const media = await measureDeck({ document: fixture.document(), pptxPath: path.join(REPO, fixture.pptx), browser, controlHtml: html => html.replace(/(<section class="slide"[^>]*>)/, `$1${injected}`) });
      expectFail(`${fixture.id}, image and placeholder past the canvas`, media, 'P3', (media.overflow?.slides?.[0]?.boxes ?? []).filter(box => box.kind !== 'text').map(box => box.reason).join('; '));

      // P1, P2, P6: mutated copies of the exported PPTX.
      for (const control of PPTX_CONTROLS) {
        const file = path.join(tmp, `${control.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pptx`);
        await mutatePptx(path.join(REPO, fixture.pptx), file, control.mutate);
        const result = await measureDeck({ document: fixture.document(), pptxPath: file, browser });
        const p = result.pptx ?? {};
        const detail = control.metric === 'P1' ? `words ${p.editableTextRate}, chars ${p.charRate}, order ${p.orderRate} (failing slides ${p.orderFailingSlides?.length}), excluded shapes ${p.visibility?.excludedShapes}`
          : control.metric === 'P2' ? `native with matching data ${p.nativeCharts}/${p.documentCharts}; ${p.chartChecks?.[0]?.issues?.[0] ?? ''}`
          : `notes ${result.notes?.withNotes}/${result.notes?.contentSlides} (document still has ${result.notes?.documentWithNotes})`;
        expectFail(control.id, result, control.metric, detail);
      }

      // P5: one content slide repeated so five slides in a row share its layout.
      const document = structuredClone(fixture.document());
      const at = document.slides.findIndex(slide => !FRAME_LAYOUTS.has(slide.layout));
      document.slides.splice(at + 1, 0, ...[1, 2, 3, 4].map(n => ({ ...structuredClone(document.slides[at]), id: `${document.slides[at].id}-control-${n}` })));
      const rotation = await measureDeck({ document, browser });
      expectFail(`five "${document.slides[at].layout}" slides in a row`, rotation, 'P5', `layout runs ${rotation.rotation?.violations.map(v => `${v.from}-${v.to}`).join(',')}; composition repeats (info) ${rotation.rotation?.compositionRepeats?.length}`);
    }
  } finally {
    await browser.close();
    await rm(tmp, { recursive: true, force: true });
  }
  if (failures) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv.includes('--selftest')) {
  selftest().catch(error => { console.error(error); process.exitCode = 1; });
}
