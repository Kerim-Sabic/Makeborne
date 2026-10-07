"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronRight, FileText, History, Sparkles } from "lucide-react";
import BrandMark from "./brand-mark";
import ComposerControls from "./composer-controls";
import { DEFAULT_EFFORT, type EffortLevel } from "@/lib/routing/effort";
import { attachmentOwner, projectAttachmentKey } from "@/lib/attachments";
import { AttachFilesButton, AttachmentList, useFileAttachments, useFileDrop } from "./file-attachments";
import "@/app/build-workspace.css";

type Instruction = { id: string; text: string; mode: "create" | "plan"; effort: EffortLevel };
export default function BuildConversation({ projectKey, brief, kind, onOpenEditor, onOpenHistory, effort = DEFAULT_EFFORT, onEffort, readonly = false }: {
  projectKey: string; brief: string; kind: "website" | "book" | "presentation";
  onOpenEditor: () => void; onOpenHistory?: () => void;
  effort?: EffortLevel; onEffort?: (value: EffortLevel) => void; readonly?: boolean;
}) {
  return <Conversation key={projectKey} {...{ projectKey, brief, kind, onOpenEditor, onOpenHistory, effort, onEffort, readonly }} />;
}
function Conversation({ projectKey, brief, kind, onOpenEditor, onOpenHistory, effort, onEffort, readonly }: Parameters<typeof BuildConversation>[0] & { effort: EffortLevel }) {
  const [draft, setDraft] = useState("");
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [mode, setMode] = useState<"create" | "plan">("create");
  const [localEffort, setLocalEffort] = useState(effort);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [writable, setWritable] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const storageKey = `makeborne.project-conversation.v1:${projectKey}`;
  const currentEffort = onEffort ? effort : localEffort;
  const owner = projectKey.startsWith("device:") ? "device" : attachmentOwner(projectKey.split(":")[0]);
  const attachments = useFileAttachments(owner, projectAttachmentKey(projectKey));
  const drop = useFileDrop(attachments.add, readonly || !attachments.ready || attachments.busy);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const data = JSON.parse(raw);
          if (!data || typeof data.draft !== "string" || data.draft.length > 4000 || !Array.isArray(data.instructions) || data.instructions.length > 20 || data.instructions.some((item: Instruction) => !item || typeof item.id !== "string" || typeof item.text !== "string" || item.text.length > 4000 || !["create", "plan"].includes(item.mode) || !["light", "medium", "high", "super_high", "ultra"].includes(item.effort))) throw new Error("Invalid draft");
          setDraft(data.draft); setInstructions(data.instructions);
        }
      } catch { setWritable(false); setError("This conversation draft could not be loaded. Its original data is preserved."); }
      setReady(true);
    });
    return () => { active = false; };
  }, [storageKey]);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "0px";
    input.current.style.height = `${Math.min(120, Math.max(48, input.current.scrollHeight))}px`;
  }, [draft]);
  useLayoutEffect(() => {
    if (instructions.length && messages.current) messages.current.scrollTop = messages.current.scrollHeight;
  }, [instructions.length]);
  function persist(nextDraft: string, nextInstructions: Instruction[]) {
    if (!writable) return false;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ draft: nextDraft, instructions: nextInstructions })); return true; }
    catch { setError("This tab could not save your instruction. Keep a copy before leaving."); return false; }
  }
  function submit() {
    if (!draft.trim() || !ready || readonly) return;
    if (instructions.length >= 20) { setError("This tab has 20 saved instructions. Live generation must be connected before these can be applied."); return; }
    const next = [...instructions, { id: crypto.randomUUID(), text: draft.trim(), mode, effort: currentEffort }];
    if (!persist("", next)) return;
    setInstructions(next); setDraft(""); setError(""); input.current?.focus();
  }
  return <aside className="build-conversation" aria-label="Project conversation">
    <div className="build-conversation-heading"><span><BrandMark size={18} />Makeborne</span><span className="build-project-state"><i />Draft</span></div>
    <div className="build-messages" ref={messages}>
      {brief ? <article className="build-user-message"><small>Your brief</small><p>{brief}</p></article> : <div className="build-no-brief"><FileText size={18} /><p>Your {kind} workspace is ready for your content.</p></div>}
      <AttachmentList files={attachments.files} onRemove={readonly ? undefined : id => void attachments.remove(id)} disabled={attachments.busy} compact />
      <div className="build-system-message"><span className="build-system-mark"><BrandMark size={20} /></span><div><h2>Your idea has a home.</h2><p>Your project is saved. Review and shape your {kind} in the editor. Available generation controls appear beside the preview.</p><div className="build-quick-actions"><button type="button" onClick={onOpenEditor}><FileText size={14} />Edit content<ChevronRight size={13} /></button>{onOpenHistory && <button type="button" onClick={onOpenHistory}><History size={14} />Version history<ChevronRight size={13} /></button>}</div></div></div>
      {instructions.map(item => <article className="build-user-message build-followup" key={item.id}><small>{item.mode === "plan" ? "Planning note" : "Change request"}</small><p>{item.text}</p><span><Check size={11} />Saved in this tab · not applied</span></article>)}
    </div>
    <div className="build-compose-area">
      <div className="build-availability"><Sparkles size={12} />Project instructions</div>
      <form className={`build-composer${drop.dragging ? " is-file-dragging" : ""}`} {...drop.handlers} onSubmit={event => { event.preventDefault(); submit(); }}>
        {drop.dragging && <p className="attachment-drop-hint">Drop files to attach to this project</p>}
        <label className="sr-only" htmlFor={`build-message-${projectKey}`}>Message about your project</label>
        <textarea ref={input} id={`build-message-${projectKey}`} rows={2} value={draft} disabled={!ready || readonly} maxLength={4000} placeholder={mode === "plan" ? "What should we think through?" : "Describe what you’d like to change…"} onChange={event => { setDraft(event.target.value); persist(event.target.value, instructions); }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); } }} />
        <div className="build-composer-tools"><AttachFilesButton onFiles={attachments.add} disabled={readonly || !attachments.ready} busy={attachments.busy} compact /><ComposerControls mode={mode} onMode={setMode} effort={currentEffort} onEffort={value => { setLocalEffort(value); onEffort?.(value); }} /><button type="submit" disabled={!ready || !writable || readonly || !draft.trim()} aria-label="Save instruction for later" title="Save instruction for later"><ArrowUp size={16} /></button></div>
      </form>
      {attachments.error && <p className="attachment-error" role="alert">{attachments.error}</p>}
      <p className="build-compose-note" role={error ? "alert" : undefined}>{error || (readonly ? "You have read-only access to this project." : "Instructions save in this tab. No AI changes or charges.")}</p>
    </div>
  </aside>;
}
