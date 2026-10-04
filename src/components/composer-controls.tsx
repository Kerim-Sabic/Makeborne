"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal, Sparkles, ListChecks } from "lucide-react";
import EffortControl from "./effort-control";
import { EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import "@/app/composer-controls.css";

export default function ComposerControls({ mode, onMode, effort, onEffort }: {
  mode: "create" | "plan"; onMode: (mode: "create" | "plan") => void;
  effort: EffortLevel; onEffort: (effort: EffortLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="creation-controls" ref={root}>
    <div className="composer-mode" role="group" aria-label="Creation mode">
      <button type="button" aria-pressed={mode === "create"} onClick={() => onMode("create")}><Sparkles size={14} />Create</button>
      <button type="button" aria-pressed={mode === "plan"} onClick={() => onMode("plan")}><ListChecks size={14} />Plan</button>
    </div>
    <button ref={trigger} type="button" className={`creation-effort-trigger ${effort === "ultra" ? "is-ultra" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}><SlidersHorizontal size={14} /><span>Effort: {EFFORT_PRESENTATION[effort].label}</span><ChevronDown size={12} /></button>
    {open && <div className="creation-effort-panel" onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}><EffortControl value={effort} onChange={onEffort} /><button type="button" className="creation-effort-done" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Done</button></div>}
  </div>;
}
