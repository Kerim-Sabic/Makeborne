"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { ArtifactContent, StyleProfile } from "@/lib/domain";
import { accountExportRequest, type AccountExportFormat } from "@/lib/cloud/account-export";

export default function AccountExport({ documentId, content, style, dirty, disabled }: {
  documentId: string; content: ArtifactContent; style: StyleProfile; dirty: boolean; disabled: boolean;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<AccountExportFormat | null>(null);
  const [message, setMessage] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("");
  const [download, setDownload] = useState<{ url: string; name: string; format: string } | null>(null);
  const downloadUrl = useRef<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/capabilities", { signal: abort.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (!abort.signal.aborted) setAvailable(value?.manualExports?.available === true); })
      .catch(() => { if (!abort.signal.aborted) setAvailable(false); });
    return () => { abort.abort(); active.current?.abort(); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); };
  }, []);
  async function exportFile(format: AccountExportFormat) {
    if (active.current || !available || disabled) return;
    const abort = new AbortController(); active.current = abort;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 45_000);
    setBusy(format); setMessage("");
    try {
      const input = accountExportRequest(content, style, { format, documentId, author: author.trim() || undefined, language: language || undefined });
      const response = await fetch("/api/export", { method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error?.message || "The export could not finish. Your document is unchanged.");
      }
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = url;
      const link = document.createElement("a"); link.href = url;
      link.download = `${content.title.replace(/[^a-z0-9 -]/gi, "").slice(0, 70) || "makeborne"}.${format}`;
      setDownload({ url, name: link.download, format });
      link.click();
      setMessage(`${format.toUpperCase()} is ready. If the download did not start, use the link below. This file contains the draft as it was when you started the export.`);
    } catch (error) {
      if (timedOut) setMessage("The export took too long. Your document is unchanged; try again shortly.");
      else if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Export unavailable.");
    } finally {
      clearTimeout(timeout);
      if (active.current === abort) active.current = null;
      if (!abort.signal.aborted || timedOut) setBusy(null);
    }
  }
  const formats: AccountExportFormat[] = content.kind === "presentation" ? ["pptx", "pdf"] : content.kind === "book" ? ["pdf", "epub"] : ["html", "pdf"];
  return <section className="account-export" aria-label="Export project">
    <h3>Export</h3>
    <p>{available === null ? "Checking export availability…" : available ? "Development exports are available on this computer. Download the content currently in your editor." : "File rendering is not configured for this environment. Download your source draft above to keep a copy."}</p>
    {available && <>
      {dirty && <p className="account-export-note">This export includes your current unsaved edits.</p>}
      {content.kind === "book" && <fieldset disabled={!!busy || disabled}><legend>For this download</legend><label>Author (optional)<input maxLength={200} value={author} onChange={event => setAuthor(event.target.value)} /></label><label>Book language<select value={language} onChange={event => setLanguage(event.target.value)}><option value="">Choose for EPUB</option><option value="en">English</option><option value="bs">Bosnian</option><option value="hr">Croatian</option><option value="sr">Serbian</option><option value="de">German</option><option value="fr">French</option><option value="es">Spanish</option><option value="pl">Polish</option></select></label></fieldset>}
      <div className="button-row">{formats.map(format => <button className="button secondary small" type="button" key={format} disabled={!!busy || disabled || (format === "epub" && !language)} onClick={() => void exportFile(format)}><Download size={14} />{busy === format ? "Preparing…" : format === "pptx" ? "Editable PPTX" : format.toUpperCase()}</button>)}</div>
      <p className="account-export-note">{content.kind === "website" ? "HTML is a downloadable website file. It does not publish a live website." : content.kind === "presentation" ? "Text and shapes remain editable in PPTX. Image-generated slides are not part of this export." : "Exports use your current text and palette. Publishing-platform acceptance has not been verified."}</p>
    </>}
    {message && <p role="status">{message}</p>}
    {download && <a className="button secondary small" href={download.url} download={download.name}>Download prepared {download.format.toUpperCase()}</a>}
  </section>;
}
