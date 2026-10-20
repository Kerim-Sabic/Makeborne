"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Code2, Eye, GitCompareArrows, MapPin, X } from "lucide-react";
import type { ArtifactVersion } from "@/lib/domain";
import { compareContent, type UnitChange } from "@/lib/cloud/version-diff";
import { limitReadable, readableChanges, READABLE_LIMITS, type ChangeLocation, type ReadableEntry, type ReadableKind, type ReadableUnit } from "@/lib/cloud/version-readable";
import "@/app/version-compare.css";

const STATUS: Record<UnitChange["status"], string> = { added: "Added", removed: "Removed", changed: "Changed" };
const ENTRY: Record<ReadableEntry["kind"], string> = { added: "Added", removed: "Removed", changed: "Changed" };
const KIND: Record<ReadableKind, string> = { copy: "Wording", code: "Code", styles: "Styling", settings: "Settings", pages: "Pages", images: "Images", content: "Text" };
const PREVIEW_LINES = 300;
const VIEW_CONTEXT = 6, VIEW_MAX_LINES = 4000;

/** Side-by-side choice of two saved versions and what changed between them: a readable summary and the exact line diff. */
export default function VersionCompare({ versions, from: initialFrom, to: initialTo, onClose, labels, currentVersion, dirty = false, onOpenInCode, onPreview }: {
  versions: ArtifactVersion[]; from: number; to: number; onClose: () => void;
  /** Personal checkpoint names by version number, shown next to the version. */
  labels?: Record<number, string>;
  /** The latest saved version and whether there are unsaved edits on top of it. */
  currentVersion?: number; dirty?: boolean;
  /** Opens a file at a line in the Code editor (only offered for the current saved version). */
  onOpenInCode?: (path: string, line: number) => void;
  /** Opens the saved preview of a version (for slides, chapters, sections and pages). */
  onPreview?: (version: number) => void;
}) {
  const ordered = useMemo(() => [...versions].sort((a, b) => b.number - a.number), [versions]);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [mode, setMode] = useState<"readable" | "exact">("readable");
  const older = ordered.find(version => version.number === from), newer = ordered.find(version => version.number === to);
  const result = useMemo(() => older && newer ? compareContent(older.content, newer.content) : null, [older, newer]);
  const groups = useMemo(() => {
    const map = new Map<string, UnitChange[]>();
    for (const change of result?.changes ?? []) map.set(change.group, [...(map.get(change.group) ?? []), change]);
    return [...map];
  }, [result]);
  const name = (number: number) => labels?.[number] ? `Version ${number} · ${labels[number]}` : `Version ${number}`;

  const choose = (label: string, value: number, set: (value: number) => void, id: string) => <label className="vc-pick" htmlFor={id}>
    <span>{label}</span>
    <select id={id} value={value} onChange={event => set(Number(event.target.value))}>
      {ordered.map(version => <option key={version.id} value={version.number}>{name(version.number)}</option>)}
    </select>
  </label>;

  return <section className="vc" aria-label="Compare versions">
    <header className="vc-head">
      <h3><GitCompareArrows size={16} />Compare versions</h3>
      <button type="button" className="vc-close" onClick={onClose} aria-label="Close comparison"><X size={15} /></button>
    </header>
    <div className="vc-picks">
      {choose("From", from, setFrom, "vc-from")}
      <ArrowRight size={15} aria-hidden="true" />
      {choose("To", to, setTo, "vc-to")}
      <button type="button" className="button secondary small" onClick={() => { setFrom(to); setTo(from); }}>Swap</button>
    </div>
    {older && newer && <p className="vc-notes">
      <span><strong>{name(older.number)}</strong> {older.changeSummary.slice(0, 140)}</span>
      <span><strong>{name(newer.number)}</strong> {newer.changeSummary.slice(0, 140)}</span>
    </p>}
    {!result ? <p className="small-note">Choose two saved versions to compare.</p>
      : from === to ? <p className="small-note">Pick two different versions.</p>
      : !result.changes.length ? <p className="vc-empty">These versions have the same content.</p>
      : <>
        <p className="vc-summary" role="status">
          {result.changes.length} {result.changes.length === 1 ? "change" : "changes"} · <span className="vc-add">+{result.added}</span> <span className="vc-remove">−{result.removed}</span> lines
          {result.unchanged > 0 && <span className="vc-muted"> · {result.unchanged} unchanged</span>}
        </p>
        <div className="vc-modes" role="group" aria-label="Show changes as">
          <button type="button" aria-pressed={mode === "readable"} onClick={() => setMode("readable")}>Readable summary</button>
          <button type="button" aria-pressed={mode === "exact"} onClick={() => setMode("exact")}>Exact changes</button>
        </div>
        {mode === "readable" && older && newer ? <ReadableChanges key={`${from}:${to}`} older={older} newer={newer} comparison={result} currentVersion={currentVersion} dirty={dirty} onOpenInCode={onOpenInCode} onPreview={onPreview} name={name} />
          : groups.map(([group, changes]) => <section key={group} className="vc-group" aria-label={group}>
            <h4>{group}</h4>
            {changes.map(change => <Change key={`${from}:${to}:${change.key}`} change={change} />)}
          </section>)}
      </>}
  </section>;
}

