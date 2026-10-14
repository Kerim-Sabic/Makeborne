"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, AtSign, Check, Globe2, List, Loader2, Mail, MapPin, Phone, Search, Sparkles, UserPlus, Users, X } from "lucide-react";
import Modal from "../mail/modal";
import { api, CloudError } from "../cloud-api";
import { leadApi } from "./lead-api";
import { emptyOutreach } from "@/lib/client-outreach";
import { localCalendarDay } from "@/lib/client-followups";
import { normalizeTag } from "@/lib/leads";
import { CATEGORIES } from "@/lib/leads/osm";
import { AUDIENCES, LEAD_FINDER, leadFinderMaxCredits, leadFinderTypicalCredits, PLATFORMS, type FoundLead, type LeadFindEvent } from "@/lib/leads/finder-types";
import type { CloudClient } from "@/lib/cloud/contracts";

type Mode = "local" | "creators" | "list";
type Platform = typeof PLATFORMS[number];
type Audience = keyof typeof AUDIENCES;
type Run = { stage: "search" | "read" | "rank" | "done"; status: string; done: number; total: number };
type Result = { leads: FoundLead[]; skipped: number; duplicates: number; attribution: string; place: string; category: string; charged: number | null };
const OFFER_STORE = "makeborne.lead-finder.offer";
const tier = (score: number) => score >= 70 ? "hot" : score >= 45 ? "warm" : "cold";

