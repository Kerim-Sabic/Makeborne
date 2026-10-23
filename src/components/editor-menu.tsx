"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A disclosure menu for the editor chrome: a button that shows a panel of actions or facts right after it.
 * - Escape, an outside click (including one in the preview frame) or tabbing out closes it; Escape and choosing an action return focus to the button.
 * - ArrowDown on the button opens it on its first item; ArrowUp/ArrowDown/Home/End move between items.
 * - The panel always stays mounted (hidden when closed), so a running action keeps its state and message.
 * - `collapse`: on wide toolbars the items show inline and the button is hidden; under the container
 *   width set in editor-chrome.css the same items move into the panel (one copy, never two rows).
 * Items marked `data-keep-open` (a download that reports progress) leave the panel open when chosen.
 */
export default function EditorMenu({ label, trigger, className = "", panelLabel, collapse = false, align = "end", children, triggerClassName = "", describedBy, heading = false }: {
  /** Accessible name of the button (also its tooltip when the trigger is an icon). */
  label: string;
  trigger: ReactNode;
  className?: string;
  triggerClassName?: string;
  /** Names the panel for assistive technology; defaults to the button label. */
  panelLabel?: string;
  collapse?: boolean;
  align?: "start" | "end";
  describedBy?: string;
  /** The button is the page heading (the project title): it is wrapped in an h1 and named by its visible text; `label` becomes its tooltip. */
  heading?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = () => [...(panel.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], select:not([disabled]), input:not([disabled])") ?? [])].filter(item => item.getClientRects().length > 0);
  const close = useCallback((refocus: boolean) => { setOpen(false); if (refocus) button.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(true); } };
    // A click in the preview frame would never reach this document: while a menu is open the frame takes no pointer
    // events (editor-chrome.css), so that click lands here and closes the menu. Leaving the window closes it too.
    const away = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", away);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("blur", away); };
  }, [open, close]);
  const focusItem = (index: number) => { const list = items(); if (list.length) list[(index + list.length) % list.length].focus(); };
  const toggle = <button ref={button} type="button" className={`editor-menu-toggle ${triggerClassName}`.trim()} aria-label={heading ? undefined : label} title={label} aria-expanded={open} aria-controls={id} aria-describedby={describedBy}
    onClick={() => setOpen(value => !value)}
    onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => focusItem(0)); } }}>{trigger}</button>;
  return <div ref={root} className={`editor-menu ${className}`.trim()} data-open={open || undefined} data-collapse={collapse || undefined} data-align={align}
    onBlur={event => { if (open && event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(false); }}>
    {heading ? <h1 className="editor-menu-heading">{toggle}</h1> : toggle}
    <div ref={panel} id={id} className="editor-menu-panel" role="group" aria-label={panelLabel ?? label}
      onKeyDown={event => {
        if (!open) return;
        const list = items(), at = list.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown") { event.preventDefault(); focusItem(at + 1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(at - 1); }
        else if (event.key === "Home") { event.preventDefault(); focusItem(0); }
        else if (event.key === "End") { event.preventDefault(); focusItem(list.length - 1); }
      }}
      onClick={event => {
        if (!open) return;
        const chosen = (event.target as HTMLElement).closest("button, a[href]");
        if (chosen && !chosen.closest("[data-keep-open]") && !(chosen as HTMLButtonElement).disabled) close(true);
      }}>{children}</div>
  </div>;
}
