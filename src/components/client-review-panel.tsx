"use client";
import "./client-review-panel.css";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, Link2, LoaderCircle, Mail, MessageSquare, RefreshCw, RotateCcw, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";
import { linkState, type ReviewLink, type StudioReviewComment } from "@/lib/client-review/contracts";
import { anchorLabel, builderRequestFromFeedback, reviewMailto } from "@/lib/client-review/feedback";

type Kind = "website" | "book" | "presentation";
type Overview = { currentVersion: number; kind: Kind; title: string; links: ReviewLink[]; comments: StudioReviewComment[]; snapshots: number[]; client: { id: string; name: string; email: string; stage: string } | null };
const day = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const moment = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function request<T>(accountId: string, path: string, init?: { method: string; body?: unknown }): Promise<T> {
  const assertAccount = cloudAccountGuard(accountId);
  const response = await fetch(path, {
    method: init?.method ?? "GET", cache: "no-store",
    headers: { "X-Makeborne-Account": accountId, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const result = await response.json().catch(() => null);
  assertAccount();
  if (!response.ok) throw new Error(result?.error?.message ?? "Client review is unavailable right now.");
  return result as T;
}

/** Share a project with a client, then read and act on their feedback. */
export default function ClientReviewPanel({ accountId, workspaceId, artifactId, version, dirty, canEdit, capture, onSendToBuilder }: {
  accountId: string; workspaceId: string; artifactId: string; version: number; dirty: boolean; canEdit: boolean;
  /** Website source projects: render the saved site and return static HTML. */
  capture?: () => Promise<string>;
  onSendToBuilder?: (text: string) => void;
}) {
  const base = `/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}`;
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"version" | "latest">("latest");
  const [days, setDays] = useState(14);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<{ url: string; link: ReviewLink } | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const load = useCallback(async () => {
    try { setData(await request<Overview>(accountId, `${base}/reviews`)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Client review is unavailable right now."); }
  }, [accountId, base]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);

  async function create() {
    if (!data || busy || !canEdit) return;
    setBusy(true); setMessage(""); setCreated(null);
    try {
      const snapshot = data.kind === "website" && capture ? await capture() : undefined;
      const result = await request<{ url: string; link: ReviewLink }>(accountId, `${base}/reviews`, { method: "POST", body: {
        scope, version, days, recipientName: (recipient ?? data.client?.name ?? "").slice(0, 120), message: note, ...(snapshot ? { snapshot } : {}),
      } });
      setCreated(result); setNote("");
      setMessage(data.client ? `Link ready. ${data.client.name} is now in Review.` : "Link ready. Copy it now — it is shown only once.");
      await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The review link could not be created."); }
    finally { setBusy(false); }
  }
  async function revoke(link: ReviewLink) {
    if (busy || !window.confirm("Turn off this review link? Your client will no longer be able to open it.")) return;
    setBusy(true);
    try { await request(accountId, `${base}/reviews/${link.id}`, { method: "DELETE" }); if (created?.link.id === link.id) setCreated(null); setMessage("Review link turned off."); await load(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "The link could not be turned off."); }
    finally { setBusy(false); }
  }
  async function refreshCopy() {
    if (!capture || busy) return;
    setBusy(true); setMessage("");
    try { await request(accountId, `${base}/review-snapshot`, { method: "POST", body: { version, snapshot: await capture() } }); setMessage(`Your client now sees version ${version}.`); await load(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "The review copy could not be updated."); }
    finally { setBusy(false); }
  }
  async function resolve(comment: StudioReviewComment, resolved: boolean) {
    try {
      await request(accountId, `/api/cloud/workspaces/${workspaceId}/review-comments/${comment.id}`, { method: "PATCH", body: { resolved } });
      setData(current => current ? { ...current, comments: current.comments.map(item => item.id === comment.id ? { ...item, resolved, resolvedAt: resolved ? new Date().toISOString() : null } : item) } : current);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The comment could not be updated."); }
  }
  function toBuilder(items: StudioReviewComment[]) {
    if (!data || !onSendToBuilder) return;
    const text = builderRequestFromFeedback(items, { title: data.title, version: items[0]?.version ?? null, kind: data.kind });
    if (!text) return;
    onSendToBuilder(text);
    setMessage("Feedback added to the builder message. Review it, then send.");
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setMessage("Link copied."); }
    catch { setMessage("Select the link above and copy it."); }
  }

  if (!data) return <section className="crp" aria-label="Client review"><p role={error ? "alert" : "status"} className="crp-muted">{error || "Loading client review…"}</p>{error && <button type="button" className="button secondary small" onClick={() => void load()}>Try again</button>}</section>;
  const linksById = new Map(data.links.map(link => [link.id, link]));
  const feedback = data.comments.filter(comment => comment.kind === "comment" || comment.body.trim());
  const open = feedback.filter(comment => !comment.resolved && comment.kind !== "approved");
  const visible = showResolved ? feedback : open;
  const decisions = data.comments.filter(comment => comment.kind !== "comment").slice(-1);
  const newestSnapshot = data.snapshots[0] ?? 0;
  const activeLatest = data.links.some(link => link.version === null && linkState(link) === "active");
  const staleCopy = data.kind === "website" && !!capture && activeLatest && newestSnapshot > 0 && newestSnapshot < data.currentVersion;
  return <section className="crp" aria-labelledby={`crp-${artifactId}`}>
    <header className="crp-head">
      <span className="crp-icon"><ShieldCheck size={18} /></span>
      <div><h3 id={`crp-${artifactId}`}>Client review</h3><p>A private link for your client: no account, comments on the page, approve or request changes.</p></div>
      <button type="button" className="crp-icon-button" aria-label="Refresh client review" onClick={() => void load()}><RefreshCw size={15} /></button>
    </header>
    {decisions.map(decision => <div key={decision.id} className={`crp-decision is-${decision.kind}`} role="status">
      {decision.kind === "approved" ? <Check size={16} /> : <RotateCcw size={16} />}
      <div><strong>{decision.kind === "approved" ? `${decision.authorName} approved version ${decision.version}` : `${decision.authorName} requested changes on version ${decision.version}`}</strong>
        <p>{moment(decision.createdAt)}{decision.kind === "approved" ? (data.client ? ` · ${data.client.name} moved to ${data.client.stage}` : " · Link this project to a client to track delivery") : ""}</p>
        {decision.body && <blockquote>{decision.body}</blockquote>}</div>
    </div>)}
    <div className="crp-client">{data.client ? <>For <strong>{data.client.name}</strong><span className="crp-pill">{data.client.stage}</span><small>Sending a link moves them to Review; approval moves them to Delivered.</small></> : <small>Link this project to a client to move them through Review → Delivered automatically.</small>}</div>

    {canEdit && <div className="crp-create">
      <h4><Link2 size={15} /> Share for review</h4>
      <div className="crp-scope" role="radiogroup" aria-label="What the client sees">
        <label className={scope === "latest" ? "is-selected" : ""}><input type="radio" name={`scope-${artifactId}`} checked={scope === "latest"} onChange={() => setScope("latest")} /><span><strong>Latest version</strong><small>{data.kind === "website" && capture ? "Update the review copy after new saves" : "Follows every save"}</small></span></label>
        <label className={scope === "version" ? "is-selected" : ""}><input type="radio" name={`scope-${artifactId}`} checked={scope === "version"} onChange={() => setScope("version")} /><span><strong>Version {version} only</strong><small>Fixed, for sign-off</small></span></label>
      </div>
      <div className="crp-row">
        <label>Client name<input value={recipient ?? data.client?.name ?? ""} maxLength={120} onChange={event => setRecipient(event.target.value)} placeholder="Who is reviewing?" /></label>
        <label>Link expires<select value={days} onChange={event => setDays(Number(event.target.value))}>{[3, 7, 14, 30, 90].map(value => <option key={value} value={value}>In {value} days</option>)}</select></label>
      </div>
      <label>Personal note <small>(shown on the review page)</small><textarea rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="Here’s the first full draft — let me know what you think." /></label>
      <button type="button" className="button primary" disabled={busy || dirty || version < 1} onClick={() => void create()}>{busy ? <LoaderCircle size={15} className="auth-spinner" /> : <Link2 size={15} />}{busy ? "Preparing…" : "Create review link"}</button>
      {dirty && <p className="crp-muted">Save your changes before sharing.</p>}
    </div>}

    {created && <div className="crp-created" role="status">
      <strong>Your review link</strong>
      <div className="crp-url"><input readOnly value={created.url} aria-label="Review link" onFocus={event => event.currentTarget.select()} /><button type="button" className="button secondary small" onClick={() => void copy(created.url)}><Copy size={14} /> Copy link</button></div>
      <div className="crp-created-actions">
        <a className="button secondary small" href={reviewMailto({ email: data.client?.email ?? "", recipientName: created.link.recipientName, title: data.title, url: created.url, expiresAt: created.link.expiresAt, senderNote: created.link.message })}><Mail size={14} /> Email to {data.client?.email ? data.client.name : "client"}</a>
        <a className="button secondary small" href={created.url} target="_blank" rel="noopener noreferrer">Open review page <ArrowUpRight size={14} /></a>
      </div>
      <small>For security, this link is shown only once. You can create a new link at any time.</small>
    </div>}
    {message && <p className="crp-message" role="status">{message}</p>}
    {staleCopy && <div className="crp-stale"><p>Your client sees version {newestSnapshot}. You’ve saved version {data.currentVersion} since.</p><button type="button" className="button secondary small" disabled={busy || dirty} onClick={() => void refreshCopy()}><RefreshCw size={14} /> Show version {data.currentVersion}</button></div>}

    <div className="crp-feedback">
      <div className="crp-feedback-head">
        <h4><MessageSquare size={15} /> Client feedback <span>{open.length} open</span></h4>
        {onSendToBuilder && open.length > 0 && <button type="button" className="button primary small" onClick={() => toBuilder(open)}><Sparkles size={14} /> Send {open.length} to builder</button>}
      </div>
      {feedback.length === 0 ? <p className="crp-muted">Comments appear here as soon as your client leaves them.</p> : <>
        <ol className="crp-comments">{visible.map(comment => {
          const link = linksById.get(comment.linkId);
          return <li key={comment.id} className={comment.resolved ? "is-resolved" : ""}>
            <div className="crp-comment-head"><strong>{comment.authorName}</strong>{comment.authorEmail && <a href={`mailto:${comment.authorEmail}`}>{comment.authorEmail}</a>}<time dateTime={comment.createdAt}>{moment(comment.createdAt)}</time></div>
            <span className="crp-where">{comment.kind === "changes_requested" ? "Change request" : anchorLabel(comment.anchor, data.kind)} · v{comment.version}{link?.recipientName ? ` · via ${link.recipientName}’s link` : ""}</span>
            <p>{comment.body}</p>
            <div className="crp-comment-actions">
              {onSendToBuilder && <button type="button" onClick={() => toBuilder([comment])}><Send size={13} /> Send to builder</button>}
              {canEdit && <button type="button" onClick={() => void resolve(comment, !comment.resolved)}>{comment.resolved ? <><RotateCcw size={13} /> Reopen</> : <><Check size={13} /> Resolve</>}</button>}
            </div>
          </li>;
        })}</ol>
        {feedback.length !== open.length && <button type="button" className="crp-text-button" onClick={() => setShowResolved(value => !value)}>{showResolved ? "Hide resolved" : `Show ${feedback.length - open.length} resolved`}</button>}
      </>}
    </div>

    {data.links.length > 0 && <div className="crp-links">
      <h4>Review links</h4>
      <ul>{data.links.map(link => {
        const state = linkState(link);
        return <li key={link.id}>
          <div><span className={`crp-state is-${state}`}>{state === "active" ? "Active" : state === "expired" ? "Expired" : "Off"}</span>
            {link.decision && <span className={`crp-state is-${link.decision}`}>{link.decision === "approved" ? "Approved" : "Changes requested"}</span>}
            <strong>{link.recipientName || "Client"}</strong></div>
          <small>{link.version === null ? "Latest version" : `Version ${link.version}`} · sent {day(link.createdAt)} · {state === "active" ? `expires ${day(link.expiresAt)}` : state === "expired" ? `expired ${day(link.expiresAt)}` : `off since ${day(link.revokedAt!)}`} · {link.viewCount} {link.viewCount === 1 ? "view" : "views"}</small>
          {canEdit && state === "active" && <button type="button" className="crp-icon-button" aria-label={`Turn off link for ${link.recipientName || "client"}`} title="Turn off link" disabled={busy} onClick={() => void revoke(link)}><X size={14} /></button>}
        </li>;
      })}</ul>
    </div>}
  </section>;
}
