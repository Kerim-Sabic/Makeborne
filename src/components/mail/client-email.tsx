"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Pause, Play, Send, Sparkles, Square, Workflow } from "lucide-react";
import { generateEmailDraft } from "./ai-draft";
import { mailApi, providerLabel, TOKEN_HELP, type Enrollment, type MailMessage, type MailOverview } from "./mail-api";

/** One client's email: the full thread, a composer that sends from your own mailbox, and their sequence. */
export default function ClientEmail({ accountId, workspaceId, client, canEdit, onSent, onOpenEmailCenter }: {
  accountId: string; workspaceId: string; client: { id: string; name: string; email: string }; canEdit: boolean; onSent: () => void; onOpenEmailCenter: () => void;
}) {
  const [messages, setMessages] = useState<MailMessage[] | null>(null);
  const [overview, setOverview] = useState<MailOverview | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [mailbox, setMailbox] = useState(""), [subject, setSubject] = useState(""), [body, setBody] = useState(""), [reply, setReply] = useState(false);
  const [sequence, setSequence] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [aiGoal, setAiGoal] = useState(""), [aiOpen, setAiOpen] = useState(false), [writing, setWriting] = useState<AbortController | null>(null);
  const base = `/api/cloud/workspaces/${workspaceId}`;
  const load = useCallback(async () => {
    try {
      const [thread, info, enrolled] = await Promise.all([
        mailApi<{ messages: MailMessage[] }>(accountId, `${base}/clients/${client.id}/mail`),
        mailApi<MailOverview>(accountId, `${base}/mail`),
        mailApi<{ enrollments: Enrollment[] }>(accountId, `${base}/mail/enrollments?client=${client.id}`),
      ]);
      setMessages(thread.messages); setOverview(info); setEnrollments(enrolled.enrollments);
      setMailbox(current => current || info.accounts.find(account => account.mine && account.status === "active")?.id || "");
      setReply(current => current || thread.messages.some(item => item.direction === "out" && item.status === "sent"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Email is unavailable."); }
  }, [accountId, base, client.id]);
  // Load after mount (from a callback, so the effect itself never sets state).
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const mine = overview?.accounts.filter(account => account.mine && account.status === "active") ?? [];
  const running = enrollments.find(item => item.status === "active" || item.status === "paused");
  async function send() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await mailApi(accountId, `${base}/clients/${client.id}/mail`, "POST", { accountId: mailbox, subject, body, reply });
      setSubject(""); setBody(""); setMessage(`Sent to ${client.email}. It's logged in this client's history.`); onSent(); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The email couldn't be sent."); }
    finally { setBusy(false); }
  }
  /** Haiku writes a personal email from the client record; the result lands in the composer to edit. */
  async function writeWithAi() {
    if (writing) { writing.abort(); return; }
    const controller = new AbortController();
    setWriting(controller); setError(""); setMessage("");
    const account = mine.find(item => item.id === mailbox);
    const result = await generateEmailDraft({ accountId, workspaceId, clientId: client.id, signal: controller.signal, onText: text => setBody(text),
      options: { goal: aiGoal, tone: "warm", mode: "standard", senderName: (account?.displayName || account?.email.split("@")[0] || "").split(/s+/)[0] } });
    setWriting(null);
    if (result.error && !result.text) { setError(result.error.message); return; }
    if (!reply) setSubject(result.subject); setBody(result.body);
    setMessage(`Draft ready${result.charged ? ` (${result.charged} credit${result.charged === 1 ? "" : "s"})` : ""}. Edit anything, then send.`);
  }
  async function enroll() {
    if (busy || !sequence) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await mailApi<{ enrolled: number; skipped: { reason: string }[] }>(accountId, `${base}/mail/enrollments`, "POST", { sequenceId: sequence, accountId: mailbox, clientIds: [client.id] });
      setMessage(result.enrolled ? "Added to the sequence. The first email goes out on the next check." : `Not added: ${result.skipped[0]?.reason ?? "unknown reason"}.`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't add to the sequence."); }
    finally { setBusy(false); }
  }
  async function change(id: string, action: "pause" | "resume" | "stop") {
    try { await mailApi(accountId, `${base}/mail/enrollments`, "PATCH", { id, action }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "That didn't work."); }
  }

  if (!messages || !overview) return error ? <p className="mc-error" role="alert">{error}</p> : <div className="ac-skeleton ac-skeleton-detail" role="status" aria-label="Loading email"><span /><span /></div>;
  return <section className="ce" aria-label={`Email with ${client.name}`}>
    {!client.email && <p className="mc-note"><AlertTriangle size={14} /> Add an email address in Contact details to email {client.name}.</p>}
    {mine.length === 0 && <p className="mc-note"><AlertTriangle size={14} /> Connect your Gmail or Outlook to email clients from Makeborne. <button type="button" className="mc-link" onClick={onOpenEmailCenter}>Open Email</button></p>}

    {running && <div className="ce-sequence"><Workflow size={15} /><span>In sequence <strong>{overview.sequences.find(item => item.id === running.sequenceId)?.name ?? "(archived)"}</strong> · {running.status === "active" && running.nextSendAt ? `email ${running.nextStep + 1} on ${new Date(running.nextSendAt).toLocaleString()}` : running.status}{running.lastError ? ` · ${running.lastError}` : ""}</span>
      {canEdit && <div className="mc-row-actions">
        {running.status === "active" ? <button type="button" className="button ghost small" onClick={() => void change(running.id, "pause")}><Pause size={13} />Pause</button> : <button type="button" className="button ghost small" onClick={() => void change(running.id, "resume")}><Play size={13} />Resume</button>}
        <button type="button" className="button ghost small" onClick={() => void change(running.id, "stop")}><Square size={13} />Stop</button></div>}</div>}

    <ol className="ce-thread">{messages.length === 0 ? <li className="mc-empty">No emails with {client.name} yet.</li> : messages.map(item => <li key={item.id} className={`ce-message is-${item.direction}${item.status === "failed" || item.status === "unknown" ? " is-problem" : ""}`}>
      <header>{item.direction === "in" ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}<strong>{item.direction === "in" ? client.name : "You"}</strong>
        <small>{new Date(item.at).toLocaleString()}{item.automated && item.step !== null ? ` · sequence email ${item.step + 1}` : ""}{item.status === "failed" ? " · not sent" : item.status === "unknown" ? " · check your Sent folder" : item.status === "sending" ? " · sending" : ""}</small></header>
      {item.subject && <p className="ce-subject">{item.subject}</p>}
      <p className="ce-body">{item.body}</p>
      {item.error && <small className="mc-error">{item.error}</small>}
    </li>)}</ol>

    {canEdit && mine.length > 0 && client.email && <div className="ce-compose">
      <div className="ce-compose-row">
        <label>From<select value={mailbox} onChange={event => setMailbox(event.target.value)}>{mine.map(account => <option key={account.id} value={account.id}>{account.email} ({providerLabel(account.provider)}) · {account.todayQuota - account.sentToday} left today</option>)}</select></label>
        {overview.templates.length > 0 && <label>Template<select value="" onChange={event => { const template = overview.templates.find(item => item.id === event.target.value); if (template) { setSubject(template.subject); setBody(template.body); } }}><option value="">Use a template…</option>{overview.templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>}
      </div>
      <div className="ce-ai">{aiOpen ? <><input aria-label="What should this email achieve?" value={aiGoal} maxLength={1000} placeholder="What should it achieve? e.g. follow up on the proposal and offer a call" onChange={event => setAiGoal(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void writeWithAi(); } }} />
        <button type="button" className="button secondary small" onClick={() => void writeWithAi()}>{writing ? <><Square size={13} />Stop</> : <><Sparkles size={13} />Write</>}</button></>
        : <button type="button" className="button secondary small" onClick={() => setAiOpen(true)}><Sparkles size={13} />Write with AI</button>}</div>
      <input aria-label="Subject" value={subject} maxLength={300} placeholder={reply ? "Subject (Re: is added when replying in the thread)" : "Subject"} onChange={event => setSubject(event.target.value)} />
      <textarea aria-label="Email" value={body} rows={7} maxLength={20000} placeholder={`Write to ${client.name}…`} onChange={event => setBody(event.target.value)} />
      <div className="ce-compose-foot">
        {messages.some(item => item.direction === "out" && item.status === "sent") && <label className="mc-check"><input type="checkbox" checked={reply} onChange={event => setReply(event.target.checked)} />Reply in the last thread</label>}
        <small>Sending is free. {TOKEN_HELP}</small>
        <button type="button" className="button primary" disabled={busy || !mailbox || !subject.trim() || !body.trim()} onClick={() => void send()}><Send size={15} />{busy ? "Sending…" : "Send"}</button>
      </div>
      {!running && overview.sequences.length > 0 && <div className="ce-compose-row ce-enroll"><label>Or start a sequence<select value={sequence} onChange={event => setSequence(event.target.value)}><option value="">Choose a sequence…</option>{overview.sequences.map(item => <option key={item.id} value={item.id}>{item.name} ({item.steps.length} emails)</option>)}</select></label>
        <button type="button" className="button secondary" disabled={busy || !sequence || !mailbox} onClick={() => void enroll()}><Workflow size={15} />Start sequence</button></div>}
    </div>}
    {message && <p className="mc-message" role="status">{message}</p>}
    {error && <p className="mc-error" role="alert">{error}</p>}
  </section>;
}
