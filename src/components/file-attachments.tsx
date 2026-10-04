"use client";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Download, File, FileText, LoaderCircle, Paperclip, X } from "lucide-react";
import { addAttachments, formatFileSize, readAttachments, removeAttachment, type Attachment } from "@/lib/attachments";
import "@/app/file-attachments.css";

export function useFileAttachments(owner: string | null, context: string) {
  const key = `${owner}/${context}`;
  const [state, setState] = useState<{ key: string; files: Attachment[]; ready: boolean; busy: boolean; error: string }>({ key: "", files: [], ready: false, busy: false, error: "" });
  const current = useRef(key);
  const locked = useRef(false);
  useEffect(() => {
    current.current = key;
    locked.current = false;
    let active = true;
    if (owner) void readAttachments(owner, context).then(files => {
      if (active) setState({ key, files, ready: true, busy: false, error: "" });
    }).catch(error => { if (active) setState({ key, files: [], ready: false, busy: false, error: error instanceof Error ? error.message : "Could not load files." }); });
    return () => { active = false; };
  }, [owner, context, key]);
  const ready = state.key === key && state.ready;
  async function mutate(run: () => Promise<Attachment[]>) {
    if (!owner || !ready || locked.current) return;
    locked.current = true;
    setState(value => ({ ...value, busy: true, error: "" }));
    try { const files = await run(); if (current.current === key) setState({ key, files, ready: true, busy: false, error: "" }); }
    catch (error) { if (current.current === key) setState(value => ({ ...value, busy: false, error: error instanceof Error ? error.message : "Could not save these files." })); }
    finally { if (current.current === key) locked.current = false; }
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
function FileChip({ file, onRemove, disabled }: { file: Attachment; onRemove?: (id: string) => void; disabled?: boolean }) {
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
  return <li className="attachment-chip">
    <a className="attachment-download" href={downloadUrl || undefined} download={file.name} aria-label={`Download ${file.name}`} title={`Download ${file.name}`}>
      <span className="attachment-thumbnail">{preview && !broken ? /* Local raster object URL; no remote optimizer or document execution. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" onError={() => setBroken(true)} /> : <Icon size={19} />}</span>
      <span className="attachment-details"><strong>{file.name}</strong><small>{formatFileSize(file.size)}<Download size={10} /></small></span>
    </a>
    {onRemove && <button type="button" className="attachment-remove" onClick={() => onRemove(file.id)} disabled={disabled} aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`}><X size={13} /></button>}
  </li>;
}
export function AttachmentList({ files, onRemove, disabled, compact = false }: { files: Attachment[]; onRemove?: (id: string) => void; disabled?: boolean; compact?: boolean }) {
  if (!files.length) return null;
  return <div className={`attachment-section${compact ? " is-compact" : ""}`}><ul className="attachment-list" aria-label="Attached files">{files.map(file => <FileChip key={file.id} file={file} onRemove={onRemove} disabled={disabled} />)}</ul><p className="attachment-note">Saved on this device · not yet read by AI</p></div>;
}
