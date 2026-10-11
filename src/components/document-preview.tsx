"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Maximize2 } from "lucide-react";
import type { DocumentSource } from "@/lib/documents/schema";
import { deckHtml } from "@/lib/documents/render-deck";
import { bookHtml } from "@/lib/documents/render-book";
import { wordCount } from "@/lib/documents/book-markup";
import { readCloudImage } from "./cloud-api";

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Live preview for presentations and books. Renders the same HTML the PDF
 * printer uses, inside a script-free sandboxed frame. */
export default function DocumentPreview({ document: doc, focus, scope, building, savedVersion, canExport }: {
  document: DocumentSource;
  focus?: string;
  scope: { accountId: string; workspaceId: string; artifactId: string };
  building?: boolean;
  savedVersion: number;
  canExport: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [html, setHtml] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "pptx" | null>(null);
  const [message, setMessage] = useState("");
  const cache = useRef(new Map<string, string>());
  const scroll = useRef(0);

  const assetKey = doc.assets.map(asset => `${asset.name}:${asset.id}`).sort().join("|");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const next: Record<string, string> = {};
      for (const asset of doc.assets) {
        let url = cache.current.get(asset.id);
        if (!url) {
          try {
            url = await toDataUrl(await readCloudImage(`/api/cloud/workspaces/${scope.workspaceId}/artifacts/${scope.artifactId}/assets/${asset.id}`, scope.accountId, controller.signal));
            cache.current.set(asset.id, url);
          } catch { continue; }
        }
        next[asset.name] = url;
      }
      if (!controller.signal.aborted) setImages(next);
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assetKey summarises the asset list
  }, [assetKey, scope.accountId, scope.workspaceId, scope.artifactId]);

  // Re-render shortly after changes settle; keep the reader's scroll position
  // and bring the item that just changed into view while building.
  useEffect(() => {
    const timer = setTimeout(() => {
      try { scroll.current = frame.current?.contentWindow?.scrollY ?? scroll.current; } catch { /* frame not ready */ }
      setHtml(doc.kind === "deck" ? deckHtml(doc, images, "preview") : bookHtml(doc, images, "preview"));
    }, building ? 250 : 60);
    return () => clearTimeout(timer);
  }, [doc, images, building]);

  const onLoad = () => {
    const view = frame.current?.contentWindow, page = frame.current?.contentDocument;
    if (!view || !page) return;
    const target = building && focus ? page.getElementById(doc.kind === "deck" ? `slide-${focus}` : `chapter-${focus}`) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else view.scrollTo(0, scroll.current);
  };

  const stats = useMemo(() => doc.kind === "deck"
    ? `${doc.slides.length} slide${doc.slides.length === 1 ? "" : "s"} · 16:9`
    : `${doc.chapters.length} chapter${doc.chapters.length === 1 ? "" : "s"} · ${doc.chapters.reduce((sum, chapter) => sum + wordCount(chapter.text), 0).toLocaleString()} words · 6 × 9 in`, [doc]);

  async function download(format: "pdf" | "pptx") {
    if (exporting) return;
    setExporting(format); setMessage("");
    try {
      const response = await fetch(`/api/cloud/workspaces/${scope.workspaceId}/artifacts/${scope.artifactId}/document-export?format=${format}&version=${savedVersion}`,
        { headers: { "X-Makeborne-Account": scope.accountId }, cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message ?? "The export could not finish.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      link.download = `${doc.title.replace(/[^a-z0-9 -]/gi, "").trim().slice(0, 70) || "makeborne"}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Export unavailable."); }
    finally { setExporting(null); }
  }

  const exportDisabled = !canExport || building || !!exporting;
  return <section className="lp dp" aria-label={doc.kind === "deck" ? "Presentation preview" : "Book preview"}>
    <header className="lp-bar">
      <span className="dp-stats">{stats}</span>
      <span className="lp-status" role="status">{building ? "Writing live…" : message || "Live preview"}</span>
      <div className="dp-actions">
        <button type="button" className="dp-export" disabled={exportDisabled} onClick={() => void download("pdf")} title={canExport ? "Download the saved version as PDF" : "Save the document first"}>
          {exporting === "pdf" ? <Loader2 size={13} className="lb-spin" /> : <Download size={13} />}PDF</button>
        {doc.kind === "deck" && <button type="button" className="dp-export" disabled={exportDisabled} onClick={() => void download("pptx")} title="Download an editable PowerPoint file">
          {exporting === "pptx" ? <Loader2 size={13} className="lb-spin" /> : <Download size={13} />}PPTX</button>}
        <button type="button" aria-label="Full screen preview" onClick={() => void frame.current?.requestFullscreen?.().catch(() => undefined)}><Maximize2 size={15} /></button>
      </div>
    </header>
    <div className="lp-stage dp-stage">
      {html ? <iframe ref={frame} title={doc.kind === "deck" ? "Presentation preview" : "Book preview"} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={html} onLoad={onLoad} style={{ width: "100%" }} />
        : <div className="lp-empty">Preparing preview…</div>}
    </div>
  </section>;
}
