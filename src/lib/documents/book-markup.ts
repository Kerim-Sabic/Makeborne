/** Makeborne book markup: a small, forgiving Markdown subset that is easy for
 * the model to write and to edit with exact find/replace.
 *
 *   Paragraphs are separated by a blank line.
 *   ## Subheading
 *   > Quoted passage (a final line starting with "— " is the attribution)
 *   - bullet item (or * item) / 1. numbered item
 *   | Table | row |    (a |---| line after the first row makes it the header)
 *   * * *            scene break
 *   [[figure:image-name|Caption]]
 *   [[note:Title|Body text]]
 *   Inline: *italic*, **bold**
 *
 * A block written without its blank line (a heading directly above its text,
 * an intro line followed by a list) is split into its parts rather than
 * flattened into one paragraph.
 */
export type BookBlock =
  | { type: "paragraph"; text: string }
  | { type: "subheading"; text: string }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "list"; ordered: boolean; items: string[]; start?: number }
  | { type: "table"; header?: string[]; rows: string[][] }
  | { type: "break" }
  | { type: "figure"; image: string; caption?: string }
  | { type: "note"; title?: string; text: string };

type LineKind = "heading" | "quote" | "bullet" | "ordered" | "table" | "break" | "text";
const BREAK = /^(\*\s*){3,}$|^(-\s*){3,}$|^⁂$/;
const lineKind = (line: string): LineKind =>
  BREAK.test(line) ? "break"
  : /^#{1,4}\s/.test(line) ? "heading"
  : line.startsWith(">") ? "quote"
  : /^[-•*]\s+\S/.test(line) ? "bullet"
  // Up to three digits, so a wrapped line starting with a year stays prose.
  : /^\d{1,3}[.)]\s+\S/.test(line) ? "ordered"
  : /^\|.*\|$/.test(line) ? "table"
  : "text";
const TABLE_RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;
const tableCells = (line: string) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());

function addGroup(kind: LineKind, lines: string[], blocks: BookBlock[]) {
  switch (kind) {
    case "break": blocks.push({ type: "break" }); return;
    case "heading": for (const line of lines) blocks.push({ type: "subheading", text: line.replace(/^#{1,4}\s+/, "") }); return;
    case "quote": {
      const body = lines.map(line => line.replace(/^>\s?/, "")).filter(line => line.trim());
      if (!body.length) return;
      const last = body[body.length - 1];
      const attribution = body.length > 1 && /^(—|--|-)\s*\S/.test(last) ? last.replace(/^(—|--|-)\s*/, "") : undefined;
      blocks.push({ type: "quote", text: (attribution ? body.slice(0, -1) : body).join(" ").trim(), ...(attribution ? { attribution } : {}) });
      return;
    }
    case "bullet": blocks.push({ type: "list", ordered: false, items: lines.map(line => line.replace(/^[-•*]\s+/, "")) }); return;
    case "ordered": {
      const start = Number(/^\d+/.exec(lines[0])![0]);
      blocks.push({ type: "list", ordered: true, items: lines.map(line => line.replace(/^\d+[.)]\s+/, "")), ...(start !== 1 ? { start } : {}) });
      return;
    }
    case "table": {
      const header = lines.length > 1 && TABLE_RULE.test(lines[1]);
      const rows = lines.filter(line => !TABLE_RULE.test(line)).map(tableCells);
      if (rows.length) blocks.push(header ? { type: "table", header: rows[0], rows: rows.slice(1) } : { type: "table", rows });
      return;
    }
    case "text": blocks.push({ type: "paragraph", text: lines.join(" ") }); return;
  }
}

export function parseBookMarkup(source: string): BookBlock[] {
  const blocks: BookBlock[] = [];
  const chunks = source.replace(/\r\n?/g, "\n").split(/\n{2,}/).map(chunk => chunk.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const directive = /^\[\[(figure|note):([^|\]]*)(?:\|([\s\S]*?))?\]\]$/.exec(chunk);
    if (directive) {
      const [, kind, first, second] = directive;
      if (kind === "figure") blocks.push({ type: "figure", image: first.trim(), ...(second?.trim() ? { caption: second.trim() } : {}) });
      else blocks.push(second === undefined ? { type: "note", text: first.trim() } : { type: "note", title: first.trim() || undefined, text: second.trim() });
      continue;
    }
    const lines = chunk.split("\n").map(line => line.trim()).filter(Boolean);
    // Consecutive lines of one kind form one block; a change of kind starts the next.
    let kind = lineKind(lines[0]), group: string[] = [];
    for (const line of lines) {
      let next = lineKind(line);
      // A wrapped line continues the list item or quote above it.
      if (next === "text" && (kind === "bullet" || kind === "ordered")) { group[group.length - 1] += ` ${line}`; continue; }
      if (next === "text" && kind === "quote") next = "quote";
      if (next !== kind || kind === "break") { if (group.length) addGroup(kind, group, blocks); kind = next; group = []; }
      group.push(line);
    }
    if (group.length) addGroup(kind, group, blocks);
  }
  return blocks;
}

/** Typographer's punctuation for rendered body text: curly quotes, em dashes and
 * ellipses. Runs on raw text before escaping; the stored source is unchanged. */
export function smartPunctuation(value: string) {
  const text = value.replace(/(^|[^-])---?(?!-)/g, "$1—").replace(/\.\.\./g, "…");
  // Emphasis markers are transparent: look past them to the real neighbours.
  const neighbour = (at: number, step: -1 | 1) => { while (text[at] === "*") at += step; return text[at] ?? ""; };
  const closesAfter = /[\p{L}\p{N}.,!?;:)\]}%…’”]/u;
  let out = "";
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char !== '"' && char !== "'") { out += char; continue; }
    const before = neighbour(at - 1, -1), after = neighbour(at + 1, 1);
    // Apostrophes: inside or after a word, or before a year ('90s).
    const closing = closesAfter.test(before) || (char === "'" && /\d/.test(after)) || (!after.trim() && !!before);
    out += char === '"' ? (closing ? "”" : "“") : (closing ? "’" : "‘");
  }
  return out;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Escape, then apply **bold** and *italic*. Never emits other markup. */
export function inlineHtml(value: string) {
  return escapeHtml(value)
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, "$1<em>$2</em>");
}
/** Inline markup for body text, with typographic punctuation. */
export const bodyHtml = (value: string) => inlineHtml(smartPunctuation(value));
export const plainText = (value: string) => value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, "$1$2");
export const wordCount = (value: string) => (value.match(/[\p{L}\p{N}’']+/gu) ?? []).length;
