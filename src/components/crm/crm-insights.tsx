"use client";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { AlertTriangle, Ban, Copy, Globe2, LoaderCircle, Search, UserPlus, X } from "lucide-react";
import type { SiteCheck } from "@/lib/crm-research/site-check";
import type { Fit } from "@/lib/crm-research/score";
import type { DuplicateReason } from "@/lib/crm-research/match";
import { crmCall, CrmRequestError, localDay } from "./crm-api";
import WebsiteCheckCard from "./website-check-card";
import "@/app/crm-research.css";

/**
 * CRM research on the client list: what needs attention, a website check for a
 * business you're considering (and adding it as a client with that check),
 * suggested duplicates, and your do-not-contact list. Renders nothing while
 * the feature is off. Nothing is sent to anyone from here.
 */
type Attention = { id: string; name: string; company: string; stage: string; nextFollowUp: string | null; nextStep: string; items: { kind: string; text: string }[] };
type Pair = { a: string; b: string; aName: string; bName: string; reasons: DuplicateReason[]; strength: "strong" | "possible" };
type Entry = { id: string; kind: "email" | "domain"; value: string; reason: string };
type Overview = { enabled: true; canEdit: boolean; attention: Attention[]; duplicates: Pair[]; suppressions: Entry[]; suppressedClients: { id: string; name: string }[]; truncated: boolean };
type Match = { id: string; name: string; reasons: DuplicateReason[]; strength: string };
type CheckResult = { checkId: string; check: SiteCheck; fit: Fit; matches: Match[]; suppressed: Entry | null };
type Tab = "attention" | "check" | "duplicates" | "contact";

export default function CrmInsights({ accountId, workspaceId, refreshKey = 0, onOpenClient, onAdded }: { accountId: string; workspaceId: string; refreshKey?: number; onOpenClient: (id: string) => void; onAdded: (message: string) => void }) {
  const base = `/api/cloud/workspaces/${workspaceId}/crm`;
  const [data, setData] = useState<Overview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [tab, setTab] = useState<Tab>("attention");
  const [error, setError] = useState("");
  const settle = useCallback((result: Promise<Overview>, live: () => boolean = () => true) => result.then(value => { if (live()) { setData(value); setError(""); } }, cause => {
    if (!live()) return;
    if (cause instanceof CrmRequestError && cause.status === 404 && cause.code === "CRM_RESEARCH_DISABLED") setHidden(true); else setError(cause instanceof Error ? cause.message : "Couldn't load.");
  }), []);
  const load = useCallback(() => settle(crmCall<Overview>(accountId, `${base}?day=${localDay()}`)), [accountId, base, settle]);
  useEffect(() => {
    let live = true;
    void settle(crmCall<Overview>(accountId, `${base}?day=${localDay()}`), () => live);
    return () => { live = false; };
  }, [accountId, base, settle, refreshKey]);
  if (hidden || (!data && !error)) return null;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "attention", label: "Needs attention", count: data?.attention.length }, { id: "check", label: "Check a business" },
    { id: "duplicates", label: "Possible duplicates", count: data?.duplicates.length }, { id: "contact", label: "Do not contact", count: data?.suppressions.length },
  ];
  return <section className="crm-panel" aria-label="Client research" data-testid="crm-insights">
    <nav className="crm-tabs" aria-label="Client research views">{tabs.map(item => <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}{item.count ? <small>{item.count}</small> : null}</button>)}</nav>
    {error && <p className="crm-error" role="alert">{error}</p>}
    {data && tab === "attention" && <AttentionList items={data.attention} onOpen={onOpenClient} />}
    {data && tab === "check" && (data.canEdit ? <ProspectCheck accountId={accountId} base={base} onOpenClient={onOpenClient} onAdded={message => { onAdded(message); void load(); }} /> : <p className="crm-muted">Only owners and editors can check websites and add clients.</p>)}
    {data && tab === "duplicates" && <Duplicates accountId={accountId} base={base} pairs={data.duplicates} canEdit={data.canEdit} onOpen={onOpenClient} onChanged={load} />}
    {data && tab === "contact" && <DoNotContact accountId={accountId} base={base} entries={data.suppressions} clients={data.suppressedClients} canEdit={data.canEdit} onOpen={onOpenClient} onChanged={load} />}
    {data?.truncated && <p className="crm-muted">Only your first 2,000 clients are included here.</p>}
  </section>;
}

function AttentionList({ items, onOpen }: { items: Attention[]; onOpen: (id: string) => void }) {
  if (!items.length) return <p className="crm-muted crm-empty">Every open deal has a follow-up date and recent activity.</p>;
  return <ul className="crm-attention">{items.map(item => <li key={item.id}>
    <button type="button" onClick={() => onOpen(item.id)}><strong>{item.company || item.name}</strong><span className="crm-stage">{item.stage}</span>
      <span className="crm-reasons">{item.items.map(reason => <em key={reason.kind} className={`is-${reason.kind}`}>{reason.text}</em>)}</span>
      {item.nextStep && <small>Next: {item.nextStep}</small>}</button></li>)}</ul>;
}

