"use client";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { AlertTriangle, BookCheck, Check, ChevronDown, LoaderCircle, Pencil, Plus, X } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";
import { KIND_LABEL, STATUS_LABEL, describeLocator } from "@/lib/knowledge/types";
import type { FactView, KnowledgeList, KnowledgeProvenance } from "@/lib/knowledge/views";
import "@/app/client-knowledge.css";

class KnowledgeRequestError extends Error { constructor(readonly code: string, message: string) { super(message); } }
async function knowledgeRequest<T>(accountId: string, path: string, init?: RequestInit): Promise<T> {
  const guard = cloudAccountGuard(accountId);
  const response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId, ...init?.headers } });
  const value = await response.json().catch(() => ({}));
  guard();
  if (!response.ok) throw new KnowledgeRequestError(value?.error?.code ?? "REQUEST_FAILED", value?.error?.message ?? "Something went wrong. Try again.");
  return value as T;
}
const date = (value: string | null) => value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
const validity = (fact: FactView) => fact.validFrom || fact.validTo ? `${fact.validFrom ? `from ${date(fact.validFrom)}` : ""}${fact.validFrom && fact.validTo ? " " : ""}${fact.validTo ? `until ${date(fact.validTo)}` : ""}` : "";
const EVIDENCE_STATE: Record<string, string> = { stale: "This source changed since it was read", revoked: "This source was withdrawn" };

/**
 * "Client knowledge" on a client's page: suggested facts to review (approve,
 * correct or reject), contradictions highlighted, approved facts, and for each
 * one where it came from. Renders nothing while the feature is off.
 */
