"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Loader2, Maximize2, MoreHorizontal, Play, X } from "lucide-react";
import EditorMenu from "./editor-menu";
import type { Deck, DocumentSource } from "@/lib/documents/schema";
import { deckHtml } from "@/lib/documents/render-deck";
import { BOOK_TRIM, bookHtml, chapterLabel } from "@/lib/documents/render-book";
import { wordCount } from "@/lib/documents/book-markup";

/** About 230 words a minute, rounded for display. */
const readingTime = (words: number) => {
  const minutes = Math.max(1, Math.round(words / 230));
  return minutes < 60 ? `${minutes} min read` : `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min ` : ""}read`;
};
import { advancesOnClick, presenterShortcut } from "@/lib/documents/presenter-keys";
import { describeTyped, documentTexts, fontCoverage } from "@/lib/builder/font-fallback";
import "@/app/publish-output.css";
import { frameListenersRun, watchFrameScroll } from "@/lib/frame-events";
import { readCloudImage } from "./cloud-api";
import { focusReturnTarget } from "@/lib/focus-return";

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Full-screen presenter for decks. The slides are the same script-free HTML in
 * "present" mode; this host only toggles which slide is current, and CSS in the
 * frame provides the transition and builds (instant under reduced motion). */
export function Presenter({ deck, images, onClose }: { deck: Deck; images: Record<string, string>; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null), entered = useRef(false);
  const [index, setIndex] = useState(0);
  // False where the browser ignores listeners on the script-free slide frame (Safari, see frame-events.ts).
  const [frameListeners, setFrameListeners] = useState(true);
  const total = deck.slides.length, current = Math.max(0, Math.min(index, total - 1));
  const html = useMemo(() => deckHtml(deck, images, "present"), [deck, images]);
  const go = useCallback((next: number) => setIndex(Math.max(0, Math.min(total - 1, next))), [total]);

  const sync = useCallback(() => {
    const page = frame.current?.contentDocument;
    page?.querySelectorAll<HTMLElement>(".deck .slide").forEach((slide, i) => {
      slide.classList.toggle("is-current", i === current);
      slide.classList.toggle("is-past", i < current);
      slide.setAttribute("aria-hidden", String(i !== current));
    });
  }, [current]);
  useEffect(sync, [sync]);

  // Shortcuts belong to the slide canvas; a focused button or field keeps its own keys (presenter-keys.ts).
  const onKey = useCallback((event: KeyboardEvent) => {
    const action = presenterShortcut(event);
    if (!action) return;
    event.preventDefault();
    if (action === "close") onClose();
    else go(action === "next" ? current + 1 : action === "previous" ? current - 1 : action === "first" ? 0 : total - 1);
  }, [current, go, onClose, total]);
  const keyHandler = useRef(onKey), currentRef = useRef(current);
  useEffect(() => { currentRef.current = current; }, [current]);
  useEffect(() => { keyHandler.current = onKey; }, [onKey]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Focus moves into the presenter when it opens and back to the control that
  // opened it when it closes (once per presentation, whatever onClose is).
  useEffect(() => {
    const opener = focusReturnTarget();
    root.current?.focus();
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  // Full screen when the browser allows it; leaving full screen ends the presentation.
  useEffect(() => {
    const element = root.current;
    void element?.requestFullscreen?.().then(() => { entered.current = true; }).catch(() => undefined);
    const change = () => { if (entered.current && !document.fullscreenElement) onClose(); };
    document.addEventListener("fullscreenchange", change);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  const onLoad = () => {
    sync();
    const view = frame.current?.contentWindow;
    if (!view) return;
    const live = frameListenersRun(view.document);
    setFrameListeners(live);
    if (!live) return;
    view.addEventListener("keydown", event => keyHandler.current(event));
    view.document.addEventListener("click", event => { if (advancesOnClick(event.target, view.getSelection()?.toString() ?? "")) go(currentRef.current + 1); });
  };
  // Where the frame ignores its listeners, it takes no pointer or focus: keys stay with the presenter, and a
  // click falls through to it and is mapped into the slide, with the same link/control rule as in the frame.
  const onCanvasClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const element = frame.current, page = element?.contentDocument;
    if (frameListeners || !element || !page || event.target !== root.current) return;
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    if (advancesOnClick(page.elementFromPoint(x, y), page.getSelection()?.toString() ?? "")) go(currentRef.current + 1);
  };

  return <div ref={root} className="dp-present" data-presenter-root="" role="dialog" aria-modal="true" aria-label={`Presenting ${deck.title}`} tabIndex={-1} onClick={onCanvasClick}>
    <iframe ref={frame} title={`Slide ${current + 1} of ${total}`} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={html} onLoad={onLoad}
      {...(frameListeners ? {} : { tabIndex: -1, style: { pointerEvents: "none" as const }, onFocus: () => root.current?.focus() })} />
    <div className="dp-present-bar">
      <button type="button" aria-label="Previous slide" disabled={current === 0} onClick={() => go(current - 1)}><ChevronLeft size={16} /></button>
      <span aria-live="polite">{current + 1} / {total}</span>
      <button type="button" aria-label="Next slide" disabled={current >= total - 1} onClick={() => go(current + 1)}><ChevronRight size={16} /></button>
      <button type="button" aria-label="Exit presentation" onClick={onClose}><X size={15} /></button>
    </div>
  </div>;
}

/** Characters the document's embedded fonts (Latin and Latin Extended) can't draw,
 * so the preview and PDF show them in a fallback font. Advice only. */
export function FontCoverageNote({ document: doc }: { document: DocumentSource }) {
  const coverage = useMemo(() => fontCoverage(documentTexts(doc), 3), [doc]);
  if (!coverage.uncovered.length && !coverage.decomposed.length) return null;
  const places = (items: { locations: string[] }[]) => [...new Set(items.flatMap(item => item.locations))].slice(0, 4).join(", ");
  const kind = doc.kind === "deck" ? "presentation" : "book";
  return <div className="dp-font-note" role="note" aria-label="Font coverage">
    {coverage.uncovered.length > 0 && <p><strong>Some characters aren’t in this {kind}’s fonts:</strong> <span lang="und">{coverage.uncovered.slice(0, 12).map(item => item.char).join(" ")}</span>{coverage.uncovered.length > 12 ? ` and ${coverage.uncovered.length - 12} more` : ""} ({places(coverage.uncovered)}). The fonts embed Latin and Latin Extended letters only, so these show in a fallback font in the preview and PDF.</p>}
    {coverage.decomposed.length > 0 && <p><strong>Letters typed with separate accent marks:</strong> {coverage.decomposed.slice(0, 6).map(item => `${describeTyped(item.typed)} → ${item.letter}`).join(", ")} ({places(coverage.decomposed)}). Fonts are chosen for the joined letter, but a browser may still draw these in a fallback font; retype them as single letters to be safe.</p>}
  </div>;
}

/** Live preview for presentations and books. Renders the same HTML the PDF
 * printer uses, inside a script-free sandboxed frame. */
export default function DocumentPreview({ document: doc, focus, scope, building, savedVersion, canExport, toolbar }: {
  /** The editor's single preview toolbar: when given, outline, export and present controls render there instead of in this bar. */
  toolbar?: HTMLElement | null;
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
  const [presenting, setPresenting] = useState(false);
  const closePresenter = useCallback(() => setPresenting(false), []);
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

  // Chapters or slides, in reading order, for the jump menu.
  const outline = useMemo(() => doc.kind === "deck"
    ? doc.slides.map((slide, index) => ({ anchor: `slide-${slide.id}`, label: `${index + 1}. ${slide.title}` }))
    : doc.chapters.map((chapter, index) => ({ anchor: `chapter-${chapter.id}`, label: `${chapterLabel(doc, index)} · ${chapter.title}` })), [doc]);
  const [current, setCurrent] = useState("");
  const outlineRef = useRef(outline);
  useEffect(() => { outlineRef.current = outline; }, [outline]);

  // Track which chapter or slide is at the top of the frame as the reader scrolls
  // (from the host page where the browser ignores the frame's own listeners).
  const stopFollowing = useRef<() => void>(() => {});
  useEffect(() => () => stopFollowing.current(), []);
  const followScroll = (view: Window, page: Document) => {
    stopFollowing.current();
    stopFollowing.current = watchFrameScroll(view, () => {
      let found = "";
      for (const item of outlineRef.current) {
        const element = page.getElementById(item.anchor);
        if (element && element.getBoundingClientRect().top <= view.innerHeight * 0.35) found = item.anchor;
      }
      setCurrent(found);
    });
  };

  // Book pages are typeset at their real trim width (6 in = 576 CSS px plus the
  // reader's 16px gutters). A narrower pane zooms the pages down to fit instead
  // of scrolling sideways; the zoom never enlarges them. Decks are already fluid.
  const fitPages = useCallback(() => {
    const page = frame.current?.contentDocument, body = page?.body;
    if (doc.kind !== "book" || !page || !body) return;
    // The frame's own viewport width, excluding its scrollbar.
    const scale = Math.min(1, page.documentElement.clientWidth / (BOOK_TRIM.width * 96 + 32));
    if (scale < 0.999) body.style.setProperty("zoom", String(Math.max(0.3, Math.floor(scale * 1000) / 1000)));
    else body.style.removeProperty("zoom");
  }, [doc.kind]);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitPages());
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitPages, html]);

  const onLoad = () => {
    const view = frame.current?.contentWindow, page = frame.current?.contentDocument;
    if (!view || !page) return;
    fitPages();
    followScroll(view, page);
    const target = building && focus ? page.getElementById(doc.kind === "deck" ? `slide-${focus}` : `chapter-${focus}`) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else view.scrollTo(0, scroll.current);
  };

  const jump = (anchor: string) => {
    setCurrent(anchor);
    const view = frame.current?.contentWindow, page = frame.current?.contentDocument;
    if (!view || !page) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = anchor ? page.getElementById(anchor) : null;
    if (target) target.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    else view.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  };

  const stats = useMemo(() => {
    if (doc.kind === "deck") return `${doc.slides.length} slide${doc.slides.length === 1 ? "" : "s"} · 16:9`;
    const words = doc.chapters.reduce((sum, chapter) => sum + wordCount(chapter.text), 0);
    return `${doc.chapters.length} chapter${doc.chapters.length === 1 ? "" : "s"} · ${words.toLocaleString()} words${words ? ` · ${readingTime(words)}` : ""} · 6 × 9 in`;
  }, [doc]);

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
  const outlineSelect = outline.length > 1 && <select className="dp-jump" aria-label={doc.kind === "deck" ? "Go to slide" : "Go to chapter"} value={outline.some(item => item.anchor === current) ? current : ""} onChange={event => jump(event.target.value)}>
    <option value="">{doc.kind === "deck" ? "Start" : "Cover & contents"}</option>
    {outline.map(item => <option key={item.anchor} value={item.anchor}>{item.label.length > 70 ? `${item.label.slice(0, 68)}…` : item.label}</option>)}
  </select>;
  const statusText = building ? "Writing live…" : message || "Live preview";
  const toolbarControls = toolbar && createPortal(<div className="lp-toolbar dp-toolbar">
    <span className="dp-stats">{stats}</span>
    {outlineSelect}
    <span className="lp-status" role="status" data-idle={statusText === "Live preview" || undefined}>{statusText}</span>
    <EditorMenu collapse label={`Download and present: saved version ${savedVersion}`} className="lp-tools dp-tools" trigger={<MoreHorizontal size={16} aria-hidden="true" />}>
      <div className="dp-actions" role="group" aria-label={`Generated outputs from saved version ${savedVersion}`}>
        <span className="dp-outputs-label" title="Made by Makeborne from the saved version; your uploaded source files are listed with the builder">Generated · v{savedVersion}</span>
        <button type="button" className="dp-export" data-keep-open disabled={exportDisabled} onClick={() => void download("pdf")} title={canExport ? `Generated output: download saved version ${savedVersion} as PDF` : "Save the document first"}>
          {exporting === "pdf" ? <Loader2 size={13} className="lb-spin" /> : <Download size={13} />}PDF</button>
        {doc.kind === "deck" && <button type="button" className="dp-export" data-keep-open disabled={exportDisabled} onClick={() => void download("pptx")} title={`Generated output: download saved version ${savedVersion} as an editable PowerPoint file`}>
          {exporting === "pptx" ? <Loader2 size={13} className="lb-spin" /> : <Download size={13} />}PPTX</button>}
        {doc.kind === "deck" && doc.slides.length > 0 && <button type="button" aria-label="Present" title="Present: arrow keys move, Esc exits" onClick={() => setPresenting(true)}><Play size={15} aria-hidden="true" /><span className="editor-menu-label">Present</span></button>}
        <button type="button" aria-label="Full screen preview" title="Full screen preview" onClick={() => void frame.current?.requestFullscreen?.().catch(() => undefined)}><Maximize2 size={15} aria-hidden="true" /><span className="editor-menu-label">Full screen</span></button>
      </div>
      {!canExport && <p className="editor-menu-note">Downloads use the saved version. Wait for saving or building to finish.</p>}
    </EditorMenu>
  </div>, toolbar);
  return <section className="lp dp" aria-label={doc.kind === "deck" ? "Presentation preview" : "Book preview"}>
    {toolbar ? toolbarControls : <header className="lp-bar">
      <span className="dp-stats">{stats}</span>
      {outline.length > 1 && <select className="dp-jump" aria-label={doc.kind === "deck" ? "Go to slide" : "Go to chapter"} value={outline.some(item => item.anchor === current) ? current : ""} onChange={event => jump(event.target.value)}>
        <option value="">{doc.kind === "deck" ? "Start" : "Cover & contents"}</option>
        {outline.map(item => <option key={item.anchor} value={item.anchor}>{item.label.length > 70 ? `${item.label.slice(0, 68)}…` : item.label}</option>)}
      </select>}
      <span className="lp-status" role="status">{building ? "Writing live…" : message || "Live preview"}</span>
      <div className="dp-actions" role="group" aria-label={`Generated outputs from saved version ${savedVersion}`}>
        <span className="dp-outputs-label" aria-hidden="true" title="Made by Makeborne from the saved version; your uploaded source files are listed with the builder">Generated · v{savedVersion}</span>
        <button type="button" className="dp-export" disabled={exportDisabled} onClick={() => void download("pdf")} title={canExport ? `Generated output: download saved version ${savedVersion} as PDF` : "Save the document first"}>
          {exporting === "pdf" ? <Loader2 size={13} className="lb-spin" /> : <Download size={13} />}PDF</button>
        {doc.kind === "deck" && <button type="button" className="dp-export" disabled={exportDisabled} onClick={() => void download("pptx")} title={`Generated output: download saved version ${savedVersion} as an editable PowerPoint file`}>
          {exporting === "pptx" ? <Loader2 size={13} className="lb-spin" /> : <Download size={13} />}PPTX</button>}
        {doc.kind === "deck" && doc.slides.length > 0 && <button type="button" aria-label="Present" title="Present: arrow keys move, Esc exits" onClick={() => setPresenting(true)}><Play size={15} /></button>}
        <button type="button" aria-label="Full screen preview" onClick={() => void frame.current?.requestFullscreen?.().catch(() => undefined)}><Maximize2 size={15} /></button>
      </div>
    </header>}
    <FontCoverageNote document={doc} />
    <div className="lp-stage dp-stage">
      {html ? <iframe ref={frame} title={doc.kind === "deck" ? "Presentation preview" : "Book preview"} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={html} onLoad={onLoad} style={{ width: "100%" }} />
        : <div className="lp-empty">Preparing preview…</div>}
    </div>
    {presenting && doc.kind === "deck" && doc.slides.length > 0 && <Presenter deck={doc} images={images} onClose={closePresenter} />}
  </section>;
}
