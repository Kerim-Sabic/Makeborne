"use client";
import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { RENAME_MAX, RENAME_REASON, checkRename, renameEffect, renameFailure, type RenameFailure } from "@/lib/projects/library-rename";
import type { TitleKind } from "@/lib/projects/project-title";
import "@/app/project-rename.css";

/** A failed rename from the open editor: a conflict asks to load the latest version (not to refresh a library); everything else as the library says it. */
export function editorRenameFailure(error: unknown): RenameFailure {
  const failure = renameFailure(error);
  return failure.conflict ? { message: "This project was saved again elsewhere, so it wasn’t renamed. Load the latest version and try again.", conflict: true } : failure;
}

/**
 * Rename the project open in the editor. The editor saves its current saved
 * version again with only the title changed (`onRename`), through the same
 * authorized version route and `expectedVersion` guard the library uses.
 * Same dialog, checks and wording as the library's rename.
 */
export default function ProjectRenameDialog({ kind, title, nextVersion, ownDocumentTitle, onRename, onClose, onLoadLatest }: {
  kind: TitleKind; title: string; nextVersion: number; ownDocumentTitle: boolean;
  onRename: (name: string) => Promise<void>; onClose: () => void; onLoadLatest: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(title);
  const [hint, setHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<RenameFailure | null>(null);
  const savingRef = useRef(false);
  const headingId = useId(), noteId = useId(), hintId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    input.current?.select();
  }, []);
  async function submit() {
    if (savingRef.current) return;
    const check = checkRename(name, title);
    if (!check.ok) { setHint(RENAME_REASON[check.reason]); input.current?.focus(); return; }
    savingRef.current = true; setSaving(true); setFailure(null); setHint("");
    try { await onRename(check.name); }
    catch (error) { setFailure(editorRenameFailure(error)); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="library-rename" aria-labelledby={headingId} aria-describedby={noteId}
    onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 id={headingId}>Rename project</h2>
      <label className="library-rename-field"><span>Project name</span>
        <input ref={input} value={name} maxLength={RENAME_MAX} required autoComplete="off" spellCheck aria-invalid={hint ? true : undefined} aria-describedby={hint ? hintId : undefined}
          disabled={saving} onChange={event => { setName(event.target.value); setHint(""); }} /></label>
      {hint && <p id={hintId} className="library-rename-hint" role="alert">{hint}</p>}
      <p id={noteId} className="small-note">{renameEffect(kind, nextVersion, ownDocumentTitle)}</p>
      {failure && <div className="library-rename-error" role="alert"><p>{failure.message}</p>
        {failure.conflict && <button type="button" className="button secondary small" onClick={onLoadLatest}><RefreshCw size={14} aria-hidden="true" /> Load the latest version</button>}</div>}
      <div className="library-rename-actions">
        <button type="button" className="button secondary small" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className="button primary small" disabled={saving}>{saving ? "Renaming…" : "Rename"}</button>
      </div>
    </form>
  </dialog>;
}
