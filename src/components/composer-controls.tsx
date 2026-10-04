"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Sparkles, ListChecks } from "lucide-react";
import EffortControl from "./effort-control";
import { EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import "@/app/composer-controls.css";

export default function ComposerControls({ mode, onMode, effort, onEffort }: {
  mode: "create" | "plan"; onMode: (mode: "create" | "plan") => void;
  effort: EffortLevel; onEffort: (effort: EffortLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const element = panel.current;
      if (!element || !trigger.current) return;
      const bounds = trigger.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      const above = Math.max(0, bounds.top - viewportTop - 20);
      const below = Math.max(0, viewportBottom - bounds.bottom - 20);
      const desiredHeight = element.scrollHeight + 2;
      // Prefer the space above the composer, without covering the control.
      const opensAbove = above >= desiredHeight || above > below;
      element.style.maxHeight = `${opensAbove ? above : below}px`;
      element.style.top = `${opensAbove ? bounds.top - element.offsetHeight - 8 : bounds.bottom + 8}px`;
      element.style.left = `${Math.max(viewportLeft + 12, Math.min(bounds.left, viewportRight - element.offsetWidth - 12))}px`;
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
    panel.current?.querySelector<HTMLInputElement>('input[type="range"]')?.focus({ preventScroll: true });
    const outside = (event: Event) => { if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("focusin", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="creation-controls">
    <div className="composer-mode" role="group" aria-label="Creation mode">
      <button type="button" aria-pressed={mode === "create"} onClick={() => onMode("create")}><Sparkles size={14} />Create</button>
      <button type="button" aria-pressed={mode === "plan"} onClick={() => onMode("plan")}><ListChecks size={14} />Plan</button>
    </div>
    <button ref={trigger} type="button" className="creation-effort-trigger" aria-label={`Effort: ${EFFORT_PRESENTATION[effort].label}`} aria-haspopup="dialog" aria-controls={open ? `${id}-effort` : undefined} aria-expanded={open} title="Thinking effort" onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}><span className="creation-effort-label">Effort</span><span>{EFFORT_PRESENTATION[effort].label}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {open && createPortal(<div ref={panel} className="creation-effort-panel" id={`${id}-effort`} role="dialog" aria-label="Thinking effort" onKeyDown={event => {
      if (event.key === "Tab") { trigger.current?.focus({ preventScroll: true }); setOpen(false); }
    }}><EffortControl value={effort} variant="menu" onChange={onEffort} /></div>, document.body)}
  </div>;
}
