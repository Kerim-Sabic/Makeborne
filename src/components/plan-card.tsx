"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, CircleHelp, FileCode2, Hammer, LayoutTemplate, ListChecks, Palette, Plus, Sparkles, Type, X } from "lucide-react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import type { PlanEstimate, SitePlan } from "@/lib/builder/plan";
import "@/app/plan-card.css";

type SaveState = "saved" | "saving" | "local" | "error";

/** Click-to-edit text. Commits on blur or Enter; Escape cancels; empty reverts. */
function Editable({ value, onChange, label, multiline = true, className, disabled }: {
  value: string; onChange: (value: string) => void; label: string; multiline?: boolean; className?: string; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = field.current;
    if (!editing || !element) return;
    element.focus(); element.select();
    element.style.height = "auto"; element.style.height = `${element.scrollHeight}px`;
  }, [editing]);
  const commit = () => { setEditing(false); const next = draft.trim(); if (next && next !== value) onChange(next); else setDraft(value); };
  if (disabled) return <span className={className}>{value}</span>;
  if (!editing) return <span className={`pc-editable ${className ?? ""}`} role="button" tabIndex={0} aria-label={`Edit ${label}`} title="Click to edit"
    onClick={() => { setDraft(value); setEditing(true); }}
    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDraft(value); setEditing(true); } }}>{value}</span>;
  return <textarea ref={field} className={`pc-field ${className ?? ""}`} aria-label={label} value={draft} rows={1} maxLength={800}
    onChange={event => { setDraft(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${event.target.scrollHeight}px`; }}
    onBlur={commit}
    onKeyDown={event => {
      if (event.key === "Escape") { setDraft(value); setEditing(false); }
      if (event.key === "Enter" && (!multiline || !event.shiftKey)) { event.preventDefault(); commit(); }
    }} />;
}

const contrastText = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#1d1720" : "#ffffff";
};
const fontStack = (family: string, fallback: string) => `"${family.split(/[,(]/)[0].replace(/["']/g, "").trim()}", ${fallback}`;

/** The Plan mode card: a readable, editable website plan with a primary
 * "Build this plan" action and per-effort credit estimates. */
export default function PlanCard({ plan, estimate, recommended, revision, built, superseded, save, busy, onChange, onBuild, onRevise }: {
  plan: SitePlan; estimate: PlanEstimate; recommended: EffortLevel; revision: number;
  built?: boolean; superseded?: boolean; save: SaveState; busy?: boolean;
  onChange: (plan: SitePlan) => void; onBuild: (plan: SitePlan, effort: EffortLevel) => void; onRevise: () => void;
}) {
  const [effort, setEffort] = useState<EffortLevel>(recommended);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const id = useId();
  const locked = built || superseded || busy;
  const set = (change: Partial<SitePlan>) => onChange({ ...plan, ...change });
  const setPage = (index: number, change: Partial<SitePlan["pages"][number]>) => set({ pages: plan.pages.map((page, item) => item === index ? { ...page, ...change } : page) });
  const setDesign = (change: Partial<SitePlan["design"]>) => set({ design: { ...plan.design, ...change } });

  if (superseded) return <div className="pc pc-collapsed"><ListChecks size={14} /><span>Plan v{revision} · <strong>{plan.title}</strong> — revised below</span></div>;
  if (built) return <div className="pc pc-collapsed pc-built"><Check size={14} /><span>Built from plan v{revision} · <strong>{plan.title}</strong></span></div>;

  function build() {
    // Answered questions become decisions the builder must follow.
    const answered = plan.questions.flatMap((question, index) => answers[index]?.trim() ? [`${question} → ${answers[index].trim()}`] : []);
    const open = plan.questions.filter((_, index) => !answers[index]?.trim());
    const final = answered.length ? { ...plan, questions: open, assumptions: [...answered, ...plan.assumptions].slice(0, 12) } : plan;
    if (answered.length) onChange(final);
    onBuild(final, effort);
  }

  const sections = plan.pages.reduce((total, page) => total + page.sections.length, 0);
  return <article className="pc" aria-labelledby={`${id}-title`}>
    <header className="pc-head">
      <div className="pc-eyebrow"><ListChecks size={13} /><span>{plan.kind === "edit" ? "Change plan" : "Website plan"} · v{revision}</span>
        <span className="pc-save" data-state={save}>{save === "saving" ? "Saving…" : save === "saved" ? "Saved" : save === "local" ? "Kept in this tab" : "Not saved — check empty fields"}</span></div>
      <h4 id={`${id}-title`}><Editable label="site title" value={plan.title} multiline={false} disabled={locked} onChange={title => set({ title })} /></h4>
      <p className="pc-summary"><Editable label="summary" value={plan.summary} disabled={locked} onChange={summary => set({ summary })} /></p>
      <ul className="pc-stats" aria-label="Plan size"><li>{plan.pages.length} page{plan.pages.length === 1 ? "" : "s"}</li><li>{sections} sections</li>{plan.kind === "edit" && <li>{plan.changes.length} changes</li>}<li>{plan.design.palette.length} colors</li></ul>
    </header>

    <dl className="pc-strategy">
      <div><dt>Goal</dt><dd><Editable label="goal" value={plan.goal} disabled={locked} onChange={goal => set({ goal })} /></dd></div>
      <div><dt>Audience</dt><dd><Editable label="audience" value={plan.audience} disabled={locked} onChange={audience => set({ audience })} /></dd></div>
      <div><dt>Positioning</dt><dd><Editable label="positioning" value={plan.positioning} disabled={locked} onChange={positioning => set({ positioning })} /></dd></div>
    </dl>

    {plan.kind === "edit" && plan.changes.length > 0 && <section className="pc-block">
      <h5><FileCode2 size={13} />Changes</h5>
      <ol className="pc-changes">{plan.changes.map((change, index) => <li key={index}>
        <Editable label={`change ${index + 1}`} value={change.change} disabled={locked} onChange={value => set({ changes: plan.changes.map((item, at) => at === index ? { ...item, change: value } : item) })} />
        {!!change.files.length && <span className="pc-files">{change.files.map(file => <code key={file}>{file}</code>)}</span>}
        {!locked && plan.changes.length > 1 && <button type="button" className="pc-remove" aria-label={`Remove change ${index + 1}`} onClick={() => set({ changes: plan.changes.filter((_, at) => at !== index) })}><X size={11} /></button>}
      </li>)}</ol>
    </section>}

    <section className="pc-block">
      <h5><LayoutTemplate size={13} />Sitemap</h5>
      {plan.pages.map((page, pageIndex) => <details key={`${page.path}:${pageIndex}`} className="pc-page" open={pageIndex === 0}>
        <summary><span className="pc-page-name">{page.name}</span><code>{page.path}</code><small>{page.sections.length}</small></summary>
        <p className="pc-page-purpose"><Editable label={`${page.name} purpose`} value={page.purpose} disabled={locked} onChange={purpose => setPage(pageIndex, { purpose })} /></p>
        <ol className="pc-sections">{page.sections.map((section, index) => <li key={index}>
          <div className="pc-section-head"><strong><Editable label="section name" value={section.name} multiline={false} disabled={locked} onChange={name => setPage(pageIndex, { sections: page.sections.map((item, at) => at === index ? { ...item, name } : item) })} /></strong>
            {!locked && page.sections.length > 1 && <button type="button" className="pc-remove" aria-label={`Remove ${section.name}`} onClick={() => setPage(pageIndex, { sections: page.sections.filter((_, at) => at !== index) })}><X size={11} /></button>}</div>
          <p><Editable label={`${section.name} purpose`} value={section.purpose} disabled={locked} onChange={purpose => setPage(pageIndex, { sections: page.sections.map((item, at) => at === index ? { ...item, purpose } : item) })} /></p>
          <details className="pc-detail"><summary><span>{section.content}</span></summary>
            <p className="pc-content"><Editable label={`${section.name} content`} value={section.content} disabled={locked} onChange={content => setPage(pageIndex, { sections: page.sections.map((item, at) => at === index ? { ...item, content } : item) })} /></p></details>
        </li>)}</ol>
        {!locked && page.sections.length < 14 && <button type="button" className="pc-add" onClick={() => setPage(pageIndex, { sections: [...page.sections, { name: "New section", purpose: "Describe why this section exists.", content: "Describe what it shows." }] })}><Plus size={12} />Add section</button>}
      </details>)}
    </section>

    <section className="pc-block pc-design">
      <h5><Sparkles size={13} />Design direction</h5>
      <p className="pc-concept"><Editable label="design concept" value={plan.design.concept} disabled={locked} onChange={concept => setDesign({ concept })} /></p>
      <div className="pc-type">
        <span className="pc-type-sample" aria-hidden="true"><b style={{ fontFamily: fontStack(plan.design.typography.display, "ui-serif, Georgia, serif") }}>Aa</b><i style={{ fontFamily: fontStack(plan.design.typography.body, "ui-sans-serif, system-ui, sans-serif") }}>Aa</i></span>
        <div><h6><Type size={12} />Type pairing</h6>
          <p><Editable label="display typeface" value={plan.design.typography.display} multiline={false} disabled={locked} onChange={display => setDesign({ typography: { ...plan.design.typography, display } })} /> <span className="pc-dim">+</span> <Editable label="body typeface" value={plan.design.typography.body} multiline={false} disabled={locked} onChange={body => setDesign({ typography: { ...plan.design.typography, body } })} /></p>
          <p className="pc-dim"><Editable label="type rationale" value={plan.design.typography.rationale} disabled={locked} onChange={rationale => setDesign({ typography: { ...plan.design.typography, rationale } })} /></p></div>
      </div>
      <h6><Palette size={12} />Palette</h6>
      <ul className="pc-palette">{plan.design.palette.map((color, index) => <li key={index}>
        <label className="pc-swatch" style={{ background: color.hex, color: contrastText(color.hex) }} title={locked ? color.hex : "Change color"}>
          <span>{color.hex}</span>
          {!locked && <input type="color" aria-label={`${color.name} color`} value={color.hex.toLowerCase()} onChange={event => setDesign({ palette: plan.design.palette.map((item, at) => at === index ? { ...item, hex: event.target.value.toUpperCase() } : item) })} />}
        </label>
        <strong>{color.name}</strong><small>{color.role}</small>
      </li>)}</ul>
      <h6>Layout ideas</h6>
      <ul className="pc-list">{plan.design.layout.map((idea, index) => <li key={index}><Editable label={`layout idea ${index + 1}`} value={idea} disabled={locked} onChange={value => setDesign({ layout: plan.design.layout.map((item, at) => at === index ? value : item) })} /></li>)}</ul>
      <dl className="pc-strategy pc-compact">
        <div><dt>Imagery</dt><dd><Editable label="imagery" value={plan.design.imagery} disabled={locked} onChange={imagery => setDesign({ imagery })} /></dd></div>
        <div><dt>Signature</dt><dd><Editable label="signature interaction" value={plan.design.signatureInteraction} disabled={locked} onChange={signatureInteraction => setDesign({ signatureInteraction })} /></dd></div>
      </dl>
    </section>

    {plan.questions.length > 0 && <section className="pc-block pc-questions">
      <h5><CircleHelp size={13} />Before I build</h5>
      {plan.questions.map((question, index) => <label key={index}><span>{question}</span>
        <input value={answers[index] ?? ""} maxLength={300} disabled={locked} placeholder="Your answer (optional — I'll decide if blank)" onChange={event => setAnswers({ ...answers, [index]: event.target.value })} /></label>)}
    </section>}

    {plan.assumptions.length > 0 && <details className="pc-block pc-assumptions"><summary>{plan.assumptions.length} assumption{plan.assumptions.length === 1 ? "" : "s"}</summary>
      <ul className="pc-list">{plan.assumptions.map((item, index) => <li key={index}><Editable label={`assumption ${index + 1}`} value={item} disabled={locked} onChange={value => set({ assumptions: plan.assumptions.map((entry, at) => at === index ? value : entry) })} />
        {!locked && <button type="button" className="pc-remove" aria-label={`Remove assumption ${index + 1}`} onClick={() => set({ assumptions: plan.assumptions.filter((_, at) => at !== index) })}><X size={11} /></button>}</li>)}</ul>
    </details>}

    <footer className="pc-foot">
      <div className="pc-effort" role="radiogroup" aria-label="Build effort and estimated credits">
        {EFFORT_LEVELS.map(level => <button key={level} type="button" role="radio" aria-checked={effort === level} disabled={locked} onClick={() => setEffort(level)} title={EFFORT_PRESENTATION[level].purpose}>
          <span>{EFFORT_PRESENTATION[level].label}{level === recommended && <em>Best fit</em>}</span>
          <small>{estimate[level].min === estimate[level].max ? estimate[level].max : `${estimate[level].min}–${estimate[level].max}`} cr</small>
        </button>)}
      </div>
      <button type="button" className="pc-build" disabled={locked || save === "error"} onClick={build}>
        <Hammer size={14} />Build this plan<span>~{estimate[effort].min}–{estimate[effort].max} credits</span><ArrowRight size={14} />
      </button>
      <p className="pc-hint">Click any text to edit it, or <button type="button" className="pc-link" disabled={locked} onClick={onRevise}>reply in chat to revise</button>. No code is written until you build.</p>
    </footer>
  </article>;
}
