"use client";
/** File-name and code search for the website Code view (audit M12). Searches the
 * code shown in the editor, names the version it read, and marks its results out
 * of date when that code changes. Opening a result only moves the editor; it
 * never edits, formats or saves anything. */
import {useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent, type ReactNode} from "react";
import {FileCode2, LockKeyhole, RefreshCw, Search, X} from "lucide-react";
import type {WebsiteProjectSource} from "@/lib/projects/website-source";
import {locateHit, searchIsCurrent, searchedLabel, searchSource, sourceFingerprint, SOURCE_SEARCH_LIMITS, type SearchScope, type SourceSearchResult} from "@/lib/projects/source-search";

export type SearchSubject = {artifactId: string; version: number; dirty: boolean};
const SCOPES: {value: SearchScope; label: string}[] = [{value: "all", label: "All"}, {value: "names", label: "File names"}, {value: "content", label: "In code"}];
const DEBOUNCE_MS = 200;
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en")} ${count === 1 ? one : many}`;

export default function SourceSearchPanel({source, subject, onOpenFile, onOpenLine, children}: {
  source: WebsiteProjectSource; subject: SearchSubject;
  onOpenFile: (path: string) => void;
  /** Reveals [from, to) of that exact path; the panel has already checked the match is still there. */
  onOpenLine: (path: string, from: number, to: number, line: number) => void;
  /** The ordinary file list, shown while nothing is being searched. */
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [skipManaged, setSkipManaged] = useState(false);
  const [result, setResult] = useState<SourceSearchResult | null>(null);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Only fingerprint the code while there are results to compare it with.
  const fingerprint = useMemo(() => result ? sourceFingerprint(source) : "", [source, result]);
  const current = !result || searchIsCurrent(result, subject.artifactId, fingerprint);
  // Same code under a newer label (for example, just saved) is still the code that was searched.
  const shownSubject = result && current ? subject : result?.identity ?? subject;

  function run(text: string) {
    setNotice("");
    setResult(text.trim() ? searchSource(source, text, subject, {scope, caseSensitive, skipManaged}) : null);
  }
  const debounced = useEffectEvent(run);
  useEffect(() => {
    const timer = setTimeout(() => debounced(query), query.trim() ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, scope, caseSensitive, skipManaged]);
  // Results for another project are never shown.
  useEffect(() => { queueMicrotask(() => { setQuery(""); setResult(null); setNotice(""); }); }, [subject.artifactId]);

  function openLine(path: string, line: number, column: number) {
    if (!result) return;
    const located = locateHit(source, path, line, column, result.query, result.caseSensitive);
    if (!located.ok) {
      setNotice(located.reason === "missing-file" ? `${path} is no longer in this code. Search again to update the results.` : `That match is no longer on line ${line} of ${path}. Search again to update the results.`);
      return;
    }
    setNotice(`Opened ${path} at line ${line}.`);
    onOpenLine(path, located.from, located.to, line);
  }
  function openFile(path: string) {
    if (!source.files.some(file => file.path === path)) { setNotice(`${path} is no longer in this code. Search again to update the results.`); return; }
    setNotice(`Opened ${path}.`);
    onOpenFile(path);
  }
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (!target.matches("[data-search-result]")) return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-search-result]") ?? [])];
    const index = items.indexOf(target as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); input.current?.focus(); return; }
    if (next === null) return;
    event.preventDefault();
    if (next < 0) input.current?.focus(); else items[Math.min(next, items.length - 1)]?.focus();
  }
  const searching = query.trim().length > 0;
  const nothing = result && !result.names.length && !result.files.length;

  return <div className="sse">
    <label className="source-editor-search"><Search size={14} aria-hidden="true" /><input ref={input} type="search" aria-label="Search files and code" placeholder="Search files and code…" value={query} maxLength={SOURCE_SEARCH_LIMITS.maxQuery}
      aria-describedby="sse-scope-note"
      onChange={event => setQuery(event.target.value)}
      onKeyDown={event => {
        if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); return; }
        if (event.key === "Enter") { event.preventDefault(); run(query); return; }
        if (event.key === "ArrowDown") { const first = list.current?.querySelector<HTMLButtonElement>("[data-search-result]"); if (first) { event.preventDefault(); first.focus(); } }
      }} />{query && <button type="button" className="sse-clear" aria-label="Clear search" onClick={() => { setQuery(""); input.current?.focus(); }}><X size={13} /></button>}</label>
    <div className="sse-options">
      <div className="sse-scopes" role="group" aria-label="Search in">{SCOPES.map(option => <button key={option.value} type="button" aria-pressed={scope === option.value} onClick={() => setScope(option.value)}>{option.label}</button>)}</div>
      <label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} /> Match case</label>
      <label><input type="checkbox" checked={skipManaged} onChange={event => setSkipManaged(event.target.checked)} /> Skip managed files</label>
    </div>
    <p id="sse-scope-note" className="sse-scope">{searchedLabel(shownSubject)}. Plain text, not patterns.</p>
    {!searching ? children : !result ? <p className="sse-summary" role="status">Searching…</p> : <div className="sse-results" ref={list} onKeyDown={move} data-stale={current ? undefined : "true"}>
      <p className="sse-summary" role="status">{[
        result.scope !== "content" ? plural(result.totals.names, "file name") : null,
        result.scope !== "names" && !result.contentTooShort ? `${result.countCapped ? `${result.totals.occurrences.toLocaleString("en")}+` : result.totals.occurrences.toLocaleString("en")} ${result.totals.occurrences === 1 && !result.countCapped ? "match" : "matches"} in ${result.countCapped ? `${result.totals.contentFiles.toLocaleString("en")}+ files` : plural(result.totals.contentFiles, "file")}` : null,
      ].filter(Boolean).join(" · ")}</p>
      {!current && <div className="sse-stale" role="status"><span>The code changed after this search, so these results may point to the wrong line.</span><button type="button" onClick={() => run(query)}><RefreshCw size={12} /> Search again</button></div>}
      {notice && <p className="sse-notice" role={notice.startsWith("Opened") ? "status" : "alert"}>{notice}</p>}
      {nothing && <p className="sse-empty">No {result.scope === "names" ? "file names match" : result.scope === "content" ? "code matches" : "file names or code match"} “{result.query}” in this version.{result.caseSensitive ? " Try turning off Match case." : result.scope !== "all" ? " Try searching All." : ""}</p>}
      {result.names.length > 0 && <section aria-label="File name matches">
        <h4>File names <span>{result.names.length}</span></h4>
        <ul>{result.names.map(item => <li key={item.id}><button type="button" data-search-result title={item.path} onClick={() => openFile(item.path)}>
          {item.managed ? <LockKeyhole size={13} aria-hidden="true" /> : <FileCode2 size={13} aria-hidden="true" />}
          <span className="sse-path"><strong>{item.basename}</strong>{(item.directory || item.duplicate) && <span>{item.directory || "project root"}</span>}</span>{item.managed && <em>Managed</em>}
        </button></li>)}</ul>
      </section>}
      {result.contentTooShort && <p className="sse-note">Type at least {SOURCE_SEARCH_LIMITS.minContentQuery} characters to search inside files.</p>}
      {result.files.length > 0 && <section aria-label="Code matches">
        <h4>In code <span>{plural(result.totals.contentFiles, "file")}</span></h4>
        <ul>{result.files.map(file => <li key={file.id} className="sse-file">
          <button type="button" data-search-result title={file.path} onClick={() => openFile(file.path)} aria-label={`${file.path}, ${plural(file.occurrences, "match", "matches")}`}>
            {file.managed ? <LockKeyhole size={13} aria-hidden="true" /> : <FileCode2 size={13} aria-hidden="true" />}
            <span className="sse-path"><strong>{file.basename}</strong>{file.directory && <span>{file.directory}</span>}</span>
            <em>{file.occurrences.toLocaleString("en")}</em>
          </button>
          <ul>{file.hits.map(hit => <li key={hit.id}><button type="button" data-search-result className="sse-hit" onClick={() => openLine(file.path, hit.line, hit.column)}
            aria-label={`${file.path} line ${hit.line}${hit.matches > 1 ? `, ${hit.matches} matches` : ""}: ${hit.parts.map(part => part.text).join("")}`}>
            <span className="sse-line" aria-hidden="true">{hit.line}</span>
            <code aria-hidden="true">{hit.clippedStart && "…"}{hit.parts.map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}{hit.clippedEnd && "…"}</code>
            {hit.matches > 1 && <em aria-hidden="true">×{hit.matches}</em>}
          </button></li>)}</ul>
          {file.capped && <p className="sse-note">{plural(file.lines - file.hits.length, "more matching line")} not listed. Open the file and use Find (Ctrl / ⌘ F).</p>}
        </li>)}</ul>
      </section>}
      {(result.countCapped || result.hitsCapped) && <p className="sse-note">{result.countCapped ? `Counting stopped at ${SOURCE_SEARCH_LIMITS.countCap.toLocaleString("en")} matches, so there are more than shown. ` : ""}{result.hitsCapped ? "Some matching lines are not listed; narrow the search to see them." : ""}</p>}
      {(result.skipped.managed.length > 0 || result.skipped.images > 0) && <p className="sse-note">Not searched: {[result.skipped.managed.length ? `managed files (${result.skipped.managed.join(", ")})` : "", result.skipped.images ? plural(result.skipped.images, "artwork image") : ""].filter(Boolean).join("; ")}.</p>}
    </div>}
  </div>;
}
