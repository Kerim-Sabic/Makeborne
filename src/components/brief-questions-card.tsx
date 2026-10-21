"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import type { BriefAnswers, BriefQuestion } from "@/lib/builder/brief-questions";
import "@/app/brief-questions.css";

/** Quick questions before the first build, one at a time so they fit the
 * builder chat. Every question is optional: "Skip this question" leaves the
 * call to the builder, and "Skip all" starts right away. */
export default function BriefQuestionsCard({ questions, kind, planning, busy, limit, onStart, onSkip }: {
  questions: readonly BriefQuestion[]; kind: "website" | "presentation" | "book"; planning: boolean; busy: boolean;
  /** What starting will send and the most it can charge, shown before Start and Skip all. */
  limit?: string;
  onStart: (answers: BriefAnswers) => void; onSkip: () => void;
}) {
  const [answers, setAnswers] = useState<BriefAnswers>({});
  const [step, setStep] = useState(0);
  const advance = useRef<number | undefined>(undefined);
  // The last pointer press on an option (mouse, touch or pen). Keyboard and screen-reader
  // activation never auto-advance: they move on only with Next.
  const pointer = useRef<{ value: string; at: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => window.clearTimeout(advance.current), []);
  useEffect(() => { if (step > 0) heading.current?.focus(); }, [step]);

  const question = questions[step], last = step === questions.length - 1;
  const answer = answers[question.id] ?? {};
  const chosen = question.options.find(option => option.value === answer.option);
  const thing = kind === "presentation" ? "presentation" : kind;
  const next = () => { window.clearTimeout(advance.current); if (last) onStart(answers); else setStep(step + 1); };
  const pick = (value: string, viaPointer: boolean) => {
    const option = answer.option === value ? undefined : value;
    setAnswers(current => ({ ...current, [question.id]: { option, custom: "" } }));
    window.clearTimeout(advance.current);
    const label = question.options.find(item => item.value === option)?.label;
    // A pointer choice moves on after briefly showing it, and says so; keyboard, screen-reader
    // and reduced-motion users stay on the question and press Next themselves.
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (option && !last && viaPointer && !reduced) {
      const target = step + 1;
      advance.current = window.setTimeout(() => {
        setStep(current => Math.min(current + 1, questions.length - 1));
        setAnnouncement(`Chose ${label}. Moved to question ${target + 1} of ${questions.length}.`);
      }, 280);
    } else setAnnouncement(option ? `Chose ${label}. Press Next when you are ready.` : "Choice cleared.");
  };
  // Skipping clears this answer. On the last question the start callback must
  // receive the cleared answers themselves: a scheduled state update is not yet
  // visible to `next`, which would otherwise send the discarded answer.
  const skipThis = () => {
    const cleared: BriefAnswers = { ...answers, [question.id]: {} };
    window.clearTimeout(advance.current);
    setAnswers(cleared);
    if (last) onStart(cleared); else setStep(step + 1);
  };

  return <section className="bq" aria-label="Questions before we start">
    <header className="bq-head">
      <Sparkles size={14} aria-hidden="true" />
      <span className="bq-kicker">Before I start · {step + 1} of {questions.length}</span>
      <span className="bq-dots" aria-hidden="true">{questions.map((item, index) => <i key={item.id} data-state={index < step ? "done" : index === step ? "now" : undefined} />)}</span>
    </header>
    <div className="bq-body" key={question.id}>
      <h4 ref={heading} tabIndex={-1} id={`bq-title-${question.id}`}>{question.question}</h4>
      <p className="bq-why">{question.why}</p>
      {question.options.length > 0 && <div className="bq-chips" role="group" aria-labelledby={`bq-title-${question.id}`}>
        {question.options.map(option => {
          const on = answer.option === option.value;
          return <button key={option.value} type="button" className="bq-chip" aria-pressed={on} disabled={busy} title={option.hint}
            onPointerDown={event => { pointer.current = event.pointerType ? { value: option.value, at: Date.now() } : null; }}
            onClick={event => { const press = pointer.current; pointer.current = null; pick(option.value, event.detail > 0 && press?.value === option.value && Date.now() - press.at < 1500); }}>
            {option.swatch && <span className="bq-swatch" aria-hidden="true">{option.swatch.map(color => <i key={color} style={{ background: color }} />)}</span>}
            {option.label}
            {on && <Check size={13} aria-hidden="true" />}
          </button>;
        })}
      </div>}
      {chosen?.hint && <p className="bq-hint" aria-live="polite">{chosen.hint}</p>}
      <label className="bq-custom">
        <span>{question.options.length ? "Or in your own words" : "Your answer"}</span>
        <input id={`bq-${question.id}`} value={answer.custom ?? ""} placeholder={question.custom} maxLength={300} disabled={busy}
          onChange={event => { window.clearTimeout(advance.current); setAnswers(current => ({ ...current, [question.id]: { option: undefined, custom: event.target.value } })); }}
          onKeyDown={event => { if (event.key === "Enter" && event.currentTarget.value.trim()) { event.preventDefault(); next(); } }} />
      </label>
      {question.note && <p className="bq-note">{question.note}</p>}
    </div>
    <p className="bq-announce" aria-live="polite" role="status">{announcement}</p>
    {limit && <p className="bq-limit">{limit}</p>}
    <footer className="bq-actions">
      {step > 0 && <button type="button" className="bq-back" disabled={busy} onClick={() => { window.clearTimeout(advance.current); setStep(step - 1); }} aria-label="Previous question"><ArrowLeft size={14} /></button>}
      <button type="button" className="button primary small" disabled={busy} onClick={next}>
        {last ? planning ? "Make the plan" : "Start building" : "Next"}<ArrowRight size={14} />
      </button>
      <button type="button" className="bq-skip" disabled={busy} onClick={skipThis}>Skip this question</button>
      <button type="button" className="bq-skip bq-skip-all" disabled={busy} onClick={onSkip} title={`Start the ${thing} with the brief as written`}>Skip all</button>
    </footer>
  </section>;
}
