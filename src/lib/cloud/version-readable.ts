/**
 * A readable summary of what changed between two saved versions (audit M11),
 * shown alongside the exact line diff, never instead of it. Website files are
 * summarised by the wording they contain (text between tags, readable
 * attributes and prose strings), slides/chapters/sections by their text, and
 * everything else by how many lines of code, styling or settings changed.
 * It reads the saved versions only; it never rewrites or reformats them.
 * Heuristic by design: the exact diff remains the authority. Client-safe.
 */
import type { ArtifactContent } from "@/lib/domain";
import { contentUnits, diffLines, type DiffLine, type UnitChange, type UnitStatus, type VersionComparison } from "./version-diff";

export type WordPart = { type: "same" | "add" | "remove"; text: string };
/** Where a change lives: a line of a file in the newer ("to") or, for removed text, the older ("from") version. */
export type ChangeLocation = { side: "from" | "to"; line: number };
export type ReadableEntry = {
  id: string; kind: "added" | "removed" | "changed";
  before: string | null; after: string | null; clipped: boolean;
  /** Word-level marks for a changed line; null when the line is too long to mark. */
  words: WordPart[] | null;
  at: ChangeLocation | null;
};
export type ReadableKind = "copy" | "code" | "styles" | "settings" | "pages" | "images" | "content";
export type ReadableUnit = {
  key: string; label: string; group: string; status: UnitStatus; kind: ReadableKind;
  /** Full project path for website source files. */
  path: string | null;
  added: number; removed: number;
  entries: ReadableEntry[];
  /** No wording to show (code/styling/settings only, or too large to summarise). */
  summaryOnly: "code" | "styles" | "settings" | "too-large" | null;
  first: ChangeLocation | null;
};
export type ReadableComparison = { units: ReadableUnit[]; total: number };

export const READABLE_LIMITS = { textChars: 280, wordTokens: 400, copyItems: 3000, page: 30 } as const;

type CopyItem = { text: string; line: number };

