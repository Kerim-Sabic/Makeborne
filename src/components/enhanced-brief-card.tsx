"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { designAnswerLabels, type DesignAnswers } from "@/lib/builder/brief-questions";
import { MAX_ENHANCED_BRIEF_CHARS, type BuildBrief, type EnhancedBrief } from "@/lib/builder/enhanced-brief";
import "@/app/brief-questions.css";

export type EnhancingState =
  | { status: "loading" }
  | { status: "ready"; enhanced: EnhancedBrief; text: string; charged: number }
  | { status: "failed" };

/** The enhanced brief before a first website build (M08: explicit intent). The client sees what
 * will be built, can edit it, or builds from their own words; nothing starts until they choose. */
export default function EnhancedBriefCard({ state, design, maximum, busy, onStart, onOriginal, onCancel }: {
  state: EnhancingState; design: DesignAnswers; maximum: number; busy: boolean;
  /** Start with the enhanced brief (as returned, or as edited here). */
  onStart: (brief: BuildBrief) => void;
  /** Start from the client's own brief (and answers) without the enhancement. */
  onOriginal: () => void;
  onCancel: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state.status === "ready" ? state.text : "");
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (state.status !== "loading") heading.current?.focus(); }, [state.status]);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  const answers = designAnswerLabels(design);
  const limit = `Starting the build uses up to ${maximum} credits. You pay only for what is used.`;

  if (state.status === "loading") return <div className="bq bq-loading" role="status">
    <Loader2 size={14} className="lb-spin" aria-hidden="true" />
    <span>Turning your brief into a full design brief… (free)</span>
    <button type="button" className="bq-skip" onClick={onOriginal}>Use my original</button>
  </div>;

  if (state.status === "failed") return <section className="eb" aria-labelledby="eb-title">
    <header className="eb-head"><Sparkles size={14} aria-hidden="true" /><h4 id="eb-title" ref={heading} tabIndex={-1}>Your brief</h4></header>
    <p className="eb-summary">Your brief couldn&rsquo;t be enhanced just now. Nothing was charged for it. The build can use your own words{answers.length ? " and your answers" : ""}.</p>
    <p className="eb-note">{limit}</p>
    <footer className="eb-actions">
      <button type="button" className="button primary small" disabled={busy} onClick={onOriginal}>Start building with my brief<ArrowRight size={14} /></button>
      <button type="button" className="bq-skip" disabled={busy} onClick={onCancel}>Cancel</button>
    </footer>
  </section>;

  const { enhanced } = state;
  const edited = draft.trim() !== state.text.trim();
  return <section className="eb" aria-labelledby="eb-title">
    <header className="eb-head"><Sparkles size={14} aria-hidden="true" /><h4 id="eb-title" ref={heading} tabIndex={-1}>Enhanced brief</h4></header>
    {editing ? <>
      <label className="bq-custom" htmlFor="eb-text"><span>Edit the enhanced brief. Keep the numbered section lines if you want each section checked before the build is saved.</span></label>
      <textarea id="eb-text" ref={field} className="eb-text" value={draft} maxLength={MAX_ENHANCED_BRIEF_CHARS} disabled={busy} onChange={event => setDraft(event.target.value)} />
    </> : <>
      <p className="eb-summary">{enhanced.business}{enhanced.workingName ? <> Working name: <strong>{enhanced.workingName}</strong> (an example until you give yours).</> : null} <strong>Main action:</strong> {enhanced.primaryAction.label}.</p>
      <dl className="eb-meta">
        <dt>Sections</dt><dd><ol className="eb-list">{enhanced.sections.map(section => <li key={section.anchor}>{section.name}</li>)}</ol></dd>
        {enhanced.factsMissing.length > 0 && <><dt>Shown as labelled examples until you add them</dt><dd><ul className="eb-list">{enhanced.factsMissing.map(item => <li key={item.fact}>{item.fact}</li>)}</ul></dd></>}
        <dt>Feel and imagery</dt><dd>{enhanced.tone === "quiet" ? "Calm and restrained" : "Bold"} · {enhanced.imagery.plan === "type" ? "mostly type" : enhanced.imagery.plan}</dd>
        {(answers.length > 0 || enhanced.answersUsed.length > 0) && <><dt>Your answers used</dt><dd>{answers.length ? answers.join("; ") : enhanced.answersUsed.join("; ")}</dd></>}
      </dl>
      <details><summary>Read the full enhanced brief</summary><pre>{state.text}</pre></details>
    </>}
    <p className="eb-note">Your own words always come first: nothing you wrote is dropped or changed. Enhancing your brief is free. {limit}</p>
    <footer className="eb-actions">
      {editing
        ? <button type="button" className="button primary small" disabled={busy || !draft.trim()} onClick={() => onStart(edited ? { mode: "edited", text: draft.trim() } : { mode: "enhanced", text: state.text })}>Start with my edits<ArrowRight size={14} /></button>
        : <button type="button" className="button primary small" disabled={busy} onClick={() => onStart({ mode: "enhanced", text: state.text })}>Start building<ArrowRight size={14} /></button>}
      {editing
        ? <button type="button" className="bq-skip" disabled={busy} onClick={() => { setEditing(false); setDraft(state.text); }}>Discard edits</button>
        : <button type="button" className="bq-skip" disabled={busy} onClick={() => setEditing(true)}>Edit</button>}
      <button type="button" className="bq-skip" disabled={busy} onClick={onOriginal}>Use my original</button>
      <button type="button" className="bq-skip bq-skip-all" disabled={busy} onClick={onCancel}>Cancel</button>
    </footer>
  </section>;
}