type Viewing = { unit: string; side: ChangeLocation["side"]; line: number };

/** What changed, in words where possible. Bounded: the first changes are listed and the rest are counted. */
function ReadableChanges({ older, newer, comparison, currentVersion, dirty, onOpenInCode, onPreview, name }: {
  older: ArtifactVersion; newer: ArtifactVersion; comparison: ReturnType<typeof compareContent>;
  currentVersion?: number; dirty: boolean; onOpenInCode?: (path: string, line: number) => void; onPreview?: (version: number) => void; name: (number: number) => string;
}) {
  const readable = useMemo(() => readableChanges(older.content, newer.content, comparison), [older, newer, comparison]);
  const [limit, setLimit] = useState<number>(READABLE_LIMITS.page);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const shown = useMemo(() => limitReadable(readable, limit), [readable, limit]);
  const versionOf = (side: ChangeLocation["side"]) => side === "to" ? newer : older;
  const view = (unit: ReadableUnit, at: ChangeLocation) => setViewing(current => current && current.unit === unit.key && current.side === at.side && current.line === at.line ? null : { unit: unit.key, side: at.side, line: at.line });

  return <div className="vc-readable">
    <p className="vc-guide">A readable guide to what changed. Exact changes lists every changed line. Nothing here edits either version.</p>
    {shown.units.map(unit => {
      const place = unit.path ? unit.first : null;
      const previewVersion = unit.status === "removed" ? older : newer;
      return <section key={unit.key} className="vc-unit" aria-label={`${STATUS[unit.status]}: ${unit.label}`}>
        <header>
          <span className={`vc-status is-${unit.status}`}>{STATUS[unit.status]}</span>
          <span className="vc-unit-label" title={unit.label}>{unit.label}</span>
          <span className="vc-kind">{KIND[unit.kind]}</span>
          <span className="vc-counts"><span className="vc-add">+{unit.added}</span> <span className="vc-remove">−{unit.removed}</span></span>
        </header>
        {unit.entries.length > 0 && <ul className="vc-entries">{unit.entries.map(entry => <li key={entry.id} className={`vc-entry is-${entry.kind}`}>
          <span className="vc-entry-kind">{ENTRY[entry.kind]}</span>
          <EntryText entry={entry} />
          {entry.at && unit.path && <button type="button" className="vc-link" aria-expanded={viewing?.unit === unit.key && viewing.side === entry.at.side && viewing.line === entry.at.line}
            aria-label={`Show line ${entry.at.line} of ${unit.path} in ${name(versionOf(entry.at.side).number)}`} onClick={() => view(unit, entry.at!)}><MapPin size={12} aria-hidden="true" />Line {entry.at.line}</button>}
        </li>)}</ul>}
        {unit.summaryOnly && <p className="vc-only">{unit.summaryOnly === "too-large" ? "Too large to summarise in words. Exact changes shows it line by line where possible."
          : `${KIND[unit.summaryOnly]} changed: ${unit.added} ${unit.added === 1 ? "line" : "lines"} added, ${unit.removed} removed${unit.kind === "copy" ? "; no wording change found" : ""}.`}</p>}
        <div className="vc-unit-actions">
          {place && unit.path && <button type="button" className="vc-link" aria-expanded={viewing?.unit === unit.key && viewing.side === place.side && viewing.line === place.line} onClick={() => view(unit, place)}>
            <Code2 size={12} aria-hidden="true" />Show in {name(versionOf(place.side).number)}</button>}
          {!unit.path && onPreview && <button type="button" className="vc-link" onClick={() => onPreview(previewVersion.number)}><Eye size={12} aria-hidden="true" />Preview {name(previewVersion.number)}</button>}
        </div>
        {viewing?.unit === unit.key && unit.path && <VersionSourceView version={versionOf(viewing.side)} path={unit.path} line={viewing.line} label={name(versionOf(viewing.side).number)}
          current={versionOf(viewing.side).number === currentVersion} dirty={dirty} onOpenInCode={onOpenInCode} onClose={() => setViewing(null)} />}
      </section>;
    })}
    {shown.hidden > 0 && <div className="vc-more-row">
      <p role="status">{shown.hidden} more {shown.hidden === 1 ? "change" : "changes"} not shown.</p>
      <button type="button" className="vc-more" onClick={() => setLimit(value => value + READABLE_LIMITS.page)}>Show {Math.min(READABLE_LIMITS.page, shown.hidden)} more</button>
    </div>}
  </div>;
}

