"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";
import { matchCommands, type PaletteCommand } from "@/lib/command-palette";
import { focusReturnTarget } from "@/lib/focus-return";
import "@/app/global-command-palette.css";

export type { PaletteCommand } from "@/lib/command-palette";

/**
 * Ctrl/⌘+K anywhere on the page: go to a place or open a starting point. Commands only
 * navigate or open a composer; none sends a request or starts paid work. A palette that
 * handles the shortcut first (the client list's) takes precedence.
 */
/** `shortcut` is false where another palette owns Ctrl/⌘+K (the client list); the trigger button still opens this one. */
export default function GlobalCommandPalette({ commands, triggerClassName, shortcut: listening = true }: { commands: readonly PaletteCommand[]; triggerClassName?: string; shortcut?: boolean }) {
  const [open, setOpen] = useState(false);
  const [shortcut, setShortcut] = useState("Ctrl+K");
  useEffect(() => {
    queueMicrotask(() => setShortcut(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K"));
  }, []);
  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault(); setOpen(value => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening]);
  return <>
    {triggerClassName && <button type="button" className={triggerClassName} aria-haspopup="dialog" aria-keyshortcuts={listening ? "Control+K Meta+K" : undefined} onClick={() => setOpen(true)}>
      <Search size={15} aria-hidden="true" /><span>Go to or start…</span>{listening && <kbd>{shortcut}</kbd>}</button>}
    {open && <PaletteDialog commands={commands} onClose={() => setOpen(false)} />}
  </>;
}

function PaletteDialog({ commands, onClose }: { commands: readonly PaletteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const restore = useRef<Element | null>(null);
  const list = useId();
  useEffect(() => {
    restore.current = focusReturnTarget();
    input.current?.focus();
    return () => { if (restore.current instanceof HTMLElement && restore.current.isConnected) restore.current.focus(); };
  }, []);
  const items = matchCommands(commands, query);
  const current = items.length ? Math.min(active, items.length - 1) : -1;
  useEffect(() => { document.getElementById(`${list}-${current}`)?.scrollIntoView({ block: "nearest" }); }, [current, list]);
  const choose = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    // After the dialog closes and focus is restored, so the command can move focus itself.
    requestAnimationFrame(() => item.run());
  };
  return createPortal(<div className="gp-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="gp-dialog" role="dialog" aria-modal="true" aria-label="Go to or start">
      <label className="gp-search"><Search size={17} aria-hidden="true" /><span className="gp-sr-only">Go to a page or start something</span>
        <input ref={input} role="combobox" aria-expanded="true" aria-controls={list} aria-autocomplete="list" aria-activedescendant={current >= 0 ? `${list}-${current}` : undefined}
          placeholder="Go to or start…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive(items.length ? (current + 1) % items.length : 0); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActive(items.length ? (current - 1 + items.length) % items.length : 0); }
            else if (event.key === "Home") { event.preventDefault(); setActive(0); }
            else if (event.key === "End") { event.preventDefault(); setActive(Math.max(0, items.length - 1)); }
            else if (event.key === "Enter") { event.preventDefault(); choose(current); }
            else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
            else if (event.key === "Tab") event.preventDefault();
          }} />
        <kbd>Esc</kbd></label>
      <ul id={list} role="listbox" aria-label="Commands" className="gp-results">
        {items.map((item, index) => <li key={item.id} id={`${list}-${index}`} role="option" aria-selected={index === current} className={index === current ? "is-active" : undefined}
          onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); choose(index); }}>
          <span><strong>{item.label}</strong>{item.hint && <small>{item.hint}</small>}</span>
          <em>{item.group}</em>
          {index === current && <CornerDownLeft size={14} aria-hidden="true" />}
        </li>)}
      </ul>
      <p className="gp-status" role="status">{items.length ? `${items.length} result${items.length === 1 ? "" : "s"}` : `Nothing matches “${query}”.`}</p>
      <p className="gp-note">Commands only open pages and composers. Nothing is sent or charged from here.</p>
    </div>
  </div>, document.body);
}
