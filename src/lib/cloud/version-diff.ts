/** Compares two saved versions of a project in the browser. Every kind of
 * content (React website files, legacy website HTML/CSS, decks, books and
 * outline sections) becomes named text units, which are matched by key and
 * diffed line by line. Pure and deterministic: nothing is fetched or executed. */
import type { ArtifactContent } from "@/lib/domain";

export type DiffLine = { type: "same" | "add" | "remove"; text: string; old?: number; new?: number };
export type DiffHunk = { oldStart: number; newStart: number; lines: DiffLine[] };
export type UnitStatus = "added" | "removed" | "changed";
export type UnitChange = {
  key: string; label: string; group: string; status: UnitStatus;
  added: number; removed: number;
  /** null when the unit is too large to compare line by line. */
  hunks: DiffHunk[] | null;
};
export type VersionComparison = { changes: UnitChange[]; unchanged: number; added: number; removed: number };

type Unit = { key: string; label: string; group: string; text: string };

const MAX_LINES = 12_000;
const MAX_EDITS = 3_000;
const CONTEXT = 3;

/** Myers' O(ND) line diff. Returns null when the inputs are too large or too different. */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before === "" ? [] : before.split(/\r?\n/), b = after === "" ? [] : after.split(/\r?\n/);
  if (a.length + b.length > MAX_LINES) return null;
  // Trim the common prefix and suffix first: most edits touch a small region.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const x = a.slice(start, endA), y = b.slice(start, endB), n = x.length, m = y.length, max = n + m;
  const middle: DiffLine[] = [];
  if (n === 0) y.forEach(text => middle.push({ type: "add", text }));
  else if (m === 0) x.forEach(text => middle.push({ type: "remove", text }));
  else {
    const offset = max + 1, v = new Int32Array(2 * max + 3), trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let i = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
        let j = i - k;
        while (i < n && j < m && x[i] === y[j]) { i++; j++; }
        v[offset + k] = i;
        if (i >= n && j >= m) { found = d; break; }
      }
      if (found >= 0) break;
    }
    if (found < 0) return null;
    // Walk the trace backwards to recover the edit script.
    let i = n, j = m;
    for (let d = found; d > 0; d--) {
      const previous = trace[d], k = i - j;
      const down = k === -d || (k !== d && previous[offset + k - 1] < previous[offset + k + 1]);
      const prevK = down ? k + 1 : k - 1, prevI = previous[offset + prevK], prevJ = prevI - prevK;
      while (i > prevI && j > prevJ) { middle.push({ type: "same", text: x[--i] }); j--; }
      if (down) middle.push({ type: "add", text: y[--j] }); else middle.push({ type: "remove", text: x[--i] });
    }
    while (i > 0 && j > 0) { middle.push({ type: "same", text: x[--i] }); j--; }
    middle.reverse();
  }
  const lines: DiffLine[] = a.slice(0, start).map(text => ({ type: "same", text }));
  lines.push(...middle, ...a.slice(endA).map(text => ({ type: "same" as const, text })));
  let oldLine = 0, newLine = 0;
  for (const line of lines) {
    if (line.type !== "add") line.old = ++oldLine;
    if (line.type !== "remove") line.new = ++newLine;
  }
  return lines;
}

/** Changed regions with a few lines of surrounding context. */
export function toHunks(lines: DiffLine[], context = CONTEXT): DiffHunk[] {
  // Merge each change's [index - context, index + context] window with its neighbours.
  const ranges: [number, number][] = [];
  lines.forEach((line, index) => {
    if (line.type === "same") return;
    const from = Math.max(0, index - context), to = Math.min(lines.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = to; else ranges.push([from, to]);
  });
  // Line numbers where each hunk starts, counting lines that exist on each side.
  return ranges.map(([from, to]) => {
    let oldStart = 1, newStart = 1;
    for (let at = 0; at < from; at++) { if (lines[at].type !== "add") oldStart++; if (lines[at].type !== "remove") newStart++; }
    return { oldStart, newStart, lines: lines.slice(from, to + 1) };
  });
}

/** Readable, stable text for structured content (slides, chapters, themes). */
export function readableLines(value: unknown, indent = ""): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value !== "object") return String(value).split(/\r?\n/).map(line => `${indent}${line}`);
  if (Array.isArray(value)) return value.flatMap(item => {
    const inner = readableLines(item, `${indent}  `);
    return inner.length ? [`${indent}- ${inner[0].trimStart()}`, ...inner.slice(1)] : [];
  });
  return Object.keys(value).sort().flatMap(key => {
    const item = (value as Record<string, unknown>)[key];
    if (item === null || item === undefined || item === "" || key === "id") return [];
    if (typeof item !== "object" && !String(item).includes("\n")) return [`${indent}${key}: ${String(item)}`];
    const inner = readableLines(item, `${indent}  `);
    return inner.length ? [`${indent}${key}:`, ...inner] : [];
  });
}

