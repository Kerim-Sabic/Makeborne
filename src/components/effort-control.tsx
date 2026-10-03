"use client";

import { useId, type CSSProperties } from "react";
import { Sparkles } from "lucide-react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import "@/app/effort-control.css";

export default function EffortControl({ value, onChange, disabled = false }: {
  value: EffortLevel;
  onChange: (value: EffortLevel) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const selected = EFFORT_PRESENTATION[value];
  return <fieldset className={`mbe-effort${value === "ultra" ? " is-ultra" : ""}`} disabled={disabled} aria-describedby={`${id}-purpose ${id}-cost`}>
    <legend>Creative effort</legend>
    <div className="mbe-effort-top"><span>How deeply should we work?</span><span className="mbe-effort-selection"><Sparkles size={12} aria-hidden="true" />{selected.label}</span></div>
    <div className="mbe-effort-track" style={{ "--effort-index": EFFORT_LEVELS.indexOf(value) } as CSSProperties}>
      <span className="mbe-effort-highlight" aria-hidden="true" />
      {EFFORT_LEVELS.map(level => <label className={`mbe-effort-option${value === level ? " is-selected" : ""}`} key={level}>
        <input type="radio" name={`${id}-effort`} value={level} checked={value === level} onChange={() => onChange(level)} />
        <span>{EFFORT_PRESENTATION[level].label}</span>
      </label>)}
    </div>
    <p className="mbe-effort-purpose" id={`${id}-purpose`} aria-live="polite">{selected.purpose}</p>
    <p className="mbe-effort-cost" id={`${id}-cost`}>Higher effort may cost more. You’ll see the exact estimate before a run.</p>
  </fieldset>;
}
