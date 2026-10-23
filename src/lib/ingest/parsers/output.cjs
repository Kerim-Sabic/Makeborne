/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* Collects one file's extracted structure in reading order. */
const { ImageCollector } = require('./common.cjs');
const { normaliseCell } = require('./cells.cjs');

class Output {
  constructor(limits) {
    this.limits = limits;
    this.blocks = [];
    this.tables = [];
    this.slides = [];
    this.sheets = [];
    this.warnings = [];
    this.unsupported = [];
    this.images = new ImageCollector(limits);
    this.partial = [];
    this.coverage = null;
    this.details = {};
  }
  heading(text, level, location) { const value = clean(text); if (value) this.blocks.push({ type: 'heading', level: Math.min(Math.max(level || 1, 1), 6), text: value, ...(location ? { location } : {}) }); }
  paragraph(text, extra) { const value = clean(text); if (value) this.blocks.push({ type: 'paragraph', text: value, ...(extra || {}) }); }
  note(label, text, location) { const value = clean(text); if (value) this.blocks.push({ type: 'note', label, text: value, ...(location ? { location } : {}) }); }
  /** rows: string[][]; the first `headerRows` rows are headings. Cells keep their original text. */
  table(source, rows, headerRows = 1, location) {
    const width = Math.max(0, ...rows.map(row => row.length));
    if (!width || !rows.some(row => row.some(cell => clean(cell)))) return null;
    const id = `table-${this.tables.length + 1}`;
    const cells = rows.map(row => Array.from({ length: width }, (_, index) => normaliseCell(clean(row[index] ?? ''))));
    this.tables.push({ id, source, headerRows: Math.min(headerRows, rows.length), rows: cells });
    this.blocks.push({ type: 'table', table: id, ...(location ? { location } : {}) });
    return id;
  }
  image(id, location) { if (id) this.blocks.push({ type: 'image', image: id, ...(location ? { location } : {}) }); }
  warn(message) { if (!this.warnings.includes(message) && this.warnings.length < 50) this.warnings.push(message); }
  /** Something that should have been read was not: the record cannot be complete. */
  missed(message) { this.partial.push(message); this.warn(message); }
}
/** Collapse runs of spaces inside lines; keep line breaks and tabs meaningful. */
function clean(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[  ]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { Output, clean };
