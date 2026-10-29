"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import type { CloudArtifact, CloudProject, CloudVersion } from "@/lib/cloud/contracts";
import { RENAME_MAX, RENAME_REASON, checkRename, renameEffect, renameFailure, renameSuggestions, renameSummary, renamedContent, type RenameFailure } from "@/lib/projects/library-rename";
import { isPlaceholderTitle } from "@/lib/projects/project-title";
import { api } from "./cloud-api";

/**
 * A library card's action menu (menu button pattern): the trigger opens a
 * list of real actions only; arrow keys, Home and End move between them,
 * Escape closes and returns focus to the trigger, Tab closes and moves on.
 */
export type CardAction =
  | { id: string; label: string; icon?: ReactNode; onSelect: (trigger: HTMLButtonElement) => void }
  | { id: string; label: string; icon?: ReactNode; href: string };

const ITEM_HEIGHT = 40;
export function CardActionsMenu({ label, actions, disabled }: { label: string; actions: CardAction[]; disabled?: boolean }) {
  const [open, setOpen] = useState<null | { up: boolean; focus: "first" | "last" }>(null);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  function show(focus: "first" | "last") {
    const rect = trigger.current?.getBoundingClientRect();
    const height = actions.length * ITEM_HEIGHT + 12;
    // Open upwards only when the menu would not fit below and does fit above.
    setOpen({ up: !!rect && window.innerHeight - rect.bottom < height + 8 && rect.top > height + 8, focus });
  }
  const close = (returnFocus: boolean) => { setOpen(null); if (returnFocus) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const list = items();
    (open.focus === "last" ? list.at(-1) : list[0])?.focus();
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(null); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  if (!actions.length) return null;
  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const list = items(), at = list.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => { event.preventDefault(); list[(index + list.length) % list.length]?.focus(); };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab") setOpen(null);
  }
  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); show("first"); }
    else if (event.key === "ArrowUp") { event.preventDefault(); show("last"); }
  }
  const select = (action: CardAction) => {
    setOpen(null);
    if ("onSelect" in action && trigger.current) action.onSelect(trigger.current);
  };
  return <div className={`account-project-actions${open ? " open" : ""}`}>
    <button ref={trigger} type="button" className="account-project-menu" aria-label={label} title="Project actions" aria-haspopup="menu" aria-expanded={!!open} aria-controls={open ? id : undefined}
      disabled={disabled} onClick={() => open ? close(false) : show("first")} onKeyDown={onTriggerKey}><MoreHorizontal size={18} aria-hidden="true" /></button>
    {open && <div ref={menu} id={id} role="menu" aria-label={label} className={`account-project-menu-list${open.up ? " up" : ""}`} onKeyDown={onMenuKey}>
      {actions.map(action => "href" in action
        ? <a key={action.id} role="menuitem" tabIndex={-1} href={action.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(null)}>{action.icon}{action.label}</a>
        : <button key={action.id} type="button" role="menuitem" tabIndex={-1} onClick={() => select(action)}>{action.icon}{action.label}</button>)}
    </div>}
  </div>;
}

type Detail = { status: "loading" } | { status: "ready"; version: CloudVersion } | { status: "stale"; savedVersion: number } | { status: "error"; message: string };

/**
 * Rename one saved project: reads the current version through the editor's own
 * authorized route, then saves it again with only its title changed
 * (`expectedVersion` guards against a newer save). Suggestions are offered
 * only for a placeholder name and are never applied without Rename.
 */
