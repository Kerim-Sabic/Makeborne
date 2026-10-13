"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Inbox, Mail, Pause, Play, Plus, RefreshCw, Square, Trash2, Workflow, FileText } from "lucide-react";
import Modal from "./modal";
import { mailApi, providerLabel, TOKEN_HELP, type Enrollment, type MailOverview, type MailSequence, type MailTemplate, type SequenceStep } from "./mail-api";

/** A proven starting point: every touch adds something; replies stop the sequence automatically. */
const STARTER_STEPS: SequenceStep[] = [
  { delayDays: 0, subject: "Quick idea for {{company|your business}}", body: "Hi {{first_name|there}},\n\nI looked at {{company|your website}} and noticed one thing that's probably costing you enquiries: [specific observation].\n\nWould it help if I sent over a short idea for fixing it?\n\n{{sender_first_name}}" },
  { delayDays: 3, subject: "", body: "Hi {{first_name|there}}, one example of what I meant: [a similar business and the result, or a short before/after]. Happy to sketch the same for you.\n\n{{sender_first_name}}" },
  { delayDays: 4, subject: "", body: "{{first_name|Hi}}, a quick, useful tip either way: [one practical improvement they can make themselves].\n\nIf you'd like me to handle it, just reply \"yes\".\n\n{{sender_first_name}}" },
  { delayDays: 7, subject: "", body: "Hi {{first_name|there}}, I'll stop here so I'm not crowding your inbox. If improving [the outcome] becomes a priority, just reply and I'll pick it up.\n\nAll the best,\n{{sender_first_name}}" },
];

