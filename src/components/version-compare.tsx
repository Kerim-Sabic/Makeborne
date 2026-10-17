"use client";
import { useMemo, useState } from "react";
import { ArrowRight, GitCompareArrows, X } from "lucide-react";
import type { ArtifactVersion } from "@/lib/domain";
import { compareContent, type UnitChange } from "@/lib/cloud/version-diff";
import "@/app/version-compare.css";

const STATUS: Record<UnitChange["status"], string> = { added: "Added", removed: "Removed", changed: "Changed" };
const PREVIEW_LINES = 300;

/** Side-by-side choice of two saved versions and what changed between them. */
export default function VersionCompare({ versions, from: initialFrom, to: initialTo, onClose }: {
  versions: ArtifactVersion[]; from: number; to: number; onClose: () => void;
}) {
  const ordered = useMemo(() => [...versions].sort((a, b) => b.number - a.number), [versions]);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const older = ordered.find(version => version.number === from), newer = ordered.find(version => version.number === to);
  const result = useMemo(() => older && newer ? compareContent(older.content, newer.content) : null, [older, newer]);
  const groups = useMemo(() => {
    const map = new Map<string, UnitChange[]>();
    for (const change of result?.changes ?? []) map.set(change.group, [...(map.get(change.group) ?? []), change]);
    return [...map];
  }, [result]);

  const choose = (label: string, value: number, set: (value: number) => void, id: string) => <label className="vc-pick" htmlFor={id}>
    <span>{label}</span>
    <select id={id} value={value} onChange={event => set(Number(event.target.value))}>
      {ordered.map(version => <option key={version.id} value={version.number}>Version {version.number}</option>)}
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
      <span><strong>Version {older.number}</strong> {older.changeSummary.slice(0, 140)}</span>
      <span><strong>Version {newer.number}</strong> {newer.changeSummary.slice(0, 140)}</span>
    </p>}
    {!result ? <p className="small-note">Choose two saved versions to compare.</p>
      : from === to ? <p className="small-note">Pick two different versions.</p>
      : !result.changes.length ? <p className="vc-empty">These versions have the same content.</p>
      : <>
        <p className="vc-summary" role="status">
          {result.changes.length} {result.changes.length === 1 ? "change" : "changes"} · <span className="vc-add">+{result.added}</span> <span className="vc-remove">−{result.removed}</span> lines
          {result.unchanged > 0 && <span className="vc-muted"> · {result.unchanged} unchanged</span>}
        </p>
        {groups.map(([group, changes]) => <section key={group} className="vc-group" aria-label={group}>
          <h4>{group}</h4>
          {changes.map(change => <Change key={`${from}:${to}:${change.key}`} change={change} />)}
        </section>)}
      </>}
  </section>;
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