function EntryText({ entry }: { entry: ReadableEntry }) {
  const spoken = entry.kind === "changed" ? `Changed from “${entry.before}” to “${entry.after}”` : entry.kind === "added" ? `Added “${entry.after}”` : `Removed “${entry.before}”`;
  if (entry.kind === "changed" && entry.words && !entry.clipped) return <p className="vc-words" aria-label={spoken}>
    {entry.words.map((part, index) => part.type === "add" ? <ins key={index}>{part.text}</ins> : part.type === "remove" ? <del key={index}>{part.text}</del> : <span key={index}>{part.text}</span>)}
  </p>;
  if (entry.kind === "changed") return <p className="vc-words is-pair" aria-label={spoken}><del>{entry.before}</del><ArrowRight size={12} aria-hidden="true" /><ins>{entry.after}</ins></p>;
  return <p className="vc-words" aria-label={spoken}>{entry.kind === "added" ? <ins>{entry.after}</ins> : <del>{entry.before}</del>}</p>;
}

/** Read-only view of one file in one saved version, opened at a line. It never changes the saved version. */
function VersionSourceView({ version, path, line, label, current, dirty, onOpenInCode, onClose }: {
  version: ArtifactVersion; path: string; line: number; label: string; current: boolean; dirty: boolean;
  onOpenInCode?: (path: string, line: number) => void; onClose: () => void;
}) {
  const [whole, setWhole] = useState(false);
  const target = useRef<HTMLDivElement>(null);
  const file = version.content.websiteSource?.files.find(item => item.path === path);
  const lines = useMemo(() => file ? file.content.split(/\r?\n/) : [], [file]);
  const at = Math.min(Math.max(1, line), Math.max(1, lines.length));
  const start = whole ? 1 : Math.max(1, at - VIEW_CONTEXT), end = whole ? Math.min(lines.length, VIEW_MAX_LINES) : Math.min(lines.length, at + VIEW_CONTEXT);
  useEffect(() => { target.current?.scrollIntoView({ block: "nearest" }); }, [whole, at]);
  return <div className="vc-view" role="region" aria-label={`${path} in ${label}, line ${at}`}>
    <div className="vc-view-head">
      <span className="vc-view-path"><code>{path}</code><span>{label} · line {at}</span></span>
      <button type="button" className="vc-close" aria-label="Close file view" onClick={onClose}><X size={14} /></button>
    </div>
    {!file ? <p className="small-note vc-pad">{path} is not in {label}.</p> : <>
      <div className="vc-view-code">{lines.slice(start - 1, end).map((text, index) => {
        const number = start + index;
        return <div key={number} ref={number === at ? target : undefined} className={`vc-view-line${number === at ? " is-target" : ""}`} aria-current={number === at ? "location" : undefined}>
          <span className="vc-num" aria-hidden="true">{number}</span><code>{text || " "}</code>
        </div>;
      })}</div>
      <div className="vc-view-actions">
        {lines.length > end - start + 1 && <button type="button" className="vc-more" onClick={() => setWhole(!whole)}>{whole ? "Show lines around the change" : `Show whole file (${lines.length} lines)`}</button>}
        {whole && lines.length > VIEW_MAX_LINES && <span className="small-note">Showing the first {VIEW_MAX_LINES} lines.</span>}
        {onOpenInCode && current && !dirty && <button type="button" className="vc-more" onClick={() => onOpenInCode(path, at)}><Code2 size={12} aria-hidden="true" /> Open in Code at line {at}</button>}
        {onOpenInCode && current && dirty && <span className="small-note">Save your edits to open this line in Code; unsaved edits may have moved it.</span>}
        {!current && <span className="small-note">Saved snapshot. Code shows the current version.</span>}
      </div>
    </>}
  </div>;
}