/** Find new leads (local businesses, creators by niche, or a pasted list), verify and rank them, then add the chosen ones to the CRM. */
export default function LeadFinder({ accountId, workspaceId, onClose, onAdded }: { accountId: string; workspaceId: string; onClose: () => void; onAdded: (count: number, tag: string) => void }) {
  const [mode, setMode] = useState<Mode>("local");
  const [niche, setNiche] = useState(""), [place, setPlace] = useState(""), [list, setList] = useState("");
  const [offer, setOffer] = useState(() => { try { return localStorage.getItem(OFFER_STORE) ?? ""; } catch { return ""; } });
  const [count, setCount] = useState<10 | 25 | 40>(25);
  const [platform, setPlatform] = useState<Platform>("Instagram"), [audience, setAudience] = useState<Audience>("any");
  const [run, setRun] = useState<Run | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tag, setTag] = useState("");
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const items = useMemo(() => list.split(/[\n,]+/).map(item => item.trim()).filter(Boolean), [list]);
  // Creators: 10 or 25 per search (each one is a web search and a profile read).
  const creatorCount = count === 10 ? 10 : 25;
  const size = mode === "list" ? Math.min(items.length || 1, LEAD_FINDER.maxListItems) : mode === "creators" ? creatorCount : count;
  const ready = mode === "local" ? niche.trim().length >= 3 && place.trim().length >= 2 : mode === "creators" ? niche.trim().length >= 3 : items.length > 0 && items.length <= LEAD_FINDER.maxListItems;
  const busy = Boolean(run && run.stage !== "done") || Boolean(adding);

  async function find() {
    if (!ready || busy) return;
    try { localStorage.setItem(OFFER_STORE, offer); } catch { /* storage unavailable */ }
    setError(""); setResult(null); setPicked(new Set());
    setRun({ stage: "search", status: mode === "local" ? `Searching for ${niche.trim()} in ${place.trim()}…` : mode === "creators" ? `Searching ${platform} for ${niche.trim()} creators…` : "Reading your list…", done: 0, total: 0 });
    controller.current = new AbortController();
    const body = mode === "local" ? { mode, niche: niche.trim(), place: place.trim(), offer: offer.trim(), count }
      : mode === "creators" ? { mode, niche: niche.trim(), platform, place: place.trim(), audience, offer: offer.trim(), count: creatorCount }
      : { mode, items: items.slice(0, LEAD_FINDER.maxListItems), offer: offer.trim(), count: 40 };
    let found: Result | null = null;
    try {
      const response = await fetch(`/api/cloud/workspaces/${workspaceId}/leads/find`, { method: "POST", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId }, body: JSON.stringify(body), signal: controller.current.signal });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(failure?.error?.message ?? "The search couldn't start. Nothing was charged.");
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
          if (!chunk.startsWith("data: ")) continue;
          const event = JSON.parse(chunk.slice(6)) as LeadFindEvent;
          if (event.type === "status") setRun(current => current && { ...current, status: event.message });
          else if (event.type === "progress") setRun(current => current && { ...current, stage: event.stage, done: event.done, total: event.total });
          else if (event.type === "results") {
            found = { ...event, charged: null };
            setResult(found);
            setTag(normalizeTag(event.category === "Your list" ? "my list" : event.category.toLowerCase()));
            setPicked(new Set(event.leads.filter(lead => lead.score >= 45 && (lead.email || lead.profileUrl)).map(lead => lead.id)));
          } else if (event.type === "done") setResult(current => current && { ...current, charged: event.charged });
          else if (event.type === "error") throw new Error(event.message);
        }
      }
      setRun(current => current && { ...current, stage: "done" });
      if (!found) throw new Error("The search ended early. Nothing was charged; please try again.");
    } catch (cause) {
      setRun(null);
      if (!controller.current?.signal.aborted) setError(cause instanceof Error ? cause.message : "The search couldn't finish.");
    }
  }

  async function addPicked() {
    if (!result || !picked.size || adding) return;
    const chosen = result.leads.filter(lead => picked.has(lead.id));
    const label = normalizeTag(tag);
    setAdding({ done: 0, total: chosen.length }); setError("");
    let added = 0, failed = 0;
    for (const lead of chosen) {
      try {
        const notes = [`Found with Lead finder (${lead.source}) on ${new Date().toISOString().slice(0, 10)}.`, lead.address && `Address: ${lead.address}`, lead.phone && `Phone: ${lead.phone}`,
          lead.email && lead.emailSource && `Email published on their ${lead.emailSource === "listing" ? "map listing" : lead.emailSource === "profile" ? "profile" : "website"}.`,
          lead.ai?.why && `Why: ${lead.ai.why}`, lead.ai?.angle && `Opening idea: ${lead.ai.angle}`].filter(Boolean).join("\n");
        const created = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${workspaceId}/clients`, { name: lead.name.slice(0, 120), company: "", email: lead.email, website: lead.website, notes });
        const id = created.client.id;
        // New leads land in "Due today", with their profile link and the best channel to reach them.
        const channel = lead.email ? "Email" : /instagram/i.test(lead.profileUrl) ? "Instagram" : lead.phone ? "Phone" : "Other";
        await api(`/api/cloud/workspaces/${workspaceId}/clients/${id}`, { outreach: { ...emptyOutreach(), profileUrl: lead.profileUrl, channel, nextFollowUp: localCalendarDay(new Date()) }, expectedUpdatedAt: created.client.updatedAt }, "PATCH").catch(() => undefined);
        await leadApi.update(accountId, workspaceId, id, {
          ...(label ? { tags: [label] } : {}), source: "Lead finder",
          research: { url: (lead.profileUrl || lead.website).slice(0, 500), platform: lead.platform.slice(0, 30), handle: lead.handle, followers: lead.followers, following: null, posts: null, bio: (lead.bio || lead.summary).slice(0, 600) },
          ...(lead.ai ? { insight: { niche: lead.ai.niche, audience: lead.ai.audience, angle: lead.ai.angle, confidence: lead.ai.confidence } } : {}),
        }).catch(() => undefined);
        added++;
      } catch (cause) { failed++; if (cause instanceof CloudError && cause.uncertain) break; }
      setAdding({ done: added + failed, total: chosen.length });
    }
    setAdding(null);
    if (failed) setError(`Added ${added}; ${failed} couldn't be saved. Try adding those again.`);
    if (added) onAdded(added, label);
  }

  const toggle = (id: string) => setPicked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allPicked = Boolean(result?.leads.length) && result!.leads.every(lead => picked.has(lead.id));

  return <Modal label="Find new leads" onClose={() => { controller.current?.abort(); onClose(); }} locked={Boolean(adding)} wide>
    <div className="lf">
      <header className="lf-head">
        <div><span className="lf-eyebrow"><Sparkles size={13} /> Lead finder</span><h2>Find new leads</h2>
          <p>Real businesses and creators with public contact details, checked and ranked for what you offer.</p></div>
        <button type="button" className="lf-close" aria-label="Close" disabled={Boolean(adding)} onClick={() => { controller.current?.abort(); onClose(); }}><X size={18} /></button>
      </header>

      {!result && <form className="lf-form" onSubmit={event => { event.preventDefault(); void find(); }}>
        <div className="lf-modes" role="radiogroup" aria-label="Where to find leads">
          <button type="button" role="radio" aria-checked={mode === "local"} onClick={() => setMode("local")} disabled={busy}><MapPin size={15} />Local businesses</button>
          <button type="button" role="radio" aria-checked={mode === "creators"} onClick={() => setMode("creators")} disabled={busy}><Users size={15} />Creators</button>
          <button type="button" role="radio" aria-checked={mode === "list"} onClick={() => setMode("list")} disabled={busy}><List size={15} />From your list</button>
        </div>
        {mode === "local" ? <div className="lf-grid">
          <label>What kind of business?<input list="lf-categories" value={niche} onChange={event => setNiche(event.target.value)} placeholder="Dentists, yoga studios, restaurants…" maxLength={80} disabled={busy} autoFocus /></label>
          <datalist id="lf-categories">{CATEGORIES.map(category => <option key={category.label} value={category.label} />)}</datalist>
          <label>Where?<input value={place} onChange={event => setPlace(event.target.value)} placeholder="City, e.g. Sarajevo or Austin, Texas" maxLength={120} disabled={busy} /></label>
        </div> : mode === "creators" ? <div className="lf-creators">
          <div className="lf-platforms" role="radiogroup" aria-label="Platform">{PLATFORMS.map(item => <button type="button" role="radio" key={item} aria-checked={platform === item} disabled={busy} onClick={() => setPlatform(item)}>{item}</button>)}</div>
          <div className="lf-grid">
            <label>What do they post about?<input value={niche} onChange={event => setNiche(event.target.value)} placeholder="Vegan recipes, home fitness, interior design…" maxLength={80} disabled={busy} autoFocus /></label>
            <label>Where? (optional)<input value={place} onChange={event => setPlace(event.target.value)} placeholder="City or country" maxLength={120} disabled={busy} /></label>
          </div>
          <label className="lf-audience">Audience size<select value={audience} onChange={event => setAudience(event.target.value as Audience)} disabled={busy}>{Object.entries(AUDIENCES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        </div> : <label className="lf-list">Instagram handles, profile links or websites<textarea value={list} onChange={event => setList(event.target.value)} rows={5} disabled={busy}
          placeholder={"@studio.lena\nhttps://www.instagram.com/bistro.mlin/\ngreenbikes.ba"} /><small className={items.length > LEAD_FINDER.maxListItems ? "lf-over" : ""}>{items.length}/{LEAD_FINDER.maxListItems} · one per line</small></label>}
        <label className="lf-offer">What do you offer them? <span>Optional, sharpens the ranking</span>
          <textarea value={offer} onChange={event => setOffer(event.target.value)} rows={2} maxLength={600} disabled={busy} placeholder="e.g. I design websites that bring local clinics more online bookings." /></label>
        <div className="lf-foot">
          {mode !== "list" && <div className="lf-count" role="radiogroup" aria-label="How many leads">{LEAD_FINDER.counts.filter(value => mode === "local" || value < 40).map(value =>
            <button type="button" role="radio" key={value} aria-checked={size === value} disabled={busy} onClick={() => setCount(value)}>{value}</button>)}<span>leads</span></div>}
          <p className="lf-price">About <strong>{leadFinderTypicalCredits(size, mode)} credits</strong>, at most {leadFinderMaxCredits(size, mode)}. You pay only for leads delivered{mode === "creators" ? " and the web searches used" : ""}; adding them to clients is free.</p>
          <button type="submit" className="button primary" disabled={!ready || busy}>{busy ? <Loader2 size={16} className="ac-spin" /> : <Search size={16} />}Find leads</button>
        </div>
        {run && <Progress run={run} mode={mode} onCancel={() => { controller.current?.abort(); setRun(null); }} />}
        {error && <p className="lf-error" role="alert">{error}</p>}
      </form>}

      {result && <div className="lf-results">
        <div className="lf-summary">
          <div><strong>{result.leads.length ? `${result.leads.length} lead${result.leads.length === 1 ? "" : "s"}` : "No new leads"}</strong>
            <span>{result.place ? `${result.category} in ${result.place}` : result.category}{result.duplicates ? ` · ${result.duplicates} already in your clients` : ""}{result.skipped ? ` · ${result.skipped} unreachable skipped` : ""}</span></div>
          <span className="lf-charged">{result.charged === null ? "Settling…" : result.charged ? `${result.charged} credit${result.charged === 1 ? "" : "s"} used` : "Nothing charged"}</span>
        </div>
        {result.leads.length ? <>
          <div className="lf-toolbar">
            <label className="lf-all"><input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(result.leads.map(lead => lead.id)))} disabled={Boolean(adding)} />Select all</label>
            <label className="lf-tag">Tag<input value={tag} onChange={event => setTag(event.target.value)} maxLength={30} disabled={Boolean(adding)} /></label>
            <button type="button" className="button primary" disabled={!picked.size || Boolean(adding)} onClick={() => void addPicked()}>
              {adding ? <><Loader2 size={16} className="ac-spin" />Adding {adding.done}/{adding.total}…</> : <><UserPlus size={16} />Add {picked.size} to clients</>}</button>
          </div>
          <ol className="lf-list-results">{result.leads.map(lead => <LeadRow key={lead.id} lead={lead} picked={picked.has(lead.id)} onToggle={() => toggle(lead.id)} disabled={Boolean(adding)} />)}</ol>
        </> : <p className="lf-empty">Everyone we found is already in your clients, or had no public way to contact them. Try a nearby city or a related niche.</p>}
        {error && <p className="lf-error" role="alert">{error}</p>}
        <div className="lf-after">
          {result.attribution && <small>{result.attribution}. Contact details are as published by each business.</small>}
          <button type="button" className="button secondary small" disabled={Boolean(adding)} onClick={() => { setResult(null); setRun(null); }}>New search</button>
        </div>
      </div>}
    </div>
  </Modal>;
}

function Progress({ run, mode, onCancel }: { run: Run; mode: Mode; onCancel: () => void }) {
  const steps: { id: Run["stage"]; label: string }[] = [{ id: "search", label: mode === "local" ? "Search the map" : mode === "creators" ? "Search the web" : "Check your list" }, { id: "read", label: mode === "creators" ? "Read their profiles" : "Read their pages" }, { id: "rank", label: "Rank for your offer" }];
  const order = ["search", "read", "rank", "done"], at = order.indexOf(run.stage);
  const percent = run.stage === "read" && run.total ? 20 + Math.round(run.done / run.total * 55) : run.stage === "search" ? 10 : run.stage === "rank" ? 85 : 100;
  return <div className="lf-progress" role="status" aria-live="polite">
    <div className="lf-bar"><span style={{ width: `${percent}%` }} /></div>
    <ol>{steps.map((step, index) => <li key={step.id} className={index < at ? "is-done" : index === at ? "is-active" : ""}>
      <span className="lf-dot">{index < at ? <Check size={12} /> : index === at ? <Loader2 size={12} className="ac-spin" /> : null}</span>
      {step.label}{step.id === "read" && run.stage === "read" && run.total ? <em>{run.done}/{run.total}</em> : null}</li>)}</ol>
    <p>{run.status}</p>
    <button type="button" className="button ghost small" onClick={onCancel}>Cancel</button>
  </div>;
}

function LeadRow({ lead, picked, onToggle, disabled }: { lead: FoundLead; picked: boolean; onToggle: () => void; disabled: boolean }) {
  const level = tier(lead.score);
  return <li className={`lf-row${picked ? " is-picked" : ""}`}>
    <input type="checkbox" checked={picked} onChange={onToggle} disabled={disabled} aria-label={`Select ${lead.name}`} />
    <span className={`lf-score is-${level}`} title={lead.ai ? `Fit ${lead.ai.fit}/100 for your offer` : "Reachability score (no AI read)"}><strong>{lead.score}</strong><small>{level}</small></span>
    <div className="lf-main">
      <div className="lf-name"><strong>{lead.name}</strong><span>{[lead.ai?.niche || lead.category, lead.followers && `${lead.followers} followers`].filter(Boolean).join(" · ")}</span></div>
      {lead.ai?.why && <p className="lf-why">{lead.ai.why}</p>}
      {lead.ai?.angle && <p className="lf-angle"><Sparkles size={12} /> {lead.ai.angle}</p>}
      {!lead.ai && lead.summary && <p className="lf-why">{lead.summary}</p>}
      <div className="lf-contacts">
        {lead.email ? <span className="lf-chip is-email"><Mail size={12} />{lead.email}</span> : <span className="lf-chip is-missing"><Mail size={12} />No public email</span>}
        {lead.website && <a className="lf-chip" href={lead.website} target="_blank" rel="noopener noreferrer"><Globe2 size={12} />{lead.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 40)}<ArrowUpRight size={11} /></a>}
        {lead.profileUrl && <a className="lf-chip" href={lead.profileUrl} target="_blank" rel="noopener noreferrer"><AtSign size={12} />{lead.handle ? `@${lead.handle}` : "Profile"}{/tiktok/.test(lead.profileUrl) ? " · TikTok" : /youtube/.test(lead.profileUrl) ? " · YouTube" : ""}<ArrowUpRight size={11} /></a>}
        {lead.phone && <span className="lf-chip"><Phone size={12} />{lead.phone}</span>}
        {lead.address && <span className="lf-chip is-quiet"><MapPin size={12} />{lead.address}</span>}
        {lead.ai && <span className={`lf-chip is-quiet is-${lead.ai.confidence}`}>{lead.ai.confidence} confidence</span>}
        {lead.source === "Web search" && <span className="lf-chip is-quiet"><Search size={11} />Found on the web</span>}
        {lead.note && <span className="lf-chip is-quiet">{lead.note}</span>}
      </div>
    </div>
  </li>;
}
