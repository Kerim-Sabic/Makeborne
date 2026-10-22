"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { designAnswerLabels, type DesignAnswers } from "@/lib/builder/brief-questions";
import { MAX_ENHANCED_BRIEF_CHARS, type BuildBrief } from "@/lib/builder/enhanced-brief";
import type { EnhancingState } from "./use-brief-improvement";
import "@/app/brief-questions.css";

export type { EnhancingState } from "./use-brief-improvement";
export { buildRefusedToo } from "@/lib/builder/enhance-action";

const credits = (value: number) => `${value} credit${value === 1 ? "" : "s"}`;

/** The brief before a first website build (M08: explicit intent). Nothing paid starts until the client chooses:
 * build from their own words, or improve the brief first (free) and review it. Every receipt line comes from the
 * server's durable action: "nothing was charged" only when its hold was confirmed returned. */
export default function EnhancedBriefCard({ state, design, maximum, busy, onImprove, onStart, onOriginal, onCancel, onStop, onCheck }: {
  state: EnhancingState; design: DesignAnswers; maximum: number; busy: boolean;
  /** The explicit opt-in: improve the brief first (free). */
  onImprove: () => void;
  /** Start with the improved brief (as returned, or as edited here). */
  onStart: (brief: BuildBrief) => void;
  /** Start from the client's own brief (and answers). After a completed improvement its receipt is kept; nothing is refunded or undone. */
  onOriginal: () => void;
  onCancel: () => void;
  /** Stop an improvement that is running. */
  onStop: () => void;
  /** Re-read an improvement whose outcome is not known yet. */
  onCheck: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state.status === "ready" ? state.text : "");
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (state.status !== "loading" && state.status !== "checking") heading.current?.focus(); }, [state.status]);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  const answers = designAnswerLabels(design);
  const limit = `Starting the build uses up to ${maximum} credits. You pay only for what is used.`;
  const own = `Build with my brief · up to ${maximum} credits`;
  const head = (title: string) => <header className="eb-head"><Sparkles size={14} aria-hidden="true" /><h4 id="eb-title" ref={heading} tabIndex={-1}>{title}</h4></header>;

  if (state.status === "offer") return <section className="eb" aria-labelledby="eb-title">
    {head("Your brief")}
    <p className="eb-summary">Your brief is short. Build from it now, or let Makeborne improve it first: it suggests the sections, tone and imagery from your words{answers.length ? " and answers" : ""}, and you review it before anything is built.</p>
    <p className="eb-note">Improving your brief is free and starts nothing paid. {limit}</p>
    <footer className="eb-actions">
      <button type="button" className="button primary small" disabled={busy} onClick={onOriginal}>{own}<ArrowRight size={14} /></button>
      <button type="button" className="bq-skip" disabled={busy} onClick={onImprove}>Improve my brief first · free</button>
      <button type="button" className="bq-skip bq-skip-all" disabled={busy} onClick={onCancel}>Cancel</button>
    </footer>
  </section>;

  if (state.status === "loading") return <div className="bq bq-loading" role="status">
    <Loader2 size={14} className="lb-spin" aria-hidden="true" />
    <span>Improving your brief… (free)</span>
    <button type="button" className="bq-skip" onClick={onStop}>Stop</button>
  </div>;

  if (state.status === "checking") return <section className="eb" aria-labelledby="eb-title" data-state="checking">
    {head("Your brief")}
    <p className="eb-summary" role="status"><Loader2 size={14} className="lb-spin" aria-hidden="true" /> {state.message}</p>
    <footer className="eb-actions">
      <button type="button" className="bq-skip" disabled={busy} onClick={onCheck}>Check again</button>
      <button type="button" className="bq-skip" disabled={busy} onClick={onOriginal}>{own}</button>
      <button type="button" className="bq-skip bq-skip-all" disabled={busy} onClick={onCancel}>Cancel</button>
    </footer>
  </section>;

  if (state.status === "failed") return <section className="eb" aria-labelledby="eb-title">
    {head("Your brief")}
    <p className="eb-summary" role="alert">{state.message}{state.blocking ? "" : state.charged === null ? " Its charge is still being confirmed; nothing more will be charged." : ""}</p>
    {!state.blocking && <p className="eb-note">{limit}</p>}
    <footer className="eb-actions">
      {!state.blocking && <button type="button" className="button primary small" disabled={busy} onClick={onOriginal}>Start building with my brief · up to {maximum} credits<ArrowRight size={14} /></button>}
      <button type="button" className="bq-skip" disabled={busy} onClick={onCancel}>Cancel</button>
    </footer>
  </section>;

  const { enhanced } = state;
  const edited = draft.trim() !== state.text.trim();
  return <section className="eb" aria-labelledby="eb-title">
    {head("Improved brief")}
    {editing ? <>
      <label className="bq-custom" htmlFor="eb-text"><span>Edit the improved brief. Keep the numbered section lines if you want each section checked before the build is saved.</span></label>
      <textarea id="eb-text" ref={field} className="eb-text" value={draft} maxLength={MAX_ENHANCED_BRIEF_CHARS} disabled={busy} onChange={event => setDraft(event.target.value)} />
    </> : <>
      <p className="eb-summary">{enhanced.business}{enhanced.workingName ? <> Working name: <strong>{enhanced.workingName}</strong> (a placeholder name until you give yours).</> : null} <strong>Main action:</strong> {enhanced.primaryAction.label}.</p>
      <dl className="eb-meta">
        <dt>Sections</dt><dd><ol className="eb-list">{enhanced.sections.map(section => <li key={section.anchor}>{section.name}</li>)}</ol></dd>
        {enhanced.factsMissing.length > 0 && <><dt>Shown as placeholders until you add them</dt><dd><ul className="eb-list">{enhanced.factsMissing.map(item => <li key={item.fact}>{item.fact}</li>)}</ul></dd></>}
        <dt>Feel and imagery</dt><dd>{enhanced.tone === "quiet" ? "Calm and restrained" : "Bold"} · {enhanced.imagery.plan === "type" ? "mostly type" : enhanced.imagery.plan}</dd>
        {(answers.length > 0 || enhanced.answersUsed.length > 0) && <><dt>Your answers used</dt><dd>{answers.length ? answers.join("; ") : enhanced.answersUsed.join("; ")}</dd></>}
      </dl>
      <details><summary>Read the full improved brief</summary><pre>{state.text}</pre></details>
    </>}
    <p className="eb-note">Your own words always come first: nothing you wrote is dropped or changed. Improving your brief charged {credits(state.charged)}. {limit}</p>
    <footer className="eb-actions">
      {editing
        ? <button type="button" className="button primary small" disabled={busy || !draft.trim()} onClick={() => onStart(edited ? { mode: "edited", text: draft.trim() } : { mode: "enhanced", text: state.text })}>Start with my edits<ArrowRight size={14} /></button>
        : <button type="button" className="button primary small" disabled={busy} onClick={() => onStart({ mode: "enhanced", text: state.text })}>Start building<ArrowRight size={14} /></button>}
      {editing
        ? <button type="button" className="bq-skip" disabled={busy} onClick={() => { setEditing(false); setDraft(state.text); }}>Discard edits</button>
        : <button type="button" className="bq-skip" disabled={busy} onClick={() => setEditing(true)}>Edit</button>}
      <button type="button" className="bq-skip" disabled={busy} onClick={onOriginal}>Build with my original instead · up to {maximum} credits</button>
      <button type="button" className="bq-skip bq-skip-all" disabled={busy} onClick={onCancel}>Cancel</button>
    </footer>
  </section>;
}
