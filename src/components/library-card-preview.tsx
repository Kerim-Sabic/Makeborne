"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CloudArtifact } from "@/lib/cloud/contracts";
import { CARD_CANVAS } from "@/lib/documents/render-card";
import { cardPreviewText, cardRequestKey, settleCardPreview, type CardPreviewState } from "@/lib/projects/card-preview";
import { cachedCardPreview, rememberCardPreview, resolveCardPreview } from "./card-preview-store";
import { icons } from "./studio-model";
import "@/app/library-preview.css";

/**
 * A small, real preview of the version a library card names: a deck's first
 * slide, a book's cover, a website's home page. The frame is decorative
 * (aria-hidden, not focusable, no pointer events, no scripts); the card's
 * button is described by the version the preview depicts. It loads when the
 * card scrolls near the viewport, through a bounded queue, and a response is
 * kept only while this card still names the same account, workspace, project
 * and version.
 */
export default function LibraryCardPreview({ accountId, workspaceId, artifact, canCapture, descriptionId }: {
  accountId: string; workspaceId: string; artifact: Pick<CloudArtifact, "id" | "kind" | "currentVersion">; canCapture: boolean; descriptionId: string;
}) {
  const request = useMemo(() => ({ accountId, workspaceId, artifactId: artifact.id, versionNumber: artifact.currentVersion }), [accountId, workspaceId, artifact.id, artifact.currentVersion]);
  const key = cardRequestKey(request);
  const [state, setState] = useState<CardPreviewState>(() => cachedCardPreview(key) ?? { status: "idle", key });
  const shown = useRef(key);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // What this card shows now: its own state, or its cached state; never another key's.
  const current: CardPreviewState = state.key === key ? state : cachedCardPreview(key) ?? { status: "idle", key };

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const resize = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    resize.observe(node);
    if (typeof IntersectionObserver === "undefined") { queueMicrotask(() => setVisible(true)); return () => resize.disconnect(); }
    const near = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); near.disconnect(); } }, { rootMargin: "240px 0px" });
    near.observe(node);
    return () => { resize.disconnect(); near.disconnect(); };
  }, []);

  useEffect(() => {
    shown.current = key;
    if (!visible || cachedCardPreview(key)) return;
    const controller = new AbortController();
    void resolveCardPreview(request, key, canCapture, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      rememberCardPreview(next);
      setState(previous => settleCardPreview(previous.key === key ? previous : { status: "loading", key }, shown.current, next));
    }, () => undefined);
    return () => controller.abort();
  }, [key, visible, request, canCapture]);

  const Icon = icons[artifact.kind];
  const text = cardPreviewText(current, artifact.kind, artifact.currentVersion);
  const canvas = current.status === "ready" ? CARD_CANVAS[current.canvas] : null;
  // Decks and websites fill the width (a website shows its top); a book cover fits the height.
  const scale = canvas && size ? (current.status === "ready" && current.canvas === "book" ? size.height / canvas.height : size.width / canvas.width) : 0;
  return <>
    <div ref={box} className={`library-card-thumb ${artifact.kind} ${current.status}`} aria-hidden="true" data-preview-key={current.status === "ready" ? current.frameKey : undefined}>
      {current.status === "ready" && canvas && scale > 0 ? <iframe key={current.frameKey} className={`library-card-frame ${current.canvas}`} title="" tabIndex={-1} aria-hidden="true"
        sandbox={current.sandbox} referrerPolicy="no-referrer" srcDoc={current.html}
        style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale}) translate(-50%, ${current.canvas === "deck" ? "-50%" : "0"})` }} />
        : <span className="library-card-fallback"><span className={`account-project-icon ${artifact.kind}`}><Icon size={20} /></span>{text.caption && <small>{text.caption}</small>}</span>}
    </div>
    <span id={descriptionId} hidden>{text.description}</span>
  </>;
}
