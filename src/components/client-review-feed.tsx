"use client";
import "./client-review-panel.css";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, MessageSquare, RotateCcw, Sparkles } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";
import { linkState, type ReviewLink, type StudioReviewComment } from "@/lib/client-review/contracts";
import { anchorLabel, builderRequestFromFeedback } from "@/lib/client-review/feedback";
import { storeReviewPrefill } from "@/lib/client-review/prefill";
import type { AccountProjectRoute } from "@/lib/studio-navigation";

type Kind = "website" | "book" | "presentation";
type Item = { link: ReviewLink; artifact: { id: string; kind: Kind; title: string; currentVersion: number } | null; comments: StudioReviewComment[] };
const moment = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Client reviews across every project for one CRM client. */
export default function ClientReviewFeed({ accountId, workspaceId, clientId, clientName, canEdit, onOpenProject }: {
  accountId: string; workspaceId: string; clientId: string; clientName: string; canEdit: boolean; onOpenProject: (route: AccountProjectRoute) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const assertAccount = cloudAccountGuard(accountId);
    fetch(`/api/cloud/workspaces/${workspaceId}/clients/${clientId}/reviews`, { cache: "no-store", headers: { "X-Makeborne-Account": accountId } })
      .then(async response => { const result = await response.json().catch(() => null); assertAccount(); if (!response.ok) throw new Error(result?.error?.message ?? "Client reviews are unavailable."); return result as { items: Item[] }; })
      .then(result => { if (active) setItems(result.items); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Client reviews are unavailable."); });
    return () => { active = false; };
  }, [accountId, workspaceId, clientId]);
  function sendToBuilder(item: Item) {
    if (!item.artifact) return;
    const open = item.comments.filter(comment => !comment.resolved && comment.kind !== "approved" && comment.body.trim());
    const text = builderRequestFromFeedback(open, { title: item.artifact.title, version: open[0]?.version ?? null, kind: item.artifact.kind });
    if (text) storeReviewPrefill(item.artifact.id, text);
    onOpenProject({ workspaceId, artifactId: item.artifact.id });
  }
  if (error) return <p role="alert">{error}</p>;
  if (!items) return <p role="status">Loading client reviews…</p>;
  if (!items.length) return <section className="crp"><div className="crp-head"><span className="crp-icon"><MessageSquare size={18} /></span><div><h3>No reviews yet</h3><p>Open one of {clientName}’s projects and choose Client review to send a private review link. Their comments and approval will appear here.</p></div></div></section>;
  return <div className="crp-feed">{items.map(item => {
    const state = linkState(item.link);
    const discussion = item.comments.filter(comment => comment.kind === "comment" || comment.body.trim());
    const open = discussion.filter(comment => !comment.resolved && comment.kind !== "approved");
    return <section className="crp" key={item.link.id} aria-label={`Review of ${item.artifact?.title ?? "project"}`}>
      <header className="crp-head">
        <span className="crp-icon">{item.link.decision === "approved" ? <Check size={18} /> : item.link.decision === "changes_requested" ? <RotateCcw size={18} /> : <MessageSquare size={18} />}</span>
        <div><h3>{item.artifact?.title ?? "Project"}</h3>
          <p><span className={`crp-state is-${state}`}>{state === "active" ? "Link active" : state === "expired" ? "Link expired" : "Link off"}</span> {item.link.decision && <span className={`crp-state is-${item.link.decision}`}>{item.link.decision === "approved" ? `Approved by ${item.link.decisionName}` : `Changes requested by ${item.link.decisionName}`}</span>} · {item.link.version === null ? "latest version" : `version ${item.link.version}`} · sent {moment(item.link.createdAt)} · {item.link.viewCount} views</p></div>
      </header>
      {discussion.length ? <ol className="crp-comments">{discussion.slice(-6).map(comment => <li key={comment.id} className={comment.resolved ? "is-resolved" : ""}>
        <div className="crp-comment-head"><strong>{comment.authorName}</strong><time dateTime={comment.createdAt}>{moment(comment.createdAt)}</time></div>
        <span className="crp-where">{comment.kind === "changes_requested" ? "Change request" : comment.kind === "approved" ? "Approval note" : anchorLabel(comment.anchor, item.artifact?.kind ?? "website")} · v{comment.version}{comment.resolved ? " · resolved" : ""}</span>
        <p>{comment.body}</p>
      </li>)}</ol> : <p className="crp-muted">No comments on this link yet.</p>}
      {discussion.length > 6 && <p className="crp-muted">Showing the latest 6 of {discussion.length}. Open the project to see all feedback.</p>}
      {item.artifact && <div className="crp-created-actions">
        {canEdit && open.length > 0 && <button type="button" className="button primary small" onClick={() => sendToBuilder(item)}><Sparkles size={14} /> Send {open.length} open {open.length === 1 ? "comment" : "comments"} to builder</button>}
        <button type="button" className="button secondary small" onClick={() => onOpenProject({ workspaceId, artifactId: item.artifact!.id })}>Open project <ArrowUpRight size={14} /></button>
      </div>}
    </section>;
  })}</div>;
}
