"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const element = panel.current;
      const anchor = element?.offsetParent;
      if (!element || !(anchor instanceof HTMLElement)) return;
      const bounds = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const above = Math.max(0, bounds.top - viewportTop - 21);
      const below = Math.max(0, viewportBottom - bounds.bottom - 21);
      const desiredHeight = Math.min(element.scrollHeight + 2, 380);
      const opensAbove = below < desiredHeight && above > below;
      element.style.top = opensAbove ? "auto" : "calc(100% + 9px)";
      element.style.bottom = opensAbove ? "calc(100% + 9px)" : "auto";
      element.style.maxHeight = `${Math.min(380, opensAbove ? above : below)}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const selected = root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]');
    selected?.focus({ preventScroll: true });
    if (panel.current && selected) {
      const bounds = panel.current.getBoundingClientRect();
      const selectedBounds = selected.getBoundingClientRect();
      if (selectedBounds.bottom > bounds.bottom - 8) panel.current.scrollTop += selectedBounds.bottom - bounds.bottom + 8;
    }
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
    {open && <div ref={panel} className="creation-effort-panel" id={`${id}-effort`}><EffortControl value={effort} variant="menu" onChange={value => { onEffort(value); setOpen(false); trigger.current?.focus({ preventScroll: true }); }} /></div>}
  </div>;
}
