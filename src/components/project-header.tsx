"use client";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Eye, Globe2, LoaderCircle, MoreHorizontal } from "lucide-react";
import EditorMenu from "./editor-menu";
import "@/app/editor-chrome.css";

/**
 * Where saving stands, from the editor's own state. "saved" is shown only after the account
 * acknowledged the save (the editor clears `dirty` on a confirmed response or a fresh load);
 * every state that needs the person stays visible in the header, never only in a menu.
 */
export type SaveState = "loading" | "view-only" | "saved" | "unsaved" | "saving" | "failed" | "unconfirmed" | "conflict" | "recovery";

export function saveStateOf(input: { loaded: boolean; reviewer: boolean; dirty: boolean; busy: boolean; paused: boolean; uncertain: boolean; conflict: boolean; recovery: boolean }): SaveState {
  if (!input.loaded) return "loading";
  if (input.reviewer) return "view-only";
  if (input.uncertain) return "unconfirmed";
  if (input.conflict) return "conflict";
  if (input.recovery) return "recovery";
  if (input.paused) return "failed";
  if (input.dirty) return input.busy ? "saving" : "unsaved";
  return "saved";
}

const SAVE_COPY: Record<SaveState, { text: string; detail: (version: number) => string; tone: "quiet" | "busy" | "attention" }> = {
  loading: { text: "Opening…", detail: () => "Loading the latest saved version.", tone: "busy" },
  "view-only": { text: "View only", detail: version => `You can view saved version ${version}. Editing and saving need editor access.`, tone: "quiet" },
  saved: { text: "Saved", detail: version => `Version ${version} is saved to your account.`, tone: "quiet" },
  unsaved: { text: "Unsaved changes", detail: version => `Edits since version ${version} save automatically when you pause, or save them now.`, tone: "attention" },
  saving: { text: "Saving…", detail: version => `Saving your edits as the version after ${version}.`, tone: "busy" },
  failed: { text: "Save failed", detail: () => "Your edits are kept on this screen. Retry the save.", tone: "attention" },
  unconfirmed: { text: "Save not confirmed", detail: () => "The last save may or may not have reached your account. See the notice below.", tone: "attention" },
  conflict: { text: "Save paused", detail: () => "A newer version was saved elsewhere. Your draft is kept; see the notice below.", tone: "attention" },
  recovery: { text: "Draft on this device", detail: () => "An unsaved draft from this device is waiting. See the notice below.", tone: "attention" },
};

function SaveStatus({ state, version, onSave }: { state: SaveState; version: number; onSave: () => void }) {
  const copy = SAVE_COPY[state];
  const Icon = copy.tone === "busy" ? LoaderCircle : copy.tone === "attention" ? AlertTriangle : state === "view-only" ? Eye : Check;
  const action = state === "unsaved" ? "Save now" : state === "failed" ? "Retry save" : null;
  return <div className="ph-save" data-state={state} data-tone={copy.tone}>
    <span className="ph-save-text" title={copy.detail(version)}>
      <Icon size={14} aria-hidden="true" className={copy.tone === "busy" ? "lb-spin" : undefined} />
      <span>{copy.text}</span>
      <span className="chrome-sr">. {copy.detail(version)}</span>
    </span>
    {action && <button type="button" className={`ph-save-action${state === "failed" ? " is-primary" : ""}`} onClick={onSave}>{action}</button>}
  </div>;
}

export default function ProjectHeader({ title, kindLabel, version, save, onSave, onBack, details, publish, actions }: {
  title: string;
  /** Plain kind of the open project, e.g. "Website" or "Book outline". */
  kindLabel: string;
  version: number;
  save: SaveState;
  onSave: () => void;
  onBack: () => void;
  /** Saved, checked and live facts (websites) and the public address, shown in the project details popover. */
  details?: ReactNode;
  /** The publishing workflow for this project, when this person can open it. Opening it never publishes. */
  publish?: { open: () => void; current: boolean; description: string };
  /** Less frequent project actions (History, Client review, downloads). */
  actions: ReactNode;
}) {
  return <header className="project-header" data-editor-chrome="header">
    <button type="button" className="ph-icon" aria-label="Back to projects" title="Back to projects" onClick={onBack}><ArrowLeft size={18} /></button>
    <EditorMenu heading label={`${title}: project details`} className="ph-project" align="start" panelLabel="Project details" triggerClassName="ph-title-button"
      trigger={<><span className="ph-title-text">{title}</span><ChevronDown size={14} aria-hidden="true" /></>}>
      <div className="ph-details">
        <p className="ph-details-title">{title}</p>
        {/* Websites list saved, checked and live versions in `details`; other kinds name the saved version here. */}
        <p className="ph-details-kind">{details ? kindLabel : `${kindLabel} · ${version < 1 ? "not saved yet" : `saved version ${version}`}`}</p>
        {(!details || save !== "saved") && <p className="ph-details-save" data-tone={SAVE_COPY[save].tone}>{SAVE_COPY[save].detail(version)}</p>}
        {details}
      </div>
    </EditorMenu>
    <SaveStatus state={save} version={version} onSave={onSave} />
    <div className="ph-actions">
      {publish && <button type="button" className="ph-publish" aria-pressed={publish.current} title={publish.description} onClick={publish.open}><Globe2 size={15} aria-hidden="true" /><span>Publish</span></button>}
      <EditorMenu label="Project actions" className="ph-more" trigger={<MoreHorizontal size={18} aria-hidden="true" />} triggerClassName="ph-icon">{actions}</EditorMenu>
    </div>
  </header>;
}
