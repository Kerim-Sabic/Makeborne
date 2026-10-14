"use client";
import { requestClientsAction } from "../onboarding/signals";
import { useState } from "react";
import { AtSign, Flame, Plus, Search, Sparkles, Tag, Users, X } from "lucide-react";
import { compactCount, countValue, CURRENCIES, LEAD_SOURCES, normalizeTag, scoreLead, type Lead } from "@/lib/leads";
import { leadApi } from "./lead-api";

/** Lead profile on a client page: score, tags, deal value, source, and what research and the AI found. */
export default function LeadProfileCard({ accountId, workspaceId, clientId, clientName = "", clientWebsite = "", lead, stage, hasEmail, overdue, canEdit, onChange }: {
  accountId: string; workspaceId: string; clientId: string; clientName?: string; clientWebsite?: string; lead: Lead | undefined; stage: string; hasEmail: boolean; overdue: boolean; canEdit: boolean; onChange: (lead: Lead) => void;
}) {
  const [tagDraft, setTagDraft] = useState("");
  const [deal, setDeal] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "research">("");
  const [message, setMessage] = useState("");
  if (!lead) return <div className="ac-skeleton ac-skeleton-detail" role="status" aria-label="Loading lead profile"><span /></div>;
  const score = scoreLead({ stage, hasEmail, lead, overdue });
  const research = lead.profile.research, insight = lead.profile.insight;
  const followers = countValue(research?.followers);
  async function save(change: Parameters<typeof leadApi.update>[3], done = "") {
    setBusy("save"); setMessage("");
    try { const result = await leadApi.update(accountId, workspaceId, clientId, change); onChange(result.lead); if (done) setMessage(done); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Couldn't save."); }
    finally { setBusy(""); }
  }
  async function runResearch() {
    setBusy("research"); setMessage("");
    try {
      const result = await leadApi.research(accountId, workspaceId, clientId);
      if (result.lead) onChange(result.lead);
      setMessage(result.read ? `Read ${result.read} page${result.read === 1 ? "" : "s"}.${result.skipped.length ? ` Skipped: ${result.skipped.map(item => item.reason).join(" ")}` : ""}` : `Nothing readable. ${result.skipped.map(item => item.reason).join(" ")}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Research failed."); }
    finally { setBusy(""); }
  }
  const addTag = () => { const tag = normalizeTag(tagDraft); if (!tag || lead.tags.includes(tag) || lead.tags.length >= 12) { setTagDraft(""); return; } setTagDraft(""); void save({ tags: [...lead.tags, tag] }); };

  return <section className="lp-card" aria-labelledby="lp-title">
    <header>
      <h2 id="lp-title">Lead profile</h2>
      {score && <span className={`lp-score is-${score.tier}`} title={score.reasons.join(" · ")}><Flame size={13} />{score.value} · {score.tier === "hot" ? "Hot" : score.tier === "warm" ? "Warm" : "Cold"}</span>}
    </header>
    {score && <p className="lp-why">{score.reasons.join(" · ")}</p>}

    <div className="lp-grid">
      <div className="lp-field"><span><Tag size={13} />Tags</span>
        <div className="lp-tags">{lead.tags.map(tag => <span key={tag} className="lp-tag">{tag}{canEdit && <button type="button" aria-label={`Remove tag ${tag}`} disabled={!!busy} onClick={() => void save({ tags: lead.tags.filter(item => item !== tag) })}><X size={11} /></button>}</span>)}
          {canEdit && lead.tags.length < 12 && <form onSubmit={event => { event.preventDefault(); addTag(); }}><input aria-label="Add a tag" value={tagDraft} maxLength={30} placeholder="Add tag" onChange={event => setTagDraft(event.target.value)} onBlur={() => tagDraft.trim() && addTag()} /></form>}
          {!canEdit && !lead.tags.length && <small>None</small>}</div></div>
      <div className="lp-field"><span>Deal value</span>
        {canEdit ? <div className="lp-deal"><input inputMode="decimal" aria-label="Deal value" placeholder="0" value={deal ?? (lead.dealValue ?? "").toString()} onChange={event => setDeal(event.target.value.replace(/[^\d.,]/g, ""))}
          onBlur={() => { if (deal === null) return; const value = deal.trim() ? Number(deal.replace(",", ".")) : null; setDeal(null); if (value !== lead.dealValue && (value === null || Number.isFinite(value))) void save({ dealValue: value }, "Deal value saved."); }} />
          <select aria-label="Currency" value={lead.dealCurrency} disabled={!!busy} onChange={event => void save({ dealCurrency: event.target.value })}>{CURRENCIES.map(item => <option key={item}>{item}</option>)}</select></div>
          : <strong>{lead.dealValue ? `${lead.dealValue} ${lead.dealCurrency}` : "—"}</strong>}</div>
      <div className="lp-field"><span>Source</span>
        {canEdit ? <select aria-label="Lead source" value={lead.source} disabled={!!busy} onChange={event => void save({ source: event.target.value })}>{LEAD_SOURCES.map(item => <option key={item} value={item}>{item || "Not set"}</option>)}</select> : <strong>{lead.source || "—"}</strong>}</div>
    </div>

    <div className="lp-research">
      <div className="lp-research-head"><span><Search size={13} />What we know about them</span>
        {canEdit && clientName && <button type="button" className="button ghost small" title="Find new leads similar to this client" onClick={() => requestClientsAction("find-leads", {
          name: clientName, url: research?.url || clientWebsite, about: (lead?.profile.insight?.niche || research?.bio || "").slice(0, 400) })}><Sparkles size={13} />Find more like this</button>}
        {canEdit && <button type="button" className="button secondary small" disabled={!!busy} onClick={() => void runResearch()}>{busy === "research" ? "Reading…" : research ? "Refresh research" : "Research (free)"}</button>}</div>
      {research ? <div className="lp-facts">
        <a href={research.url} target="_blank" rel="noopener noreferrer nofollow">{research.platform}{research.handle ? <> · <AtSign size={11} />{research.handle}</> : ""}</a>
        <div className="lp-stats">{followers !== null && <span><Users size={12} /><strong>{compactCount(followers)}</strong> followers</span>}{research.posts && <span><strong>{research.posts}</strong> posts</span>}</div>
        {research.bio && <p>{research.bio}</p>}
        <small>Read {new Date(research.at).toLocaleDateString()}</small>
      </div> : <p className="mc-empty">Add their Instagram or other profile link (in Outreach) or website, then research them. Public pages only; no credits.</p>}
      {insight && (insight.niche || insight.audience) && <div className="lp-insight"><span><Sparkles size={13} />Rex&apos;s read{insight.confidence ? ` · ${insight.confidence} confidence` : ""}</span>
        <dl>{insight.niche && <><dt>Niche</dt><dd>{insight.niche}</dd></>}{insight.audience && <><dt>Audience</dt><dd>{insight.audience}</dd></>}{insight.angle && <><dt>Best angle</dt><dd>{insight.angle}</dd></>}</dl></div>}
    </div>
    {message && <p className="mc-fine" role="status">{message}</p>}
    {canEdit && !lead.tags.length && <p className="lp-hint"><Plus size={12} />Tip: tag leads (e.g. “creator”, “Sarajevo”, “fitness”) to filter them and write to a whole group at once.</p>}
  </section>;
}
