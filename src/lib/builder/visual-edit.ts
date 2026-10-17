/** Deterministic click-to-edit for React website projects. Project TSX/JSX is
 * parsed with the code editor's Lezer grammar: preview builds tag each HTML
 * element with its source position, and inspector changes become exact source
 * edits. Customer code is never executed here and no model is called. */
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { editWebsiteSource } from "@/lib/projects/source-edit";
import { SourcePathSchema, type WebsiteProjectSource } from "@/lib/projects/website-source";
import { CONTENT_LIMITS, MANIFEST_PATH, ManifestSchema, collectionPath, parseManifest, serialiseContent, type Manifest } from "@/lib/portal/content-model";

type Tree = ReturnType<typeof tsxLanguage.parser.parse>;
type SyntaxNode = Tree["topNode"];

export const LOC_ATTRIBUTE = "data-mb-loc";
const MAX_TEXT = 2000;

/** Files whose JSX can be tagged for click-to-edit. */
const markupParser = (path: string) => /\.tsx$/i.test(path) ? tsxLanguage.parser : /\.jsx$/i.test(path) ? jsxLanguage.parser : null;
/** Files searched for string literals that render as page text. */
const scriptParser = (path: string) => markupParser(path) ?? (/\.ts$/i.test(path) ? typescriptLanguage.parser : /\.m?js$/i.test(path) ? javascriptLanguage.parser : null);

export type ElementLoc = { path: string; offset: number };
export const formatLoc = (loc: ElementLoc) => `${loc.path}@${loc.offset}`;
export function parseLoc(value: unknown): ElementLoc | null {
  if (typeof value !== "string" || value.length > 260) return null;
  const match = /^([A-Za-z0-9_./-]+)@(\d{1,7})$/.exec(value);
  return match && markupParser(match[1]) && SourcePathSchema.safeParse(match[1]).success ? { path: match[1], offset: Number(match[2]) } : null;
}

/** Adds `data-mb-loc="path@offset"` to every HTML element in a TSX/JSX file.
 * Offsets point at the element's `<` in the unmodified source. Components
 * (capitalised tags) are left alone: their own HTML is tagged in their file. */
export function instrumentSource(path: string, code: string): string {
  const parser = markupParser(path);
  if (!parser || !code.includes("<")) return code;
  const inserts: [at: number, offset: number][] = [];
  parser.parse(code).iterate({ enter(node) {
    if (node.name !== "JSXOpenTag" && node.name !== "JSXSelfClosingTag") return;
    const name = node.node.getChild("JSXBuiltin");
    if (name) inserts.push([name.to, node.from]);
  } });
  if (!inserts.length) return code;
  let output = "", last = 0;
  for (const [at, offset] of inserts) {
    output += `${code.slice(last, at)} ${LOC_ATTRIBUTE}="${path}@${offset}"`;
    last = at;
  }
  return output + code.slice(last);
}

// ---------------------------------------------------------------- decoding

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", middot: "·", bull: "•", times: "×", euro: "€", pound: "£" };
function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Visible value of raw JSX text, following JSX whitespace rules. */
function jsxTextValue(raw: string) {
  const lines = raw.split(/\r\n|\n|\r/);
  return decodeEntities(lines.map((line, index) => {
    let value = line.replace(/\t/g, " ");
    if (index > 0) value = value.replace(/^ +/, "");
    if (index < lines.length - 1) value = value.replace(/ +$/, "");
    return value;
  }).filter((line, index, all) => line.length > 0 || (all.length === 1 && index === 0)).join(" "));
}

