/**
 * Literal search over the files of one website project version (audit M12):
 * file names and file contents as separate scopes, honest counts, line-level
 * hits with snippets, and an identity (artifact, version, unsaved edits,
 * content fingerprint) so a result can be recognised as out of date once the
 * code changes. Deterministic and bounded; nothing is fetched or executed and
 * artwork is never read. Client-safe.
 */
import type {WebsiteProjectSource} from "./website-source";
import {managedSourcePath} from "./source-edit";

export const SOURCE_SEARCH_LIMITS = {
  /** Content search needs at least this many characters; file names need one. */
  minContentQuery: 2,
  maxQuery: 200,
  /** Line hits kept per file and in total (every occurrence is still counted, up to countCap). */
  hitsPerFile: 40,
  totalHits: 300,
  countCap: 20_000,
  /** Characters of context kept either side of the first match on a long line. */
  snippetRadius: 56,
} as const;

export type SearchScope = "all" | "names" | "content";
export type SearchOptions = {scope?: SearchScope; caseSensitive?: boolean; skipManaged?: boolean};
/** Which code a search read. `fingerprint` changes with any file path or content change. */
export type SearchIdentity = {artifactId: string; version: number; dirty: boolean; fingerprint: string};
export type SnippetPart = {text: string; match: boolean};
export type NameResult = {id: string; path: string; basename: string; directory: string; duplicate: boolean; managed: boolean};
export type LineHit = {
  id: string; line: number; /** 1-based column of the first match on this line. */ column: number;
  /** Matches on this line (all of them are counted in `occurrences`). */ matches: number;
  parts: SnippetPart[]; clippedStart: boolean; clippedEnd: boolean;
};
export type ContentFile = {
  id: string; path: string; basename: string; directory: string; duplicate: boolean; managed: boolean;
  occurrences: number; /** Lines holding a match (may exceed hits.length when capped). */ lines: number;
  hits: LineHit[]; capped: boolean;
};
export type SourceSearchResult = {
  query: string; scope: SearchScope; caseSensitive: boolean; skipManaged: boolean; identity: SearchIdentity;
  names: NameResult[]; files: ContentFile[];
  totals: {names: number; contentFiles: number; occurrences: number; shownHits: number; managedOccurrences: number};
  /** Counting stopped at countCap occurrences: totals are a lower bound. */
  countCapped: boolean;
  /** Some line hits are not listed (per-file or overall cap). */
  hitsCapped: boolean;
  /** Content scope was requested but the query is shorter than minContentQuery. */
  contentTooShort: boolean;
  /** Not searched: managed files when skipped, and artwork (binary) by path only. */
  skipped: {managed: string[]; images: number};
};

const basenameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const directoryOf = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A fast 64-bit (two 32-bit FNV/djb2 lanes) fingerprint of every file path and content. Not a security hash. */
export function sourceFingerprint(source: Pick<WebsiteProjectSource, "files">): string {
  let a = 0x811c9dc5, b = 5381, length = 0;
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      a = Math.imul(a ^ code, 0x01000193);
      b = (Math.imul(b, 33) + code) | 0;
    }
    length += text.length;
  };
  for (const file of source.files) { feed(file.path); feed("\u0000"); feed(file.content); feed("\u0001"); }
  return `${source.files.length}.${length}.${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

/** Offsets of each line start, for mapping a character offset to a 1-based line. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
  return starts;
}
function lineAt(starts: number[], offset: number): number {
  let low = 0, high = starts.length - 1;
  while (low < high) { const middle = (low + high + 1) >> 1; if (starts[middle] <= offset) low = middle; else high = middle - 1; }
  return low;
}

function snippet(lineText: string, matches: [number, number][]): {parts: SnippetPart[]; clippedStart: boolean; clippedEnd: boolean} {
  const radius = SOURCE_SEARCH_LIMITS.snippetRadius;
  const [firstStart, firstLength] = matches[0];
  const from = Math.max(0, firstStart - radius);
  const to = Math.min(lineText.length, firstStart + firstLength + radius * 2);
  const parts: SnippetPart[] = [];
  let at = from;
  for (const [start, length] of matches) {
    if (start < at || start >= to) continue;
    if (start > at) parts.push({text: lineText.slice(at, start), match: false});
    const end = Math.min(to, start + length);
    parts.push({text: lineText.slice(start, end), match: true});
    at = end;
  }
  if (at < to) parts.push({text: lineText.slice(at, to), match: false});
  // Leading indentation is noise in a result list.
  if (from === 0 && parts[0] && !parts[0].match) parts[0] = {...parts[0], text: parts[0].text.trimStart()};
  return {parts: parts.filter(part => part.text.length), clippedStart: from > 0, clippedEnd: to < lineText.length};
}

const nameRank = (path: string, query: string, caseSensitive: boolean) => {
  const fold = (value: string) => caseSensitive ? value : value.toLowerCase();
  const base = fold(basenameOf(path)), needle = fold(query), full = fold(path);
  if (base === needle) return 0;
  if (base.startsWith(needle)) return 1;
  if (base.includes(needle)) return 2;
  return full.includes(needle) ? 3 : -1;
};

/** Searches one version's files. The query is literal text (no patterns); case-insensitive unless asked. */
export function searchSource(source: Pick<WebsiteProjectSource, "files" | "assets">, rawQuery: string, identity: Omit<SearchIdentity, "fingerprint"> & {fingerprint?: string}, options: SearchOptions = {}): SourceSearchResult {
  const scope = options.scope ?? "all", caseSensitive = !!options.caseSensitive, skipManaged = !!options.skipManaged;
  const query = rawQuery.slice(0, SOURCE_SEARCH_LIMITS.maxQuery);
  const fingerprint = identity.fingerprint ?? sourceFingerprint(source);
  const result: SourceSearchResult = {
    query, scope, caseSensitive, skipManaged, identity: {artifactId: identity.artifactId, version: identity.version, dirty: identity.dirty, fingerprint},
    names: [], files: [], totals: {names: 0, contentFiles: 0, occurrences: 0, shownHits: 0, managedOccurrences: 0},
    countCapped: false, hitsCapped: false, contentTooShort: false,
    skipped: {managed: skipManaged ? source.files.filter(file => managedSourcePath(file.path)).map(file => file.path) : [], images: source.assets.length},
  };
  if (!query.trim()) return result;
  const baseCounts = new Map<string, number>();
  for (const file of source.files) { const key = basenameOf(file.path).toLowerCase(); baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1); }
  const describe = (path: string) => ({path, basename: basenameOf(path), directory: directoryOf(path), duplicate: (baseCounts.get(basenameOf(path).toLowerCase()) ?? 0) > 1, managed: managedSourcePath(path)});
  const searched = source.files.filter(file => !(skipManaged && managedSourcePath(file.path)));
  const scopeKey = `${identity.artifactId}:${identity.version}:${fingerprint}`;

  if (scope !== "content") {
    result.names = searched
      .map(file => ({file, rank: nameRank(file.path, query, caseSensitive)}))
      .filter(item => item.rank >= 0)
      .sort((x, y) => x.rank - y.rank || Number(managedSourcePath(x.file.path)) - Number(managedSourcePath(y.file.path)) || (x.file.path < y.file.path ? -1 : 1))
      .map(({file}) => ({id: `${scopeKey}:name:${file.path}`, ...describe(file.path)}));
    result.totals.names = result.names.length;
  }
  if (scope === "names") return result;
  if (query.length < SOURCE_SEARCH_LIMITS.minContentQuery) { result.contentTooShort = true; return result; }

  // Pass 1: every occurrence offset (up to the overall count cap), per file.
  const pattern = new RegExp(escapeRegExp(query), caseSensitive ? "gu" : "giu");
  const found: {file: (typeof searched)[number]; offsets: number[]; lengths: number[]}[] = [];
  let counted = 0;
  for (const file of searched) {
    if (counted >= SOURCE_SEARCH_LIMITS.countCap) { result.countCapped = true; break; }
    pattern.lastIndex = 0;
    const offsets: number[] = [], lengths: number[] = [];
    for (let match = pattern.exec(file.content); match; match = pattern.exec(file.content)) {
      offsets.push(match.index); lengths.push(match[0].length);
      if (++counted >= SOURCE_SEARCH_LIMITS.countCap) { result.countCapped = true; break; }
    }
    if (offsets.length) found.push({file, offsets, lengths});
  }
  // Ranking: your own files before managed ones, then most occurrences, then path.
  found.sort((x, y) => Number(managedSourcePath(x.file.path)) - Number(managedSourcePath(y.file.path)) || y.offsets.length - x.offsets.length || (x.file.path < y.file.path ? -1 : 1));

  // Pass 2: line hits with snippets, within the per-file and overall budgets.
  let budget: number = SOURCE_SEARCH_LIMITS.totalHits;
  for (const {file, offsets, lengths} of found) {
    const starts = lineStarts(file.content);
    const byLine = new Map<number, [number, number][]>();
    offsets.forEach((offset, index) => {
      const line = lineAt(starts, offset);
      const list = byLine.get(line) ?? [];
      list.push([offset - starts[line], lengths[index]]);
      byLine.set(line, list);
    });
    const hits: LineHit[] = [];
    // Each file keeps at least its first hit so it can always be opened at a match.
    const room = Math.max(1, Math.min(SOURCE_SEARCH_LIMITS.hitsPerFile, budget));
    for (const [line, matches] of byLine) {
      if (hits.length >= room) break;
      const end = line + 1 < starts.length ? starts[line + 1] - 1 : file.content.length;
      const text = file.content.slice(starts[line], end).replace(/\r$/, "");
      hits.push({id: `${scopeKey}:line:${file.path}:${line + 1}`, line: line + 1, column: matches[0][0] + 1, matches: matches.length, ...snippet(text, matches)});
    }
    budget = Math.max(0, budget - hits.length);
    const capped = hits.length < byLine.size;
    if (capped) result.hitsCapped = true;
    result.files.push({id: `${scopeKey}:file:${file.path}`, ...describe(file.path), occurrences: offsets.length, lines: byLine.size, hits, capped});
    result.totals.occurrences += offsets.length;
    if (managedSourcePath(file.path)) result.totals.managedOccurrences += offsets.length;
    result.totals.shownHits += hits.length;
  }
  result.totals.contentFiles = result.files.length;
  return result;
}

/** Whether results still describe this code. Same content under a newer label stays valid. */
export function searchIsCurrent(result: Pick<SourceSearchResult, "identity"> | null, artifactId: string, fingerprint: string): boolean {
  return !!result && result.identity.artifactId === artifactId && result.identity.fingerprint === fingerprint;
}

/** How the searched code is named to the reader. */
export function searchedLabel(identity: Pick<SearchIdentity, "version" | "dirty">): string {
  if (identity.version < 1) return "Searching your unsaved code";
  return identity.dirty ? `Searching version ${identity.version} with unsaved changes` : `Searching saved version ${identity.version}`;
}

export type HitCheck = {ok: true; from: number; to: number} | {ok: false; reason: "missing-file" | "moved"};
/**
 * Before revealing a (possibly out-of-date) hit, confirm the match is still on
 * that line of that exact path. A file with the same basename elsewhere is
 * never substituted.
 */
export function locateHit(source: Pick<WebsiteProjectSource, "files">, path: string, line: number, column: number, query: string, caseSensitive: boolean): HitCheck {
  const file = source.files.find(item => item.path === path);
  if (!file) return {ok: false, reason: "missing-file"};
  const starts = lineStarts(file.content);
  if (line < 1 || line > starts.length) return {ok: false, reason: "moved"};
  const lineStart = starts[line - 1], lineEnd = line < starts.length ? starts[line] - 1 : file.content.length;
  const from = lineStart + column - 1;
  if (from > lineEnd) return {ok: false, reason: "moved"};
  const pattern = new RegExp(escapeRegExp(query), caseSensitive ? "yu" : "yiu");
  pattern.lastIndex = from;
  const match = pattern.exec(file.content);
  return match && match.index + match[0].length <= lineEnd ?{ok: true, from, to: from + match[0].length} : {ok: false, reason: "moved"};
}
