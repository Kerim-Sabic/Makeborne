"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Gem, Send, Sparkles, Square } from "lucide-react";
import type { CloudClient } from "@/lib/cloud/contracts";
import { localCalendarDay } from "@/lib/client-followups";
import { CHAT_MODES, type ChatMode } from "@/lib/expert-personas";
import { readExpertStream } from "./expert-stream";
import { addDays, quickUpdate } from "./client-quick-actions";

/** Rex writes the next follow-up from the client's saved record; the user edits, copies and logs it as sent. */
export default function ClientFollowUpDraft({ accountId, workspaceId, client, onLogged }: { accountId: string; workspaceId: string; client: CloudClient; onLogged: (client: CloudClient) => void }) {
  const [goal, setGoal] = useState("");
  const [tone, setTone] = useState<"warm" | "direct" | "formal">("warm");
  const [mode, setMode] = useState<ChatMode>("standard");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [charged, setCharged] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [logging, setLogging] = useState(false);
  const [followUpIn, setFollowUpIn] = useState(3);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function draft() {
    if (running) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(""); setText(""); setCharged(null); setStatus("Reading the client record…");
    const result = await readExpertStream(`/api/cloud/workspaces/${workspaceId}/clients/${client.id}/follow-up-draft`, { goal, tone, mode }, {
      signal: controller.signal, headers: { "X-Makeborne-Account": accountId },
      onText: value => { setText(value); setStatus(""); }, onStatus: setStatus,
    });
    abort.current = null;
    setRunning(false); setStatus("");
    if (result.error && !result.text) { setError(result.error.message); return; }
    setCharged(result.charged);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setError("Copy is blocked in this browser. Select the text to copy it."); }
  }
  async function logSent() {
    if (logging || !text.trim()) return;
    setLogging(true); setError("");
    try {
      const today = localCalendarDay(new Date());
      const updated = await quickUpdate(workspaceId, client.id, { kind: "contacted", nextFollowUp: addDays(today, followUpIn), note: `Sent: ${text.trim()}` }, today);
      onLogged(updated); setText(""); setCharged(null); setGoal("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't log the message. Try again."); }
    finally { setLogging(false); }
  }

  return <section className="fd-panel" aria-labelledby="fd-title">
    <header><span className="fd-icon" aria-hidden="true"><Sparkles size={16} /></span><div><h3 id="fd-title">Draft the next follow-up</h3><p>Rex, your sales advisor, writes it from this client&apos;s notes and history. You review and send it yourself.</p></div></header>
    <div className="fd-controls">
      <label className="fd-goal"><span>Goal (optional)</span><input maxLength={300} value={goal} disabled={running} placeholder="e.g. book a 15-minute call, share the proposal" onChange={event => setGoal(event.target.value)} /></label>
      <label><span>Tone</span><select value={tone} disabled={running} onChange={event => setTone(event.target.value as typeof tone)}><option value="warm">Warm</option><option value="direct">Direct</option><option value="formal">Formal</option></select></label>
      <label><span>Depth</span><select value={mode} disabled={running} onChange={event => setMode(event.target.value as ChatMode)} title={CHAT_MODES[mode].summary}><option value="standard">Standard · 1 credit</option><option value="genius">Genius · usage-based</option></select></label>
      {running
        ? <button type="button" className="button secondary" onClick={() => abort.current?.abort()}><Square size={14} /> Stop</button>
        : <button type="button" className="button primary" onClick={() => void draft()}>{mode === "genius" ? <Gem size={15} /> : <Sparkles size={15} />}{text ? "Write another" : "Write draft"}</button>}
    </div>
    {status && <p className="fd-status" role="status"><span />{status}</p>}
    {error && <p className="fd-error" role="alert">{error}</p>}
    {(text || running) && <>
      <textarea className="fd-text" value={text} readOnly={running} rows={Math.min(16, Math.max(6, text.split("\n").length + 1))} aria-label="Follow-up draft" onChange={event => setText(event.target.value)} />
      {!running && text && <div className="fd-actions">
        <button type="button" className="button secondary small" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>
        <label className="fd-next">Follow up again in<select value={followUpIn} onChange={event => setFollowUpIn(Number(event.target.value))}>{[2, 3, 5, 7, 14].map(days => <option key={days} value={days}>{days} days</option>)}</select></label>
        <button type="button" className="button primary small" disabled={logging} onClick={() => void logSent()}><Send size={14} />{logging ? "Logging…" : "I sent it: log it"}</button>
        {charged !== null && <small>{charged === 0 ? "No credits used" : `${charged} credit${charged === 1 ? "" : "s"}`}</small>}
      </div>}
    </>}
  </section>;
}