export function RenameProjectDialog({ workspaceId, artifact, project, onClose, onRenamed, onRefresh }: {
  workspaceId: string; artifact: CloudArtifact; project: CloudProject | undefined;
  onClose: () => void; onRenamed: (artifact: CloudArtifact) => void; onRefresh: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<Detail>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState(artifact.title);
  const [hint, setHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<RenameFailure | null>(null);
  const savingRef = useRef(false);
  const headingId = useId(), noteId = useId(), hintId = useId();
  const placeholder = isPlaceholderTitle(artifact.title);
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    input.current?.select();
  }, []);
  useEffect(() => {
    let active = true;
    void api<{ artifact: CloudArtifact; versions: CloudVersion[] }>(`/api/cloud/workspaces/${workspaceId}/artifacts/${artifact.id}`).then(result => {
      if (!active) return;
      if (result.artifact.currentVersion !== artifact.currentVersion) return setDetail({ status: "stale", savedVersion: result.artifact.currentVersion });
      const version = result.versions.find(item => item.number === artifact.currentVersion);
      setDetail(version ? { status: "ready", version } : { status: "error", message: "The saved version couldn’t be read, so this project can’t be renamed right now." });
    }, error => { if (active) setDetail({ status: "error", message: renameFailure(error).message }); });
    return () => { active = false; };
  }, [workspaceId, artifact.id, artifact.currentVersion, attempt]);
  const ready = detail.status === "ready" ? detail.version : null;
  const ownDocument = ready?.content.document;
  const suggestions = ready ? renameSuggestions(artifact.title, artifact.kind, { documentTitle: ownDocument?.title, brief: project?.brief, projectTitle: project?.title }) : [];
  async function submit() {
    if (!ready || savingRef.current) return;
    const check = checkRename(name, artifact.title);
    if (!check.ok) { setHint(RENAME_REASON[check.reason]); input.current?.focus(); return; }
    savingRef.current = true; setSaving(true); setFailure(null); setHint("");
    try {
      const result = await api<{ artifact: CloudArtifact }>(`/api/cloud/workspaces/${workspaceId}/artifacts/${artifact.id}/versions`, {
        expectedVersion: ready.number, content: renamedContent(ready.content, check.name), style: ready.style, assetIds: ready.assetIds, changeSummary: renameSummary(check.name),
      }, "POST");
      onRenamed(result.artifact);
    } catch (error) { setFailure(renameFailure(error)); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="library-rename" aria-labelledby={headingId} aria-describedby={noteId}
    onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 id={headingId}>{placeholder ? "Name this project" : "Rename project"}</h2>
      <label className="library-rename-field"><span>Project name</span>
        <input ref={input} value={name} maxLength={RENAME_MAX} required autoComplete="off" spellCheck aria-invalid={hint ? true : undefined} aria-describedby={hint ? hintId : undefined}
          disabled={saving} onChange={event => { setName(event.target.value); setHint(""); }} /></label>
      {hint && <p id={hintId} className="library-rename-hint" role="alert">{hint}</p>}
      {suggestions.length > 0 && <fieldset className="library-rename-suggestions" disabled={saving}><legend>Suggested from this project’s saved brief and content</legend>
        {suggestions.map(suggestion => <button key={suggestion} type="button" aria-pressed={name.trim() === suggestion} onClick={() => { setName(suggestion); setHint(""); input.current?.focus(); }}>{suggestion}</button>)}
        <p className="small-note">Choosing a suggestion only fills in the name. Nothing changes until you press Rename.</p></fieldset>}
      <p id={noteId} className="small-note">{ready ? renameEffect(artifact.kind, ready.number + 1, Boolean(ownDocument)) : "Renaming saves a new version with the new name."}</p>
      {detail.status === "loading" && <p role="status" className="small-note">Checking the saved version…</p>}
      {detail.status === "stale" && <div className="library-rename-error" role="alert"><p>This project was saved again since the library loaded (now Version {detail.savedVersion}). Refresh the library before renaming it.</p>
        <button type="button" className="button secondary small" onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /> Refresh library</button></div>}
      {detail.status === "error" && <div className="library-rename-error" role="alert"><p>{detail.message}</p>
        <button type="button" className="button secondary small" onClick={() => { setDetail({ status: "loading" }); setAttempt(value => value + 1); }}><RefreshCw size={14} aria-hidden="true" /> Retry</button></div>}
      {failure && <div className="library-rename-error" role="alert"><p>{failure.message}</p>
        {failure.conflict && <button type="button" className="button secondary small" onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /> Refresh library</button>}</div>}
      <div className="library-rename-actions">
        <button type="button" className="button secondary small" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className="button primary small" disabled={!ready || saving}>{saving ? "Renaming…" : "Rename"}</button>
      </div>
    </form>
  </dialog>;
}
