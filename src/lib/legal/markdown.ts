/** The small Markdown subset the legal documents in docs/legal use: headings (#, ##, ###),
 * paragraphs, "- " lists, pipe tables, **bold** and [links](url). Anything else is plain text.
 * Pure and dependency-free, so the offline check parses exactly what the pages render. */
export type Inline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "link"; text: string; href: string };
export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

export function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Links may point at this site (/path, #anchor) or at mailto:/https: only. */
export function safeHref(href: string) {
  return /^(\/(?!\/)|#|mailto:|https:\/\/)/.test(href) ? href : "";
}

export function inline(source: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) out.push({ kind: "text", text: source.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ kind: "bold", text: match[1] });
    else {
      const href = safeHref(match[3]);
      out.push(href ? { kind: "link", text: match[2], href } : { kind: "text", text: match[2] });
    }
    last = match.index + match[0].length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => inline(cell.trim()));

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) blocks.push({ kind: "paragraph", inline: inline(paragraph.join(" ")) }); paragraph = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) { flush(); const text = heading[2].trim(); blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text, id: slug(text) }); continue; }
    if (/^- /.test(line)) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(inline(lines[i++].slice(2).trim()));
      i--; blocks.push({ kind: "list", items }); continue;
    }
    if (/^\|/.test(line)) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const [head, , ...body] = rows;
      blocks.push({ kind: "table", head: cells(head), rows: body.map(cells) }); continue;
    }
    if (!line.trim()) { flush(); continue; }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

export function plainText(blocks: Block[]) {
  const text = (parts: Inline[]) => parts.map(part => part.text).join("");
  return blocks.map(block => block.kind === "heading" ? block.text : block.kind === "paragraph" ? text(block.inline)
    : block.kind === "list" ? block.items.map(text).join("\n") : [block.head, ...block.rows].map(row => row.map(text).join(" | ")).join("\n")).join("\n");
}
