"use client";
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
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
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const dragging = useRef(false);
  const position = dragPosition ?? EFFORT_LEVELS.indexOf(value);
  const selected = Math.round(position);
  const preview = EFFORT_LEVELS[selected];
  function commit(position: number) {
    const level = EFFORT_LEVELS[Math.min(4, Math.max(0, Math.round(position)))];
    dragging.current = false;
    setDragPosition(null);
    if (level !== value) onChange(level);
  }
  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -1, PageUp: 1 };
    if (!(event.key in steps) && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    commit(event.key === "Home" ? 0 : event.key === "End" ? 4 : selected + steps[event.key]);
  }
  return <fieldset className={`mbe-effort mbe-effort-slider${variant === "menu" ? " mbe-effort-menu" : ""}${dragPosition !== null ? " is-dragging" : ""}${preview === "ultra" ? " is-ultra" : ""}`} disabled={disabled} style={{ "--effort-progress": `${position * 25}%` } as CSSProperties}>
    <legend className="mbe-effort-sr-only">Thinking effort</legend>
    <div className="mbe-effort-heading">
      <label htmlFor={`${id}-range`}>Thinking effort</label>
      <output htmlFor={`${id}-range`} className={preview === "ultra" ? "is-ultra" : ""}>{EFFORT_PRESENTATION[preview].label}</output>
    </div>
    <div className="mbe-effort-track">
      <div className="mbe-effort-rail" aria-hidden="true">
        <span className="mbe-effort-fill" />
        {EFFORT_LEVELS.map((level, index) => <i key={level} className={index <= selected ? "is-filled" : ""} style={{ left: `${index * 25}%` }} />)}
        <span className="mbe-effort-thumb" />
      </div>
      <input id={`${id}-range`} type="range" min={0} max={4} step="any" value={position} aria-valuenow={selected} aria-valuetext={EFFORT_PRESENTATION[preview].label} aria-describedby={`${id}-description ${id}-cost`}
        onPointerDown={event => { if (event.button !== 0) return; dragging.current = true; setDragPosition(position); event.currentTarget.setPointerCapture(event.pointerId); }}
        onChange={event => { const next = Number(event.target.value); if (dragging.current) setDragPosition(next); else commit(next); }}
        onPointerUp={event => { if (dragging.current) commit(Number(event.currentTarget.value)); }}
        onPointerCancel={() => { dragging.current = false; setDragPosition(null); }}
        onLostPointerCapture={event => { if (dragging.current) commit(Number(event.currentTarget.value)); }}
        onBlur={event => { if (dragging.current) commit(Number(event.currentTarget.value)); }}
        onKeyDown={navigate} />
    </div>
    <div className="mbe-effort-stops">
      {EFFORT_LEVELS.map((level, index) => <button key={level} type="button" tabIndex={-1} aria-label={`Set effort to ${EFFORT_PRESENTATION[level].label}`} aria-pressed={preview === level} onClick={() => commit(index)} style={{ "--stop": `${index * 25}%` } as CSSProperties}>{EFFORT_PRESENTATION[level].label}</button>)}
    </div>
    <p className="mbe-effort-description" id={`${id}-description`}>{descriptions[preview]}</p>
    <p className="mbe-effort-cost" id={`${id}-cost`}>Higher effort can use more credits.</p>
  </fieldset>;
}
