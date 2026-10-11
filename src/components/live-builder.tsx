"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, FileCode2, ImageIcon, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";

type Activity = { id: string; kind: "file" | "image" | "note" | "error"; label: string; done: boolean };
type Turn = { id: string; role: "user" | "assistant"; text: string; activity: Activity[]; state: "streaming" | "done" | "error"; credits?: number };
type Attachment = { name: string; mediaType: string; data: string; size: number };
export type LiveUpdate = { files: Record<string, string>; assets: { id: string; path: string }[]; building: boolean };

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,.md,.txt";
const MAX_FILE = 6 * 1024 * 1024;
const readBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
const newId = () => crypto.randomUUID();

/** Chat-driven website builder: every message streams real edits into the
 * project, previews them live and saves a new version when finished. */
export default function LiveBuilder({ accountId, workspaceId, artifactId, version, history, baseFiles, baseAssets, defaultEffort, disabled, autoStart, onLive, onSaved }: {
  accountId: string; workspaceId: string; artifactId: string; version: number;
  history: { number: number; summary: string }[];
  baseFiles: Record<string, string>; baseAssets: { id: string; path: string }[];
  defaultEffort?: EffortLevel; disabled?: boolean; autoStart?: string | null;
  onLive: (update: LiveUpdate | null) => void;
  onSaved: () => Promise<void> | void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [effort, setEffort] = useState<EffortLevel>(defaultEffort ?? "medium");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [balance, setBalance] = useState<{ available: number; unlimited: boolean } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const refreshBalance = useCallback(() => {
    fetch("/api/credits", { cache: "no-store", headers: { "X-Makeborne-Account": accountId } })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (value && typeof value.available === "number") setBalance({ available: value.available, unlimited: Boolean(value.unlimited) }); })
      .catch(() => undefined);
  }, [accountId]);
  useEffect(() => { refreshBalance(); }, [refreshBalance]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [turns]);

  const update = (id: string, change: (turn: Turn) => Turn) => setTurns(current => current.map(turn => turn.id === id ? change(turn) : turn));

  const send = useCallback(async (text: string, files: Attachment[] = []) => {
    if (!text.trim() || busy || disabled) return;
    setBusy(true); setNotice(""); setDraft(""); setAttachments([]);
    const userTurn: Turn = { id: newId(), role: "user", text: text.trim() + (files.length ? `\n📎 ${files.map(file => file.name).join(", ")}` : ""), activity: [], state: "done" };
    const reply: Turn = { id: newId(), role: "assistant", text: "", activity: [], state: "streaming" };
    setTurns(current => [...current, userTurn, reply]);
    const live = { files: { ...baseFiles }, assets: [...baseAssets] };
    onLive({ ...live, building: true });
    const activity = (item: Omit<Activity, "id">, key?: string) => update(reply.id, turn => {
      const existing = key ? turn.activity.findIndex(entry => entry.id === key) : -1;
      if (existing >= 0) { const next = [...turn.activity]; next[existing] = { ...next[existing], ...item }; return { ...turn, activity: next }; }
      return { ...turn, activity: [...turn.activity, { id: key ?? newId(), ...item }] };
    });
    let finished = false;
    try {
      const response = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
        body: JSON.stringify({ workspaceId, artifactId, expectedVersion: version, message: text.trim(), effort,
          attachments: files.map(({ name, mediaType, data }) => ({ name, mediaType, data })) }),
      });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.error?.message ?? "The builder couldn't start. Please try again.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const line = chunk.split("\n").find(entry => entry.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          switch (event.type) {
            case "text": update(reply.id, turn => ({ ...turn, text: turn.text + event.delta })); break;
            case "status": activity({ kind: "note", label: event.message, done: false }, "status"); break;
            case "file_start": activity({ kind: "file", label: `${event.op === "edit" ? "Editing" : "Writing"} ${event.path}`, done: false }, `file:${event.path}`); break;
            case "file":
              live.files = { ...live.files, [event.path]: event.content };
              onLive({ ...live, building: true });
              activity({ kind: "file", label: `${event.op === "edit" ? "Edited" : "Wrote"} ${event.path}`, done: true }, `file:${event.path}`);
              break;
            case "delete": {
              const next = { ...live.files }; delete next[event.path]; live.files = next;
              onLive({ ...live, building: true });
              activity({ kind: "file", label: `Removed ${event.path}`, done: true }, `file:${event.path}`);
              break;
            }
            case "image_start": activity({ kind: "image", label: `Creating image: ${event.name}`, done: false }, `image:${event.name}`); break;
            case "image":
              live.assets = [...live.assets.filter(asset => asset.path !== event.path), { id: event.assetId, path: event.path }];
              onLive({ ...live, building: true });
              activity({ kind: "image", label: `Created ${event.url}`, done: true }, `image:${String(event.path).replace(/^public\/images\/|\.webp$/g, "")}`);
              break;
            case "tool_error": activity({ kind: "note", label: "Fixing an issue…", done: true }); break;
            case "usage": update(reply.id, turn => ({ ...turn, credits: event.credits })); break;
            case "done":
              finished = true;
              update(reply.id, turn => ({ ...turn, state: "done", text: turn.text.trim() ? `${turn.text.trim()}\n\n${event.summary}` : event.summary, credits: event.charged,
                activity: turn.activity.filter(item => item.id !== "status") }));
              break;
            case "error":
              finished = true;
              update(reply.id, turn => ({ ...turn, state: "error", text: `${turn.text.trim() ? `${turn.text.trim()}\n\n` : ""}${event.message}`, activity: turn.activity.filter(item => item.id !== "status") }));
              break;
          }
        }
      }
      if (!finished) update(reply.id, turn => ({ ...turn, state: "error", text: `${turn.text}\n\nThe connection closed early. If the build finished, it has been saved — reload to see it.` }));
    } catch (error) {
      update(reply.id, turn => ({ ...turn, state: "error", text: error instanceof Error ? error.message : "Something went wrong." }));
    } finally {
      setBusy(false);
      refreshBalance();
      await onSaved();
      onLive(null);
    }
  }, [accountId, artifactId, baseAssets, baseFiles, busy, disabled, effort, onLive, onSaved, refreshBalance, version, workspaceId]);

  useEffect(() => {
    if (!autoStart || started.current || disabled || turns.length) return;
    started.current = true;
    void send(autoStart);
  }, [autoStart, disabled, send, turns.length]);

  async function attach(list: FileList | null) {
    if (!list) return;
    const next = [...attachments];
    for (const file of Array.from(list)) {
      if (next.length >= 5) { setNotice("Attach up to five files."); break; }
      const mediaType = file.type || (file.name.endsWith(".md") ? "text/markdown" : "text/plain");
      if (!ACCEPT.split(",").includes(mediaType) || file.size > MAX_FILE) { setNotice(`${file.name} isn't supported. Use images, PDFs or text files under 6 MB.`); continue; }
      next.push({ name: file.name, mediaType, data: await readBase64(file), size: file.size });
    }
    setAttachments(next);
  }

  const empty = !turns.length && !history.length;
  return <aside className="lb" aria-label="Builder chat">
    <div className="lb-log" ref={log} aria-live="polite">
      {empty && <div className="lb-intro"><Sparkles size={18} /><h3>What should we build?</h3><p>Describe the website, its audience and the feeling you want. Attach a logo, screenshot or brief for reference. Then keep chatting to refine it.</p></div>}
      {!!history.length && <details className="lb-history"><summary>{history.length} earlier change{history.length === 1 ? "" : "s"}</summary>
        <ol>{history.map(item => <li key={item.number}><strong>v{item.number}</strong> {item.summary}</li>)}</ol></details>}
      {turns.map(turn => <div key={turn.id} className={`lb-turn lb-${turn.role}`} data-state={turn.state}>
        {turn.text && <p>{turn.text}</p>}
        {!!turn.activity.length && <ul className="lb-activity">{turn.activity.map(item => <li key={item.id} data-done={item.done}>
          {item.done ? <Check size={13} /> : <Loader2 size={13} className="lb-spin" />}
          {item.kind === "image" ? <ImageIcon size={13} /> : item.kind === "file" ? <FileCode2 size={13} /> : null}
          <span>{item.label}</span></li>)}</ul>}
        {turn.role === "assistant" && turn.state === "streaming" && !turn.text && !turn.activity.length && <p className="lb-thinking"><Loader2 size={14} className="lb-spin" /> Thinking…</p>}
        {turn.role === "assistant" && typeof turn.credits === "number" && turn.credits > 0 && <small className="lb-cost">{turn.state === "streaming" ? `${turn.credits} credits so far` : `${turn.credits} credits`}</small>}
      </div>)}
    </div>
    <form className="lb-composer" onSubmit={event => { event.preventDefault(); void send(draft, attachments); }}>
      {!!attachments.length && <ul className="lb-files">{attachments.map((file, index) => <li key={`${file.name}:${index}`}>{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments(attachments.filter((_, item) => item !== index))}><X size={12} /></button></li>)}</ul>}
      <textarea aria-label="Message the builder" placeholder={empty ? "A premium website for a makeup brand selling three products…" : "Ask for a change — e.g. make the hero bolder and add an FAQ"} value={draft} rows={3} maxLength={8000} disabled={busy || disabled}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft, attachments); } }} />
      <div className="lb-controls">
        <label className="lb-attach" aria-label="Attach files"><Paperclip size={15} /><input type="file" multiple accept={ACCEPT} disabled={busy || disabled} onChange={event => { void attach(event.target.files); event.target.value = ""; }} /></label>
        <select aria-label="Effort" value={effort} disabled={busy} onChange={event => setEffort(event.target.value as EffortLevel)} title={EFFORT_PRESENTATION[effort].purpose}>
          {EFFORT_LEVELS.map(level => <option key={level} value={level}>{EFFORT_PRESENTATION[level].label}</option>)}
        </select>
        <span className="lb-balance">{balance ? balance.unlimited ? "Unlimited credits" : `${balance.available} credits` : ""}</span>
        <button type="submit" className="lb-send" aria-label="Send" disabled={busy || disabled || !draft.trim()}>{busy ? <Loader2 size={16} className="lb-spin" /> : <ArrowUp size={16} />}</button>
      </div>
      {(notice || disabled) && <p className="lb-notice" role="status">{notice || "Save or resolve the current draft before building."}</p>}
    </form>
  </aside>;
}
