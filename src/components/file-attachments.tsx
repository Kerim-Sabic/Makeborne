"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Ban, CircleAlert, CircleCheck, Download, File, FileText, HardDrive, LoaderCircle, Paperclip, RotateCcw, TriangleAlert, X } from "lucide-react";
import { addAttachments, formatFileSize, readAttachments, removeAttachment, type Attachment } from "@/lib/attachments";
import { analyzeSource, decideSources, type SourceAnalysis, type SourceEntry, type SourceInspector, type SourceReadiness, type SourceState } from "@/lib/builder/source-readiness";
import { ingestCapabilities, inspectSourceFile } from "@/lib/ingest/client";
import "@/app/file-attachments.css";

export function useFileAttachments(owner: string | null, context: string) {
  const key = `${owner}/${context}`;
  const [state, setState] = useState<{ key: string; files: Attachment[]; ready: boolean; busy: boolean; error: string }>({ key: "", files: [], ready: false, busy: false, error: "" });
  const current = useRef(key);
  const generation = useRef({ active: false });
  const locked = useRef(false);
  useEffect(() => {
    const session = { active: true };
    generation.current = session;
    current.current = key;
    locked.current = false;
    let active = true;
    if (owner) void readAttachments(owner, context).then(files => {
      if (active) setState({ key, files, ready: true, busy: false, error: "" });
    }).catch(error => { if (active) setState({ key, files: [], ready: false, busy: false, error: error instanceof Error ? error.message : "Could not load files." }); });
    return () => { active = false; session.active = false; };
  }, [owner, context, key]);
  const ready = state.key === key && state.ready;
  async function mutate(run: () => Promise<Attachment[]>) {
    if (!owner || !ready || locked.current) return;
    const startedGeneration = generation.current;
    const active = () => current.current === key && generation.current === startedGeneration && startedGeneration.active;
    locked.current = true;
    setState(value => ({ ...value, busy: true, error: "" }));
    try { const files = await run(); if (active()) setState({ key, files, ready: true, busy: false, error: "" }); }
    catch (error) { if (active()) setState(value => ({ ...value, busy: false, error: error instanceof Error ? error.message : "Could not save these files." })); }
    finally { if (active()) locked.current = false; }
  }
  return {
    files: state.key === key ? state.files : [], ready, busy: state.key === key && state.busy, error: state.key === key ? state.error : "",
    add: (files: File[]) => mutate(() => addAttachments(owner!, context, files)),
    remove: (id: string) => mutate(() => removeAttachment(owner!, context, id)),
  };
}
export function useFileDrop(add: (files: File[]) => Promise<void>, disabled = false) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return {
    dragging,
    handlers: {
      onDragEnter: (event: DragEvent) => { if (disabled || !event.dataTransfer.types.includes("Files")) return; event.preventDefault(); depth.current++; setDragging(true); },
      onDragOver: (event: DragEvent) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; },
      onDragLeave: (event: DragEvent) => { event.preventDefault(); if (--depth.current <= 0) { depth.current = 0; setDragging(false); } },
      onDrop: (event: DragEvent) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); depth.current = 0; setDragging(false); if (!disabled) void add(Array.from(event.dataTransfer.files)); },
    },
  };
}
export function AttachFilesButton({ onFiles, disabled, busy, compact = false }: { onFiles: (files: File[]) => Promise<void>; disabled?: boolean; busy?: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <span className={`attachment-picker${compact ? " is-compact" : ""}`}>
    <button type="button" className="attachment-add" disabled={disabled || busy} onClick={() => input.current?.click()} title="Attach any file · up to 25 MB each" aria-label="Attach files">{busy ? <LoaderCircle size={17} className="attachment-saving" /> : <Paperclip size={17} />}</button>
    <input ref={input} type="file" hidden multiple aria-label="Choose files to attach" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void onFiles(files); }} />
  </span>;
}
/** Pre-Send AI readiness for stored files. Analyses are cached by the immutable stored id,
 * so Retry re-reads exactly the same saved copy and Send binds exactly the listed files. */
