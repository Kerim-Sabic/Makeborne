"use client";
import { useId, type CSSProperties } from "react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import "@/app/effort-control.css";

const descriptions: Record<EffortLevel, string> = {
  light: "Quick, focused changes.",
  medium: "A balance of speed and depth.",
  high: "More time to plan and refine.",
  super_high: "Deeper work on complex ideas.",
  ultra: "The most room to explore and refine.",
};

export default function EffortControl({ value, onChange, disabled = false, variant = "list" }: {
  value: EffortLevel; onChange: (value: EffortLevel) => void; disabled?: boolean; variant?: "list" | "menu";
}) {
  const id = useId();
  const selected = EFFORT_LEVELS.indexOf(value);
  return <fieldset className={`mbe-effort mbe-effort-slider${variant === "menu" ? " mbe-effort-menu" : ""}`} disabled={disabled} style={{ "--effort-progress": `${selected * 25}%` } as CSSProperties}>
    <legend className="mbe-effort-sr-only">Thinking effort</legend>
    <div className="mbe-effort-heading">
      <label htmlFor={`${id}-range`}>Thinking effort</label>
      <output htmlFor={`${id}-range`} className={value === "ultra" ? "is-ultra" : ""}>{EFFORT_PRESENTATION[value].label}</output>
    </div>
    <div className="mbe-effort-track">
      <div className="mbe-effort-rail" aria-hidden="true">
        {EFFORT_LEVELS.map((level, index) => <i key={level} className={index <= selected ? "is-filled" : ""} style={{ left: `${index * 25}%` }} />)}
      </div>
      <input id={`${id}-range`} type="range" min={0} max={4} step={1} value={selected} aria-valuetext={EFFORT_PRESENTATION[value].label} aria-describedby={`${id}-description ${id}-cost`} onChange={event => onChange(EFFORT_LEVELS[Number(event.target.value)])} />
    </div>
    <div className="mbe-effort-stops">
      {EFFORT_LEVELS.map((level, index) => <button key={level} type="button" tabIndex={-1} aria-label={`Set effort to ${EFFORT_PRESENTATION[level].label}`} aria-pressed={value === level} onClick={() => onChange(level)} style={{ "--stop": `${index * 25}%` } as CSSProperties}>{EFFORT_PRESENTATION[level].label}</button>)}
    </div>
    <p className="mbe-effort-description" id={`${id}-description`}>{descriptions[value]}</p>
    <p className="mbe-effort-cost" id={`${id}-cost`}>Higher effort can use more credits.</p>
  </fieldset>;
}
