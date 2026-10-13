"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, RotateCcw, Send, Sparkles, Square, X } from "lucide-react";
import { generateEmailDraft, type DraftNotes, type DraftOptions } from "./ai-draft";
import { leadApi } from "../leads/lead-api";
import { mailApi, MailApiError, providerLabel, type MailOverview } from "./mail-api";
import Modal from "./modal";

export type QueueClient = { id: string; name: string; email: string; company: string };
type Item = QueueClient & { status: "waiting" | "writing" | "ready" | "error" | "sending" | "sent" | "failed"; subject: string; body: string; error: string; credits: number | null; include: boolean; notes: DraftNotes | null };
const PLACEHOLDER = /\[[^\]\n]{2,80}\]/;
const MAX = 25;
const CAMPAIGN_CHOICES: { id: NonNullable<DraftOptions["campaign"]>; label: string; detail: string }[] = [
  { id: "audience_value", label: "Creators: what your audience is worth", detail: "Offer a breakdown of their audience's value plus product ideas. Reply YES to get it." },
  { id: "website", label: "Businesses: a website that wins customers", detail: "Offer a specific idea or mock-up for their site. Reply YES to see it." },
  { id: "custom", label: "My own angle", detail: "Describe the offer and ask yourself." },
];

/** Writes a unique email for each selected client, lets you edit and approve each one, then sends them from your mailbox. */
export default function PersonalizeQueue({ accountId, workspaceId, clients, onClose, onDone }: {
  accountId: string; workspaceId: string; clients: QueueClient[]; onClose: () => void; onDone: (message: string) => void;
}) {
  const [overview, setOverview] = useState<MailOverview | null>(null);
  const [goal, setGoal] = useState("");
  const [tone, setTone] = useState<DraftOptions["tone"]>("warm");
  const [campaign, setCampaign] = useState<NonNullable<DraftOptions["campaign"]>>("audience_value");
  const [research, setResearch] = useState(true);
  const [mailbox, setMailbox] = useState("");
  const [items, setItems] = useState<Item[]>(() => clients.slice(0, MAX).map(client => ({ ...client, status: "waiting", subject: "", body: "", error: "", credits: null, include: !!client.email, notes: null })));
  const [phase, setPhase] = useState<"setup" | "writing" | "review" | "sending" | "done">("setup");
  const [notice, setNotice] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let live = true;
    void mailApi<MailOverview>(accountId, `/api/cloud/workspaces/${workspaceId}/mail`).then(data => { if (live) { setOverview(data); setMailbox(data.accounts.find(item => item.mine && item.status === "active")?.id ?? ""); } }).catch(() => undefined);
    return () => { live = false; abort.current?.abort(); };
  }, [accountId, workspaceId]);
  const mine = overview?.accounts.filter(item => item.mine && item.status === "active") ?? [];
  const sender = mine.find(item => item.id === mailbox);
  const senderName = (sender?.displayName || sender?.email.split("@")[0] || "").split(/\s+/)[0] ?? "";
  const patch = (id: string, fields: Partial<Item>) => setItems(current => current.map(item => item.id === id ? { ...item, ...fields } : item));

  async function write(targets: Item[]) {
    const controller = new AbortController();
    abort.current = controller;
    setPhase("writing"); setNotice("");
    for (const target of targets) {
      if (controller.signal.aborted) break;
      patch(target.id, { status: "writing", error: "", body: "", subject: "" });
      const result = await generateEmailDraft({ accountId, workspaceId, clientId: target.id, options: { goal, tone, mode: "standard", senderName, campaign, research }, signal: controller.signal,
        onText: text => patch(target.id, { body: text }) });
      if (result.error && !result.text) {
        patch(target.id, { status: "error", error: result.error.message, body: "" });
        if (["INSUFFICIENT_CREDITS", "CHAT_UNAVAILABLE", "AI_PAUSED", "AI_DAILY_LIMIT"].includes(result.error.code)) { setNotice(result.error.message); break; }
        continue;
      }
      // Keep Rex's read of this lead on their profile (best effort).
      if (result.notes?.niche) void leadApi.update(accountId, workspaceId, target.id, { insight: { niche: result.notes.niche.slice(0, 240), audience: result.notes.audience.slice(0, 240), angle: result.notes.angle.slice(0, 300), confidence: result.notes.confidence } }).catch(() => undefined);
      patch(target.id, { status: result.text ? "ready" : "error", subject: result.subject, body: result.body, notes: result.notes, credits: result.charged, error: result.text ? "" : "Stopped." });
    }
    abort.current = null;
    setItems(current => current.map(item => item.status === "writing" ? { ...item, status: "error", error: "Stopped." } : item));
    setPhase("review");
  }
  async function send() {
    if (!mailbox) return;
    setPhase("sending"); setNotice("");
    let sent = 0, stopped = "";
    for (const item of items.filter(entry => entry.include && entry.status === "ready" && entry.email)) {
      if (stopped) break;
      if (PLACEHOLDER.test(item.subject) || PLACEHOLDER.test(item.body) || !item.subject.trim()) { patch(item.id, { status: "ready", error: "Fill in the [placeholders] and subject first." }); continue; }
      patch(item.id, { status: "sending", error: "" });
      try {
        await mailApi(accountId, `/api/cloud/workspaces/${workspaceId}/clients/${item.id}/mail`, "POST", { accountId: mailbox, subject: item.subject, body: item.body, reply: false });
        patch(item.id, { status: "sent" }); sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Not sent.";
        patch(item.id, { status: "failed", error: message });
        if (error instanceof MailApiError && ["DAILY_LIMIT", "MAILBOX_NEEDS_RECONNECT", "SEND_UNCERTAIN"].includes(error.code)) stopped = message;
      }
    }
    setPhase("done");
    setNotice(stopped ? `Sent ${sent}. Stopped: ${stopped}` : `Sent ${sent} personal email${sent === 1 ? "" : "s"}. Each is logged in the client's history.`);
    onDone(`Sent ${sent} personal email${sent === 1 ? "" : "s"}.`);
  }

  const ready = items.filter(item => item.include && item.status === "ready" && item.email);
  const needsFixing = ready.filter(item => PLACEHOLDER.test(item.subject) || PLACEHOLDER.test(item.body) || !item.subject.trim());
  const credits = items.reduce((sum, item) => sum + (item.credits ?? 0), 0);
  const busy = phase === "writing" || phase === "sending";
  return <Modal label={`Personal emails for ${items.length} clients`} onClose={onClose} locked={busy} wide>
      <header className="pq-head"><div><h3 id="pq-title"><Sparkles size={17} />Personal emails for {items.length} client{items.length === 1 ? "" : "s"}</h3>
        <p>Rex writes a different email for each person from their saved notes and history (about 1 credit each for writing; sending is free). You review every one before anything is sent.</p></div>
        <button type="button" className="button ghost small" aria-label="Close" disabled={busy} onClick={onClose}><X size={16} /></button></header>
      {clients.length > MAX && <p className="mc-note"><AlertTriangle size={14} /> The first {MAX} selected clients are included; run it again for the rest.</p>}

      {phase === "setup" && <div className="pq-setup">
        <fieldset className="pq-campaigns"><legend>Angle</legend>{CAMPAIGN_CHOICES.map(choice => <label key={choice.id} className={campaign === choice.id ? "is-on" : ""}>
          <input type="radio" name="pq-campaign" value={choice.id} checked={campaign === choice.id} onChange={() => setCampaign(choice.id)} /><strong>{choice.label}</strong><small>{choice.detail}</small></label>)}</fieldset>
        <label className="pq-research"><input type="checkbox" checked={research} onChange={event => setResearch(event.target.checked)} /><span><strong>Research each person first</strong><small>Reads their linked Instagram or website (public pages only) for their niche, audience size and bio. Sites that block reading are skipped; your notes are always used.</small></span></label>
        <label className="mc-field">{campaign === "custom" ? "What should these emails achieve?" : "Anything to add? (optional)"} <span className="pq-hint">Your offer, the reason you&apos;re reaching out, any proof you can mention.</span>
          <textarea rows={4} maxLength={1000} value={goal} placeholder="e.g. Offer a free 10-minute review of their booking page; mention we rebuilt Green Bikes' site and online bookings doubled; ask for a short call next week." onChange={event => setGoal(event.target.value)} /></label>
        <div className="ce-compose-row">
          <label>Tone<select value={tone} onChange={event => setTone(event.target.value as DraftOptions["tone"])}><option value="warm">Warm</option><option value="direct">Direct</option><option value="formal">Formal</option></select></label>
          {mine.length > 0 && <label>Send from<select value={mailbox} onChange={event => setMailbox(event.target.value)}>{mine.map(item => <option key={item.id} value={item.id}>{item.email} ({providerLabel(item.provider)}) · {item.todayQuota - item.sentToday} left today</option>)}</select></label>}
        </div>
        {!mine.length && overview && <p className="mc-note"><AlertTriangle size={14} /> No mailbox connected: you can still write the emails and copy them, or connect Gmail/Outlook in Email to send from here.</p>}
        {items.some(item => !item.email) && <p className="mc-fine">{items.filter(item => !item.email).length} selected client(s) have no email address; their message is written for you to copy.</p>}
        <div className="button-row"><button type="button" className="button primary" disabled={campaign === "custom" && !goal.trim()} onClick={() => void write(items)}><Sparkles size={15} />Write {items.length} email{items.length === 1 ? "" : "s"}</button>
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button></div>
      </div>}

      {phase !== "setup" && <>
        <div className="pq-progress" aria-live="polite">
          <span>{items.filter(item => ["ready", "sent", "sending", "failed"].includes(item.status)).length} of {items.length} written{credits ? ` · ${credits} credit${credits === 1 ? "" : "s"} used` : ""}{phase === "sending" ? " · sending…" : ""}</span>
          {phase === "writing" && <button type="button" className="button secondary small" onClick={() => abort.current?.abort()}><Square size={13} />Stop</button>}
        </div>
        {notice && <p className="mc-message" role="status">{notice}</p>}
        <ol className="pq-list">{items.map(item => <li key={item.id} className={`pq-card is-${item.status}${item.include ? "" : " is-excluded"}`}>
          <header>
            {item.email && ["ready", "error", "failed"].includes(item.status) && phase !== "sending" && <input type="checkbox" checked={item.include} aria-label={`Include ${item.name}`} onChange={event => patch(item.id, { include: event.target.checked })} />}
            <div><strong>{item.name}</strong><small>{[item.company, item.email || "no email address"].filter(Boolean).join(" · ")}</small></div>
            <span className={`pq-status is-${item.status}`}>{item.status === "writing" ? "Writing…" : item.status === "waiting" ? "Waiting" : item.status === "ready" ? (PLACEHOLDER.test(item.body) || PLACEHOLDER.test(item.subject) ? "Fill in [ ]" : "Ready") : item.status === "sending" ? "Sending…" : item.status === "sent" ? <><Check size={12} />Sent</> : item.status === "failed" ? "Not sent" : "Couldn't write"}</span>
          </header>
          {(item.status === "writing" && item.body) || ["ready", "sent", "failed", "sending"].includes(item.status) ? <>
            <input aria-label={`Subject for ${item.name}`} value={item.subject} readOnly={item.status !== "ready" && item.status !== "failed"} placeholder="Subject" onChange={event => patch(item.id, { subject: event.target.value })} />
            <textarea aria-label={`Email for ${item.name}`} value={item.body} rows={Math.min(12, Math.max(5, item.body.split("\n").length + 1))} readOnly={item.status !== "ready" && item.status !== "failed"} onChange={event => patch(item.id, { body: event.target.value })} />
          </> : null}
          {item.notes && (item.notes.niche || item.notes.audience) && <details className="pq-notes" open={item.notes.confidence === "low" || !!item.notes.check}><summary><span className={`pq-confidence is-${item.notes.confidence || "medium"}`}>{item.notes.confidence || "medium"} confidence</span>What Rex found</summary>
            <dl>{item.notes.niche && <><dt>Niche</dt><dd>{item.notes.niche}</dd></>}{item.notes.audience && <><dt>Audience</dt><dd>{item.notes.audience}</dd></>}{item.notes.angle && <><dt>Angle</dt><dd>{item.notes.angle}</dd></>}</dl>
            {item.notes.check && <p className="pq-check"><AlertTriangle size={12} />{item.notes.check}</p>}</details>}
          {item.error && <small className="mc-error">{item.error}</small>}
          {(item.status === "ready" || item.status === "error" || item.status === "failed") && phase !== "writing" && phase !== "sending" && <div className="mc-row-actions">
            <button type="button" className="button ghost small" onClick={() => void write([item])}><RotateCcw size={13} />Rewrite</button>
            {item.body && <button type="button" className="button ghost small" onClick={() => void navigator.clipboard.writeText(`${item.subject}\n\n${item.body}`).catch(() => undefined)}><Copy size={13} />Copy</button>}
          </div>}
        </li>)}</ol>
        {phase === "review" || phase === "done" ? <footer className="pq-foot">
          {needsFixing.length > 0 && <span className="mc-error">{needsFixing.length} email{needsFixing.length === 1 ? " has" : "s have"} [placeholders] or no subject; fix or untick {needsFixing.length === 1 ? "it" : "them"}.</span>}
          {mine.length > 0 && <button type="button" className="button primary" disabled={!ready.length || needsFixing.length > 0 || !mailbox} onClick={() => void send()}><Send size={15} />Send {ready.length} email{ready.length === 1 ? "" : "s"}{sender ? ` from ${sender.email}` : ""}</button>}
          <button type="button" className="button secondary" onClick={onClose}>{phase === "done" ? "Close" : "Close without sending"}</button>
        </footer> : null}
      </>}
  </Modal>;
}
