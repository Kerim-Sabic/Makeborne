"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Globe2, Inbox, Loader2, UserPlus, X } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";
import { crmProtocolHeaders } from "@/lib/crm-protocol";
import "@/app/enquiry-leads.css";

export type EnquiryResult = { enquiryId: string; clientId?: string; status: "created" | "existing" | "failed"; message?: string };
type Item = { id: string; name: string; email: string; message: string; created_at: string; artifact_id: string; site: string; clientId: string | null };

/** Today in the viewer's time zone (YYYY-MM-DD), for the lead's follow-up date. */
export const localDay = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };

/** Adds enquiries to Clients through the server, which uses the normal client-creation path. */
export async function addEnquiriesToClients(accountId: string, workspaceId: string, ids: string[]): Promise<EnquiryResult[]> {
  const guard = cloudAccountGuard(accountId); guard();
  const response = await fetch(`/api/cloud/workspaces/${workspaceId}/enquiries/clients`, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId, ...crmProtocolHeaders },
    body: JSON.stringify({ ids: ids.slice(0, 25), day: localDay() }),
  });
  const value = await response.json().catch(() => ({}));
  guard();
  if (!response.ok) throw new Error(value?.error?.message ?? "Those enquiries couldn't be added. Try again.");
  return (value.results ?? []) as EnquiryResult[];
}

export function resultMessage(results: EnquiryResult[]) {
  const created = results.filter(item => item.status === "created").length, existing = results.filter(item => item.status === "existing").length, failed = results.filter(item => item.status === "failed").length;
  const parts = [created && `${created} new lead${created === 1 ? "" : "s"} added`, existing && `${existing} added to existing client${existing === 1 ? "" : "s"}`, failed && `${failed} couldn't be added`].filter(Boolean);
  return `${parts.join(" · ")}.${created ? " Each has a follow-up for today." : ""}`;
}

/** New website enquiries on the Clients page, ready to become leads (owner only). */
export default function EnquiryLeads({ accountId, workspaceId, onAdded }: { accountId: string; workspaceId: string; onAdded: (message: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const guard = cloudAccountGuard(accountId); guard();
    const response = await fetch(`/api/cloud/workspaces/${workspaceId}/enquiries`, { cache: "no-store", headers: { "X-Makeborne-Account": accountId } });
    const value = await response.json().catch(() => ({}));
    guard();
    if (!response.ok) throw new Error(value?.error?.message ?? "Website enquiries couldn't load.");
    return (value.items ?? []) as Item[];
  }, [accountId, workspaceId]);
  useEffect(() => {
    let active = true;
    void load().then(next => { if (active) setItems(next); }).catch(() => undefined);
    return () => { active = false; };
  }, [load]);

  async function add(ids: string[], key: string) {
    setBusy(key); setError("");
    try {
      const results = await addEnquiriesToClients(accountId, workspaceId, ids);
      const failed = results.filter(item => item.status === "failed");
      if (failed.length) setError(failed[0].message ?? "Some enquiries couldn't be added.");
      setItems(await load());
      onAdded(resultMessage(results));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Those enquiries couldn't be added."); }
    finally { setBusy(null); }
  }
  async function dismiss(item: Item) {
    setBusy(item.id); setError("");
    try {
      const guard = cloudAccountGuard(accountId); guard();
      const response = await fetch(`/api/cloud/workspaces/${workspaceId}/artifacts/${item.artifact_id}/enquiries`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId }, body: JSON.stringify({ readId: item.id }) });
      guard();
      if (!response.ok) throw new Error("That enquiry couldn't be dismissed.");
      setItems(current => current.filter(entry => entry.id !== item.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That enquiry couldn't be dismissed."); }
    finally { setBusy(null); }
  }

  if (!items.length) return null;
  const fresh = items.filter(item => !item.clientId);
  return <section className="el" aria-label="New website enquiries">
    <header className="el-head">
      <span className="el-icon"><Inbox size={16} /></span>
      <div><h3>{items.length} new website {items.length === 1 ? "enquiry" : "enquiries"}</h3><p>People who wrote through your websites. Add them as leads to follow up.</p></div>
      {items.length > 1 && <button type="button" className="button primary small" disabled={Boolean(busy)} onClick={() => void add(items.map(item => item.id), "all")}>
        {busy === "all" ? <Loader2 size={14} className="el-spin" /> : <UserPlus size={14} />}Add all{fresh.length && fresh.length < items.length ? ` (${fresh.length} new)` : ""}</button>}
    </header>
    {error && <p className="el-error" role="alert">{error}</p>}
    <ul className="el-list">{items.map(item => <li key={item.id} className="el-item">
      <div className="el-who"><strong>{item.name}</strong><span>{item.email}</span></div>
      <p className="el-message">{item.message.length > 180 ? `${item.message.slice(0, 179)}…` : item.message}</p>
      <div className="el-meta"><Globe2 size={12} />{item.site} · {new Date(item.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}{item.clientId && <span className="el-known"><Check size={12} />Already a client</span>}</div>
      <div className="el-actions">
        <button type="button" className="button secondary small" disabled={Boolean(busy)} onClick={() => void add([item.id], item.id)}>
          {busy === item.id ? <Loader2 size={14} className="el-spin" /> : <UserPlus size={14} />}{item.clientId ? "Add note to client" : "Add to clients"}</button>
        <button type="button" className="el-dismiss" disabled={Boolean(busy)} onClick={() => void dismiss(item)} aria-label={`Dismiss enquiry from ${item.name}`}><X size={14} />Dismiss</button>
      </div>
    </li>)}</ul>
  </section>;
}