/** Value of a quoted JS string or a template without substitutions. */
function literalValue(raw: string): string | null {
  const quote = raw[0], body = raw.slice(1, -1);
  if (!/^["'`]$/.test(quote) || raw[raw.length - 1] !== quote) return null;
  if (quote === "`" && /(^|[^\\])\$\{/.test(body)) return null;
  let value = "";
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char !== "\\") { value += char; continue; }
    const next = body[++index];
    if (next === undefined) return null;
    if (next === "n") value += "\n"; else if (next === "t") value += "\t"; else if (next === "r") value += "\r";
    else if (next === "b") value += "\b"; else if (next === "f") value += "\f"; else if (next === "v") value += "\v"; else if (next === "0") value += "\0";
    else if (next === "\n") continue; else if (next === "\r") { if (body[index + 1] === "\n") index++; continue; }
    else if (next === "x") { const hex = body.slice(index + 1, index + 3); if (!/^[0-9a-f]{2}$/i.test(hex)) return null; value += String.fromCharCode(parseInt(hex, 16)); index += 2; }
    else if (next === "u") {
      const braced = /^\{([0-9a-f]{1,6})\}/i.exec(body.slice(index + 1)), plain = /^[0-9a-f]{4}/i.exec(body.slice(index + 1));
      if (braced) { value += String.fromCodePoint(parseInt(braced[1], 16)); index += braced[0].length; }
      else if (plain) { value += String.fromCharCode(parseInt(plain[0], 16)); index += 4; }
      else return null;
    } else value += next;
  }
  return value;
}

function encodeLiteral(value: string, quote: string) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, quote === "`" ? "\n" : "\\n").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return quote === "`" ? `\`${escaped.replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\`` : `${quote}${escaped.split(quote).join(`\\${quote}`)}${quote}`;
}
/** JSX children text: plain when safe, otherwise a string expression. */
const encodeJsxText = (value: string) => /[{}<>&]|^\s|\s$/.test(value) ? `{${JSON.stringify(value)}}` : value;
/** JSX attribute value: quoted when safe, otherwise an expression. */
const encodeAttribute = (value: string) => /["&{}<>\n\r]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;

// ---------------------------------------------------------------- structure

type Parsed = { code: string; tree: Tree };
function parseFile(source: WebsiteProjectSource, path: string): Parsed | null {
  const parser = markupParser(path), file = source.files.find(item => item.path === path);
  return parser && file ? { code: file.content, tree: parser.parse(file.content) } : null;
}

function elementAt(parsed: Parsed, offset: number): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  parsed.tree.iterate({ from: offset, to: offset + 1, enter(node) {
    if (found) return false;
    if ((node.name === "JSXOpenTag" || node.name === "JSXSelfClosingTag") && node.from === offset) { found = node.node.parent; return false; }
  } });
  const element = found as SyntaxNode | null;
  return element?.name === "JSXElement" && element.firstChild?.getChild("JSXBuiltin") ? element : null;
}

const text = (parsed: Parsed, node: SyntaxNode) => parsed.code.slice(node.from, node.to);
const openTag = (element: SyntaxNode) => element.firstChild!;
const tagName = (parsed: Parsed, element: SyntaxNode) => { const name = openTag(element)?.getChild("JSXBuiltin"); return name ? text(parsed, name) : null; };
const children = (node: SyntaxNode) => { const list: SyntaxNode[] = []; for (let child = node.firstChild; child; child = child.nextSibling) list.push(child); return list; };

function attribute(parsed: Parsed, element: SyntaxNode, name: string) {
  for (const node of openTag(element).getChildren("JSXAttribute")) {
    const identifier = node.firstChild;
    if (identifier && text(parsed, identifier) === name) return { node, value: identifier.nextSibling?.name === "Equals" ? identifier.nextSibling.nextSibling : identifier.nextSibling };
  }
  return null;
}

/** A single string literal inside `{…}`, if that is all the escape holds. */
function escapedLiteral(escape: SyntaxNode | null | undefined) {
  if (escape?.name !== "JSXEscape") return null;
  const inner = children(escape).filter(child => child.name !== "{" && child.name !== "}");
  return inner.length === 1 && (inner[0].name === "String" || inner[0].name === "TemplateString") && !inner[0].getChild("Interpolation") ? inner[0] : null;
}

/** Where new attributes go: before `>` or `/>`, after any spread. */
function attributeInsertion(parsed: Parsed, element: SyntaxNode, attribute: string) {
  const open = openTag(element), end = open.lastChild!;
  const before = parsed.code[end.from - 1];
  return /\s/.test(before) ? { at: end.from, insert: `${attribute} ` } : { at: end.from, insert: ` ${attribute}` };
}

