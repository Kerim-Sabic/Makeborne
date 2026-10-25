"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import { AlertTriangle, ExternalLink, LoaderCircle, Pencil, Search, X } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";
import { DELIVERABLE_LABEL, INACCESSIBLE_LABEL, NOT_READ_LABEL, SECTIONS, SECTION_LABEL, type ResearchBrief, type StoredClaim } from "@/lib/research/contract";
import { ingestedMediaType, uploadSourceReference } from "@/lib/ingest/client";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import "@/app/client-research.css";

/**
 * "Understand this client": website + optional links, notes and documents →
 * a cited brief (facts with their sources and read dates, inferences labelled,
 * what could not be read and why) → the person keeps or corrects claims →
 * Save to client (suggestions for Client knowledge), Use in proposal, or
 * Create a plan. Nothing is sent to anyone and nothing is approved here.
 * Renders nothing while the feature is off.
 */
type Anchor = { artifactId: string; projectId: string; title: string; kind: string; currentVersion: number };
type Info = { enabled: true; canEdit: boolean; client: { name: string; company: string; website: string }; anchors: Anchor[]; documents: boolean; knowledge: boolean; search: { available: boolean; reason: string }; recent: { id: string; createdAt: string; method: string }[] };
type Row = { id: string; brief: ResearchBrief; method: string; replayed: boolean; createdAt: string };
export type CreationPrefill = { brief: string; title: string; kind: "website" | "book" | "presentation" };

class ResearchRequestError extends Error { constructor(readonly code: string, message: string) { super(message); } }
async function call<T>(accountId: string, path: string, init?: RequestInit): Promise<T> {
  const guard = cloudAccountGuard(accountId);
  const response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId, ...init?.headers } });
  const value = await response.json().catch(() => ({}));
  guard();
  if (!response.ok) throw new ResearchRequestError(value?.error?.code ?? "REQUEST_FAILED", value?.error?.message ?? "Something went wrong. Try again.");
  return value as T;
}
const day = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
const lines = (value: string) => value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean);