function ProspectCheck({ accountId, base, onOpenClient, onAdded }: { accountId: string; base: string; onOpenClient: (id: string) => void; onAdded: (message: string) => void }) {
  const id = useId();
  const [form, setForm] = useState({ url: "", name: "", email: "", phone: "", category: "" });
  const [busy, setBusy] = useState<"check" | "add" | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<Match[] | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  async function run(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy("check"); setError(""); setResult(null); setDuplicates(null);
    try { setResult(await crmCall<CheckResult>(accountId, base, { action: "check", ...form })); setRequestKey(crypto.randomUUID()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The check couldn't finish."); }
    finally { setBusy(null); }
  }
  async function add(allowDuplicate: boolean) {
    if (!result || busy) return;
    setBusy("add"); setError("");
    const name = form.name.trim() || result.check.host || form.url.trim();
    const email = form.email.trim() || result.check.contacts.find(item => item.kind === "email")?.value || "";
    const phone = form.phone.trim() || result.check.contacts.find(item => item.kind === "phone")?.value || "";
    try {
      const out = await crmCall<{ clientId: string; knowledge: { proposed: number; available: boolean } }>(accountId, base, { action: "add", requestKey, checkId: result.checkId, allowDuplicate, today: localDay(),
        prospect: { name: name.slice(0, 120), website: result.check.finalUrl ?? form.url.trim(), email, phone: phone.slice(0, 40), category: form.category.trim(), source: "Website" } });
      onAdded(`Added ${name} to your clients with its website check${out.knowledge.proposed ? `; ${out.knowledge.proposed} facts are waiting for your review in Contact details` : ""}.`);
      setResult(null); setForm({ url: "", name: "", email: "", phone: "", category: "" }); setDuplicates(null);
      onOpenClient(out.clientId);
    } catch (cause) {
      if (cause instanceof CrmRequestError && cause.code === "POSSIBLE_DUPLICATE") setDuplicates((cause.details?.matches as Match[]) ?? []);
      else setError(cause instanceof Error ? cause.message : "Couldn't add this client.");
    } finally { setBusy(null); }
  }
  const field = (key: keyof typeof form, label: string, placeholder: string, extra: Record<string, unknown> = {}) =>
    <label>{label}<input type="text" value={form[key]} placeholder={placeholder} maxLength={key === "url" ? 500 : 120} disabled={Boolean(busy)} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} {...extra} /></label>;
  return <div className="crm-prospect">
    <form className="crm-form" onSubmit={run} aria-describedby={`${id}-help`}>
      <p id={`${id}-help`} className="crm-muted">Reads the business&apos;s public website (never social profiles or pages behind a sign-in, and never pages the site asks robots to skip) and scores how much a better website would help them. Every finding shows where and when it was seen.</p>
      <div className="crm-grid">
        {field("url", "Website", "lana-dental.ba", { "aria-label": "Business website" })}
        {field("name", "Business name (optional)", "Dental Studio Lana")}
        {field("email", "Email (optional)", "info@…")}
        {field("phone", "Phone (optional)", "+387 …")}
        {field("category", "Category (optional)", "Dentist")}
      </div>
      <div className="crm-row"><button type="submit" className="button primary" disabled={Boolean(busy)}>{busy === "check" ? <LoaderCircle size={15} className="crm-spin" aria-hidden /> : <Search size={15} aria-hidden />}{busy === "check" ? "Checking their website…" : "Check website"}</button>
        <span className="crm-muted">Takes up to 30 seconds. No AI, no credits.</span></div>
    </form>
    {error && <p className="crm-error" role="alert">{error}</p>}
    {result && <div className="crm-result" aria-live="polite">
      {result.suppressed && <p className="crm-warn"><Ban size={15} aria-hidden /> On your do-not-contact list ({result.suppressed.value}). It can&apos;t be added as a client.</p>}
      {result.matches.length > 0 && <div className="crm-warn"><AlertTriangle size={15} aria-hidden /><div><p>Looks like a client you already have:</p>
        <ul>{result.matches.map(item => <li key={item.id}><button type="button" className="crm-link" onClick={() => onOpenClient(item.id)}>{item.name}</button> ({item.reasons.map(reason => reason.text).join(", ")})</li>)}</ul></div></div>}
      <WebsiteCheckCard check={result.check} />
      <div className="crm-fit" data-testid="crm-fit"><strong>Fit {result.fit.score}/100 · {result.fit.tier}</strong>
        <ul>{result.fit.reasons.map(item => <li key={item.text}><span>{item.points > 0 ? `+${item.points}` : item.points}</span>{item.text}</li>)}</ul></div>
      {duplicates && <div className="crm-warn" role="alert"><AlertTriangle size={15} aria-hidden /><div><p>This looks like a client you already have. Open it, or add a new client anyway.</p>
        <ul>{duplicates.map(item => <li key={item.id}><button type="button" className="crm-link" onClick={() => onOpenClient(item.id)}>{item.name}</button> ({item.reasons.map(reason => reason.text).join(", ")})</li>)}</ul>
        <button type="button" className="button secondary small" disabled={Boolean(busy)} onClick={() => void add(true)}>Add anyway</button></div></div>}
      {!result.suppressed && <div className="crm-row"><button type="button" className="button primary" disabled={Boolean(busy)} onClick={() => void add(false)}>{busy === "add" ? <LoaderCircle size={15} className="crm-spin" aria-hidden /> : <UserPlus size={15} aria-hidden />}Add as client with this check</button>
        <span className="crm-muted">Contact details and findings become suggested facts for you to approve. Nothing is sent.</span></div>}
    </div>}
  </div>;
}

function Duplicates({ accountId, base, pairs, canEdit, onOpen, onChanged }: { accountId: string; base: string; pairs: Pair[]; canEdit: boolean; onOpen: (id: string) => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!pairs.length) return <p className="crm-muted crm-empty">No likely duplicates. Clients are compared by website, email, phone number and name.</p>;
  async function dismiss(pair: Pair) {
    setBusy(`${pair.a}|${pair.b}`); setError("");
    try { await crmCall(accountId, base, { action: "dismiss_duplicate", a: pair.a, b: pair.b }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save."); } finally { setBusy(""); }
  }
  return <>{error && <p className="crm-error" role="alert">{error}</p>}<p className="crm-muted">Suggestions only: nothing is merged. Open both to compare, then keep one.</p>
    <ul className="crm-duplicates">{pairs.map(pair => <li key={`${pair.a}|${pair.b}`} className={`is-${pair.strength}`}>
      <div><button type="button" className="crm-link" onClick={() => onOpen(pair.a)}>{pair.aName}</button> and <button type="button" className="crm-link" onClick={() => onOpen(pair.b)}>{pair.bName}</button>
        <small>{pair.reasons.map(reason => reason.text).join(" · ")}</small></div>
      {canEdit && <button type="button" className="button ghost small" disabled={Boolean(busy)} onClick={() => void dismiss(pair)}><X size={13} aria-hidden /> Not the same</button>}</li>)}</ul></>;
}

function DoNotContact({ accountId, base, entries, clients, canEdit, onOpen, onChanged }: { accountId: string; base: string; entries: Entry[]; clients: { id: string; name: string }[]; canEdit: boolean; onOpen: (id: string) => void; onChanged: () => Promise<void> }) {
  const [kind, setKind] = useState<"email" | "domain">("email");
  const [value, setValue] = useState(""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function act(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try { await crmCall(accountId, base, body); await onChanged(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save."); return false; } finally { setBusy(false); }
  }
  return <div className="crm-dnc">
    <p className="crm-muted">People and businesses who asked not to be contacted. They can&apos;t be added as clients and no email draft is written for them. Keep them here rather than deleting them, so they aren&apos;t contacted again.</p>
    {canEdit && <form className="crm-row" onSubmit={async event => { event.preventDefault(); if (await act({ action: "suppress", kind, value, reason })) { setValue(""); setReason(""); } }}>
      <select aria-label="Type" value={kind} onChange={event => setKind(event.target.value as "email" | "domain")} disabled={busy}><option value="email">Email address</option><option value="domain">Whole website or domain</option></select>
      <input type="text" aria-label={kind === "email" ? "Email address" : "Website or domain"} placeholder={kind === "email" ? "owner@example.com" : "example.com"} value={value} maxLength={320} onChange={event => setValue(event.target.value)} disabled={busy} />
      <input type="text" aria-label="Reason (optional)" placeholder="Reason (optional)" value={reason} maxLength={200} onChange={event => setReason(event.target.value)} disabled={busy} />
      <button type="submit" className="button secondary small" disabled={busy || value.trim().length < 3}><Ban size={13} aria-hidden /> Add</button></form>}
    {error && <p className="crm-error" role="alert">{error}</p>}
    {clients.length > 0 && <p className="crm-warn"><AlertTriangle size={15} aria-hidden /> Already in your clients: {clients.map((item, index) => <span key={item.id}>{index ? ", " : ""}<button type="button" className="crm-link" onClick={() => onOpen(item.id)}>{item.name}</button></span>)}</p>}
    {entries.length ? <ul className="crm-dnc-list">{entries.map(entry => <li key={entry.id}><Globe2 size={13} aria-hidden /><span>{entry.value}</span>{entry.reason && <small>{entry.reason}</small>}
      {canEdit && <button type="button" className="button ghost small" disabled={busy} aria-label={`Remove ${entry.value} from the do-not-contact list`} onClick={() => { if (window.confirm(`Remove ${entry.value}? They could be contacted again.`)) void act({ action: "unsuppress", id: entry.id }); }}><X size={13} aria-hidden /></button>}</li>)}</ul>
      : <p className="crm-muted crm-empty">Nobody on the list yet.</p>}
    <p className="crm-muted"><Copy size={12} aria-hidden /> Tip: every first email drafted here ends with a line telling them how to opt out.</p>
  </div>;
}