const lineOf = (code: string, offset: number) => code.slice(0, offset).split("\n").length;

// ---------------------------------------------------------------- text

type Literal = { path: string; from: number; to: number; quote: string; value: string };
type TextRun = { from: number; to: number; raw: string; value: string };
type TextTarget = ({ kind: "jsx"; path: string } & TextRun) | ({ kind: "literal" } & Literal) | { kind: "runs"; path: string; runs: TextRun[] };
/** Inline elements whose neighbouring text can be edited run by run. */
const INLINE = new Set(["em", "strong", "b", "i", "u", "span", "br", "mark", "small", "sup", "sub", "a", "code", "abbr", "s"]);

function literalsMatching(source: WebsiteProjectSource, wanted: string, limit = 3): Literal[] {
  const target = wanted.replace(/\s+/g, " ").trim();
  if (!target || target.length > MAX_TEXT) return [];
  const found: Literal[] = [];
  for (const file of source.files) {
    const parser = scriptParser(file.path);
    if (!parser || !file.content.includes(target.slice(0, 12).replace(/[\\"'`]/g, "").slice(0, 6))) continue;
    parser.parse(file.content).iterate({ enter(node) {
      if (found.length >= limit) return false;
      if (node.name !== "String" && node.name !== "TemplateString") return;
      const raw = file.content.slice(node.from, node.to), value = literalValue(raw);
      if (value !== null && value.replace(/\s+/g, " ").trim() === target) found.push({ path: file.path, from: node.from, to: node.to, quote: raw[0], value });
      return false;
    } });
    if (found.length >= limit) break;
  }
  return found;
}

function textTarget(source: WebsiteProjectSource, parsed: Parsed, loc: ElementLoc, element: SyntaxNode, rendered?: string): TextTarget | { reason: string } {
  const open = openTag(element), close = element.lastChild;
  if (open.name === "JSXSelfClosingTag" || close?.name !== "JSXCloseTag") return { reason: "This element has no text of its own." };
  const inner = children(element).slice(1, -1).filter(child => !(child.name === "JSXText" && !text(parsed, child).trim()));
  if (!inner.length) return { reason: "This element has no text of its own." };
  if (inner.every(child => child.name === "JSXText")) {
    const raw = parsed.code.slice(open.to, close.from);
    return { kind: "jsx", path: loc.path, from: open.to, to: close.from, raw, value: jsxTextValue(raw) };
  }
  if (inner.length === 1 && inner[0].name === "JSXEscape") {
    const literal = escapedLiteral(inner[0]);
    if (literal) { const raw = text(parsed, literal); return { kind: "literal", path: loc.path, from: literal.from, to: literal.to, quote: raw[0], value: literalValue(raw) ?? "" }; }
    // Text from data (e.g. {item.title}): edit the one string that renders it.
    const matches = rendered ? literalsMatching(source, rendered) : [];
    if (matches.length === 1) return { kind: "literal", ...matches[0] };
    if (matches.length > 1) return { reason: "This text appears in several places in the code. Edit it in Code, or ask the builder." };
    return { reason: "This text is produced by code. Edit it in Code, or ask the builder." };
  }
  // Text around inline accents (e.g. "cooked by the <em>season</em>"): each run is editable.
  if (inner.every(child => child.name === "JSXText" || (child.name === "JSXElement" && INLINE.has(tagName(parsed, child) ?? "")))) {
    const runs = inner.filter(child => child.name === "JSXText").map(child => { const raw = text(parsed, child); return { from: child.from, to: child.to, raw, value: jsxTextValue(raw).trim() }; });
    if (runs.length) return { kind: "runs", path: loc.path, runs };
  }
  if (inner.some(child => child.name === "JSXElement")) return { reason: "This element contains other elements. Click the exact text you want to change." };
  return { reason: "This text mixes words with live values. Edit it in Code, or ask the builder." };
}

// ---------------------------------------------------------------- style

export const STYLE_FIELDS = ["color", "backgroundColor", "fontSize", "fontWeight", "textAlign", "padding", "margin", "borderRadius"] as const;
export type StyleField = typeof STYLE_FIELDS[number];
const LENGTH = "-?(?:\\d{1,4}(?:\\.\\d{1,3})?|\\.\\d{1,3})(?:px|rem|em|%|vw|vh)?";
const STYLE_RULES: Record<StyleField, RegExp> = {
  color: /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(?:rgb|hsl)a?\([\d\s.,%/-]{1,60}\)|transparent|currentColor)$/i,
  backgroundColor: /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(?:rgb|hsl)a?\([\d\s.,%/-]{1,60}\)|transparent)$/i,
  fontSize: new RegExp(`^${LENGTH}$`),
  fontWeight: /^(?:normal|bold|[1-9]00)$/,
  textAlign: /^(?:left|center|right|justify)$/,
  padding: new RegExp(`^${LENGTH}(?: ${LENGTH}){0,3}$`),
  margin: new RegExp(`^(?:${LENGTH}|auto)(?: (?:${LENGTH}|auto)){0,3}$`),
  borderRadius: new RegExp(`^${LENGTH}(?: ${LENGTH}){0,3}$`),
};
const camel = (key: string) => key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

type StyleEntry = { key: string | null; raw: string };
/** Inline style entries, or the expression a non-literal style comes from. */
function styleState(parsed: Parsed, element: SyntaxNode) {
  const found = attribute(parsed, element, "style");
  if (!found) return { kind: "none" as const };
  const value = found.value;
  if (value?.name !== "JSXEscape") return { kind: "unsupported" as const, reason: "This element's style is written in a way the editor can't change. Edit it in Code." };
  const inner = children(value).filter(child => child.name !== "{" && child.name !== "}");
  if (inner.length === 1 && inner[0].name === "ObjectExpression") {
    const entries: StyleEntry[] = inner[0].getChildren("Property").map(property => {
      const name = property.firstChild, raw = text(parsed, property);
      if (name?.name === "PropertyDefinition") return { key: text(parsed, name), raw };
      if (name?.name === "String") { const key = literalValue(text(parsed, name)); return { key: key === null ? null : camel(key), raw }; }
      return { key: null, raw };
    });
    return { kind: "object" as const, attribute: found.node, object: inner[0], entries };
  }
  if (inner.length === 1) return { kind: "expression" as const, attribute: found.node, escape: value, expression: text(parsed, inner[0]) };
  return { kind: "unsupported" as const, reason: "This element's style is written in a way the editor can't change. Edit it in Code." };
}

function literalStyleValues(parsed: Parsed, element: SyntaxNode): Partial<Record<StyleField, string>> {
  const state = styleState(parsed, element), values: Partial<Record<StyleField, string>> = {};
  if (state.kind !== "object") return values;
  for (const property of state.object.getChildren("Property")) {
    const name = property.firstChild, valueNode = property.lastChild;
    if (!name || !valueNode || name === valueNode) continue;
    const key = name.name === "PropertyDefinition" ? text(parsed, name) : name.name === "String" ? camel(literalValue(text(parsed, name)) ?? "") : "";
    if (!(STYLE_FIELDS as readonly string[]).includes(key)) continue;
    const raw = text(parsed, valueNode);
    const value = valueNode.name === "String" ? literalValue(raw) : valueNode.name === "Number" ? (key === "fontWeight" ? raw : `${raw}px`) : null;
    if (value !== null) values[key as StyleField] = value;
  }
  return values;
}

// ---------------------------------------------------------------- describe

export type AttributeState = { value: string; editable: true } | { value: null; editable: true } | { editable: false; reason: string };
export type ElementDescription = {
  loc: ElementLoc; tag: string; line: number;
  text: { value: string; path: string; line: number; shared: boolean } | { parts: string[]; path: string; line: number } | { reason: string };
  href?: AttributeState; alt?: AttributeState; src?: AttributeState;
  style: Partial<Record<StyleField, string>>; styleReason: string | null;
  removable: boolean;
};

function attributeState(parsed: Parsed, element: SyntaxNode, name: string): AttributeState {
  const found = attribute(parsed, element, name);
  if (!found) return { value: null, editable: true };
  if (found.value?.name === "JSXAttributeValue") return { value: decodeEntities(text(parsed, found.value).slice(1, -1)), editable: true };
  const literal = escapedLiteral(found.value);
  if (literal) return { value: literalValue(text(parsed, literal)) ?? "", editable: true };
  return { editable: false, reason: "This value is set by code. Edit it in Code, or ask the builder." };
}

/** Removing is limited to elements that sit directly inside other markup. */
const removable = (element: SyntaxNode) => element.parent?.name === "JSXElement";

export function describeElement(source: WebsiteProjectSource, loc: ElementLoc, rendered?: string): ElementDescription | null {
  const parsed = parseFile(source, loc.path);
  const element = parsed && elementAt(parsed, loc.offset);
  if (!parsed || !element) return null;
  const tag = tagName(parsed, element)!, target = textTarget(source, parsed, loc, element, rendered);
  const style = styleState(parsed, element);
  return {
    loc, tag, line: lineOf(parsed.code, loc.offset),
    text: "reason" in target ? target
      : target.kind === "runs" ? { parts: target.runs.map(run => run.value), path: target.path, line: lineOf(parsed.code, target.runs[0].from) }
      : { value: target.value, path: target.path, line: lineOf(source.files.find(file => file.path === target.path)!.content, target.from), shared: target.kind === "literal" && target.path !== loc.path },
    ...(tag === "a" ? { href: attributeState(parsed, element, "href") } : {}),
    ...(tag === "img" ? { alt: attributeState(parsed, element, "alt"), src: attributeState(parsed, element, "src") } : {}),
    style: literalStyleValues(parsed, element), styleReason: style.kind === "unsupported" ? style.reason : null,
    removable: removable(element),
  };
}

// ---------------------------------------------------------------- apply

export type VisualEdit =
  | { kind: "text"; loc: ElementLoc; value: string; rendered?: string; part?: number }
  | { kind: "style"; loc: ElementLoc; style: Partial<Record<StyleField, string>> }
  | { kind: "attribute"; loc: ElementLoc; name: "href" | "alt" | "src"; value: string }
  | { kind: "remove"; loc: ElementLoc }
  | { kind: "extract"; loc: ElementLoc; label: string; rendered?: string };
export type SourceChange = { path: string; from: number; to: number; length: number };
export type VisualEditResult = { ok: true; source: WebsiteProjectSource; summary: string; change: SourceChange } | { ok: false; message: string };

const fail = (message: string): VisualEditResult => ({ ok: false, message });

function commit(source: WebsiteProjectSource, path: string, from: number, to: number, insert: string, summary: string): VisualEditResult {
  const file = source.files.find(item => item.path === path);
  if (!file) return fail("This file is no longer in the project.");
  const content = file.content.slice(0, from) + insert + file.content.slice(to);
  if (content === file.content) return fail("Nothing changed.");
  const result = editWebsiteSource(source, { type: "edit", path, content });
  return result.ok ? { ok: true, source: result.source, summary, change: { path, from, to, length: insert.length } } : fail(result.message);
}

const HREF = /^(?:#[A-Za-z0-9_:.-]*|\/(?![/\\])[^\s"<>\\]*|https?:\/\/[^\s"<>]+|mailto:[^\s"<>]+|tel:\+?[\d\s().-]+)$/;

export function applyVisualEdit(source: WebsiteProjectSource, edit: VisualEdit, assetPaths: readonly string[] = []): VisualEditResult {
  const parsed = parseFile(source, edit.loc.path);
  const element = parsed && elementAt(parsed, edit.loc.offset);
  if (!parsed || !element) return fail("That element changed since you selected it. Click it again in the preview.");
  const tag = tagName(parsed, element)!, where = `<${tag}> in ${edit.loc.path}`;

  if (edit.kind === "text") {
    const value = edit.value.replace(/\r\n?/g, "\n").replace(/\n+/g, " ");
    if (!value.trim()) return fail("Text can't be empty. To hide this element, remove it instead.");
    if (value.length > MAX_TEXT) return fail(`Keep text under ${MAX_TEXT} characters.`);
    const target = textTarget(source, parsed, edit.loc, element, edit.rendered);
    if ("reason" in target) return fail(target.reason);
    if (target.kind === "runs") {
      const run = target.runs[edit.part ?? -1];
      if (!run) return fail("That part of the text changed since you selected it. Click it again in the preview.");
      const lead = /^\s*/.exec(run.raw)![0], trail = /\s*$/.exec(run.raw)![0];
      return commit(source, target.path, run.from, run.to, `${lead}${encodeJsxText(value.trim())}${trail}`, `Edited text of ${where}`);
    }
    if (target.kind === "jsx") {
      const lead = /^\s*/.exec(target.raw)![0], trail = /\s*$/.exec(target.raw)![0];
      return commit(source, target.path, target.from, target.to, `${lead}${encodeJsxText(value.trim())}${trail}`, `Edited text of ${where}`);
    }
    return commit(source, target.path, target.from, target.to, encodeLiteral(value, target.quote), `Edited text of ${where}`);
  }

  if (edit.kind === "extract") return extractText(source, parsed, element, edit, where);

  if (edit.kind === "attribute") {
    const allowed = edit.name === "href" ? tag === "a" : tag === "img";
    if (!allowed) return fail(`<${tag}> elements don't take ${edit.name}.`);
    const value = edit.value.trim();
    if (edit.name === "href" && !HREF.test(value)) return fail("Use a page link like /about, a section like #menu, a full https:// address, mailto: or tel:.");
    if (edit.name === "alt" && value.length > 300) return fail("Keep image descriptions under 300 characters.");
    if (edit.name === "src" && !assetPaths.includes(value)) return fail("Choose one of this project's images.");
    const found = attribute(parsed, element, edit.name);
    const label = edit.name === "href" ? "link" : edit.name === "alt" ? "image description" : "image";
    if (!found) {
      const { at, insert } = attributeInsertion(parsed, element, `${edit.name}=${encodeAttribute(value)}`);
      return commit(source, edit.loc.path, at, at, insert, `Changed ${label} of ${where}`);
    }
    if (found.value?.name === "JSXAttributeValue") return commit(source, edit.loc.path, found.value.from, found.value.to, encodeAttribute(value), `Changed ${label} of ${where}`);
    const literal = escapedLiteral(found.value);
    if (literal) return commit(source, edit.loc.path, literal.from, literal.to, encodeLiteral(value, text(parsed, literal)[0]), `Changed ${label} of ${where}`);
    return fail("This value is set by code. Edit it in Code, or ask the builder.");
  }

  if (edit.kind === "style") {
    const changes = Object.entries(edit.style) as [StyleField, string][];
    if (!changes.length) return fail("Nothing changed.");
    for (const [key, value] of changes) {
      if (!(STYLE_FIELDS as readonly string[]).includes(key)) return fail("That style can't be changed here.");
      if (value.trim() && !STYLE_RULES[key].test(value.trim())) return fail(`"${value}" isn't a valid ${key.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`)}.`);
    }
    const state = styleState(parsed, element);
    if (state.kind === "unsupported") return fail(state.reason);
    const entries: StyleEntry[] = state.kind === "object" ? [...state.entries] : state.kind === "expression" ? [{ key: null, raw: `...${state.expression}` }] : [];
    for (const [key, raw] of changes) {
      const value = raw.trim(), index = entries.findIndex(entry => entry.key === key);
      const entry = { key, raw: `${key}: ${JSON.stringify(value)}` };
      if (!value) { if (index >= 0) entries.splice(index, 1); }
      else if (index >= 0) entries[index] = entry; else entries.push(entry);
    }
    const summary = `Changed style of ${where}`;
    const object = `{ ${entries.map(entry => entry.raw).join(", ")} }`;
    if (state.kind === "none") {
      if (!entries.length) return fail("Nothing changed.");
      const { at, insert } = attributeInsertion(parsed, element, `style={${object}}`);
      return commit(source, edit.loc.path, at, at, insert, summary);
    }
    if (!entries.length) {
      // Drop the now-empty attribute together with the space before it.
      let from = state.attribute.from;
      while (from > 0 && /[ \t]/.test(parsed.code[from - 1])) from--;
      return commit(source, edit.loc.path, from, state.attribute.to, "", summary);
    }
    if (state.kind === "object") return commit(source, edit.loc.path, state.object.from, state.object.to, object, summary);
    return commit(source, edit.loc.path, state.escape.from, state.escape.to, `{${object}}`, summary);
  }

  if (!removable(element)) return fail("This is a component's outer element. Remove it in Code, or ask the builder.");
  const code = parsed.code;
  let from = element.from, to = element.to;
  const lineStart = code.lastIndexOf("\n", from - 1) + 1, nextBreak = code.indexOf("\n", to), lineEnd = nextBreak < 0 ? code.length : nextBreak;
  if (!code.slice(lineStart, from).trim() && !code.slice(to, lineEnd).trim()) { from = lineStart; to = Math.min(code.length, lineEnd + 1); }
  return commit(source, edit.loc.path, from, to, "", `Removed ${where}`);
}

// ---------------------------------------------------------------- hand a text to the client

/** The identifier generated code imports the client-editable site text as. */
export const SITE_CONTENT_IMPORT = "siteContent";
const SITE_COLLECTION = "site";

/** "Hero headline" → "heroHeadline" (unique within the collection's fields). */
export function contentKey(label: string, taken: readonly string[]) {
  const words = label.normalize("NFKD").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  let base = words.map((word, index) => index ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()).join("").slice(0, 32) || "text";
  if (!/^[a-z]/.test(base)) base = `text${base}`.slice(0, 32);
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}${n}`;
  return key;
}

/** Relative import specifier from a source file to src/content/site.json. */
export function contentImportPath(fromPath: string) {
  const from = fromPath.split("/").slice(0, -1), to = collectionPath(SITE_COLLECTION).split("/");
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++;
  const up = from.length - shared;
  return `${up ? "../".repeat(up) : "./"}${to.slice(shared).join("/")}`;
}

/** Moves one literal text into src/content/site.json (declared in collections.json as a text field)
 * and renders it from there, so the client can edit it in the portal. The visible page is unchanged. */
function extractText(source: WebsiteProjectSource, parsed: Parsed, element: SyntaxNode, edit: Extract<VisualEdit, { kind: "extract" }>, where: string): VisualEditResult {
  const label = edit.label.replace(/[<>\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!label) return fail("Give this text a name your client will recognise, like “Opening offer”.");
  const target = textTarget(source, parsed, edit.loc, element, edit.rendered);
  if ("reason" in target) return fail(target.reason);
  if (target.kind === "runs") return fail("Part of this text is styled differently (like a word in italics), so it can't be handed over as one piece. Ask the builder to make it client-editable.");
  const value = target.value.replace(/\s+/g, " ").trim();
  if (!value) return fail("There's no text here to hand over.");
  if (value.length > MAX_TEXT) return fail(`Texts over ${MAX_TEXT} characters can't be handed over here.`);

  const manifestFile = source.files.find(file => file.path === MANIFEST_PATH);
  let collections: Manifest["collections"] = {}, locale: string | undefined, currency: string | undefined;
  if (manifestFile) {
    const current = parseManifest(manifestFile.content);
    if (!current.ok) return fail("This site's list of editable content has a problem. Ask the builder to fix it first.");
    collections = current.manifest.collections; locale = current.manifest.locale; currency = current.manifest.currency;
  }
  const existing = collections[SITE_COLLECTION];
  if (existing && existing.kind !== "single") return fail("This site already uses “site” for a list. Ask the builder to make this text client-editable.");
  if (!existing && Object.keys(collections).length >= CONTENT_LIMITS.collections) return fail("This site already has the maximum number of editable sections.");
  const fields = { ...(existing?.fields ?? {}) };
  if (Object.keys(fields).length >= CONTENT_LIMITS.fields) return fail(`Your client can already edit ${CONTENT_LIMITS.fields} texts on this site.`);
  const key = contentKey(label, Object.keys(fields));
  fields[key] = { type: "text", label, required: true, ...(value.length > 120 ? { multiline: true } : {}), max: Math.min(MAX_TEXT, Math.max(80, Math.ceil(value.length * 2))) };
  const manifest = ManifestSchema.safeParse({ version: 1, ...(locale ? { locale } : {}), ...(currency ? { currency } : {}),
    collections: { ...collections, [SITE_COLLECTION]: { label: existing?.label ?? "Website text", kind: "single", ...(existing?.help ? { help: existing.help } : {}), fields } } });
  if (!manifest.success) return fail("This text can't be handed over automatically. Ask the builder to make it client-editable.");

  const dataPath = collectionPath(SITE_COLLECTION), dataFile = source.files.find(file => file.path === dataPath);
  let data: Record<string, unknown> = {};
  if (dataFile) {
    try { data = JSON.parse(dataFile.content); } catch { return fail("This site's editable text file has a problem. Ask the builder to fix it first."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail("This site's editable text file has a problem. Ask the builder to fix it first.");
  }
  data = { ...data, [key]: value };

  const file = source.files.find(item => item.path === target.path);
  if (!file) return fail("This file is no longer in the project.");
  const code = file.content, reference = `${SITE_CONTENT_IMPORT}.${key}`;
  const hasImport = new RegExp(`import\\s+${SITE_CONTENT_IMPORT}\\s+from\\s+["'][^"']*content/site\\.json["']`).test(code);
  if (!hasImport && new RegExp(`\\b${SITE_CONTENT_IMPORT}\\b`).test(code)) return fail("This file already uses the name siteContent. Ask the builder to make this text client-editable.");
  const insert = target.kind === "jsx" ? `${/^\s*/.exec(target.raw)![0]}{${reference}}${/\s*$/.exec(target.raw)![0]}` : reference;
  let next = code.slice(0, target.from) + insert + code.slice(target.to), start = target.from, length = insert.length;
  if (!hasImport) {
    const statement = `import ${SITE_CONTENT_IMPORT} from "${contentImportPath(target.path)}";\n`;
    // After the file's last top-level import statement (multi-line imports included), found with the parser.
    const parser = scriptParser(target.path);
    if (!parser) return fail("This text lives in a file the editor can't change. Ask the builder to make it client-editable.");
    const lastImport = parser.parse(code).topNode.getChildren("ImportDeclaration").at(-1);
    const lineEnd = lastImport ? code.indexOf("\n", lastImport.to) : -1;
    const at = lastImport ? (lineEnd < 0 ? code.length : lineEnd + 1) : 0;
    if (at > target.from) return fail("This text can't be handed over automatically. Ask the builder to make it client-editable.");
    next = next.slice(0, at) + statement + next.slice(at);
    length += statement.length + (target.from - at); start = at;
  }

  let result = editWebsiteSource(source, { type: "edit", path: target.path, content: next });
  if (!result.ok) return fail(result.message);
  for (const [path, content] of [[MANIFEST_PATH, serialiseContent(manifest.data)], [dataPath, serialiseContent(data)]] as const) {
    if (!result.source.files.some(item => item.path === path)) {
      result = editWebsiteSource(result.source, { type: "add", path });
      if (!result.ok) return fail(result.message);
    }
    result = editWebsiteSource(result.source, { type: "edit", path, content });
    if (!result.ok) return fail(result.message);
  }
  return { ok: true, source: result.source, summary: `Let the client edit “${label}” (${where})`, change: { path: target.path, from: start, to: target.to, length } };
}

/** Where a selected element is after an edit; null when it was removed. */
export function remapLoc(loc: ElementLoc, change: SourceChange): ElementLoc | null {
  if (loc.path !== change.path) return loc;
  if (loc.offset >= change.to && change.to > change.from) return { path: loc.path, offset: loc.offset + change.length - (change.to - change.from) };
  if (loc.offset >= change.from && loc.offset < change.to) return change.length === 0 ? null : loc;
  if (change.from === change.to && loc.offset >= change.from && change.from !== loc.offset) return { path: loc.path, offset: loc.offset + change.length };
  return loc;
}

/** Public path for a project image asset (public/images/a.webp → /images/a.webp). */
export const assetPublicPath = (path: string) => `/${path.replace(/^public\//, "")}`;