/** The server-side ingestion check (Office/CSV/PDF coverage). When the server switch is off it reports
 * "not available" once and every file is analysed exactly as before. */
const SERVER_INSPECTOR: SourceInspector = { capabilities: ingestCapabilities, inspect: (file, mediaType) => inspectSourceFile(file, mediaType) };
export type SourceReadinessState = SourceReadiness & { retry: (id: string) => void; settle: () => Promise<SourceReadiness> };
export function useSourceReadiness(files: Attachment[], excluded: ReadonlySet<string>): SourceReadinessState {
  const [analyses, setAnalyses] = useState<ReadonlyMap<string, SourceAnalysis>>(() => new Map());
  const cache = useRef(new Map<string, SourceAnalysis>());
  const inflight = useRef(new Map<string, Promise<SourceAnalysis>>());
  const [attempt, setAttempt] = useState(0);
  const analyze = useCallback((file: Attachment) => {
    const running = inflight.current.get(file.id);
    if (running) return running;
    const next: Promise<SourceAnalysis> = analyzeSource(file, SERVER_INSPECTOR).then(result => {
      if (inflight.current.get(file.id) === next) { inflight.current.delete(file.id); cache.current.set(file.id, result); setAnalyses(new Map(cache.current)); }
      return result;
    });
    inflight.current.set(file.id, next);
    return next;
  }, []);
  useEffect(() => { files.forEach(file => { if (!excluded.has(file.id) && !cache.current.has(file.id)) void analyze(file); }); }, [analyze, attempt, excluded, files]);
  const report = useMemo(() => decideSources(files, analyses, excluded), [analyses, excluded, files]);
  const settle = useCallback(async () => {
    await Promise.all(files.filter(file => !excluded.has(file.id)).map(file => cache.current.get(file.id) ?? analyze(file)));
    return decideSources(files, cache.current, excluded);
  }, [analyze, excluded, files]);
  const retry = useCallback((id: string) => { cache.current.delete(id); inflight.current.delete(id); setAnalyses(new Map(cache.current)); setAttempt(value => value + 1); }, []);
  return { ...report, retry, settle };
}
const STATE_ICONS: Record<SourceState, typeof File> = { ready: CircleCheck, "local-only": HardDrive, unsupported: Ban, "too-large": TriangleAlert, failed: CircleAlert, partial: TriangleAlert, checking: LoaderCircle };
type ChipActions = { onRemove?: (id: string) => void; removeLabel?: (name: string) => string; onExclude?: (id: string) => void; onInclude?: (id: string) => void; onRetry?: (id: string) => void };
function FileChip({ file, entry, onRemove, removeLabel, onExclude, onInclude, onRetry, disabled }: { file: Attachment; entry?: SourceEntry; disabled?: boolean } & ChipActions) {
  const [preview, setPreview] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const download = URL.createObjectURL(file.blob.slice(0, file.blob.size, "application/octet-stream"));
    const image = file.previewType ? URL.createObjectURL(file.blob.slice(0, file.blob.size, file.previewType)) : "";
    queueMicrotask(() => { setDownloadUrl(download); setPreview(image); });
    return () => { URL.revokeObjectURL(download); if (image) URL.revokeObjectURL(image); };
  }, [file.blob, file.previewType]);
  const Icon = /\.(pdf|txt|md|docx?|rtf)$/i.test(file.name) ? FileText : File;
  const StateIcon = entry ? STATE_ICONS[entry.state] : null;
  const label = removeLabel ? removeLabel(file.name) : `Remove ${file.name}`;
  const canRetry = entry?.state === "failed" && !!onRetry;
  const canExclude = Boolean(entry && !entry.excluded && !entry.duplicateOf && entry.state !== "checking" && onExclude);
  const canInclude = !!entry?.excluded && !!onInclude;
  // An unreadable or partly readable file stops generation until the user chooses: remove it, or continue without it.
  const continueWithout = Boolean(entry && entry.state !== "ready" && (entry.state === "partial" || entry.sourceType));
  return <li className={`attachment-chip${entry ? " has-state" : ""}`} data-state={entry?.state}>
    <div className="attachment-row">
      <a className="attachment-download" href={downloadUrl || undefined} download={file.name} aria-label={`Download ${file.name}`} title={`Download ${file.name}`}>
        <span className="attachment-thumbnail">{preview && !broken ? /* Local raster object URL; no remote optimizer or document execution. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" onError={() => setBroken(true)} /> : <Icon size={19} />}</span>
        <span className="attachment-details"><strong>{file.name}</strong><small>{formatFileSize(file.size)}<Download size={10} /></small></span>
      </a>
      {onRemove && <button type="button" className="attachment-remove" onClick={() => onRemove(file.id)} disabled={disabled} aria-label={label} title={label}><X size={13} /></button>}
    </div>
    {entry && StateIcon && <>
      <p className="attachment-state"><StateIcon size={13} aria-hidden="true" className={entry.state === "checking" ? "attachment-saving" : undefined} /><span><strong>{entry.label}.</strong> {entry.reason}</span></p>
      {entry.details && entry.details.length > 0 && <ul className="attachment-details-list" aria-label={`What was and wasn’t read in ${file.name}`}>{entry.details.map(detail => <li key={detail}>{detail}</li>)}</ul>}
      {(canRetry || canExclude || canInclude) && <div className="attachment-actions">
        {canRetry && <button type="button" disabled={disabled} onClick={() => onRetry!(file.id)} aria-label={`Retry reading ${file.name}`}><RotateCcw size={12} aria-hidden="true" />Retry</button>}
        {canInclude && <button type="button" disabled={disabled} onClick={() => onInclude!(file.id)} aria-label={`Include ${file.name} in this request`}>Include</button>}
        {canExclude && <button type="button" disabled={disabled} onClick={() => onExclude!(file.id)} aria-label={continueWithout ? `Continue without ${file.name} for this request (the saved file is kept)` : `Leave ${file.name} out of this request (the saved file is kept)`}>{continueWithout ? "Continue without it" : "Leave out"}</button>}
      </div>}
    </>}
  </li>;
}
export function AttachmentList({ files, onRemove, disabled, compact = false, note = "Saved on this device · not yet read by AI", readiness, removeLabel, onExclude, onInclude, onRetry, readPrefix = "" }: {
  files: Attachment[]; disabled?: boolean; compact?: boolean; note?: string;
  /** When given, each file shows its AI state and the exact files bound to the next request. */
  readiness?: SourceReadiness; readPrefix?: string;
} & ChipActions) {
  if (!files.length) return null;
  const entries = new Map(readiness?.entries.map(entry => [entry.file.id, entry]));
  return <div className={`attachment-section${compact ? " is-compact" : ""}${readiness ? " has-readiness" : ""}`}>
    {readiness && <p className="attachment-heading">Source files <small>your uploads · AI reads them, never changes them</small></p>}
    {readiness && <div className="attachment-readiness" role="status" aria-live="polite" aria-atomic="true">
      <p className="attachment-read">{readPrefix}{readiness.readSummary}</p>
      {readiness.skippedSummary && <p className="attachment-skipped">{readiness.skippedSummary}</p>}
      {readiness.blocking.length > 0 && <p className="attachment-blocking">{readiness.blocking.some(entry => entry.state === "partial" || entry.sourceType)
        ? `Generation is stopped until you choose for ${readiness.blocking.map(entry => entry.file.name).join(", ")}: remove it${onExclude ? ", or continue without it" : ""}.`
        : `Retry or ${onExclude ? "leave out" : "remove"} ${readiness.blocking.map(entry => entry.file.name).join(", ")} before sending.`}</p>}
    </div>}
    <ul className="attachment-list" aria-label={readiness ? "Source files for this request" : "Attached files"}>{files.map(file => <FileChip key={file.id} file={file} entry={entries.get(file.id)} onRemove={onRemove} removeLabel={removeLabel} onExclude={onExclude} onInclude={onInclude} onRetry={onRetry} disabled={disabled} />)}</ul>
    <p className="attachment-note">{note}</p>
  </div>;
}