const titleOf = (value: unknown) => {
  const record = value as Record<string, unknown>;
  for (const key of ["title", "heading", "name"]) if (typeof record?.[key] === "string" && record[key]) return String(record[key]).slice(0, 80);
  return "";
};

function units(content: ArtifactContent): Unit[] {
  const list: Unit[] = [{ key: "meta:title", label: "Title", group: "Project", text: content.title }];
  const source = content.websiteSource;
  if (source) {
    for (const file of source.files) list.push({ key: `file:${file.path}`, label: file.path, group: "Files", text: file.content });
    list.push({ key: "site:pages", label: "Pages", group: "Website", text: source.routes.map(route => `${route.path}  ${route.title}`).join("\n") });
    list.push({ key: "site:images", label: "Images", group: "Website", text: source.assets.map(asset => asset.path).join("\n") });
  }
  if (content.website) {
    list.push({ key: "legacy:html", label: "Website HTML", group: "Website", text: content.website.html });
    list.push({ key: "legacy:css", label: "Website CSS", group: "Website", text: content.website.css });
  }
  const doc = content.document as unknown as Record<string, unknown> | undefined;
  if (doc) {
    const items = (doc.kind === "deck" ? doc.slides : doc.chapters) as Record<string, unknown>[] | undefined;
    const noun = doc.kind === "deck" ? "Slide" : "Chapter";
    (items ?? []).forEach((item, index) => list.push({
      key: `${noun}:${String(item.id ?? index)}`, label: `${noun} ${index + 1}${titleOf(item) ? ` · ${titleOf(item)}` : ""}`,
      group: doc.kind === "deck" ? "Slides" : "Chapters", text: readableLines(item).join("\n"),
    }));
    const rest = Object.fromEntries(Object.entries(doc).filter(([key]) => key !== "slides" && key !== "chapters" && key !== "assets" && key !== "theme"));
    list.push({ key: "doc:details", label: doc.kind === "deck" ? "Deck details" : "Book details", group: "Document", text: readableLines(rest).join("\n") });
    list.push({ key: "doc:theme", label: "Theme", group: "Document", text: readableLines(doc.theme).join("\n") });
  } else if (!source && !content.website) {
    content.sections.forEach((section, index) => list.push({
      key: `section:${section.id}`, label: `Section ${index + 1}${section.title ? ` · ${section.title}` : ""}`, group: "Sections",
      text: [section.title, ...section.blocks.map(block => (block as { text?: string }).text ?? "")].filter(Boolean).join("\n"),
    }));
  }
  return list;
}

/** What changed from `before` to `after`, in project order. */
export function compareContent(before: ArtifactContent, after: ArtifactContent): VersionComparison {
  const old = new Map(units(before).map(unit => [unit.key, unit])), next = units(after);
  const changes: UnitChange[] = [];
  let unchanged = 0, added = 0, removed = 0;
  const record = (unit: Unit, status: UnitStatus, from: string, to: string) => {
    const lines = diffLines(from, to);
    const plus = lines ? lines.filter(line => line.type === "add").length : to.split("\n").length;
    const minus = lines ? lines.filter(line => line.type === "remove").length : from.split("\n").length;
    added += plus; removed += minus;
    changes.push({ key: unit.key, label: unit.label, group: unit.group, status, added: plus, removed: minus, hunks: lines ? toHunks(lines) : null });
  };
  for (const unit of next) {
    const previous = old.get(unit.key);
    old.delete(unit.key);
    if (!previous) { if (unit.text) record(unit, "added", "", unit.text); continue; }
    if (previous.text === unit.text) { unchanged++; continue; }
    record({ ...unit, label: unit.label }, "changed", previous.text, unit.text);
  }
  for (const unit of old.values()) if (unit.text) record(unit, "removed", unit.text, "");
  return { changes, unchanged, added, removed };
}
