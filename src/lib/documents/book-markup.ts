/** Makeborne book markup: a small, forgiving Markdown subset that is easy for
 * the model to write and to edit with exact find/replace.
 *
 *   Paragraphs are separated by a blank line.
 *   ## Subheading
 *   > Quoted passage (a final line starting with "— " is the attribution)
 *   - bullet item / 1. numbered item
 *   * * *            scene break
 *   [[figure:image-name|Caption]]
 *   [[note:Title|Body text]]
 *   Inline: *italic*, **bold**
 */
export type BookBlock =
  | { type: "paragraph"; text: string }
  | { type: "subheading"; text: string }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "break" }
  | { type: "figure"; image: string; caption?: string }
  | { type: "note"; title?: string; text: string };

export function parseBookMarkup(source: string): BookBlock[] {
  const blocks: BookBlock[] = [];
  const chunks = source.replace(/\r\n?/g, "\n").split(/\n{2,}/).map(chunk => chunk.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map(line => line.trim());
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^⁂$/.test(chunk)) { blocks.push({ type: "break" }); continue; }
    const directive = /^\[\[(figure|note):([^|\]]*)(?:\|([\s\S]*?))?\]\]$/.exec(chunk);
    if (directive) {
      const [, kind, first, second] = directive;
      if (kind === "figure") blocks.push({ type: "figure", image: first.trim(), ...(second?.trim() ? { caption: second.trim() } : {}) });
      else blocks.push(second === undefined ? { type: "note", text: first.trim() } : { type: "note", title: first.trim() || undefined, text: second.trim() });
      continue;
    }
    if (/^#{1,4}\s/.test(lines[0]) && lines.length === 1) { blocks.push({ type: "subheading", text: lines[0].replace(/^#{1,4}\s+/, "") }); continue; }
    if (lines.every(line => line.startsWith(">"))) {
      const body = lines.map(line => line.replace(/^>\s?/, ""));
      const last = body[body.length - 1];
      const attribution = body.length > 1 && /^(—|--|-)\s*\S/.test(last) ? last.replace(/^(—|--|-)\s*/, "") : undefined;
      blocks.push({ type: "quote", text: (attribution ? body.slice(0, -1) : body).join(" ").trim(), ...(attribution ? { attribution } : {}) });
      continue;
    }
    if (lines.every(line => /^[-•]\s+/.test(line))) { blocks.push({ type: "list", ordered: false, items: lines.map(line => line.replace(/^[-•]\s+/, "")) }); continue; }
    if (lines.every(line => /^\d+[.)]\s+/.test(line))) { blocks.push({ type: "list", ordered: true, items: lines.map(line => line.replace(/^\d+[.)]\s+/, "")) }); continue; }
    blocks.push({ type: "paragraph", text: lines.join(" ") });
  }
  return blocks;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Escape, then apply **bold** and *italic*. Never emits other markup. */
export function inlineHtml(value: string) {
  return escapeHtml(value)
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, "$1<em>$2</em>");
}
export const plainText = (value: string) => value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, "$1$2");
export const wordCount = (value: string) => (value.match(/[\p{L}\p{N}’']+/gu) ?? []).length;
