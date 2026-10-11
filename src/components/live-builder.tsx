"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, FileCode2, Hammer, ImageIcon, ListChecks, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { EFFORT_LEVELS, EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import type { SitePlan } from "@/lib/builder/plan";
import PlanCard from "./plan-card";
import { usePlanMode } from "./use-plan-mode";

type Activity = { id: string; kind: "file" | "image" | "note" | "error"; label: string; done: boolean };
type Turn = { id: string; role: "user" | "assistant"; text: string; activity: Activity[]; state: "streaming" | "done" | "error"; credits?: number; plan?: { title: string; revision: number } | true };
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
export default function LiveBuilder({ accountId, workspaceId, artifactId, version, history, baseFiles, baseAssets, defaultEffort, disabled, autoStart, autoStartMode, onLive, onSaved }: {
  accountId: string; workspaceId: string; artifactId: string; version: number;
  history: { number: number; summary: string }[];
  baseFiles: Record<string, string>; baseAssets: { id: string; path: string }[];
  defaultEffort?: EffortLevel; disabled?: boolean; autoStart?: string | null;
  /** "plan" starts the first message in Plan mode (from a Plan-first creation). */
  autoStartMode?: "create" | "plan";
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
  const input = useRef<HTMLTextAreaElement>(null);
  const [chosenMode, setMode] = useState<"create" | "plan" | null>(null);
  const planner = usePlanMode({ accountId, workspaceId, artifactId });
  // An open draft plan from an earlier session keeps the composer in Plan mode.
  const mode = chosenMode ?? (planner.restored ? "plan" : "create");
  const draftPlan = planner.active && planner.active.stored.status === "draft" ? planner.active : null;

  const refreshBalance = useCallback(() => {
    fetch("/api/credits", { cache: "no-store", headers: { "X-Makeborne-Account": accountId } })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (value && typeof value.available === "number") setBalance({ available: value.available, unlimited: Boolean(value.unlimited) }); })
      .catch(() => undefined);
  }, [accountId]);
  useEffect(() => { refreshBalance(); }, [refreshBalance]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [turns]);

  const update = (id: string, change: (turn: Turn) => Turn) => setTurns(current => current.map(turn => turn.id === id ? change(turn) : turn));

  const send = useCallback(async (text: string, files: Attachment[] = [], options?: { plan?: SitePlan; effort?: EffortLevel }) => {
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
        body: JSON.stringify({ workspaceId, artifactId, expectedVersion: version, message: text.trim(), effort: options?.effort ?? effort,
          attachments: files.map(({ name, mediaType, data }) => ({ name, mediaType, data })), ...(options?.plan ? { plan: options.plan } : {}) }),
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
              if (options?.plan) planner.markBuilt(options.plan);
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
  }, [accountId, artifactId, baseAssets, baseFiles, busy, disabled, effort, onLive, onSaved, planner, refreshBalance, version, workspaceId]);

  /** Plan mode: investigate and propose an editable plan; never writes code.
   * A message while a draft plan is open revises that plan. */
  const plan = useCallback(async (text: string, files: Attachment[] = []) => {
    if (!text.trim() || busy || disabled) return;
    setBusy(true); setNotice(""); setDraft(""); setAttachments([]);
    setMode("plan");
    const revise = draftPlan?.stored.plan ?? null;
    const userTurn: Turn = { id: newId(), role: "user", text: text.trim() + (files.length ? `\n📎 ${files.map(file => file.name).join(", ")}` : ""), activity: [], state: "done" };
    const reply: Turn = { id: newId(), role: "assistant", text: "", activity: [{ id: "status", kind: "note", label: revise ? "Revising the plan…" : "Planning…", done: false }], state: "streaming", plan: true };
    setTurns(current => [...current, userTurn, reply]);
    await planner.run({ turnId: reply.id, message: text.trim(), effort, expectedVersion: version, revise,
      attachments: files.map(({ name, mediaType, data }) => ({ name, mediaType, data })) }, {
      onText: delta => update(reply.id, turn => ({ ...turn, text: turn.text + delta })),
      onStatus: message => update(reply.id, turn => ({ ...turn, activity: [{ id: "status", kind: "note", label: message, done: false }] })),
      onCredits: credits => update(reply.id, turn => ({ ...turn, credits })),
      onPlan: active => update(reply.id, turn => ({ ...turn, plan: { title: active.stored.plan.title, revision: active.stored.revision } })),
      onDone: charged => update(reply.id, turn => ({ ...turn, state: "done", credits: charged, activity: [] })),
      onError: message => update(reply.id, turn => ({ ...turn, state: "error", plan: undefined, text: `${turn.text.trim() ? `${turn.text.trim()}\n\n` : ""}${message}`, activity: [] })),
    });
    setBusy(false);
    refreshBalance();
  }, [busy, disabled, draftPlan, effort, planner, refreshBalance, version]);
  const submit = (text: string, files: Attachment[] = []) => void (mode === "plan" ? plan(text, files) : send(text, files));
  const buildPlan = (approved: SitePlan, level: EffortLevel) => {
    setMode("create"); setEffort(level);
    void send(`Build the approved plan: ${approved.title}`, [], { plan: approved, effort: level });
  };
  const revisePlan = () => { setMode("plan"); input.current?.focus(); };
  const planCard = (active: NonNullable<typeof planner.active>) => <PlanCard key={`${active.turnId}:${active.stored.revision}`} plan={active.stored.plan} estimate={active.estimate} recommended={active.recommended}
    revision={active.stored.revision} built={active.stored.status === "built"} save={active.save} busy={busy || disabled}
    onChange={planner.edit} onBuild={buildPlan} onRevise={revisePlan} />;

  useEffect(() => {
    if (!autoStart || started.current || disabled || turns.length) return;
    started.current = true;
    void (autoStartMode === "plan" ? plan(autoStart) : send(autoStart));
  }, [autoStart, autoStartMode, disabled, plan, send, turns.length]);

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

  const empty = !turns.length && !history.length && !planner.restored;
  return <aside className="lb" aria-label="Builder chat">
    <div className="lb-log" ref={log} aria-live="polite">
      {empty && <div className="lb-intro"><Sparkles size={18} /><h3>What should we build?</h3><p>Describe the website, its audience and the feeling you want. Attach a logo, screenshot or brief for reference. Then keep chatting to refine it.</p></div>}
      {!!history.length && <details className="lb-history"><summary>{history.length} earlier change{history.length === 1 ? "" : "s"}</summary>
        <ol>{history.map(item => <li key={item.number}><strong>v{item.number}</strong> {item.summary}</li>)}</ol></details>}
      {planner.restored && <div className="lb-turn lb-assistant">
        {planner.active?.turnId === planner.restored.turnId ? <><p>Here is the plan we left off with. Edit anything, reply to revise it, or build it.</p>{planCard(planner.active)}</>
          : <div className="pc pc-collapsed"><ListChecks size={14} /><span>Earlier plan · <strong>{planner.restored.stored.plan.title}</strong> — revised below</span></div>}
      </div>}
      {turns.map(turn => <div key={turn.id} className={`lb-turn lb-${turn.role}`} data-state={turn.state}>
        {turn.text && <p>{turn.text}</p>}
        {turn.plan && planner.active?.turnId === turn.id && planCard(planner.active)}
        {typeof turn.plan === "object" && planner.active?.turnId !== turn.id && <div className="pc pc-collapsed"><ListChecks size={14} /><span>Plan v{turn.plan.revision} · <strong>{turn.plan.title}</strong> — revised below</span></div>}
        {!!turn.activity.length && <ul className="lb-activity">{turn.activity.map(item => <li key={item.id} data-done={item.done}>
          {item.done ? <Check size={13} /> : <Loader2 size={13} className="lb-spin" />}
          {item.kind === "image" ? <ImageIcon size={13} /> : item.kind === "file" ? <FileCode2 size={13} /> : null}
          <span>{item.label}</span></li>)}</ul>}
        {turn.role === "assistant" && turn.state === "streaming" && !turn.text && !turn.activity.length && <p className="lb-thinking"><Loader2 size={14} className="lb-spin" /> Thinking…</p>}
        {turn.role === "assistant" && typeof turn.credits === "number" && turn.credits > 0 && <small className="lb-cost">{turn.state === "streaming" ? `${turn.credits} credits so far` : `${turn.credits} credits`}</small>}
      </div>)}
    </div>
    <form className="lb-composer" data-mode={mode} onSubmit={event => { event.preventDefault(); submit(draft, attachments); }}>
      {mode === "plan" && <p className="lb-plan-note"><ListChecks size={12} />{draftPlan ? "Plan mode — your reply revises the plan above." : "Plan mode — I'll study your project and propose a plan. No code is written."}</p>}
      {!!attachments.length && <ul className="lb-files">{attachments.map((file, index) => <li key={`${file.name}:${index}`}>{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments(attachments.filter((_, item) => item !== index))}><X size={12} /></button></li>)}</ul>}
      <textarea ref={input} aria-label="Message the builder" placeholder={mode === "plan" ? draftPlan ? "Revise the plan — e.g. add a pricing page, warmer palette" : "What should we plan? Describe the site or the change" : empty ? "A premium website for a makeup brand selling three products…" : "Ask for a change — e.g. make the hero bolder and add an FAQ"} value={draft} rows={3} maxLength={8000} disabled={busy || disabled}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(draft, attachments); } }} />
      <div className="lb-controls">
        <div className="lb-mode" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "create"} disabled={busy} onClick={() => setMode("create")} title="Build: edit the website directly"><Hammer size={12} />Build</button>
          <button type="button" aria-pressed={mode === "plan"} disabled={busy} onClick={() => setMode("plan")} title="Plan: propose an editable plan first, no code"><ListChecks size={12} />Plan</button>
        </div>
        <label className="lb-attach" aria-label="Attach files"><Paperclip size={15} /><input type="file" multiple accept={ACCEPT} disabled={busy || disabled} onChange={event => { void attach(event.target.files); event.target.value = ""; }} /></label>
        <select aria-label="Effort" value={effort} disabled={busy} onChange={event => setEffort(event.target.value as EffortLevel)} title={EFFORT_PRESENTATION[effort].purpose}>
          {EFFORT_LEVELS.map(level => <option key={level} value={level}>{EFFORT_PRESENTATION[level].label}</option>)}
        </select>
        <span className="lb-balance">{balance ? balance.unlimited ? "Unlimited credits" : `${balance.available} credits` : ""}</span>
        <button type="submit" className="lb-send" aria-label={mode === "plan" ? "Plan" : "Send"} disabled={busy || disabled || !draft.trim()}>{busy ? <Loader2 size={16} className="lb-spin" /> : <ArrowUp size={16} />}</button>
      </div>
      {(notice || disabled) && <p className="lb-notice" role="status">{notice || "Save or resolve the current draft before building."}</p>}
    </form>
  </aside>;
}
