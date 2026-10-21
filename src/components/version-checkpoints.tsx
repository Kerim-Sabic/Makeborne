"use client";
/** Personal version checkpoints in History (audit M11). Labels only: marking,
 * renaming or removing one never edits, restores, approves or publishes a version. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkMinus, Pencil } from "lucide-react";
import { CHECKPOINT_LIMITS, checkpointKey, parseCheckpoints, removeCheckpoint, saveCheckpoint, serializeCheckpoints, type Checkpoint, type CheckpointScope } from "@/lib/cloud/version-checkpoints";

function readStore(key: string): { list: Checkpoint[]; available: boolean } {
  try { return { list: parseCheckpoints(localStorage.getItem(key)), available: true }; }
  catch { return { list: [], available: false }; }
}

/** This account's checkpoints for one project, in this browser. Other tabs' changes are picked up. */
export function useVersionCheckpoints(scope: CheckpointScope) {
  const key = checkpointKey(scope);
  const [state, setState] = useState<{ key: string; list: Checkpoint[]; available: boolean }>({ key, list: [], available: true });
  useEffect(() => {
    queueMicrotask(() => setState({ key, ...readStore(key) }));
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) setState({ key, ...readStore(key) }); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  const list = state.key === key ? state.list : [];
  /** Re-reads before writing so a save in another tab is not overwritten. Returns an error message, or null. */
  const write = useCallback((change: (current: Checkpoint[]) => { ok: true; checkpoints: Checkpoint[] } | { ok: false; message: string }): string | null => {
    const current = readStore(key);
    if (!current.available) return "Checkpoints need browser storage, which isn't available here.";
    const next = change(current.list);
    if (!next.ok) return next.message;
    try { localStorage.setItem(key, serializeCheckpoints(next.checkpoints)); }
    catch { return "This browser couldn't store the checkpoint. Its storage may be full or blocked."; }
    setState({ key, list: next.checkpoints, available: true });
    return null;
  }, [key]);
  const save = useCallback((version: { id: string; number: number }, name: string, note: string) => write(current => saveCheckpoint(current, version, name, note)), [write]);
  const remove = useCallback((versionId: string) => write(current => ({ ok: true, checkpoints: removeCheckpoint(current, versionId) })), [write]);
  return { list, available: state.key !== key || state.available, save, remove };
}

/** The checkpoint line and controls on one History row. */
export function CheckpointControl({ version, checkpoint, onSave, onRemove }: {
  version: { id: string; number: number };
  checkpoint: Checkpoint | undefined;
  onSave: (name: string, note: string) => string | null;
  onRemove: () => string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const formId = `checkpoint-${version.id}`;
  const open = () => { setName(checkpoint?.name ?? ""); setNote(checkpoint?.note ?? ""); setError(""); setStatus(""); setEditing(true); };
  const close = () => { setEditing(false); setError(""); queueMicrotask(() => trigger.current?.focus()); };
  return <div className="cloud-checkpoint">
    {checkpoint && !editing && <>
      <span className="cloud-checkpoint-badge"><Bookmark size={12} aria-hidden="true" /><span>Checkpoint: <strong>{checkpoint.name}</strong></span></span>
      {checkpoint.note && <p className="cloud-checkpoint-note">{checkpoint.note}</p>}
    </>}
    {editing ? <form className="cloud-checkpoint-form" id={formId} aria-label={`Checkpoint for version ${version.number}`}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
      onSubmit={event => {
        event.preventDefault();
        const problem = onSave(name, note);
        if (problem) { setError(problem); return; }
        setStatus(checkpoint ? "Checkpoint renamed. The version itself is unchanged." : `Version ${version.number} marked as a checkpoint. The version itself is unchanged.`);
        close();
      }}>
      <label>Checkpoint name<input autoFocus value={name} maxLength={CHECKPOINT_LIMITS.name} required onChange={event => setName(event.target.value)} placeholder="For example: Client's favourite layout" /></label>
      <label>Note (optional)<textarea value={note} maxLength={CHECKPOINT_LIMITS.note} rows={2} onChange={event => setNote(event.target.value)} /></label>
      <p className="small-note">Private to you in this browser until you sign out. A checkpoint helps you find this version again; it doesn&apos;t approve, publish or change it.</p>
      {error && <p className="cloud-checkpoint-error" role="alert">{error}</p>}
      <div className="cloud-checkpoint-actions">
        <button type="submit" className="button secondary small">{checkpoint ? "Save name" : "Save checkpoint"}</button>
        <button type="button" className="button secondary small" onClick={close}>Cancel</button>
      </div>
    </form> : <div className="cloud-checkpoint-actions">
      <button ref={trigger} type="button" className="button secondary small" onClick={open}>
        {checkpoint ? <><Pencil size={13} aria-hidden="true" /> Rename checkpoint</> : <><Bookmark size={13} aria-hidden="true" /> Mark version {version.number} as a checkpoint</>}
      </button>
      {checkpoint && <button type="button" className="button secondary small" onClick={() => {
        const problem = onRemove();
        setStatus(problem ?? "Checkpoint removed. The version is still in History.");
        queueMicrotask(() => trigger.current?.focus());
      }}><BookmarkMinus size={13} aria-hidden="true" /> Remove checkpoint</button>}
    </div>}
    {status && !editing && <p className="small-note" role="status">{status}</p>}
  </div>;
}
