"use client";
import { useEffect, useRef, useState } from "react";
import type { CloudClient } from "@/lib/cloud/contracts";
import { outreachStages, normalizeOutreachStage, type OutreachStage } from "@/lib/client-outreach";
import { followUpBucket, followUpLabel } from "@/lib/client-followups";
import { api } from "./cloud-api";
import { quickUpdate, summaryOf } from "./client-quick-actions";
import { useLeadMeta } from "./leads/lead-api";
import { formatMoney } from "@/lib/leads";

type Column = { clients: CloudClient[]; total: number };
type Directory = { clients: CloudClient[]; pagination: { total: number } };
const stageOf = (client: CloudClient) => String(normalizeOutreachStage(summaryOf(client)?.stage ?? "Lead")) as OutreachStage;

/** Pipeline board: one column per sales stage. Dragging a card (or choosing "Move to")
 * changes the stage at once and records it in the client's history; a refused save rolls back. */
export default function ClientBoard({ accountId, workspaceId, search, today, canEdit, refreshKey, onOpen, onChanged, onError }: {
  accountId: string; workspaceId: string; search: string; today: string; canEdit: boolean; refreshKey: number;
  onOpen: (id: string) => void; onChanged: (client: CloudClient) => void; onError: (message: string) => void;
}) {
  const [columns, setColumns] = useState<Record<OutreachStage, Column> | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<OutreachStage | null>(null);
  const [moving, setMoving] = useState<Set<string>>(new Set());
  const version = useRef(0);
  const { leads } = useLeadMeta(accountId, workspaceId, columns ? Object.values(columns).flatMap(column => column.clients.map(client => client.id)) : [], refreshKey);
  /** Pipeline value per column, per currency (only cards loaded on the board). */
  const valueOf = (clients: CloudClient[]) => {
    const sums = new Map<string, number>();
    for (const client of clients) { const lead = leads[client.id]; if (lead?.dealValue) sums.set(lead.dealCurrency, (sums.get(lead.dealCurrency) ?? 0) + lead.dealValue); }
    return [...sums].map(([currency, value]) => formatMoney(value, currency)).join(" + ");
  };

  useEffect(() => {
    const current = ++version.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void Promise.all(outreachStages.map(stage => api<Directory>(`/api/cloud/workspaces/${workspaceId}/clients?${new URLSearchParams({ search, stage, followUp: "all", day: today })}`)))
        .then(results => { if (current === version.current) setColumns(Object.fromEntries(outreachStages.map((stage, index) => [stage, { clients: results[index].clients, total: results[index].pagination.total }])) as Record<OutreachStage, Column>); })
        .catch(cause => { if (current === version.current) onError(cause instanceof Error ? cause.message : "Could not load the pipeline."); })
        .finally(() => { if (current === version.current) setLoading(false); });
    }, columns ? 250 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- columns only chooses the debounce; onError is a stable notifier
  }, [workspaceId, search, today, refreshKey]);

  function place(state: Record<OutreachStage, Column>, client: CloudClient, from: OutreachStage, to: OutreachStage) {
    const next = { ...state };
    next[from] = { clients: state[from].clients.filter(item => item.id !== client.id), total: Math.max(0, state[from].total - 1) };
    next[to] = { clients: [client, ...state[to].clients.filter(item => item.id !== client.id)], total: state[to].total + (from === to ? 0 : 1) };
    return next;
  }
  async function move(client: CloudClient, to: OutreachStage) {
    const from = stageOf(client);
    if (!columns || from === to || moving.has(client.id) || !canEdit) return;
    const optimistic = { ...client, outreachSummary: { stage: to, nextFollowUp: summaryOf(client)?.nextFollowUp ?? null } };
    setColumns(state => state && place(state, optimistic, from, to));
    setMoving(set => new Set(set).add(client.id));
    try {
      const saved = await quickUpdate(workspaceId, client.id, { kind: "stage", stage: to }, today);
      const confirmed = { ...saved, outreachSummary: summaryOf(saved) };
      setColumns(state => state && place(state, confirmed, to, stageOf(confirmed)));
      onChanged(confirmed);
    } catch (cause) {
      setColumns(state => state && place(state, client, to, from));
      onError(cause instanceof Error ? cause.message : `Couldn't move ${client.name}. Nothing changed.`);
    } finally { setMoving(set => { const next = new Set(set); next.delete(client.id); return next; }); }
  }

  if (!columns) return <div className="cb-board" aria-busy="true">{outreachStages.map(stage => <section key={stage} className="cb-column"><header><h3>{stage}</h3></header><div className="ac-skeleton ac-skeleton-detail"><span /><span /></div></section>)}</div>;
  return <div className={`cb-board${loading ? " is-stale" : ""}`} aria-label="Pipeline board">
    {outreachStages.map(stage => {
      const column = columns[stage];
      return <section key={stage} className={`cb-column${over === stage ? " is-over" : ""}`} data-stage={stage} aria-label={`${stage}: ${column.total}`}
        onDragOver={event => { if (dragging && canEdit) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (over !== stage) setOver(stage); } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(current => current === stage ? null : current); }}
        onDrop={event => { event.preventDefault(); setOver(null); const client = Object.values(columns).flatMap(item => item.clients).find(item => item.id === dragging); setDragging(null); if (client) void move(client, stage); }}>
        <header><h3>{stage}</h3><span>{column.total}</span></header>
        {valueOf(column.clients) && <p className="cb-value">{valueOf(column.clients)}</p>}
        <div className="cb-cards">
          {column.clients.map(client => {
            const summary = summaryOf(client), bucket = followUpBucket(summary, today);
            return <article key={client.id} className={`cb-card${dragging === client.id ? " is-dragging" : ""}${moving.has(client.id) ? " is-moving" : ""}`} draggable={canEdit}
              onDragStart={event => { setDragging(client.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", client.id); }}
              onDragEnd={() => { setDragging(null); setOver(null); }}>
              <button type="button" className="cb-open" onClick={() => onOpen(client.id)}><strong>{client.name}</strong><small>{client.company || client.email || "No company"}</small></button>
              <div className="cb-foot"><small className={`ac-followup-${bucket}`}>{followUpLabel(summary, today)}</small>
                {canEdit && <select aria-label={`Move ${client.name} to another stage`} value={stage} disabled={moving.has(client.id)} onChange={event => void move(client, event.target.value as OutreachStage)}>{outreachStages.map(item => <option key={item} value={item}>{item === stage ? "Move…" : item}</option>)}</select>}</div>
            </article>;
          })}
          {!column.clients.length && <p className="cb-empty">{dragging ? "Drop here" : "No clients"}</p>}
          {column.total > column.clients.length && <p className="cb-more">+{column.total - column.clients.length} more · use the list to see all</p>}
        </div>
      </section>;
    })}
  </div>;
}
