"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal, Sparkles, ListChecks } from "lucide-react";
import EffortControl from "./effort-control";
import { EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import "@/app/composer-controls.css";

export default function ComposerControls({ mode, onMode, effort, onEffort }: {
  mode: "create" | "plan"; onMode: (mode: "create" | "plan") => void;
  effort: EffortLevel; onEffort: (effort: EffortLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !root.current?.querySelector(".creation-effort-panel")?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="creation-controls" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <div className="composer-mode" role="group" aria-label="Creation mode">
      <button type="button" aria-pressed={mode === "create"} onClick={() => onMode("create")}><Sparkles size={14} />Create</button>
      <button type="button" aria-pressed={mode === "plan"} onClick={() => onMode("plan")}><ListChecks size={14} />Plan</button>
    </div>
    <button ref={trigger} type="button" className={`creation-effort-trigger ${effort === "ultra" ? "is-ultra" : ""}`} aria-label={`Effort: ${EFFORT_PRESENTATION[effort].label}`} aria-haspopup="menu" aria-controls={open ? `${id}-effort` : undefined} aria-expanded={open} title="Choose effort level" onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}><SlidersHorizontal size={13} /><span>{EFFORT_PRESENTATION[effort].label}</span><ChevronDown size={11} /></button>
    {open && <div className="creation-effort-panel" id={`${id}-effort`}><EffortControl value={effort} variant="menu" onChange={value => { onEffort(value); setOpen(false); trigger.current?.focus({ preventScroll: true }); }} /></div>}
  </div>;
}
