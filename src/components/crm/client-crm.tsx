"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Ban, Check, Copy, History, LoaderCircle, Mail, RefreshCw, Sparkles } from "lucide-react";
import type { SiteCheck } from "@/lib/crm-research/site-check";
import type { TimelineEvent } from "@/lib/crm-research/timeline";
import type { DuplicateReason } from "@/lib/crm-research/match";
import { crmCall, CrmRequestError, localDay, shortDate } from "./crm-api";
import WebsiteCheckCard from "./website-check-card";
import "@/app/crm-research.css";

/**
 * Client page: next step (compare-and-set), what needs attention, their
 * website check, an honest first email to copy into your own email (never
 * sent from here), suggested facts from the check, look-alike clients, and the
 * whole timeline. Renders nothing while the feature is off.
 */
type Data = {
  enabled: true; canEdit: boolean; knowledge: boolean;
  check: (SiteCheck & { id: string }) | null;
  nextStep: { text: string; revision: number; updatedAt: string | null };
  attention: { kind: string; text: string }[];
  timeline: TimelineEvent[];
  duplicates: { id: string; name: string; reasons: DuplicateReason[]; strength: string }[];
  suppressed: { kind: string; value: string } | null;
};
type Draft = { subject: string; body: string; warnings: string[]; uses: { kind: string; text: string }[] };

