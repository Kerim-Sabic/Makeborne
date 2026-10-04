"use client";
import { useId, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import "@/app/effort-control.css";

export default function EffortControl({ value, onChange, disabled = false, variant = "list" }: {
  value: EffortLevel; onChange: (value: EffortLevel) => void; disabled?: boolean; variant?: "list" | "menu";
}) {
  const id = useId();
  const descriptions = { light: "Quick changes and simple requests", medium: "Balanced for everyday work", high: "More planning and review", super_high: "Deeper work on complex projects", ultra: "The most room to explore and refine" };
  const creditNote = "Higher effort can use more credits. You’ll see an estimate before a paid run.";
  function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'));
    if (!choices.length) return;
    event.preventDefault();
    const current = choices.findIndex(choice => choice === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
    choices[next]?.focus();
  }
  if (variant === "menu") return <div className="mbe-effort mbe-effort-menu" role="menu" aria-label="Effort level" aria-describedby={`${id}-cost`} onKeyDown={navigateMenu}>
    <div className="mbe-effort-menu-heading" aria-hidden="true"><strong>Effort</strong><span>How deeply to work</span></div>
    <div className="mbe-effort-options" role="none">
      {EFFORT_LEVELS.map(level => <button type="button" role="menuitemradio" aria-checked={value === level} aria-label={EFFORT_PRESENTATION[level].label} aria-describedby={`${id}-${level}`} disabled={disabled} tabIndex={-1} className={`mbe-effort-option${value === level ? " is-selected" : ""}`} key={level} onClick={() => onChange(level)}>
        <span className="mbe-effort-copy"><strong>{EFFORT_PRESENTATION[level].label}</strong><span id={`${id}-${level}`}>{descriptions[level]}</span></span>
        <Check size={14} className="mbe-effort-check" aria-hidden="true" />
      </button>)}
    </div>
    <p className="mbe-effort-cost" id={`${id}-cost`}>{creditNote}</p>
  </div>;
  return <fieldset className="mbe-effort" disabled={disabled} aria-describedby={`${id}-cost`}>
    <legend>Effort</legend>
    <div className="mbe-effort-options">
      {EFFORT_LEVELS.map(level => <label className={`mbe-effort-option${value === level ? " is-selected" : ""}`} key={level}>
        <input type="radio" name={`${id}-effort`} value={level} checked={value === level} onChange={() => onChange(level)} aria-label={EFFORT_PRESENTATION[level].label} />
        <span className="mbe-effort-copy"><strong>{EFFORT_PRESENTATION[level].label}</strong><span>{descriptions[level]}</span></span>
        <Check size={16} className="mbe-effort-check" aria-hidden="true" />
      </label>)}
    </div>
    <p className="mbe-effort-cost" id={`${id}-cost`}>{creditNote}</p>
  </fieldset>;
}