export default function ClientResearch({ accountId, workspaceId, clientId, onCreate }: { accountId: string; workspaceId: string; clientId: string; onCreate: (prefill: CreationPrefill) => void }) {
  const base = `/api/cloud/workspaces/${workspaceId}/clients/${clientId}/research`;
  const [info, setInfo] = useState<Info | null>(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [anchor, setAnchor] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [keys, setKeys] = useState<{ actionKey: string; stepKey: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [row, setRow] = useState<Row | null>(null);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [corrections, setCorrections] = useState<Map<string, string>>(new Map());
  const [chosen, setChosen] = useState(0);
  const [confirmPlan, setConfirmPlan] = useState("");
  const headingId = useId();

  useEffect(() => {
    let active = true;
    call<Info>(accountId, base).then(value => {
      if (!active) return;
      setInfo(value); setUrl(value.client.website); setAnchor(value.anchors[0]?.artifactId ?? "");
    }, cause => { if (active && (cause instanceof ResearchRequestError && (cause.code === "RESEARCH_DISABLED" || cause.code === "NOT_FOUND"))) setHidden(true); });
    return () => { active = false; };
  }, [accountId, base]);

  if (hidden || !info || !info.canEdit) return null;
  const selection = () => ({ include: [...include], corrections: [...corrections].map(([id, text]) => ({ id, text })) });
  const showBrief = (value: Row) => {
    setRow(value); setChosen(0); setConfirmPlan(""); setCorrections(new Map());
    setInclude(new Set([...SECTIONS.flatMap(section => value.brief.sections[section]), ...value.brief.competitors.flatMap(item => item.claims)].filter(claim => claim.basis === "fact").map(claim => claim.id)));
  };

  async function research(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    // The same keys are reused when retrying this exact request, so a retry never runs (or charges) twice.
    const current = keys ?? { actionKey: crypto.randomUUID(), stepKey: crypto.randomUUID() };
    setKeys(current); setBusy("research"); setError(""); setNotice("");
    try {
      const documents = [];
      const target = info!.anchors.find(item => item.artifactId === anchor);
      for (const file of files) {
        const mediaType = ingestedMediaType(file.name, file.type) ?? (file.type === "application/pdf" ? "application/pdf" : null);
        if (!mediaType || !target) throw new Error(`${file.name}: add Word, PowerPoint, Excel, CSV or PDF files, and choose a project to keep them with.`);
        const stored = await uploadSourceReference({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, owner: `account:${accountId}`, blob: file, previewType: null }, mediaType,
          { workspaceId, artifactId: target.artifactId, accountHeader: { "X-Makeborne-Account": accountId } },
          async (objectPath, blob, contentType) => { const { error: uploadError } = await createBrowserSupabase().storage.from("project-assets").upload(objectPath, blob, { contentType, upsert: false, cacheControl: "0" }); return { error: uploadError ? { message: uploadError.message } : null }; });
        documents.push({ name: file.name.slice(0, 255), mediaType, reference: stored.reference });
      }
      const result = await call<{ brief: Row }>(accountId, base, { method: "POST", body: JSON.stringify({ ...current, url: url.trim(), artifactId: anchor || null,
        competitorUrls: lines(competitors).slice(0, 3), documents, notes: notes.slice(0, 20_000) }) });
      showBrief(result.brief); setKeys(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The research couldn't finish.");
      if (cause instanceof ResearchRequestError && cause.code === "RESEARCH_KEY_REUSED") setKeys(null);
    } finally { setBusy(""); }
  }

  async function act(action: "save" | "proposal" | "plan", confirmNewPlan = false) {
    if (!row || busy) return;
    setBusy(action); setError(""); setNotice("");
    try {
      const result = await call<{ message?: string; handoff?: CreationPrefill; needsConfirmation?: boolean }>(accountId, `${base}/${row.id}`, { method: "POST",
        body: JSON.stringify({ action, selection: selection(), ...(action === "plan" ? { recommendation: chosen, confirmNewPlan } : {}) }) });
      if (result.needsConfirmation) { setConfirmPlan(result.message ?? "This client already has a plan."); return; }
      if (result.handoff) { setConfirmPlan(""); onCreate(result.handoff); return; }
      setNotice(result.message ?? "Saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That didn't work. Try again."); }
    finally { setBusy(""); }
  }

  if (!open) return <div className="cre-launch"><button type="button" className="button secondary" onClick={() => setOpen(true)}><Search size={16} aria-hidden /> Understand this client</button></div>;
  const brief = row?.brief;
  return <section className="cre" aria-labelledby={headingId}>
    <div className="cre-head">
      <h3 id={headingId}><Search size={17} aria-hidden /> Understand this client</h3>
      <button type="button" className="cre-close" aria-label="Close research" onClick={() => setOpen(false)}><X size={16} /></button>
    </div>
    <p className="cre-muted">Reads {info.client.company || info.client.name}&apos;s own website, the links and files you add, and facts already saved for them. Every fact shows where it came from. Nothing is sent to anyone or saved until you choose.</p>
    {!brief && <form className="cre-form" onSubmit={research}>
      <label>Their website<input type="text" inputMode="url" required value={url} onChange={event => { setUrl(event.target.value); setKeys(null); }} placeholder="https://example.com" /></label>
      {info.anchors.length > 0 && <label>Keep it with<select value={anchor} onChange={event => { setAnchor(event.target.value); setKeys(null); }}>
        {info.anchors.map(item => <option key={item.artifactId} value={item.artifactId}>{item.title}</option>)}<option value="">No project</option></select></label>}
      <label>Competitor links (optional, up to 3)<textarea rows={2} value={competitors} onChange={event => { setCompetitors(event.target.value); setKeys(null); }} placeholder="One per line" /></label>
      <label>Your notes (optional)<textarea rows={3} maxLength={20_000} value={notes} onChange={event => { setNotes(event.target.value); setKeys(null); }} placeholder="What you already know about them" /></label>
      {info.documents && anchor && <label>Documents (optional)<input type="file" multiple accept=".docx,.pptx,.xlsx,.csv,.pdf" onChange={event => { setFiles([...(event.target.files ?? [])].slice(0, 5)); setKeys(null); }} /></label>}
      <p className="cre-muted">{info.search.reason}</p>
      <div className="cre-row"><button type="submit" className="button primary" disabled={Boolean(busy)}>{busy === "research" ? <><LoaderCircle size={15} className="cre-spin" /> Reading their site…</> : "Research this client"}</button></div>
      {busy === "research" && <p className="cre-muted" role="status">Reading saved facts and your material first, then their website (a few pages at most). This can take up to half a minute.</p>}
    </form>}
    {error && <p className="cre-error" role="alert">{error}</p>}
    {notice && <p className="cre-muted" role="status">{notice}</p>}
    {brief && <div className="cre-brief">
      <p className="cre-muted">{brief.method === "assisted" ? "Written with AI assistance, then checked against the sources." : "Written directly from the sources (no AI writing)."} Read {day(brief.generatedAt)}{row?.replayed ? " · saved earlier" : ""}.</p>
      {brief.identity.status !== "consistent" && <div className="cre-warn" role="note"><AlertTriangle size={14} aria-hidden /><div>{brief.identity.notes.map(note => <p key={note}>{note}</p>)}</div></div>}
      {SECTIONS.map(section => brief.sections[section].length > 0 && <div key={section} className="cre-group"><h4>{SECTION_LABEL[section]}</h4>
        <ul>{brief.sections[section].map(claim => <Claim key={claim.id} claim={claim} brief={brief} kept={include.has(claim.id)} correction={corrections.get(claim.id)}
          onKeep={kept => setInclude(current => { const next = new Set(current); if (kept) next.add(claim.id); else next.delete(claim.id); return next; })}
          onCorrect={text => setCorrections(current => { const next = new Map(current); if (text) next.set(claim.id, text); else next.delete(claim.id); return next; })} />)}</ul></div>)}
      {brief.competitors.length > 0 && <div className="cre-group"><h4>Competitors (from your links)</h4><ul>{brief.competitors.map(item => <li key={item.source} className="cre-claim"><div className="cre-main">
        <strong>{item.name}</strong> <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="cre-link">{item.url} <ExternalLink size={11} aria-hidden /></a>
        {item.claims.map(claim => <p key={claim.id}>{claim.text}</p>)}</div></li>)}</ul></div>}
      {brief.questions.length > 0 && <div className="cre-group"><h4>Open questions</h4><ul className="cre-plain">{brief.questions.map(question => <li key={question}>{question}</li>)}</ul></div>}
      <div className="cre-group"><h4>Suggested first deliverable</h4><ul className="cre-plain">{brief.recommendations.map((item, index) => <li key={item.title}>
        <label className="cre-choice"><input type="radio" name={`${headingId}-rec`} checked={chosen === index} onChange={() => setChosen(index)} />
          <span><strong>{DELIVERABLE_LABEL[item.deliverable]}: {item.title}.</strong> {item.reason}</span></label></li>)}</ul></div>
      <details className="cre-details"><summary>What was read, and what wasn&apos;t</summary>
        <ul className="cre-plain">{brief.plan.map(step => <li key={step}>{step}</li>)}</ul>
        <h5>Sources</h5><ul className="cre-plain">{brief.sources.filter(source => source.kind !== "client_record").map(source => <li key={source.id}><span className="cre-chip">{source.id}</span> {source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="cre-link">{source.title}</a> : source.title}
          {source.fetchedAt && <span className="cre-muted"> · read {day(source.fetchedAt)}</span>}{source.flags.length > 0 && <span className="cre-muted"> · {source.flags.join(" · ")}</span>}</li>)}</ul>
        {(brief.inaccessible.length > 0 || brief.notRead.length > 0) && <><h5>Couldn&apos;t be read</h5><ul className="cre-plain">
          {brief.inaccessible.map(item => <li key={`${item.target}:${item.reason}`}>{item.target}: {INACCESSIBLE_LABEL[item.reason]}</li>)}
          {brief.notRead.map(item => <li key={`${item.url}:${item.reason}`}>{item.url}: not read ({NOT_READ_LABEL[item.reason].toLowerCase()})</li>)}</ul></>}
        {brief.removed.length > 0 && <><h5>Left out</h5><ul className="cre-plain">{brief.removed.map((item, index) => <li key={index}>{item.text}: {item.reason}</li>)}</ul></>}
        <p className="cre-muted">{brief.search.reason}</p>
      </details>
      {confirmPlan && <div className="cre-warn" role="alertdialog" aria-label="An existing plan"><AlertTriangle size={14} aria-hidden /><div><p>{confirmPlan}</p>
        <div className="cre-row"><button type="button" className="button primary small" disabled={Boolean(busy)} onClick={() => void act("plan", true)}>Start a new plan</button>
          <button type="button" className="button secondary small" onClick={() => setConfirmPlan("")}>Keep the existing plan</button></div></div></div>}
      <div className="cre-row cre-actions">
        {info.knowledge && <button type="button" className="button primary" disabled={Boolean(busy)} onClick={() => void act("save")}>{busy === "save" ? "Saving…" : "Save to client"}</button>}
        <button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => void act("proposal")}>Use in proposal</button>
        <button type="button" className="button secondary" disabled={Boolean(busy) || brief.recommendations[chosen]?.deliverable === "other"} onClick={() => void act("plan")}>Create a plan</button>
        <button type="button" className="button ghost" disabled={Boolean(busy)} onClick={() => { setRow(null); setNotice(""); }}>Research again</button>
      </div>
      <p className="cre-muted">Save to client adds suggestions to Client knowledge; nothing is used as fact until you approve it there.</p>
    </div>}
  </section>;
}

function Claim({ claim, brief, kept, correction, onKeep, onCorrect }: { claim: StoredClaim; brief: ResearchBrief; kept: boolean; correction?: string; onKeep: (kept: boolean) => void; onCorrect: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(correction ?? claim.text);
  return <li className={`cre-claim${kept ? "" : " is-dropped"}`}>
    <input type="checkbox" checked={kept} aria-label={`Keep: ${claim.text}`} onChange={event => onKeep(event.target.checked)} />
    <div className="cre-main">
      <div className="cre-title"><span className={`cre-chip is-${claim.basis}`}>{claim.basis === "fact" ? "Fact" : "Inference"}</span>
        {correction ? <span>{correction} <span className="cre-muted">(your correction)</span></span> : <span>{claim.text}</span>}</div>
      {claim.note && <p className="cre-muted">{claim.note}</p>}
      {claim.citations.length > 0 && <ul className="cre-cites">{claim.citations.map((citation, index) => {
        const source = brief.sources.find(item => item.id === citation.source);
        return <li key={index}><q>{citation.quote}</q> — {citation.url ? <a href={citation.url} target="_blank" rel="noopener noreferrer nofollow" className="cre-link">{citation.title}</a> : citation.title}
          {citation.fetchedAt && <span className="cre-muted"> · read {day(citation.fetchedAt)}</span>}{citation.stale && <span className="cre-muted"> · saved copy, couldn&apos;t be read again</span>}
          {source?.kind === "knowledge" && <span className="cre-muted"> · already saved for this client</span>}</li>;
      })}</ul>}
      {editing ? <form className="cre-row" onSubmit={event => { event.preventDefault(); onCorrect(value.trim() === claim.text ? "" : value.trim()); setEditing(false); }}>
        <input type="text" maxLength={400} value={value} onChange={event => setValue(event.target.value)} aria-label="Corrected wording" />
        <button type="submit" className="button secondary small">Use this</button><button type="button" className="button ghost small" onClick={() => setEditing(false)}>Cancel</button></form>
        : <button type="button" className="cre-edit" onClick={() => setEditing(true)}><Pencil size={12} aria-hidden /> Correct</button>}
    </div>
  </li>;
}
