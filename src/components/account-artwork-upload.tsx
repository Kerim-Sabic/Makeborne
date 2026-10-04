"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { uploadCloudImage } from "./cloud-api";

export default function AccountArtworkUpload({ accountId, workspaceId, artifactId, sectionNumber, disabled, onUploaded }: {
  accountId: string; workspaceId: string; artifactId: string; sectionNumber: number; disabled: boolean; onUploaded: (assetId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const callback = useRef(onUploaded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { callback.current = onUploaded; }, [onUploaded]);
  useEffect(() => () => { const request = active.current; active.current = null; request?.abort(); }, []);
  async function upload(file?: File) {
    if (!file || disabled || active.current) return;
    const abort = new AbortController(); active.current = abort;
    setBusy(true); setError("");
    const timeout = setTimeout(() => abort.abort(), 60_000);
    try {
      const id = await uploadCloudImage(`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/assets`, file, accountId, abort.signal);
      if (!abort.signal.aborted) callback.current(id);
    } catch (cause) { if (active.current === abort) setError(abort.signal.aborted ? "Upload timed out. Retry the same image to confirm it." : cause instanceof Error ? cause.message : "Upload could not be confirmed. Retry the same image."); }
    finally { clearTimeout(timeout); if (active.current === abort) { active.current = null; setBusy(false); } }
  }
  return <div className="account-artwork-upload">
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
    <button type="button" className="button secondary small" aria-label={`Add artwork to section ${sectionNumber}`} disabled={disabled || busy} onClick={() => input.current?.click()}><ImagePlus size={14} />{busy ? "Uploading artwork…" : "Add artwork"}</button>
    {error && <p role="alert" className="small-note">{error}</p>}
  </div>;
}