export default function ClientKnowledge({ accountId, workspaceId, clientId, clientName }: { accountId: string; workspaceId: string; clientId: string; clientName: string }) {
  const [data, setData] = useState<KnowledgeList | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const base = `/api/cloud/workspaces/${workspaceId}/clients/${clientId}/knowledge`;
  const headingId = useId();

  const load = useCallback(async () => {
    try { setData(await knowledgeRequest<KnowledgeList>(accountId, base)); setError(""); }
    catch (cause) {
      if (cause instanceof KnowledgeRequestError && cause.code === "KNOWLEDGE_DISABLED") setHidden(true);
      else setError(cause instanceof Error ? cause.message : "Client knowledge couldn't load.");
    }
  }, [accountId, base]);
  useEffect(() => {
    let active = true;
    knowledgeRequest<KnowledgeList>(accountId, base).then(value => { if (active) setData(value); }, cause => {
      if (!active) return;
      if (cause instanceof KnowledgeRequestError && cause.code === "KNOWLEDGE_DISABLED") setHidden(true);
      else setError(cause instanceof Error ? cause.message : "Client knowledge couldn't load.");
    });
    return () => { active = false; };
  }, [accountId, base]);

  async function act(fact: FactView, body: Record<string, unknown>, done: string) {
    setBusy(fact.id); setError(""); setNotice("");
    try { await knowledgeRequest(accountId, `${base}/${fact.id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: fact.revision, ...body }) }); setNotice(done); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "That change couldn't be saved."); if (cause instanceof KnowledgeRequestError && cause.code === "KNOWLEDGE_CHANGED") await load(); }
    finally { setBusy(""); }
  }

  if (hidden) return null;
  if (!data) return <section className="ckn" aria-busy={!error}><Header id={headingId} />{error ? <p className="ckn-error" role="alert">{error}</p> : <p className="ckn-muted"><LoaderCircle size={14} className="ckn-spin" /> Loading…</p>}</section>;
  const suggested = data.facts.filter(fact => fact.status === "proposed");
  const approved = data.facts.filter(fact => fact.status === "approved");
  const past = data.facts.filter(fact => fact.status === "rejected" || fact.status === "superseded");
  const byId = new Map(data.facts.map(fact => [fact.id, fact]));
  const row = (fact: FactView) => <FactRow key={fact.id} fact={fact} byId={byId} canEdit={data.canEdit} busy={busy === fact.id} accountId={accountId} base={base}
    onApprove={() => act(fact, { action: "approve" }, `Approved: ${fact.label || fact.key}.`)}
    onReject={note => act(fact, { action: "reject", ...(note ? { note } : {}) }, `Rejected: ${fact.label || fact.key}.`)}
    onCorrect={(valueText, note, approve) => act(fact, { action: "correct", patch: { valueText }, note, approve }, approve ? "Corrected and approved." : "Correction saved for review.")} />;

  return <section className="ckn" aria-labelledby={headingId}>
    <Header id={headingId} />
    {error && <p className="ckn-error" role="alert">{error}</p>}
    {notice && <p className="ckn-muted" role="status">{notice}</p>}
    <div className="ckn-group">
      <h4>To review <span className="ckn-count">{suggested.length}</span></h4>
      {!suggested.length && <p className="ckn-muted">Nothing waiting. Facts read from {clientName}&apos;s files and pages appear here before anything uses them.</p>}
      <ul>{suggested.map(row)}</ul>
    </div>
    <div className="ckn-group">
      <h4>Approved <span className="ckn-count">{approved.length}</span></h4>
      {!approved.length && <p className="ckn-muted">No approved facts yet. Websites, books and decks only state prices, hours and contact details that are approved here or in the brief.</p>}
      <ul>{approved.map(row)}</ul>
    </div>
    {data.canEdit && (adding ? <AddFact accountId={accountId} base={base} onDone={async message => { setAdding(false); setNotice(message); await load(); }} onCancel={() => setAdding(false)} />
      : <button type="button" className="button secondary small ckn-add" onClick={() => setAdding(true)}><Plus size={14} /> Add a fact or decision</button>)}
    {past.length > 0 && <div className="ckn-group">
      <button type="button" className="ckn-toggle" aria-expanded={showPast} onClick={() => setShowPast(value => !value)}><ChevronDown size={14} aria-hidden /> Rejected and replaced ({past.length})</button>
      {showPast && <ul>{past.map(row)}</ul>}
    </div>}
    {data.truncated && <p className="ckn-muted">Showing the 500 most recent facts.</p>}
  </section>;
}

function Header({ id }: { id: string }) {
  return <div className="ckn-head"><h3 id={id}><BookCheck size={17} aria-hidden /> Client knowledge</h3>
    <p className="ckn-muted">Facts Makeborne may use when it writes for this client. Suggestions are never used as fact until someone approves them.</p></div>;
}

function FactRow({ fact, byId, canEdit, busy, accountId, base, onApprove, onReject, onCorrect }: {
  fact: FactView; byId: Map<string, FactView>; canEdit: boolean; busy: boolean; accountId: string; base: string;
  onApprove: () => void; onReject: (note: string) => void; onCorrect: (valueText: string, note: string, approve: boolean) => void;
}) {
  const [mode, setMode] = useState<"" | "correct" | "reject">("");
  const [value, setValue] = useState(fact.valueText);
  const [note, setNote] = useState("");
  const [approveToo, setApproveToo] = useState(true);
  const [origin, setOrigin] = useState<KnowledgeProvenance | null>(null);
  const [originOpen, setOriginOpen] = useState(false);
  const [originError, setOriginError] = useState("");
  const panelId = useId();
  const conflicts = fact.conflictsWith.map(id => byId.get(id)).filter((item): item is FactView => !!item);
  const replaces = fact.supersedesId ? byId.get(fact.supersedesId) : undefined;
  const current = fact.status === "proposed" || fact.status === "approved";

  async function toggleOrigin() {
    const next = !originOpen;
    setOriginOpen(next);
    if (next && !origin) {
      try { setOrigin(await knowledgeRequest<KnowledgeProvenance>(accountId, `${base}/${fact.id}`)); setOriginError(""); }
      catch (cause) { setOriginError(cause instanceof Error ? cause.message : "The sources couldn't load."); }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "correct") onCorrect(value.trim(), note.trim(), approveToo); else onReject(note.trim());
    setMode("");
  }

  return <li className={`ckn-fact${conflicts.length && current ? " has-conflict" : ""}`}>
    <div className="ckn-main">
      <div className="ckn-title"><strong>{fact.label || fact.key}</strong>
        <span className={`ckn-chip is-${fact.kind}`}>{KIND_LABEL[fact.kind]}</span>
        {fact.status !== "proposed" && fact.status !== "approved" && <span className="ckn-chip">{STATUS_LABEL[fact.status]}</span>}
        {fact.suggestedBy === "task" && fact.status === "proposed" && <span className="ckn-chip">Suggested from a file</span>}</div>
      <div className={`ckn-value${fact.redacted ? " is-removed" : ""}`}>{fact.valueText}{validity(fact) && <span className="ckn-muted"> · {validity(fact)}</span>}</div>
      {fact.evidenceState !== "live" && current && <p className="ckn-warn"><AlertTriangle size={13} aria-hidden /> {EVIDENCE_STATE[fact.evidenceState]}. It isn&apos;t used until you review it.</p>}
      {replaces && fact.status === "proposed" && <p className="ckn-warn"><AlertTriangle size={13} aria-hidden /> Would replace the approved value “{replaces.valueText}”.</p>}
      {conflicts.length > 0 && current && !replaces && <p className="ckn-warn"><AlertTriangle size={13} aria-hidden /> Disagrees with {conflicts.map(item => `“${item.valueText}” (${STATUS_LABEL[item.status].toLowerCase()})`).join(", ")}. Nothing is chosen until you decide.</p>}
      {fact.uncertainty && !conflicts.length && <p className="ckn-muted">{fact.uncertainty}</p>}
      <button type="button" className="ckn-origin" aria-expanded={originOpen} aria-controls={panelId} onClick={() => void toggleOrigin()}>Where this came from</button>
      {originOpen && <div id={panelId} className="ckn-origin-panel" role="region" aria-label={`Sources for ${fact.label || fact.key}`}>
        {originError && <p className="ckn-error" role="alert">{originError}</p>}
        {!origin && !originError && <p className="ckn-muted"><LoaderCircle size={13} className="ckn-spin" /> Loading…</p>}
        {origin && <>
          <ul>{origin.fact.evidence.map(item => <li key={item.id} className={item.state !== "live" ? "is-inactive" : undefined}>
            <div><strong>{item.title}</strong>{describeLocator(item.locator) && <span className="ckn-muted"> · {describeLocator(item.locator)}</span>}
              {item.state !== "live" && <span className="ckn-chip">{item.state === "stale" ? "Changed since" : "Withdrawn"}</span>}
              {!item.supports && <span className="ckn-chip">Earlier value</span>}</div>
            {item.quote ? <blockquote>{item.quote}</blockquote> : item.state === "revoked" ? <p className="ckn-muted">The quoted text was removed with the source.</p> : null}
            <p className="ckn-muted">{item.url && <>{item.url} · </>}{item.fetchedAt ? `read ${date(item.fetchedAt)}` : `added ${date(item.createdAt)}`}{item.version && <> · version {item.version}</>}</p>
          </li>)}</ul>
          {origin.revisions.length > 1 && <details className="ckn-history"><summary>History ({origin.revisions.length})</summary>
            <ol>{origin.revisions.map(item => <li key={item.revision}>{STATUS_LABEL[item.status as keyof typeof STATUS_LABEL] ?? item.status} · {item.removed ? "content removed" : item.valueText}{item.byYou ? " · by you" : ""} · {date(item.createdAt)}</li>)}</ol></details>}
        </>}
      </div>}
      {mode && <form className="ckn-form" onSubmit={submit}>
        {mode === "correct" && <label>Correct value<input value={value} maxLength={2000} required onChange={event => setValue(event.target.value)} /></label>}
        <label>{mode === "correct" ? "Why (saved as your statement)" : "Reason (optional)"}<input value={note} maxLength={mode === "correct" ? 600 : 1000} required={mode === "correct"} onChange={event => setNote(event.target.value)} /></label>
        {mode === "correct" && <label className="ckn-check"><input type="checkbox" checked={approveToo} onChange={event => setApproveToo(event.target.checked)} /> Approve the corrected value</label>}
        <div className="ckn-actions"><button type="submit" className="button primary small" disabled={busy}>{mode === "correct" ? "Save correction" : "Reject"}</button>
          <button type="button" className="button ghost small" onClick={() => setMode("")}>Cancel</button></div>
      </form>}
    </div>
    {canEdit && current && !fact.redacted && !mode && <div className="ckn-actions">
      {fact.status === "proposed" && <button type="button" className="button secondary small" disabled={busy || fact.evidenceState !== "live"} onClick={onApprove}>{busy ? <LoaderCircle size={14} className="ckn-spin" /> : <Check size={14} />} Approve</button>}
      <button type="button" className="button ghost small" disabled={busy} onClick={() => { setValue(fact.valueText); setNote(""); setMode("correct"); }}><Pencil size={14} /> Correct</button>
      <button type="button" className="button ghost small" disabled={busy} onClick={() => { setNote(""); setMode("reject"); }}><X size={14} /> Reject</button>
    </div>}
  </li>;
}

function AddFact({ accountId, base, onDone, onCancel }: { accountId: string; base: string; onDone: (message: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<"user_decision" | "brand_preference">("user_decision");
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const prefix = kind === "brand_preference" ? "brand." : "";
      await knowledgeRequest(accountId, base, { method: "POST", body: JSON.stringify({ kind, key: `${prefix}${label}`, label: label.trim(), valueText: value.trim(), evidence: [{ kind: "user", quote: statement.trim() }] }) });
      onDone("Added for review. Approve it to let Makeborne use it.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The fact couldn't be added."); }
    finally { setBusy(false); }
  }
  return <form className="ckn-form ckn-new" onSubmit={submit} aria-label="Add a fact or decision">
    <div className="ckn-row">
      <label>Type<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="user_decision">Decision or fact from the client</option><option value="brand_preference">Brand rule</option></select></label>
      <label>Name<input value={label} required maxLength={100} placeholder="e.g. Delivery area" onChange={event => setLabel(event.target.value)} /></label>
      <label>Value<input value={value} required maxLength={2000} placeholder="e.g. Within 10 km of the shop" onChange={event => setValue(event.target.value)} /></label>
    </div>
    <label>Who said this, or why<input value={statement} required maxLength={500} placeholder="e.g. Agreed with Ana on the call of 20 October" onChange={event => setStatement(event.target.value)} /></label>
    {error && <p className="ckn-error" role="alert">{error}</p>}
    <div className="ckn-actions"><button type="submit" className="button primary small" disabled={busy}>{busy ? <LoaderCircle size={14} className="ckn-spin" /> : <Plus size={14} />} Add</button>
      <button type="button" className="button ghost small" onClick={onCancel}>Cancel</button></div>
  </form>;
}