/** Replaces a range with spaces, keeping newlines so offsets and line numbers stay put. */
const blank = (value: string) => value.replace(/[^\n]/g, " ");
const hasLetter = /[\p{L}\p{N}]/u;
const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const decode = (value: string) => value.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&rsquo;/g, "’").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–");
const codeLike = /(=>|&&|\|\||;\s*$|^[)\]};]|^(?:else|try|finally|do)$|^[\w$.]+\)$|\b(?:return|const|let|function|import|export)\b|^\s*[A-Za-z_$][\w$]*\s*\()/;
/** Space-separated tokens that look like a class list or an identifier, not wording. */
function looksLikeTokens(value: string): boolean {
  const tokens = value.trim().split(/\s+/);
  if (tokens.every(token => /^[!a-z0-9:\-/[\]().#%_&>~+*=@,]+$/.test(token)) && tokens.some(token => /[-:[]/.test(token))) return true;
  if (tokens.length === 1 && !/^[\p{Lu}\p{Lo}]/u.test(tokens[0]) && !/[^\x20-\x7e]/.test(tokens[0])) return true;
  return /^(?:https?:|mailto:|\/|\.\.?\/|#[\w-]*$|[\w./-]+\.(?:tsx?|jsx?|css|json|png|jpe?g|webp|svg|html)$)/i.test(value.trim());
}

/** The wording in a JSX/TSX/JS or HTML file, in order, with the line it starts on. */
export function extractCopy(code: string, path = "file.tsx"): CopyItem[] {
  let text = code
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s;{}])(\/\/[^\n]*)/g, (_, lead: string, comment: string) => lead + blank(comment));
  if (/\.html?$/i.test(path)) text = text.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (_, open: string, _tag: string, inner: string, close: string) => open + blank(inner) + close);
  const starts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
  const lineOf = (offset: number) => { let low = 0, high = starts.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid] <= offset) low = mid; else high = mid - 1; } return low + 1; };
  const found: { offset: number; text: string }[] = [];
  const covered: [number, number][] = [];
  const add = (offset: number, value: string, end: number) => {
    const clean = collapse(decode(value));
    if (!clean || !hasLetter.test(clean)) return;
    found.push({ offset, text: clean }); covered.push([offset, end]);
  };
  // Readable attributes: alt, title, placeholder, aria-label, label and meta content.
  for (const match of text.matchAll(/\b(?:alt|title|placeholder|aria-label|label|content)\s*=\s*(["'])((?:(?!\1)[^\\\n])*)\1/g)) {
    const start = match.index + match[0].indexOf(match[1]) + 1;
    if (!looksLikeTokens(match[2]) || /\s/.test(match[2].trim())) add(start, match[2], match.index + match[0].length);
  }
  // Text between tags (and between JSX expressions).
  for (const match of text.matchAll(/[>}]([^<>{}]+)(?=[<{])/g)) {
    const value = match[1];
    if (!hasLetter.test(value) || codeLike.test(value.trim())) continue;
    const lead = value.length - value.trimStart().length;
    add(match.index + 1 + lead, value, match.index + match[0].length);
  }
  // Prose in string literals (data arrays, props): not class lists, paths, identifiers or import specifiers.
  if (!/\.html?$/i.test(path)) for (const match of text.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
    const at = match.index, end = at + match[0].length;
    if (covered.some(([from, to]) => at < to && end > from)) continue;
    const value = match[2];
    if (!value.trim() || !hasLetter.test(value) || value.includes("${") || looksLikeTokens(value)) continue;
    const before = text.slice(Math.max(0, at - 24), at);
    if (/(?:className|class|from|import|require\(|key|id|href|src|type|rel|role|name|lang|charSet|charset|style|htmlFor|target|method|action|data-[\w-]+|variant|size|as)\s*[=:(]?\s*$/.test(before)) continue;
    add(at + 1, value.replace(/\\(["'`\\])/g, "$1"), end);
  }
  found.sort((a, b) => a.offset - b.offset);
  return found.slice(0, READABLE_LIMITS.copyItems).map(item => ({ text: item.text, line: lineOf(item.offset) }));
}

const clip = (value: string) => value.length > READABLE_LIMITS.textChars ? { text: `${value.slice(0, READABLE_LIMITS.textChars - 1)}…`, clipped: true } : { text: value, clipped: false };

/** Word-level marks between two short lines of text, merged into runs. */
export function wordDiff(before: string, after: string): WordPart[] | null {
  const split = (value: string) => value.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}]/gu) ?? [];
  const a = split(before), b = split(after);
  if (a.length > READABLE_LIMITS.wordTokens || b.length > READABLE_LIMITS.wordTokens) return null;
  // diffLines works on newline-separated items; tokens never contain a newline.
  const escape = (token: string) => token.replace(/\n/g, " ");
  const lines = diffLines(a.map(escape).join("\n"), b.map(escape).join("\n"));
  if (!lines) return null;
  const parts: WordPart[] = [];
  for (const line of lines) {
    const last = parts[parts.length - 1];
    if (last && last.type === line.type) last.text += line.text; else parts.push({ type: line.type, text: line.text });
  }
  return parts;
}

/** Pairs each run of removed lines with the following added lines: changed, then leftover added/removed. */
function entriesFromLines(lines: DiffLine[], prefix: string, locate: (line: DiffLine, side: "from" | "to") => ChangeLocation | null, tidy: (text: string) => string): ReadableEntry[] {
  const entries: ReadableEntry[] = [];
  let index = 0, serial = 0;
  while (index < lines.length) {
    if (lines[index].type === "same") { index++; continue; }
    const removed: DiffLine[] = [], added: DiffLine[] = [];
    while (index < lines.length && lines[index].type !== "same") (lines[index].type === "remove" ? removed : added).push(lines[index++]);
    const pairs = Math.min(removed.length, added.length);
    const push = (kind: ReadableEntry["kind"], from: DiffLine | null, to: DiffLine | null) => {
      const before = from ? tidy(from.text) : null, after = to ? tidy(to.text) : null;
      if (kind === "changed" && before === after) return;
      if ((before ?? "") === "" && (after ?? "") === "") return;
      const b = before === null ? null : clip(before), a = after === null ? null : clip(after);
      entries.push({ id: `${prefix}:${serial++}`, kind, before: b?.text ?? null, after: a?.text ?? null, clipped: !!(b?.clipped || a?.clipped),
        words: kind === "changed" && before !== null && after !== null ? wordDiff(before, after) : null,
        at: to ? locate(to, "to") : from ? locate(from, "from") : null });
    };
    for (let at = 0; at < pairs; at++) push("changed", removed[at], added[at]);
    for (const line of removed.slice(pairs)) push("removed", line, null);
    for (const line of added.slice(pairs)) push("added", null, line);
  }
  return entries;
}

function kindOf(key: string, path: string | null): ReadableKind {
  if (key === "site:pages") return "pages";
  if (key === "site:images") return "images";
  if (key === "legacy:html") return "copy";
  if (key === "legacy:css") return "styles";
  if (!path) return "content";
  if (/\.(?:[jt]sx?|mjs|html?|mdx?|txt)$/i.test(path)) return "copy";
  if (/\.(?:css|scss)$/i.test(path)) return "styles";
  if (/\.json$/i.test(path)) return "settings";
  return "code";
}

/** The first changed line, preferring the newer version unless the whole unit was removed. */
function firstLocation(change: UnitChange): ChangeLocation | null {
  const lines = change.hunks?.flatMap(hunk => hunk.lines) ?? [];
  const index = lines.findIndex(line => line.type !== "same");
  if (index < 0) return null;
  if (change.status === "removed") return { side: "from", line: lines[index].old ?? 1 };
  if (lines[index].new) return { side: "to", line: lines[index].new! };
  // Removed lines inside a changed file: point at where they were, in the newer version.
  const next = lines.slice(index).find(line => line.new), previous = lines.slice(0, index).reverse().find(line => line.new);
  return { side: "to", line: next?.new ?? previous?.new ?? 1 };
}

/** Per-unit readable changes for an existing comparison of the same two versions. */
export function readableChanges(before: ArtifactContent, after: ArtifactContent, comparison: VersionComparison): ReadableComparison {
  const older = new Map(contentUnits(before).map(unit => [unit.key, unit.text]));
  const newer = new Map(contentUnits(after).map(unit => [unit.key, unit.text]));
  const units: ReadableUnit[] = comparison.changes.map((change: UnitChange) => {
    const from = older.get(change.key) ?? "", to = newer.get(change.key) ?? "";
    const path = change.key.startsWith("file:") ? change.key.slice(5) : null;
    const kind = kindOf(change.key, path);
    const first = path ? firstLocation(change) : null;
    const base = { key: change.key, label: change.label, group: change.group, status: change.status, kind, path, added: change.added, removed: change.removed, first };
    if (kind === "code" || kind === "styles" || kind === "settings") return { ...base, entries: [], summaryOnly: kind };
    let entries: ReadableEntry[] = [];
    if (kind === "copy") {
      const a = extractCopy(from, path ?? "page.html"), b = extractCopy(to, path ?? "page.html");
      const lines = diffLines(a.map(item => item.text).join("\n"), b.map(item => item.text).join("\n"));
      if (!lines) return { ...base, entries: [], summaryOnly: "too-large" };
      let oldIndex = 0, newIndex = 0;
      // Map each copy line back to the source line it came from, on its own side.
      const located = lines.map(line => ({ line, oldAt: line.type !== "add" ? a[oldIndex++]?.line : undefined, newAt: line.type !== "remove" ? b[newIndex++]?.line : undefined }));
      const where = new Map(located.map(item => [item.line, item]));
      entries = entriesFromLines(lines, change.key, (line, side) => {
        if (!path) return null;
        const item = where.get(line); const at = side === "to" ? item?.newAt : item?.oldAt;
        return at ? { side, line: at } : null;
      }, text => text);
      return { ...base, entries, summaryOnly: entries.length ? null : "code" };
    }
    const lines = diffLines(from, to);
    if (!lines) return { ...base, entries: [], summaryOnly: "too-large" };
    const tidy = kind === "pages" ? (text: string) => text.replace(/^(\S+)\s{2,}/, "$1 · ") : (text: string) => text.trim().replace(/^- /, "");
    entries = entriesFromLines(lines, change.key, () => null, tidy);
    return { ...base, entries, summaryOnly: entries.length ? null : "code" };
  });
  return { units, total: units.reduce((sum, unit) => sum + Math.max(1, unit.entries.length), 0) };
}

/** The first `limit` changes (an entry, or a unit summarised without entries, each count as one). */
export function limitReadable(readable: ReadableComparison, limit: number): { units: ReadableUnit[]; shown: number; hidden: number } {
  const units: ReadableUnit[] = [];
  let shown = 0;
  for (const unit of readable.units) {
    if (shown >= limit) break;
    const weight = Math.max(1, unit.entries.length);
    if (shown + weight <= limit) { units.push(unit); shown += weight; continue; }
    const room = limit - shown;
    units.push({ ...unit, entries: unit.entries.slice(0, room) });
    shown += room;
  }
  return { units, shown, hidden: readable.total - shown };
}
