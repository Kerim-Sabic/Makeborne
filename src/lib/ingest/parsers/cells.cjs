'use strict';
/* Deterministic recognition of numbers, units and dates in table text. The
 * original text is always kept; a normalised value is added only when the
 * reading is unambiguous ("1,234" or "03/04/2026" stay text). */

const CURRENCY = { '€': 'EUR', '$': 'USD', '£': 'GBP', '¥': 'JPY', 'KM': 'BAM', 'EUR': 'EUR', 'USD': 'USD', 'GBP': 'GBP', 'BAM': 'BAM', 'CHF': 'CHF', 'RSD': 'RSD', 'HRK': 'HRK', 'JPY': 'JPY' };
const UNITS = ['%', '‰', 'kg', 'g', 'mg', 't', 'km', 'm', 'cm', 'mm', 'm²', 'm2', 'km²', 'ha', 'm³', 'l', 'ml', 'h', 'min', 's', 'ms', 'kWh', 'MWh', 'kW', 'MW', 'W', '°C', '°F', 'GB', 'MB', 'TB', 'kB', 'pcs', 'kom'];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  januar: 1, februar: 2, mart: 3, maj: 5, juni: 6, juli: 7, avgust: 8, septembar: 9, oktobar: 10, novembar: 11, decembar: 12 };

/** Parses "1 234,5", "1,234.50", "-12.5", "(300)" → number, or null when separators are ambiguous. */
function parseNumber(raw) {
  let text = raw.replace(/[    ]/g, ' ').trim();
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  if (/^[-−–]/.test(text)) { negative = !negative; text = text.slice(1).trim(); }
  else if (text.startsWith('+')) text = text.slice(1).trim();
  if (!/^[0-9][0-9 .,']*$/.test(text) || /[ .,']$/.test(text)) return null;
  const compact = text.replace(/[ ']/g, '');
  if (/ /.test(text) && !/^\d{1,3}( \d{3})+([.,]\d+)?$/.test(text)) return null;
  const dots = (compact.match(/\./g) || []).length, commas = (compact.match(/,/g) || []).length;
  let normal;
  if (dots && commas) {
    const decimal = compact.lastIndexOf('.') > compact.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    const [whole, fraction = ''] = compact.split(decimal);
    if (compact.split(decimal).length !== 2 || !new RegExp(`^\\d{1,3}(\\${group}\\d{3})*$`).test(whole) || !/^\d+$/.test(fraction)) return null;
    normal = `${whole.split(group).join('')}.${fraction}`;
  } else if (dots > 1 || commas > 1) {
    const sep = dots ? '.' : ',';
    if (!new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(compact)) return null;
    normal = compact.split(sep).join('');
  } else if (dots === 1 || commas === 1) {
    const sep = dots ? '.' : ',';
    const [whole, fraction] = compact.split(sep);
    // "1,234" and "1.234" could be a thousand or a decimal: leave as text.
    if (fraction.length === 3 && whole.length <= 3 && whole !== '0') return null;
    normal = `${whole}.${fraction}`;
  } else normal = compact;
  if (!/^\d+(\.\d+)?$/.test(normal) || normal.replace('.', '').length > 17) return null;
  const value = Number(normal);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

function isoDate(year, month, day) {
  if (!(year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** ISO, European dotted ("23.10.2026."), and named-month dates. Slash dates are ambiguous (US/EU) and stay text. */
function parseDate(raw) {
  const text = raw.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (match) return { date: isoDate(+match[1], +match[2], +match[3]) };
  match = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\.?$/.exec(text);
  if (match) return { date: isoDate(+match[3], +match[2], +match[1]) };
  match = /^(\d{1,2})\.?\s+([A-Za-zčćžšđ]+)\.?,?\s+(\d{4})\.?$/i.exec(text);
  if (match && MONTHS[match[2].toLowerCase()]) return { date: isoDate(+match[3], MONTHS[match[2].toLowerCase()], +match[1]) };
  match = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (match && MONTHS[match[1].toLowerCase()]) return { date: isoDate(+match[3], MONTHS[match[1].toLowerCase()], +match[2]) };
  // 03/04/2026 is March or April depending on the author's locale: never guessed.
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) return { ambiguous: true };
  return null;
}

/** { text, number?, unit?, currency?, date?, ambiguous? } — text is always the original. */
function normaliseCell(raw) {
  const text = String(raw ?? '');
  const trimmed = text.trim();
  const cell = { text };
  if (!trimmed || trimmed.length > 64) return cell;
  const date = parseDate(trimmed);
  if (date) { if (date.date) cell.date = date.date; else if (date.ambiguous) cell.ambiguous = 'date'; return cell; }
  let body = trimmed, currency, unit;
  for (const [symbol, code] of Object.entries(CURRENCY)) {
    if (body.startsWith(symbol) && /[\s\d(+-]/.test(body.slice(symbol.length, symbol.length + 1) || ' ')) { currency = code; body = body.slice(symbol.length).trim(); break; }
    if (body.endsWith(symbol) && /[\s\d)]/.test(body.slice(-symbol.length - 1, -symbol.length) || ' ')) { currency = code; body = body.slice(0, -symbol.length).trim(); break; }
  }
  if (!currency) for (const candidate of UNITS) {
    if (body.endsWith(candidate) && /[\s\d]/.test(body.slice(-candidate.length - 1, -candidate.length))) { unit = candidate === 'm2' ? 'm²' : candidate; body = body.slice(0, -candidate.length).trim(); break; }
  }
  const number = parseNumber(body);
  if (number === null) { if (/^[0-9][0-9 .,]*$/.test(body)) cell.ambiguous = 'number'; return cell; }
  cell.number = number;
  if (currency) cell.currency = currency;
  if (unit) cell.unit = unit;
  return cell;
}

module.exports = { normaliseCell, parseNumber, parseDate };
