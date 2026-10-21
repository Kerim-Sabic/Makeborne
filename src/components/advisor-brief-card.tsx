"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, FileText, PencilLine, X } from "lucide-react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, DEFAULT_EFFORT, type EffortLevel } from "@/lib/routing/effort";
import {
  AdvisorBriefFieldsSchema, BRIEF_FORMATS, BRIEF_LIMITS, FORMAT_LABEL, handoffMaximum, modesFor,
  type AdvisorBriefFields, type BriefFormat, type BriefMode, type HandoffTarget, type StoredAdvisorBrief,
} from "@/lib/experts/advisor-brief";

export type HandoffProject = { workspaceId: string; artifactId: string; title: string; kind: BriefFormat };
export type HandoffChoice = { target: HandoffTarget; format: BriefFormat; mode: BriefMode; effort: EffortLevel; maximum: number };
type Projects = { state: "loading" | "ready" | "error"; items: HandoffProject[]; message?: string };

const lines = (value: string, count: number) => value.split("\n").map(line => line.trim()).filter(Boolean).slice(0, count);

/** The brief drafted from the conversation: read-only until Edit, and only placed in a composer by Use this brief. */
export default function AdvisorBriefCard({ brief, advisorName, busy, projects, onLoadProjects, onSave, onUse }: {
  brief: StoredAdvisorBrief; advisorName: string; busy: boolean; projects: Projects | null;
  onLoadProjects: () => void;
  onSave: (fields: AdvisorBriefFields) => void;
  /** Places the brief in the chosen composer; false when it could not (the button can be pressed again). */
  onUse: (choice: HandoffChoice) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const fields = brief.fields;
  const heading = useId();
  const useButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // Closing the handoff (Cancel) returns focus to Use this brief; nothing was opened or sent.
  useEffect(() => { if (!handoff && returnFocus.current) { returnFocus.current = false; useButton.current?.focus(); } }, [handoff]);
  return <section className="advisor-brief" aria-labelledby={heading}>
    <header className="advisor-brief-head">
      <FileText size={15} aria-hidden="true" />
      <h2 id={heading}>Project brief · revision {brief.revision}</h2>
      <span>{brief.charged === 0 ? "Drafted · no credits used" : `Drafted · ${brief.charged} credit${brief.charged === 1 ? "" : "s"}`}{brief.editedAt ? " · edited" : ""}</span>
    </header>
    <p className="advisor-brief-note">Drafted from your conversation with {advisorName}. Advice only: nothing has been built, sent or changed. Review it before you use it.</p>
    {editing ? <BriefEditor initial={fields} onCancel={() => setEditing(false)} onSave={next => { onSave(next); setEditing(false); }} />
      : <>
        <dl className="advisor-brief-fields">
          <div><dt>Title</dt><dd>{fields.title || "Untitled"}</dd></div>
          <div><dt>Format</dt><dd>{FORMAT_LABEL[fields.format]}{fields.mode === "plan" ? " · plan first suggested" : ""}</dd></div>
          <div><dt>Goal</dt><dd>{fields.goal}</dd></div>
          {fields.audience && <div><dt>Audience</dt><dd>{fields.audience}</dd></div>}
          {!!fields.sections.length && <div><dt>{fields.format === "website" ? "Pages & sections" : fields.format === "book" ? "Chapters" : "Slides"}</dt><dd><ul>{fields.sections.map(item => <li key={item}>{item}</li>)}</ul></dd></div>}
          {fields.tone && <div><dt>Tone</dt><dd>{fields.tone}</dd></div>}
          {!!fields.constraints.length && <div><dt>Constraints</dt><dd><ul>{fields.constraints.map(item => <li key={item}>{item}</li>)}</ul></dd></div>}
          <div><dt>Sources named</dt><dd>{fields.sources.length ? <ul>{fields.sources.map(item => <li key={item}>{item}</li>)}</ul> : "None"}<small>Names only. Nothing is fetched or attached; attach files in the builder if they should be read.</small></dd></div>
          {!!fields.openQuestions.length && <div><dt>Still open</dt><dd><ul>{fields.openQuestions.map(item => <li key={item}>{item}</li>)}</ul></dd></div>}
        </dl>
        {!handoff && <div className="advisor-brief-actions">
          <button type="button" className="advisor-brief-secondary" disabled={busy} onClick={() => setEditing(true)}><PencilLine size={14} />Edit brief</button>
          <button type="button" ref={useButton} className="advisor-brief-primary" disabled={busy} onClick={() => { setHandoff(true); onLoadProjects(); }}>Use this brief<ArrowUpRight size={14} /></button>
        </div>}
        {handoff && <HandoffPanel brief={brief} projects={projects} busy={busy} onCancel={() => { returnFocus.current = true; setHandoff(false); }} onUse={onUse} />}
      </>}
  </section>;
}

function BriefEditor({ initial, onCancel, onSave }: { initial: AdvisorBriefFields; onCancel: () => void; onSave: (fields: AdvisorBriefFields) => void }) {
  const [title, setTitle] = useState(initial.title);
  const [format, setFormat] = useState<BriefFormat>(initial.format);
  const [goal, setGoal] = useState(initial.goal);
  const [audience, setAudience] = useState(initial.audience);
  const [sections, setSections] = useState(initial.sections.join("\n"));
  const [tone, setTone] = useState(initial.tone);
  const [constraints, setConstraints] = useState(initial.constraints.join("\n"));
  const [sources, setSources] = useState<string[]>(initial.sources);
  const [newSource, setNewSource] = useState("");
  const [openQuestions, setOpenQuestions] = useState(initial.openQuestions.join("\n"));
  const [error, setError] = useState("");
  const save = () => {
    const parsed = AdvisorBriefFieldsSchema.safeParse({ title, format, goal, audience, tone, mode: initial.mode,
      sections: lines(sections, BRIEF_LIMITS.sections), constraints: lines(constraints, BRIEF_LIMITS.constraints), sources, openQuestions: lines(openQuestions, BRIEF_LIMITS.openQuestions) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the brief."); return; }
    onSave(parsed.data);
  };
  return <form className="advisor-brief-form" onSubmit={event => { event.preventDefault(); save(); }}>
    <label>Title<input value={title} maxLength={BRIEF_LIMITS.title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Format<select value={format} onChange={event => setFormat(event.target.value as BriefFormat)}>{BRIEF_FORMATS.map(item => <option key={item} value={item}>{FORMAT_LABEL[item]}</option>)}</select></label>
    <label>Goal<textarea rows={2} value={goal} maxLength={BRIEF_LIMITS.goal} onChange={event => setGoal(event.target.value)} /></label>
    <label>Audience<textarea rows={2} value={audience} maxLength={BRIEF_LIMITS.audience} onChange={event => setAudience(event.target.value)} /></label>
    <label>{format === "website" ? "Pages & sections" : format === "book" ? "Chapters" : "Slides"} <small>one per line</small><textarea rows={4} value={sections} onChange={event => setSections(event.target.value)} /></label>
    <label>Tone<input value={tone} maxLength={BRIEF_LIMITS.tone} onChange={event => setTone(event.target.value)} /></label>
    <label>Constraints <small>one per line</small><textarea rows={3} value={constraints} onChange={event => setConstraints(event.target.value)} /></label>
    <fieldset className="advisor-brief-sources"><legend>Sources named</legend>
      {sources.length ? <ul>{sources.map(item => <li key={item}><span>{item}</span><button type="button" aria-label={`Remove source ${item}`} onClick={() => setSources(current => current.filter(entry => entry !== item))}><X size={12} /></button></li>)}</ul> : <p>None</p>}
      <span className="advisor-brief-add"><input aria-label="Add a source name" value={newSource} maxLength={BRIEF_LIMITS.item} placeholder="e.g. 2026 price list (PDF)" onChange={event => setNewSource(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addSource(); } }} />
        <button type="button" disabled={!newSource.trim() || sources.length >= BRIEF_LIMITS.sources} onClick={addSource}>Add</button></span>
    </fieldset>
    <label>Still open <small>one per line</small><textarea rows={2} value={openQuestions} onChange={event => setOpenQuestions(event.target.value)} /></label>
    {error && <p className="advisor-brief-error" role="alert">{error}</p>}
    <div className="advisor-brief-actions">
      <button type="button" className="advisor-brief-secondary" onClick={onCancel}>Cancel edits</button>
      <button type="submit" className="advisor-brief-primary">Save brief</button>
    </div>
  </form>;
  function addSource() {
    const value = newSource.replace(/\s+/g, " ").trim().slice(0, BRIEF_LIMITS.item);
    if (!value || sources.length >= BRIEF_LIMITS.sources) return;
    setSources(current => current.some(entry => entry.toLowerCase() === value.toLowerCase()) ? current : [...current, value]);
    setNewSource("");
  }
}

/** Reviewable handoff: target, format, Build vs Plan, effort and the maximum, before anything opens. */
function HandoffPanel({ brief, projects, busy, onCancel, onUse }: { brief: StoredAdvisorBrief; projects: Projects | null; busy: boolean; onCancel: () => void; onUse: (choice: HandoffChoice) => boolean }) {
  const [targetKey, setTargetKey] = useState("new");
  const [newFormat, setNewFormat] = useState<BriefFormat>(brief.fields.format);
  const [chosenMode, setChosenMode] = useState<BriefMode>(brief.fields.mode);
  const [effort, setEffort] = useState<EffortLevel>(DEFAULT_EFFORT);
  const using = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.querySelector<HTMLElement>("select")?.focus(); }, []);
  const project = targetKey === "new" ? null : projects?.items.find(item => `${item.workspaceId}:${item.artifactId}` === targetKey) ?? null;
  const format = project?.kind ?? newFormat;
  const mode: BriefMode = modesFor(format).includes(chosenMode) ? chosenMode : "create";
  const maximum = handoffMaximum(format, mode, effort);
  const stale = targetKey !== "new" && !project;
  const use = () => {
    // One handoff per press: a repeated click while the composer opens does nothing.
    if (using.current || busy || stale) return;
    using.current = true;
    if (!onUse({ target: project ? { type: "project", workspaceId: project.workspaceId, artifactId: project.artifactId, title: project.title } : { type: "new" }, format, mode, effort, maximum })) using.current = false;
  };
  return <div className="advisor-handoff" role="group" aria-label="Use this brief" ref={panel}>
    <label>Where<select value={targetKey} onChange={event => setTargetKey(event.target.value)} disabled={busy}>
      <option value="new">A new project</option>
      {projects?.items.map(item => <option key={`${item.workspaceId}:${item.artifactId}`} value={`${item.workspaceId}:${item.artifactId}`}>{item.title} · {FORMAT_LABEL[item.kind]}</option>)}
    </select></label>
    {projects?.state === "loading" && <p className="advisor-handoff-note" role="status">Loading your saved projects…</p>}
    {projects?.state === "error" && <p className="advisor-handoff-note" role="status">{projects.message ?? "Your saved projects could not be listed. You can still start a new project."}</p>}
    {project ? <p className="advisor-handoff-fixed">Format: {FORMAT_LABEL[project.kind]} (this project’s format)</p>
      : <label>Format<select value={newFormat} disabled={busy} onChange={event => setNewFormat(event.target.value as BriefFormat)}>{BRIEF_FORMATS.map(item => <option key={item} value={item}>{FORMAT_LABEL[item]}</option>)}</select></label>}
    <div className="advisor-handoff-mode" role="radiogroup" aria-label="Mode">
      {(["create", "plan"] as const).map(item => <button key={item} type="button" role="radio" aria-checked={mode === item} disabled={busy || !modesFor(format).includes(item)}
        onClick={() => setChosenMode(item)}>{item === "create" ? "Build" : "Plan first"}</button>)}
    </div>
    {format !== "website" && <p className="advisor-handoff-note">Plan first is available for websites.</p>}
    <label>Effort<select value={effort} disabled={busy} onChange={event => setEffort(event.target.value as EffortLevel)}>{EFFORT_LEVELS.map(level => <option key={level} value={level}>{EFFORT_PRESENTATION[level].label}</option>)}</select></label>
    <p className="advisor-handoff-summary" aria-live="polite"><strong>Up to {maximum} credits</strong> {mode === "plan" ? "for the plan" : "for the first request, including automatic refinements"}, charged only when you press {mode === "plan" ? "Plan" : "Send"} in the {project ? `“${project.title}”` : "new project’s"} composer. Opening the composer sends nothing.</p>
    <div className="advisor-brief-actions">
      <button type="button" className="advisor-brief-secondary" onClick={onCancel}>Cancel</button>
      <button type="button" className="advisor-brief-primary" disabled={busy || stale} onClick={use}>Open in composer<ArrowUpRight size={14} /></button>
    </div>
  </div>;
}
