"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { DocumentSource } from "@/lib/documents/schema";
import { reviewDocumentAssets, reviewDocumentHtml } from "@/lib/client-review/document";
import { FONTS } from "@/lib/documents/theme";
import { faceKey, facePublicUrl, faceStyles, type FontSources } from "@/lib/documents/fonts";

/** The review frame only accepts data: fonts, so the document's open-licensed
 * faces are read from the app's own static copies and inlined. A face that
 * fails to load is skipped; its CSS stack falls back to the Office face. */
async function documentFonts(doc: DocumentSource, signal: AbortSignal): Promise<FontSources> {
  const fonts: FontSources = {};
  await Promise.all(FONTS[doc.theme.fonts].faces.flatMap(id => faceStyles(id).map(async style => {
    try {
      const response = await fetch(facePublicUrl(id, style), { credentials: "omit", signal });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok || bytes.length > 400_000) return;
      let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      fonts[faceKey(id, style)] = `data:font/woff2;base64,${btoa(binary)}`;
    } catch { /* fall back to the stack */ }
  })));
  return fonts;
}

const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("Artwork could not be displayed."));
  reader.readAsDataURL(blob);
});

/** A client sees the same saved document layout as the owner. An incomplete
 * artwork load blocks approval instead of silently replacing art with placeholders. */
export default function ClientDocumentReview({ document: doc, token, version, onReady, render }: {
  document: DocumentSource; token: string; version: number; onReady: (ready: boolean) => void;
  render: (html: string, onLoaded: () => void) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ html: string; error: string }>({ html: "", error: "" });
  useEffect(() => {
    const controller = new AbortController();
    onReady(false);
    void (async () => {
      try {
        const images: Record<string, string> = {};
        let total = 0;
        for (const asset of reviewDocumentAssets(doc)) {
          const response = await fetch(`/api/review/${token}/assets/${asset.id}?version=${version}`, { cache: "no-store", credentials: "omit", signal: controller.signal });
          if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message ?? "Artwork could not be loaded. Retry before approving.");
          if (response.headers.get("content-type")?.split(";")[0] !== "image/webp") throw new Error("Artwork could not be displayed.");
          const image = await response.blob();
          total += image.size;
          if (image.size > 8 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error("This review has too much artwork to display at once. Ask the team for a smaller review copy.");
          images[asset.name] = await dataUrl(image);
        }
        const html = reviewDocumentHtml(doc, images, await documentFonts(doc, controller.signal));
        if (!controller.signal.aborted) setResult({ html, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ html: "", error: error instanceof Error ? error.message : "The document could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [doc, token, version, attempt, onReady]);
  if (result.error) return <div className="cr-empty" role="alert"><p>{result.error}</p><p>Approval is available once the complete document is displayed.</p><button type="button" className="button secondary small" onClick={() => { setResult({ html: "", error: "" }); setAttempt(value => value + 1); }}>Retry preview</button></div>;
  return result.html ? render(result.html, () => onReady(true)) : <p className="cr-empty" role="status">Loading the saved document and artwork…</p>;
}
