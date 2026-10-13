import { Fragment, type ReactNode } from "react";

/** Renders the small Markdown subset expert replies use (paragraphs, headings,
 * bullet and numbered lists, quotes, rules, **bold**, *italic*, `code`) as React
 * elements. Text is never parsed as HTML. */
export default function ChatMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let index = 0, key = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { blocks.push(<p key={key++} className="advisor-md-heading">{inline(heading[2])}</p>); index++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={key++} />); index++; continue; }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*•]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push(<ul key={key++}>{items.map((item, at) => <li key={at}>{inline(item)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const start = Number(/\d+/.exec(line)![0]), items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(<ol key={key++} start={start}>{items.map((item, at) => <li key={at}>{inline(item)}</li>)}</ol>);
      continue;
    }
    if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) quoted.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key++}>{inline(quoted.join(" "))}</blockquote>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|>|\s*[-*•]\s+|\s*\d+[.)]\s+)/.test(lines[index])) paragraph.push(lines[index++]);
    if (!paragraph.length) { paragraph.push(line); index++; }
    blocks.push(<p key={key++}>{paragraph.map((part, at) => <Fragment key={at}>{at > 0 && <br />}{inline(part)}</Fragment>)}</p>);
  }
  return <>{blocks}</>;
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|(?<![*\w])\*[^*\n]+\*(?![*\w])|(?<![_\w])_[^_\n]+_(?![_\w]))/g;
  let last = 0, match: RegExpExecArray | null, key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