export default function ClientCrm({ accountId, workspaceId, clientId, onOpenClient, onOpenEmail }: { accountId: string; workspaceId: string; clientId: string; onOpenClient?: (id: string) => void; onOpenEmail?: () => void }) {
  const base = `/api/cloud/workspaces/${workspaceId}/clients/${clientId}/crm`;
  const [data, setData] = useState<Data | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "check" | "step" | "draft" | "propose">("");
  const [step, setStep] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copied, setCopied] = useState(false);
  const settle = useCallback((result: Promise<Data>, live: () => boolean = () => true) => result.then(value => { if (live()) { setData(value); setStep(value.nextStep.text); setError(""); } }, cause => {
    if (!live()) return;
    if (cause instanceof CrmRequestError && cause.status === 404 && cause.code === "CRM_RESEARCH_DISABLED") setHidden(true); else setError(cause instanceof Error ? cause.message : "Couldn't load.");
  }), []);
  const load = useCallback(() => settle(crmCall<Data>(accountId, `${base}?day=${localDay()}`)), [accountId, base, settle]);
  useEffect(() => {
    let live = true;
    void settle(crmCall<Data>(accountId, `${base}?day=${localDay()}`), () => live);
    return () => { live = false; };
  }, [accountId, base, settle]);
  if (hidden || (!data && !error)) return null;

  async function act<T>(kind: typeof busy, body: Record<string, unknown>, done: (value: T) => void) {
    setBusy(kind); setError(""); setNote("");
    try { done(await crmCall<T>(accountId, base, body)); }
    catch (cause) {
      if (cause instanceof CrmRequestError && cause.code === "NEXT_STEP_CHANGED") { await load(); setError(cause.message); }
      else setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
    } finally { setBusy(""); }
  }
  const canEdit = Boolean(data?.canEdit);
  return <section className="crm-client" aria-label="Deal and research" data-testid="crm-client">
    {error && <p className="crm-error" role="alert">{error}</p>}
    {data?.suppressed && <p className="crm-warn"><Ban size={15} aria-hidden /> On your do-not-contact list ({data.suppressed.value}). Don&apos;t contact them; no email draft is written.</p>}
    {data && data.duplicates.length > 0 && <div className="crm-warn"><AlertTriangle size={15} aria-hidden /><div><p>Might be the same business as:</p><ul>{data.duplicates.map(item => <li key={item.id}>
      {onOpenClient ? <button type="button" className="crm-link" onClick={() => onOpenClient(item.id)}>{item.name}</button> : item.name} ({item.reasons.map(reason => reason.text).join(", ")})</li>)}</ul></div></div>}

    {data && <div className="crm-step">
      <label htmlFor={`${clientId}-step`}><strong>Next step</strong>{data.attention.length > 0 && <span className="crm-reasons">{data.attention.map(item => <em key={item.kind} className={`is-${item.kind}`}>{item.text}</em>)}</span>}</label>
      <div className="crm-row">
        <input id={`${clientId}-step`} type="text" value={step} maxLength={200} placeholder="e.g. Send the revised quote" disabled={!canEdit || Boolean(busy)} onChange={event => setStep(event.target.value)} />
        {canEdit && <button type="button" className="button secondary small" disabled={Boolean(busy) || step.trim() === data.nextStep.text} onClick={() => void act<{ nextStep: Data["nextStep"] }>("step", { action: "next_step", text: step, expectedRevision: data.nextStep.revision }, value => {
          setData(current => current && { ...current, nextStep: value.nextStep }); setStep(value.nextStep.text); setNote("Next step saved.");
        })}>{busy === "step" ? <LoaderCircle size={13} className="crm-spin" aria-hidden /> : <Check size={13} aria-hidden />}Save</button>}
      </div>
      <p className="crm-muted">The due date is the follow-up date below.{data.nextStep.updatedAt ? ` Updated ${shortDate(data.nextStep.updatedAt)}.` : ""}</p>
    </div>}

    {data && <div className="crm-block">
      <div className="crm-block-head"><h4>Their website</h4>
        {canEdit && <button type="button" className="button secondary small" disabled={Boolean(busy)} onClick={() => void act<{ check: Data["check"] }>("check", { action: "check" }, value => { setData(current => current && { ...current, check: value.check }); void load(); })}>
          {busy === "check" ? <LoaderCircle size={13} className="crm-spin" aria-hidden /> : <RefreshCw size={13} aria-hidden />}{busy === "check" ? "Checking…" : data.check ? "Check again" : "Check website"}</button>}</div>
      {data.check ? <WebsiteCheckCard check={data.check} /> : <p className="crm-muted">Not checked yet. The check reads their public website only and shows where every finding came from.</p>}
      {data.check && data.check.status === "checked" && canEdit && data.knowledge && <button type="button" className="button ghost small" disabled={Boolean(busy)} onClick={() => void act<{ knowledge: { proposed: number; deduplicated: number } }>("propose", { action: "propose", checkId: data.check!.id }, value => {
        setNote(value.knowledge.proposed ? `${value.knowledge.proposed} facts suggested. Review and approve them under Contact details.` : "Those facts were already suggested."); void load();
      })}><Sparkles size={13} aria-hidden /> Suggest facts from this check</button>}
    </div>}

    {data && canEdit && !data.suppressed && <div className="crm-block">
      <div className="crm-block-head"><h4>First email</h4>
        <button type="button" className="button secondary small" disabled={Boolean(busy)} onClick={() => void act<{ draft: Draft }>("draft", { action: "draft" }, value => { setDraft(value.draft); setCopied(false); })}>
          {busy === "draft" ? <LoaderCircle size={13} className="crm-spin" aria-hidden /> : <Mail size={13} aria-hidden />}{draft ? "Write again" : "Draft an honest first email"}</button></div>
      <p className="crm-muted">Uses only what the website check measured and facts you approved, says who you are, and tells them how to opt out. You read it, edit it and send it yourself.</p>
      {draft && <div className="crm-draft" data-testid="crm-draft">
        {draft.warnings.map(item => <p key={item} className="crm-muted">{item}</p>)}
        <p><strong>Subject:</strong> {draft.subject}</p>
        <textarea aria-label="Draft email" rows={12} defaultValue={draft.body} key={draft.body} />
        <div className="crm-row">
          <button type="button" className="button secondary small" onClick={event => { const text = (event.currentTarget.closest(".crm-draft")?.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? draft.body;
            void navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${text}`).then(() => setCopied(true)).catch(() => setCopied(false)); }}><Copy size={13} aria-hidden />{copied ? "Copied" : "Copy"}</button>
          {onOpenEmail && <button type="button" className="button ghost small" onClick={onOpenEmail}><Mail size={13} aria-hidden /> Open the Email tab to send it</button>}
        </div>
      </div>}
    </div>}

    {note && <p className="crm-note" role="status">{note}</p>}

    {data && <details className="crm-block crm-timeline" open={data.timeline.length > 0 && data.timeline.length <= 8}>
      <summary><History size={14} aria-hidden /> Timeline <small>{data.timeline.length}</small></summary>
      {data.timeline.length ? <ol>{data.timeline.map(item => <li key={item.id} className={`is-${item.kind}`}><time dateTime={item.at}>{shortDate(item.at)}</time><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}</li>)}</ol>
        : <p className="crm-muted">Nothing yet.</p>}
    </details>}
  </section>;
}
