/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* Minimal non-validating XML reader for Office parts. Document type
 * declarations are refused outright, so there are no custom entities, no
 * entity expansion and no external entity resolution. Only the five predefined
 * entities and numeric character references are decoded. Node count and depth
 * are bounded. Element: { n: qualified name, a: attributes, c: children }. */
const { IngestError } = require('./common.cjs');

const malformed = detail => new IngestError('malformed', `Part of this file isn’t valid XML (${detail}). Save a fresh copy from the original app and attach that.`);
/** Elements whose whitespace-only text is meaningful. */
const KEEP_SPACE = new Set(['t', 'v', 'f', 'instrText', 'delText', 'is']);
const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };

function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});?/g, (match, body) => {
    if (!match.endsWith(';')) throw malformed('unterminated entity');
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      return String.fromCodePoint(code);
    }
    if (!(body in NAMED)) throw malformed('undeclared entity');
    return NAMED[body];
  });
}
const local = name => { const index = name.indexOf(':'); return index < 0 ? name : name.slice(index + 1); };

function parseXml(input, limits) {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: false }).decode(input);
  const root = { n: '#document', a: Object.create(null), c: [] };
  const stack = [root];
  let position = 0, nodes = 0;
  const length = text.length;
  while (position < length) {
    const open = text.indexOf('<', position);
    if (open < 0) { if (text.slice(position).trim()) throw malformed('text outside elements'); break; }
    if (open > position) {
      const chunk = text.slice(position, open);
      const parent = stack[stack.length - 1];
      if (parent !== root && (chunk.trim() || KEEP_SPACE.has(local(parent.n)))) parent.c.push(decodeEntities(chunk));
      else if (parent === root && chunk.trim()) throw malformed('text outside elements');
    }
    if (text.startsWith('<?', open)) {
      const close = text.indexOf('?>', open + 2);
      if (close < 0) throw malformed('processing instruction');
      position = close + 2; continue;
    }
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open + 4);
      if (close < 0) throw malformed('comment');
      position = close + 3; continue;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const close = text.indexOf(']]>', open + 9);
      if (close < 0) throw malformed('CDATA');
      const parent = stack[stack.length - 1];
      if (parent === root) throw malformed('CDATA outside elements');
      parent.c.push(text.slice(open + 9, close));
      position = close + 3; continue;
    }
    if (text.startsWith('<!', open)) throw new IngestError('malformed', 'This file contains an XML document type declaration, which AI sources don’t allow (it can pull in outside content). Save a fresh copy from the original app.');
    // Find the end of the tag outside quoted attribute values.
    let index = open + 1, quote = 0;
    for (; index < length; index++) {
      const code = text.charCodeAt(index);
      if (quote) { if (code === quote) quote = 0; }
      else if (code === 34 || code === 39) quote = code;
      else if (code === 62) break;
    }
    if (index >= length) throw malformed('unterminated tag');
    const body = text.slice(open + 1, index);
    position = index + 1;
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (!top || top === root || top.n !== name) throw malformed('mismatched closing tag');
      continue;
    }
    const selfClosing = body.endsWith('/');
    const content = selfClosing ? body.slice(0, -1) : body;
    const nameMatch = /^[^\s/>]+/.exec(content);
    if (!nameMatch) throw malformed('element name');
    const element = { n: nameMatch[0], a: Object.create(null), c: [] };
    const attributes = content.slice(nameMatch[0].length);
    const pattern = /\s*([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
    let match, consumed = 0;
    while ((match = pattern.exec(attributes))) { element.a[match[1]] = decodeEntities(match[2] ?? match[3] ?? ''); consumed = pattern.lastIndex; }
    if (attributes.slice(consumed).trim()) throw malformed('attribute');
    if (++nodes > limits.xmlNodes) throw new IngestError('archive-limit', 'This file contains more structure than AI sources allow. Split it into smaller files.');
    const parent = stack[stack.length - 1];
    if (parent === root && root.c.length) throw malformed('more than one root element');
    parent.c.push(element);
    if (!selfClosing) {
      stack.push(element);
      if (stack.length > limits.xmlDepth) throw malformed('nesting too deep');
    }
  }
  if (stack.length !== 1 || root.c.length !== 1) throw malformed('unclosed element');
  return root.c[0];
}

const elements = node => node.c.filter(child => typeof child !== 'string');
const kids = (node, name) => node ? node.c.filter(child => typeof child !== 'string' && local(child.n) === name) : [];
const kid = (node, name) => node ? node.c.find(child => typeof child !== 'string' && local(child.n) === name) : undefined;
/** Attribute by local name (w:val, r:id, val). */
function attr(node, name) {
  if (!node) return undefined;
  if (name in node.a) return node.a[name];
  for (const key in node.a) if (local(key) === name) return node.a[key];
  return undefined;
}
/** A relationship id attribute (r:id), never a plain id="…" on the same element. */
function relId(node, name = 'id') {
  if (!node) return undefined;
  for (const key in node.a) if (key.includes(':') && local(key) === name) return node.a[key];
  return undefined;
}
/** Depth-first descendants with this local name (iterative). */
function find(node, name, stopAt) {
  const found = [], pending = node ? [...elements(node)].reverse() : [];
  while (pending.length) {
    const next = pending.pop();
    if (local(next.n) === name) found.push(next);
    if (stopAt && stopAt.has(local(next.n)) && local(next.n) !== name) continue;
    const children = elements(next);
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
  }
  return found;
}
function textOf(node) {
  if (!node) return '';
  let out = '';
  for (const child of node.c) out += typeof child === 'string' ? child : textOf(child);
  return out;
}

module.exports = { parseXml, local, kids, kid, attr, relId, find, textOf, elements };
