"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Columns3, CornerDownLeft, Download, List, LoaderCircle, Mail, Plus, RefreshCw, Search, Upload, User } from "lucide-react";
import type { CloudClient } from "@/lib/cloud/contracts";
import { clampActive, currentClients, searchKey, searchNotice, type PaletteSearch } from "@/lib/cloud/palette-search";
import { api } from "./cloud-api";
import { focusReturnTarget } from "@/lib/focus-return";

export type PaletteAction = { id: string; label: string; hint?: string; icon: "add" | "overdue" | "board" | "list" | "export" | "import" | "email" };
const icons = { add: Plus, overdue: CalendarClock, board: Columns3, list: List, export: Download, import: Upload, email: Mail };

/** ⌘K / Ctrl+K: jump to any client in the workspace (server search) or run a client action. */
export default function ClientCommandPalette({ workspaceId, today, actions, onOpenClient, onAction, onClose }: {
  workspaceId: string; today: string; actions: PaletteAction[];
  onOpenClient: (id: string) => void; onAction: (id: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const key = searchKey(workspaceId, query);
  // Results are bound to the workspace + query they were requested for (see palette-search.ts).
  const [search, setSearch] = useState<PaletteSearch<CloudClient>>({ status: "loading", key });
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    restore.current = focusReturnTarget();
    input.current?.focus();
    return () => { if (restore.current instanceof HTMLElement && restore.current.isConnected) restore.current.focus(); };
  }, []);
  useEffect(() => {
    let live = true;
    const requested = searchKey(workspaceId, query);
    const timer = window.setTimeout(() => {
      setSearch({ status: "loading", key: requested });
      void api<{ clients: CloudClient[] }>(`/api/cloud/workspaces/${workspaceId}/clients?${new URLSearchParams({ search: query.trim(), stage: "All stages", followUp: "all", day: today })}`)
        .then(result => { if (live) setSearch({ status: "ready", key: requested, clients: result.clients.slice(0, 8) }); })
        .catch(() => { if (live) setSearch({ status: "error", key: requested }); });
    }, query ? 160 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, workspaceId, today, attempt]);

  const matchedActions = actions.filter(action => !query.trim() || action.label.toLowerCase().includes(query.trim().toLowerCase()));
  const clients = currentClients(search, key);
  const items = [...matchedActions.map(action => ({ kind: "action" as const, action })), ...clients.map(client => ({ kind: "client" as const, client }))];
  const notice = searchNotice(search, key, items.length);
  const current = clampActive(active, items.length);
  const choose = (index: number) => {
    const item = index >= 0 ? items[index] : undefined;
    if (!item) return;
    onClose();
    if (item.kind === "action") onAction(item.action.id); else onOpenClient(item.client.id);
  };

  return createPortal(<div className="cp-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="cp-dialog" role="dialog" aria-modal="true" aria-label="Find a client or action">
      <label className="cp-search"><Search size={17} aria-hidden="true" />
        <input ref={input} role="combobox" aria-expanded="true" aria-controls="cp-results" aria-activedescendant={current >= 0 ? `cp-item-${current}` : undefined}
          aria-busy={notice === "searching" || undefined}
          placeholder="Search clients or type a command…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive(Math.min(items.length - 1, current + 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActive(Math.max(0, current - 1)); }
            else if (event.key === "Enter") { event.preventDefault(); choose(current); }
            else if (event.key === "Escape") { event.preventDefault(); onClose(); }
          }} />
        <kbd>Esc</kbd></label>
      <ul id="cp-results" role="listbox" className="cp-results">
        {items.map((item, index) => {
          const Icon = item.kind === "action" ? icons[item.action.icon] : User;
          return <li key={item.kind === "action" ? item.action.id : item.client.id} id={`cp-item-${index}`} role="option" aria-selected={index === current}
            className={index === current ? "is-active" : undefined} onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); choose(index); }}>
            <Icon size={16} aria-hidden="true" />
            {item.kind === "action" ? <span><strong>{item.action.label}</strong>{item.action.hint && <small>{item.action.hint}</small>}</span>
              : <span><strong>{item.client.name}</strong><small>{[item.client.company, item.client.outreachSummary?.stage].filter(Boolean).join(" · ")}</small></span>}
            {index === current && <CornerDownLeft size={14} aria-hidden="true" className="cp-enter" />}
          </li>;
        })}
      </ul>
      <div className="cp-status" role="status">
        {notice === "searching" && <p className="cp-empty"><LoaderCircle size={14} className="cp-spin" aria-hidden="true" /> Searching clients…</p>}
        {notice === "empty" && <p className="cp-empty">No clients or actions match “{query}”.</p>}
      </div>
      {notice === "error" && <div className="cp-error" role="alert">
        <span>Clients couldn&apos;t be searched just now. Your search is kept.</span>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setAttempt(value => value + 1); input.current?.focus(); }}><RefreshCw size={13} aria-hidden="true" /> Retry</button>
      </div>}
    </div>
  </div>, document.body);
}