export default function MailCenter({ accountId, workspaceId, canEdit, connectResult, onOpenClient }: {
  accountId: string; workspaceId: string; canEdit: boolean; connectResult: { result: string; detail: string } | null; onOpenClient: (id: string) => void;
}) {
  const [overview, setOverview] = useState<MailOverview | null>(null);
  const [message, setMessage] = useState(connectResult?.result === "connected" ? `Connected ${connectResult.detail}. You can now send and automate emails from it.` : connectResult?.result === "error" ? connectResult.detail : connectResult?.result === "cancelled" ? "Connection cancelled." : "");
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState<{ kind: "sequence"; value: Partial<MailSequence> } | { kind: "template"; value: Partial<MailTemplate> } | null>(null);
  const [openSequence, setOpenSequence] = useState<string | null>(null);
  const base = `/api/cloud/workspaces/${workspaceId}/mail`;
  const load = useCallback(async () => {
    try { setOverview(await mailApi<MailOverview>(accountId, base)); } catch (error) { setMessage(error instanceof Error ? error.message : "Email is unavailable."); }
  }, [accountId, base]);
  // Load after mount (from a callback, so the effect itself never sets state).
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function run() {
    setRunning(true); setMessage("");
    try {
      const result = await mailApi<{ replies: number; sent: number; waiting?: number; note?: string }>(accountId, `${base}/run`, "POST", {});
      setMessage(result.note ?? `Checked: ${result.replies} new repl${result.replies === 1 ? "y" : "ies"}, ${result.sent} email${result.sent === 1 ? "" : "s"} sent${result.waiting ? `, ${result.waiting} waiting for the sending pace` : ""}.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn't check now."); }
    finally { setRunning(false); }
  }
  async function act(action: () => Promise<unknown>, done: string) {
    setMessage("");
    try { await action(); setMessage(done); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "That didn't work. Try again."); }
  }

  if (!overview) return <div className="ac-skeleton ac-skeleton-detail" role="status" aria-label="Loading email"><span /><span /><span /></div>;
  const mine = overview.accounts.filter(account => account.mine && account.status !== "disconnected");
  return <section className="mc" aria-label="Email automation">
    <header className="mc-head">
      <div><h2>Email</h2><p>Send from your own Gmail or Outlook, run follow-up sequences that stop when someone replies, and see replies here. <strong className="mc-free">Sending is free.</strong> Only AI writing uses credits.</p></div>
      {mine.length > 0 && <button type="button" className="button secondary" disabled={running} onClick={() => void run()}><RefreshCw size={15} className={running ? "ac-spin" : undefined} />Check now</button>}
    </header>
    {message && <p className="mc-message" role="status">{message}</p>}
    {!overview.automation && mine.length > 0 && <p className="mc-note"><AlertTriangle size={14} /> Automatic sending runs on a schedule once email automation is switched on for this server. Until then, use <strong>Check now</strong> to send due emails and pick up replies.</p>}

    <div className="mc-grid">
      <section className="mc-card" aria-labelledby="mc-boxes"><h3 id="mc-boxes"><Mail size={16} />Mailboxes</h3>
        {overview.accounts.length === 0 && <p className="mc-empty">Connect the mailbox you already use, so emails come from you and replies land in your inbox.</p>}
        <ul className="mc-list">{overview.accounts.map(account => <li key={account.id}>
          <div><strong>{account.email}</strong><small>{providerLabel(account.provider)} · {account.status === "active" ? `${account.sentToday}/${account.todayQuota} sent today${account.todayQuota < account.dailyLimit ? " (warming up)" : ""}` : account.status === "error" ? "Needs reconnecting" : "Disconnected"}{account.mine ? "" : " · connected by a teammate"}</small>
            {account.lastError && account.status !== "active" && <small className="mc-error">{account.lastError}</small>}</div>
          {account.mine && canEdit && <div className="mc-row-actions">
            {account.status !== "active" && <a className="button secondary small" href={`/api/mail/connect?provider=${account.provider}&workspace=${workspaceId}`}>Reconnect</a>}
            {account.status === "active" && <select aria-label={`Daily limit for ${account.email}`} value={account.dailyLimit} onChange={event => void act(() => mailApi(accountId, `${base}/accounts`, "PATCH", { id: account.id, dailyLimit: Number(event.target.value) }), "Daily limit updated.")}>
              {[10, 20, 30, 50, 80, 120].map(limit => <option key={limit} value={limit}>{limit}/day max</option>)}</select>}
            {account.status !== "disconnected" && <button type="button" className="button ghost small" onClick={() => { if (window.confirm(`Disconnect ${account.email}? Running sequences on it will pause.`)) void act(() => mailApi(accountId, `${base}/accounts`, "DELETE", { id: account.id }), "Mailbox disconnected. Sent history is kept."); }}>Disconnect</button>}
          </div>}
        </li>)}</ul>
        {canEdit && <div className="mc-connect">
          {(["google", "microsoft"] as const).map(provider => overview.availability[provider]
            ? <a key={provider} className="button secondary small" href={`/api/mail/connect?provider=${provider}&workspace=${workspaceId}`}><Plus size={14} />Connect {providerLabel(provider)}</a>
            : <button key={provider} type="button" className="button secondary small" disabled title="Not set up on this server yet">Connect {providerLabel(provider)}</button>)}
          {!overview.availability.google && !overview.availability.microsoft && <small>Mailbox connections need to be set up by the Makeborne administrator first.</small>}
        </div>}
        <small className="mc-fine">New mailboxes warm up: 10 emails a day at first, rising gradually, with at least two minutes between automatic sends.</small>
      </section>

      <section className="mc-card" aria-labelledby="mc-replies"><h3 id="mc-replies"><Inbox size={16} />Recent replies</h3>
        {overview.replies.length === 0 ? <p className="mc-empty">Replies to emails sent from Makeborne appear here. A reply stops that client&apos;s sequence and moves them to Conversation.</p>
          : <ul className="mc-list">{overview.replies.map(reply => <li key={reply.id}><button type="button" className="mc-reply" disabled={!reply.clientId} onClick={() => reply.clientId && onOpenClient(reply.clientId)}>
            <strong>{reply.clientName}</strong><small>{new Date(reply.at).toLocaleString()} · {reply.from}</small><span>{reply.snippet || reply.subject}</span></button></li>)}</ul>}
      </section>
    </div>

    <section className="mc-card" aria-labelledby="mc-sequences">
      <div className="mc-card-head"><h3 id="mc-sequences"><Workflow size={16} />Sequences</h3>
        {canEdit && <div className="mc-row-actions"><button type="button" className="button secondary small" onClick={() => setEditing({ kind: "sequence", value: { name: "Follow-up sequence", steps: STARTER_STEPS, stopOnReply: true } })}><Plus size={14} />Use proven 4-step template</button>
          <button type="button" className="button secondary small" onClick={() => setEditing({ kind: "sequence", value: { name: "", steps: [{ delayDays: 0, subject: "", body: "" }], stopOnReply: true } })}><Plus size={14} />Blank</button></div>}</div>
      {overview.sequences.length === 0 ? <p className="mc-empty">A sequence is a series of emails sent days apart. Add clients from the list (select them, then &quot;Add to sequence&quot;).</p>
        : <ul className="mc-list">{overview.sequences.map(sequence => <li key={sequence.id} className="mc-sequence">
          <div><strong>{sequence.name}</strong><small>{sequence.steps.length} email{sequence.steps.length === 1 ? "" : "s"} over {sequence.steps.reduce((sum, step) => sum + step.delayDays, 0)} days · {["active", "paused", "replied", "completed"].filter(status => sequence.counts[status]).map(status => `${sequence.counts[status]} ${status}`).join(" · ") || "no clients yet"}</small></div>
          <div className="mc-row-actions">
            <button type="button" className="button ghost small" onClick={() => setOpenSequence(openSequence === sequence.id ? null : sequence.id)}>{openSequence === sequence.id ? "Hide clients" : "Clients"}</button>
            {canEdit && <button type="button" className="button ghost small" onClick={() => setEditing({ kind: "sequence", value: sequence })}>Edit</button>}
            {canEdit && <button type="button" className="button ghost small" aria-label={`Archive ${sequence.name}`} onClick={() => { if (window.confirm(`Archive "${sequence.name}"? Clients in it will stop receiving its emails.`)) void act(() => mailApi(accountId, `${base}/sequences`, "PATCH", { id: sequence.id, archived: true }), "Sequence archived."); }}><Trash2 size={14} /></button>}
          </div>
          {openSequence === sequence.id && <SequenceEnrollments accountId={accountId} workspaceId={workspaceId} sequenceId={sequence.id} canEdit={canEdit} onOpenClient={onOpenClient} />}
        </li>)}</ul>}
    </section>

    <section className="mc-card" aria-labelledby="mc-templates">
      <div className="mc-card-head"><h3 id="mc-templates"><FileText size={16} />Templates</h3>
        {canEdit && <button type="button" className="button secondary small" onClick={() => setEditing({ kind: "template", value: { name: "", subject: "", body: "" } })}><Plus size={14} />New template</button>}</div>
      {overview.templates.length === 0 ? <p className="mc-empty">Save emails you send often. Use them when writing to a client.</p>
        : <ul className="mc-list">{overview.templates.map(template => <li key={template.id}><div><strong>{template.name}</strong><small>{template.subject || "(no subject)"}</small></div>
          {canEdit && <div className="mc-row-actions"><button type="button" className="button ghost small" onClick={() => setEditing({ kind: "template", value: template })}>Edit</button>
            <button type="button" className="button ghost small" aria-label={`Delete ${template.name}`} onClick={() => { if (window.confirm(`Delete the "${template.name}" template?`)) void act(() => mailApi(accountId, `${base}/templates`, "DELETE", { id: template.id }), "Template deleted."); }}><Trash2 size={14} /></button></div>}</li>)}</ul>}
    </section>

    {editing?.kind === "sequence" && <SequenceEditor value={editing.value} onCancel={() => setEditing(null)} onSave={async sequence => {
      await mailApi(accountId, `${base}/sequences`, sequence.id ? "PATCH" : "POST", sequence); setEditing(null); setMessage("Sequence saved."); await load();
    }} />}
    {editing?.kind === "template" && <TemplateEditor value={editing.value} onCancel={() => setEditing(null)} onSave={async template => {
      await mailApi(accountId, `${base}/templates`, template.id ? "PATCH" : "POST", template); setEditing(null); setMessage("Template saved."); await load();
    }} />}
  </section>;
}

function SequenceEnrollments({ accountId, workspaceId, sequenceId, canEdit, onOpenClient }: { accountId: string; workspaceId: string; sequenceId: string; canEdit: boolean; onOpenClient: (id: string) => void }) {
  const [rows, setRows] = useState<Enrollment[] | null>(null);
  const [error, setError] = useState("");
  const path = `/api/cloud/workspaces/${workspaceId}/mail/enrollments`;
  const load = useCallback(async () => {
    try { setRows((await mailApi<{ enrollments: Enrollment[] }>(accountId, `${path}?sequence=${sequenceId}`)).enrollments); } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't load clients."); }
  }, [accountId, path, sequenceId]);
  // Load after mount (from a callback, so the effect itself never sets state).
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const change = async (id: string, action: "pause" | "resume" | "stop") => {
    try { await mailApi(accountId, path, "PATCH", { id, action }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "That didn't work."); }
  };
  if (!rows) return <p className="mc-fine">Loading clients…</p>;
  return <div className="mc-enrollments">
    {error && <p className="mc-error" role="alert">{error}</p>}
    {rows.length === 0 ? <p className="mc-fine">No clients in this sequence yet.</p> : <table><thead><tr><th>Client</th><th>Status</th><th>Next email</th><th /></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}>
        <td><button type="button" className="mc-link" onClick={() => onOpenClient(row.clientId)}>{row.clientName}<ArrowUpRight size={12} /></button><small>{row.clientEmail}</small></td>
        <td><span className={`mc-status is-${row.status}`}>{row.status === "replied" ? <CheckCircle2 size={12} /> : null}{row.status}</span>{row.lastError && <small className="mc-error">{row.lastError}</small>}</td>
        <td>{row.status === "active" && row.nextSendAt ? `Email ${row.nextStep + 1} · ${new Date(row.nextSendAt).toLocaleString()}` : "—"}</td>
        <td>{canEdit && <div className="mc-row-actions">
          {row.status === "active" && <button type="button" className="button ghost small" aria-label={`Pause for ${row.clientName}`} onClick={() => void change(row.id, "pause")}><Pause size={13} /></button>}
          {row.status === "paused" && <button type="button" className="button ghost small" aria-label={`Resume for ${row.clientName}`} onClick={() => void change(row.id, "resume")}><Play size={13} /></button>}
          {(row.status === "active" || row.status === "paused") && <button type="button" className="button ghost small" aria-label={`Stop for ${row.clientName}`} onClick={() => void change(row.id, "stop")}><Square size={13} /></button>}
        </div>}</td>
      </tr>)}</tbody></table>}
  </div>;
}

function SequenceEditor({ value, onSave, onCancel }: { value: Partial<MailSequence>; onSave: (sequence: { id?: string; name: string; steps: SequenceStep[]; stopOnReply: boolean }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(value.name ?? "");
  const [steps, setSteps] = useState<SequenceStep[]>(value.steps?.length ? value.steps : [{ delayDays: 0, subject: "", body: "" }]);
  const [stopOnReply, setStopOnReply] = useState(value.stopOnReply ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (index: number, patch: Partial<SequenceStep>) => setSteps(current => current.map((step, at) => at === index ? { ...step, ...patch } : step));
  const total = steps.reduce((sum, step) => sum + step.delayDays, 0);
  async function save() {
    setSaving(true); setError("");
    try { await onSave({ ...(value.id ? { id: value.id } : {}), name, steps, stopOnReply }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The sequence couldn't be saved."); }
    finally { setSaving(false); }
  }
  return <Modal label={value.id ? "Edit sequence" : "New sequence"} onClose={onCancel} locked={saving}>
    <h3 id="mc-seq-title">{value.id ? "Edit sequence" : "New sequence"}</h3>
    <label className="mc-field">Name<input value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="e.g. Local restaurants, October" /></label>
    <p className="mc-fine">Tokens: {TOKEN_HELP}. Later emails without a subject are sent as replies in the same thread. Total length: {total} days.</p>
    <ol className="mc-steps">{steps.map((step, index) => <li key={index}>
      <div className="mc-step-head"><strong>Email {index + 1}</strong>
        {index === 0 ? <span>Sent when a client is added</span> : <label>Wait<input type="number" min={1} max={60} value={step.delayDays} onChange={event => update(index, { delayDays: Math.max(1, Math.min(60, Number(event.target.value) || 1)) })} />days</label>}
        {steps.length > 1 && <button type="button" className="button ghost small" aria-label={`Remove email ${index + 1}`} onClick={() => setSteps(current => current.filter((_, at) => at !== index))}><Trash2 size={13} /></button>}</div>
      <input aria-label={`Subject of email ${index + 1}`} value={step.subject} maxLength={300} placeholder={index === 0 ? "Subject" : "Subject (leave empty to reply in the same thread)"} onChange={event => update(index, { subject: event.target.value })} />
      <textarea aria-label={`Body of email ${index + 1}`} value={step.body} rows={6} maxLength={20000} placeholder="Write the email…" onChange={event => update(index, { body: event.target.value })} />
    </li>)}</ol>
    {steps.length < 8 && <button type="button" className="button secondary small" onClick={() => setSteps(current => [...current, { delayDays: 3, subject: "", body: "" }])}><Plus size={14} />Add email</button>}
    <label className="mc-check"><input type="checkbox" checked={stopOnReply} onChange={event => setStopOnReply(event.target.checked)} />Stop when the client replies (recommended)</label>
    {error && <p className="mc-error" role="alert">{error}</p>}
    <div className="button-row"><button type="button" className="button primary" disabled={saving || !name.trim() || steps.some(step => !step.body.trim()) || !steps[0].subject.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save sequence"}</button>
      <button type="button" className="button secondary" disabled={saving} onClick={onCancel}>Cancel</button></div>
  </Modal>;
}

function TemplateEditor({ value, onSave, onCancel }: { value: Partial<MailTemplate>; onSave: (template: { id?: string; name: string; subject: string; body: string }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(value.name ?? ""), [subject, setSubject] = useState(value.subject ?? ""), [body, setBody] = useState(value.body ?? "");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    try { await onSave({ ...(value.id ? { id: value.id } : {}), name, subject, body }); } catch (cause) { setError(cause instanceof Error ? cause.message : "The template couldn't be saved."); }
    finally { setSaving(false); }
  }
  return <Modal label={value.id ? "Edit template" : "New template"} onClose={onCancel} locked={saving}>
    <h3 id="mc-tpl-title">{value.id ? "Edit template" : "New template"}</h3>
    <label className="mc-field">Name<input value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="e.g. Proposal follow-up" /></label>
    <label className="mc-field">Subject<input value={subject} maxLength={300} onChange={event => setSubject(event.target.value)} /></label>
    <label className="mc-field">Email<textarea value={body} rows={9} maxLength={20000} onChange={event => setBody(event.target.value)} /></label>
    <p className="mc-fine">Tokens: {TOKEN_HELP}</p>
    {error && <p className="mc-error" role="alert">{error}</p>}
    <div className="button-row"><button type="button" className="button primary" disabled={saving || !name.trim() || !body.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save template"}</button>
      <button type="button" className="button secondary" disabled={saving} onClick={onCancel}>Cancel</button></div>
  </Modal>;
}
