"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import type { BriefAnswers, BriefQuestion } from "@/lib/builder/brief-questions";
import "@/app/brief-questions.css";

/** Quick questions before the first build, one at a time so they fit the
 * builder chat. Every question is optional: "Skip this question" leaves the
 * call to the builder, and "Skip all" starts right away. */
export default function BriefQuestionsCard({ questions, kind, planning, busy, onStart, onSkip }: {
  questions: readonly BriefQuestion[]; kind: "website" | "presentation" | "book"; planning: boolean; busy: boolean;
  onStart: (answers: BriefAnswers) => void; onSkip: () => void;
}) {
  const [answers, setAnswers] = useState<BriefAnswers>({});
  const [step, setStep] = useState(0);
  const advance = useRef<number | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => window.clearTimeout(advance.current), []);
  useEffect(() => { if (step > 0) heading.current?.focus(); }, [step]);

  const question = questions[step], last = step === questions.length - 1;
  const answer = answers[question.id] ?? {};
  const chosen = question.options.find(option => option.value === answer.option);
  const thing = kind === "presentation" ? "presentation" : kind;
  const next = () => { window.clearTimeout(advance.current); if (last) onStart(answers); else setStep(step + 1); };
  const pick = (value: string) => {
    const option = answer.option === value ? undefined : value;
    setAnswers(current => ({ ...current, [question.id]: { option, custom: "" } }));
    window.clearTimeout(advance.current);
    // Choosing an option moves on, briefly showing the choice first.
    if (option && !last) advance.current = window.setTimeout(() => setStep(current => Math.min(current + 1, questions.length - 1)), 280);
  };
  const skipThis = () => { setAnswers(current => ({ ...current, [question.id]: {} })); next(); };

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
          return <button key={option.value} type="button" className="bq-chip" aria-pressed={on} disabled={busy} title={option.hint} onClick={() => pick(option.value)}>
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
