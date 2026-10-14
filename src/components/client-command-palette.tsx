"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Columns3, CornerDownLeft, Download, List, Mail, Plus, Search, Upload, User } from "lucide-react";
import type { CloudClient } from "@/lib/cloud/contracts";
import { api } from "./cloud-api";

export type PaletteAction = { id: string; label: string; hint?: string; icon: "add" | "overdue" | "board" | "list" | "export" | "import" | "email" };
const icons = { add: Plus, overdue: CalendarClock, board: Columns3, list: List, export: Download, import: Upload, email: Mail };

/** ⌘K / Ctrl+K: jump to any client in the workspace (server search) or run a client action. */
export default function ClientCommandPalette({ workspaceId, today, actions, onOpenClient, onAction, onClose }: {
  workspaceId: string; today: string; actions: PaletteAction[];
  onOpenClient: (id: string) => void; onAction: (id: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<CloudClient[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    restore.current = document.activeElement;
    input.current?.focus();
    return () => { if (restore.current instanceof HTMLElement) restore.current.focus(); };
  }, []);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void api<{ clients: CloudClient[] }>(`/api/cloud/workspaces/${workspaceId}/clients?${new URLSearchParams({ search: query.trim(), stage: "All stages", followUp: "all", day: today })}`)
        .then(result => { if (live) { setClients(result.clients.slice(0, 8)); setActive(0); } }).catch(() => { if (live) setClients([]); });
    }, query ? 160 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, workspaceId, today]);

  const matchedActions = actions.filter(action => !query.trim() || action.label.toLowerCase().includes(query.trim().toLowerCase()));
  const items = [...matchedActions.map(action => ({ kind: "action" as const, action })), ...clients.map(client => ({ kind: "client" as const, client }))];
  const choose = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    if (item.kind === "action") onAction(item.action.id); else onOpenClient(item.client.id);
  };

  return createPortal(<div className="cp-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="cp-dialog" role="dialog" aria-modal="true" aria-label="Find a client or action">
      <label className="cp-search"><Search size={17} aria-hidden="true" />
        <input ref={input} role="combobox" aria-expanded="true" aria-controls="cp-results" aria-activedescendant={items[active] ? `cp-item-${active}` : undefined}
          placeholder="Search clients or type a command…" value={query} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(items.length - 1, index + 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
            else if (event.key === "Enter") { event.preventDefault(); choose(active); }
            else if (event.key === "Escape") { event.preventDefault(); onClose(); }
          }} />
        <kbd>Esc</kbd></label>
      <ul id="cp-results" role="listbox" className="cp-results">
        {items.map((item, index) => {
          const Icon = item.kind === "action" ? icons[item.action.icon] : User;
          return <li key={item.kind === "action" ? item.action.id : item.client.id} id={`cp-item-${index}`} role="option" aria-selected={index === active}
            className={index === active ? "is-active" : undefined} onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); choose(index); }}>
            <Icon size={16} aria-hidden="true" />
            {item.kind === "action" ? <span><strong>{item.action.label}</strong>{item.action.hint && <small>{item.action.hint}</small>}</span>
              : <span><strong>{item.client.name}</strong><small>{[item.client.company, item.client.outreachSummary?.stage].filter(Boolean).join(" · ")}</small></span>}
            {index === active && <CornerDownLeft size={14} aria-hidden="true" className="cp-enter" />}
          </li>;
        })}
        {!items.length && <li className="cp-empty">No clients or actions match “{query}”.</li>}
      </ul>
    </div>
  </div>, document.body);
}
