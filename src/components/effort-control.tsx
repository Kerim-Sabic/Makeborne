"use client";
import { useId } from "react";
import { Check } from "lucide-react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import "@/app/effort-control.css";

export default function EffortControl({ value, onChange, disabled = false }: {
  value: EffortLevel; onChange: (value: EffortLevel) => void; disabled?: boolean;
}) {
  const id = useId();
  const descriptions = { light: "Quick changes and simple requests", medium: "Balanced for everyday work", high: "More planning and review", super_high: "Deeper work on complex projects", ultra: "The most room to explore and refine" };
  return <fieldset className="mbe-effort" disabled={disabled} aria-describedby={`${id}-cost`}>
    <legend>Effort</legend>
    <div className="mbe-effort-options">
      {EFFORT_LEVELS.map(level => <label className={`mbe-effort-option${value === level ? " is-selected" : ""}`} key={level}>
        <input type="radio" name={`${id}-effort`} value={level} checked={value === level} onChange={() => onChange(level)} aria-label={EFFORT_PRESENTATION[level].label} />
        <span className="mbe-effort-copy"><strong>{EFFORT_PRESENTATION[level].label}{level === "ultra" && <small>Maximum</small>}</strong><span>{descriptions[level]}</span></span>
        <Check size={16} className="mbe-effort-check" aria-hidden="true" />
      </label>)}
    </div>
    <p className="mbe-effort-cost" id={`${id}-cost`}>Higher effort can use more credits. Estimates appear before paid runs.</p>
  </fieldset>;
}