function Change({ change }: { change: UnitChange }) {
  const [all, setAll] = useState(false);
  const total = change.hunks?.reduce((count, hunk) => count + hunk.lines.length, 0) ?? 0;
  // Long diffs show their first lines until the reader asks for the rest.
  const visible = useMemo(() => (change.hunks ?? []).reduce<{ shown: number; hunks: NonNullable<UnitChange["hunks"]> }>((state, hunk) => {
    const room = all ? hunk.lines.length : Math.max(0, PREVIEW_LINES - state.shown);
    return room ? { shown: state.shown + Math.min(room, hunk.lines.length), hunks: [...state.hunks, { ...hunk, lines: hunk.lines.slice(0, room) }] } : state;
  }, { shown: 0, hunks: [] }).hunks, [change.hunks, all]);
  return <details className="vc-change" open={change.added + change.removed <= 40}>
    <summary>
      <span className={`vc-status is-${change.status}`}>{STATUS[change.status]}</span>
      <span className="vc-label">{change.label}</span>
      <span className="vc-counts"><span className="vc-add">+{change.added}</span> <span className="vc-remove">−{change.removed}</span></span>
    </summary>
    {change.hunks === null ? <p className="small-note vc-pad">This item is too large to compare line by line.</p> : <div className="vc-diff" role="table" aria-label={`Changes in ${change.label}`}>
      {visible.map((hunk, index) => {
        return <div key={index} className="vc-hunk" role="rowgroup">
          <div className="vc-hunk-head" role="row"><span role="cell">Lines {hunk.oldStart} → {hunk.newStart}</span></div>
          {hunk.lines.map((line, at) => <div key={at} className={`vc-line is-${line.type}`} role="row">
            <span className="vc-num" role="cell">{line.old ?? ""}</span>
            <span className="vc-num" role="cell">{line.new ?? ""}</span>
            <span className="vc-sign" role="cell" aria-label={line.type === "add" ? "added" : line.type === "remove" ? "removed" : "unchanged"}>{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}</span>
            <code role="cell">{line.text || " "}</code>
          </div>)}
        </div>;
      })}
      {!all && total > PREVIEW_LINES && <button type="button" className="vc-more" onClick={() => setAll(true)}>Show all {total} lines</button>}
    </div>}
  </details>;
}
