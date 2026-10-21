"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, CornerDownLeft, Maximize2, Monitor, MousePointerClick, RotateCw, Smartphone, Tablet, Wand2 } from "lucide-react";
import { bundleProject } from "@/lib/builder/browser-bundler";
import { previewFileRevision } from "@/lib/builder/preview-revision";
import { HOME, PREVIEW_HISTORY_KEY, PREVIEW_PATH_PARAM, formatPreviewPath, frameHashFor, isMissingPage, normalizePath, parseFrameHash, parsePreviewPath, preparePreviewDocument, previewPageTitle, samePage, withPreviewPathParam,
  type PreviewPage, type PreviewRoute, type PreviewStart } from "@/lib/builder/preview-route";
import { PREVIEW_ACTIONS } from "@/lib/builder/action-semantics";
import type { ElementDescription, ElementLoc, StyleField, VisualEdit } from "@/lib/builder/visual-edit";
import type { WebsiteProjectSource } from "@/lib/projects/website-source";
import type { PickedElement } from "./visual-editor-panel";
import { readCloudImage } from "./cloud-api";
import responsive from "../../infra/project-runtime/responsive-images.cjs";
import "@/app/visual-editor.css";

const VisualEditorPanel = dynamic(() => import("./visual-editor-panel"), { ssr: false });
type EditEngine = typeof import("@/lib/builder/visual-edit");

type Asset = { id: string; path: string };
type Device = "desktop" | "tablet" | "mobile";
const WIDTHS: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 };
const STYLE_KEYS: StyleField[] = ["color", "backgroundColor", "fontSize", "fontWeight", "textAlign", "padding", "margin", "borderRadius"];
const NO_ROUTES: PreviewRoute[] = [];
/** "", "#" and "#/" all show the home page. */
const frameHashKey = (hash: string) => hash === "" || hash === "#" || hash === "#/" ? "#/" : hash;

/** Saved project source plus where click-to-edit changes go. */
export type VisualEditHost = {
  source: WebsiteProjectSource;
  /** Set while editing would conflict with saving, building or review state. */
  disabledReason?: string;
  onApply: (next: WebsiteProjectSource, summary: string) => void;
  onAsk?: (text: string) => void;
  /** Brand colours offered first in the colour pickers. */
  swatches?: { label: string; value: string }[];
};

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Live React preview compiled in the browser. The site runs in an opaque,
 * script-only sandbox: no Makeborne cookies, storage or same-origin access,
 * and its document policy sends no requests or form submissions.
 * With `visualEdit`, owners and editors can click elements to change text,
 * links, images and style directly in the source — no model call.
 * Page, query, fragment target, title, scroll and focus are tracked apart;
 * `syncUrl` mirrors the page on the editor URL so a reload returns to it. */
export default function LivePreview({ files, assets, scope, building, onFixError, visualEdit, routes = NO_ROUTES, syncUrl = false, responseTimeoutMs = 10_000 }: {
  files: Record<string, string>;
  assets: Asset[];
  scope: { accountId: string; workspaceId: string; artifactId: string };
  building?: boolean;
  onFixError?: (message: string) => void;
  visualEdit?: VisualEditHost;
  /** Saved page routes of this version. Unknown paths show a not-found state. */
  routes?: PreviewRoute[];
  syncUrl?: boolean;
  responseTimeoutMs?: number;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [buildError, setBuildError] = useState("");
  const [transportError, setTransportError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const [missingImages, setMissingImages] = useState(0);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState("");
  const cache = useRef(new Map<string, string>());

  // Route state. The page is what the frame shows; the editor URL mirrors it.
  const storageKey = `makeborne:preview-page:v1:${scope.accountId}:${scope.workspaceId}:${scope.artifactId}`;
  const [page, setPageState] = useState<PreviewPage>(() => {
    if (!syncUrl || typeof window === "undefined") return HOME;
    return parsePreviewPath(new URLSearchParams(window.location.search).get(PREVIEW_PATH_PARAM)) ?? HOME;
  });
  const [frameTitle, setFrameTitle] = useState("");
  const [focusDescriptor, setFocusDescriptor] = useState("");
  const [pathOpen, setPathOpen] = useState(false);
  const [pathValue, setPathValue] = useState("");
  const [pathError, setPathError] = useState("");
  const pageRef = useRef(page);
  const lastHash = useRef<string | null>(null);
  const scrollY = useRef<number | null>(null);
  const responded = useRef(false);
  const routesRef = useRef(routes);
  useEffect(() => { routesRef.current = routes; }, [routes]);
  const retryingRef = useRef(false);
  const setPage = useCallback((next: PreviewPage) => { pageRef.current = next; setPageState(next); }, []);

  // Click-to-edit state. `inspecting` drives the tagged build.
  const [editing, setEditing] = useState(false);
  const [engine, setEngine] = useState<EditEngine | null>(null);
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const [editNote, setEditNote] = useState("");
  const [history, setHistory] = useState<{ source: WebsiteProjectSource; loc: ElementLoc | null; index: number }[]>([]);
  const produced = useRef<WebsiteProjectSource | null>(null);
  const restore = useRef<{ loc: string | null; index: number; y: number }>({ loc: null, index: 0, y: 0 });
  const inspecting = editing && Boolean(visualEdit) && !visualEdit?.disabledReason && !building;

  useEffect(() => {
    if (!inspecting || engine) return;
    let cancelled = false;
    import("@/lib/builder/visual-edit").then(module => { if (!cancelled) setEngine(module); }, () => { if (!cancelled) { setEditing(false); setEditNote("Click-to-edit could not start in this browser."); } });
    return () => { cancelled = true; };
  }, [inspecting, engine]);

  // Undo only covers this session's own edits on the current source.
  const source = visualEdit?.source;
  useEffect(() => {
    if (source && source !== produced.current) { produced.current = null; setHistory([]); }
  }, [source]);

  // Load project images once per asset id and keep them as data URLs.
  const assetKey = assets.map(asset => `${asset.id}:${asset.path}`).sort().join("|");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const next: Record<string, string> = {};
      let missing = 0;
      // Responsive copies (srcset) are for the published site; the preview uses the originals.
      for (const asset of assets.filter(asset => !responsive.isVariantPath(asset.path))) {
        let url = cache.current.get(asset.id);
        if (!url) {
          try {
            const blob = await readCloudImage(`/api/cloud/workspaces/${scope.workspaceId}/artifacts/${scope.artifactId}/assets/${asset.id}`, scope.accountId, controller.signal);
            url = await toDataUrl(blob);
            cache.current.set(asset.id, url);
          } catch { missing++; continue; }
        }
        next[`/${asset.path.replace(/^public\//, "")}`] = url;
      }
      if (!controller.signal.aborted) { setImages(next); setMissingImages(missing); }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assetKey captures the asset list
  }, [assetKey, scope.accountId, scope.workspaceId, scope.artifactId, imageAttempt]);

  /** Where a new preview document starts: the current page, its target and scroll. */
  function startState(): PreviewStart {
    const current = pageRef.current;
    let y = scrollY.current;
    if (y === null) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (saved?.page === formatPreviewPath(current) && Number.isFinite(saved.y)) y = Math.max(0, Math.round(saved.y));
      } catch { /* scroll is a convenience; the page itself comes from the URL */ }
    }
    return { hash: samePage(current, HOME) ? "" : frameHashFor(current, routesRef.current), target: current.target, y: current.target ? 0 : y ?? 0 };
  }

  // Rebuild shortly after files settle; keep the last good render on errors.
  // Each new document gets a new frame so updates never add browser history.
  const fileKey = useMemo(() => previewFileRevision(files), [files]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await bundleProject(files, images, "preview", { inspect: inspecting });
      if (cancelled) return;
      if (result.ok) {
        responded.current = false;
        const start = startState();
        lastHash.current = frameHashKey(start.hash);
        setHtml(preparePreviewDocument(result.html, start)); setFrameKey(key => key + 1);
        setBuildError(""); setTransportError(""); setRuntimeError("");
      }
      else if (inspecting) { setEditing(false); setPicked(null); setEditNote("Click-to-edit couldn't read this project's code. Use Code, or ask the builder."); }
      else if (result.kind === "transport") { setTransportError(result.error); retryingRef.current = false; setRetrying(false); }
      else { setBuildError(result.error); retryingRef.current = false; setRetrying(false); }
    }, building ? 700 : 150);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fileKey captures every path and full file content; startState reads refs
  }, [fileKey, images, building, reloadKey, inspecting]);

  // A document that never reports back is a preview connection problem, not a build error.
  useEffect(() => {
    if (!html) return;
    const timer = setTimeout(() => { if (!responded.current) { setTransportError("The preview did not respond."); retryingRef.current = false; setRetrying(false); } }, responseTimeoutMs);
    return () => clearTimeout(timer);
  }, [html, frameKey, responseTimeoutMs]);

  // The editor URL mirrors the page without touching its other parameters.
  // A new page is one editor history entry, so Back/Forward and a reload
  // return to it; rebuilt preview documents never add entries of their own.
  const urlPage = useRef<PreviewPage | null>(null);
  const scrollMemory = useRef(new Map<string, number>());
  const syncOuter = useCallback((next: PreviewPage, push: boolean) => {
    if (!syncUrl) return;
    if (!push && urlPage.current && samePage(next, urlPage.current)) return;
    const href = withPreviewPathParam(window.location.href, next);
    const state = { ...(window.history.state ?? {}), [PREVIEW_HISTORY_KEY]: formatPreviewPath(next) };
    if (push && urlPage.current && !samePage(next, urlPage.current)) window.history.pushState(state, "", href);
    else window.history.replaceState(state, "", href);
    urlPage.current = next;
  }, [syncUrl]);
  useEffect(() => { syncOuter(pageRef.current, false); }, [syncOuter]);
  useEffect(() => {
    if (!syncUrl) return;
    const restoreFromHistory = () => {
      const next = parsePreviewPath(new URLSearchParams(window.location.search).get(PREVIEW_PATH_PARAM)) ?? HOME;
      urlPage.current = next;
      if (samePage(next, pageRef.current)) return;
      const hash = frameHashFor(next, routesRef.current);
      const y = scrollMemory.current.get(formatPreviewPath(next));
      lastHash.current = frameHashKey(hash); scrollY.current = y ?? null;
      setPage(next); setNotice("");
      frame.current?.contentWindow?.postMessage({ source: "makeborne-host", type: "navigate", hash, target: next.target, mode: "replace", y }, "*");
    };
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, [syncUrl, setPage]);

  const toFrame = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ source: "makeborne-host", ...message }, "*");
  /** Show a page in the frame. A new page adds one in-preview history entry. */
  function go(next: PreviewPage) {
    const hash = frameHashFor(next, routesRef.current);
    lastHash.current = frameHashKey(hash);
    scrollY.current = next.target ? 0 : null;
    setPage(next); setPathError(""); setNotice("");
    if (frame.current?.contentWindow) toFrame({ type: "navigate", hash, target: next.target, mode: "push" });
    else syncOuter(next, true);
  }
  const goRef = useRef(go);
  useEffect(() => { goRef.current = go; });

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== "makeborne-preview") return;
      const data = event.data;
      if (data.type === "ready") responded.current = true;
      if (data.type === "runtime-error") setRuntimeError(String(data.message).slice(0, 600));
      if (data.type === "ready" && inspecting) (event.source as Window).postMessage({ source: "makeborne-host", type: "edit-mode", on: true, ...restore.current }, "*");
      if (data.type === "scroll" && Number.isFinite(data.y)) restore.current.y = Math.max(0, Math.round(data.y));
      if (data.type === "location" && typeof data.hash === "string") {
        const key = frameHashKey(data.hash);
        const current = pageRef.current;
        const next = key === lastHash.current ? current : parseFrameHash(data.hash, current.path);
        lastHash.current = key;
        if (!samePage(next, current)) setPage(next);
        syncOuter(next, data.kind === "push");
        setFrameTitle(String(data.title ?? "").slice(0, 200));
        setFocusDescriptor(String(data.focus ?? "").slice(0, 80));
        if (Number.isFinite(data.y)) {
          scrollY.current = Math.max(0, Math.round(data.y));
          scrollMemory.current.set(formatPreviewPath(next), scrollY.current);
          try { sessionStorage.setItem(storageKey, JSON.stringify({ page: formatPreviewPath(next), y: scrollY.current })); } catch { /* per-viewer convenience only */ }
        }
      }
      if (data.type === "rendered" && Number(data.text) > 0) {
        if (retryingRef.current) { retryingRef.current = false; setRetrying(false); setNotice("Preview reconnected. It shows the same saved files; nothing was regenerated or charged."); }
      }
      if (data.type === "form-draft" && Number(data.restored) > 0) setNotice(`Kept ${data.restored} unsent form ${data.restored === 1 ? "entry" : "entries"} on this page. Preview only: nothing is sent or saved.`);
      if (data.type === "form-blocked" || data.type === "request-blocked") setNotice("Nothing was sent. Forms and network requests don't leave the editor preview; they work on the published site.");
      if (data.type === "navigation-blocked" && typeof data.href === "string") {
        const target = parsePreviewPath(data.href);
        if (target) goRef.current(target);
      }
      if (data.type === "deselect") { setPicked(null); restore.current.loc = null; }
      if (data.type === "select" && engine) {
        const loc = engine.parseLoc(data.loc);
        if (!loc) return;
        const style: PickedElement["style"] = {};
        for (const key of STYLE_KEYS) if (typeof data.style?.[key] === "string") style[key] = data.style[key].slice(0, 80);
        const index = Number.isInteger(data.index) ? Math.max(0, data.index) : 0;
        restore.current = { ...restore.current, loc: engine.formatLoc(loc), index };
        setPicked({ loc, index, count: Number.isInteger(data.count) ? data.count : 1, tag: String(data.tag ?? "").slice(0, 20),
          text: String(data.text ?? "").slice(0, 2000), hasParent: data.hasParent === true, style });
        setEditNote("");
      }
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [inspecting, engine, storageKey, setPage, syncOuter]);

  // Turning edit mode off clears the selection; the rebuild drops the tags.
  function toggleEditing() {
    if (editing) { setEditing(false); setPicked(null); setEditNote(""); restore.current = { loc: null, index: 0, y: restore.current.y }; return; }
    setEditNote(""); setEditing(true);
  }

  const description: ElementDescription | null = useMemo(() => engine && picked && source ? engine.describeElement(source, picked.loc, picked.text) : null, [engine, picked, source]);
  const projectImages = useMemo(() => (source?.assets ?? []).filter(asset => !responsive.isVariantPath(asset.path)).map(asset => {
    const path = `/${asset.path.replace(/^public\//, "")}`;
    return { path, url: images[path] };
  }), [source, images]);

  function apply(edit: VisualEdit) {
    if (!engine || !visualEdit || !picked || visualEdit.disabledReason) return;
    const result = engine.applyVisualEdit(visualEdit.source, edit, projectImages.map(image => image.path));
    if (!result.ok) { setEditNote(result.message); return; }
    setHistory(entries => [...entries.slice(-29), { source: visualEdit.source, loc: picked.loc, index: picked.index }]);
    produced.current = result.source;
    const loc = engine.remapLoc(picked.loc, result.change);
    restore.current = { ...restore.current, loc: loc ? engine.formatLoc(loc) : null, index: picked.index };
    setPicked(loc ? { ...picked, loc, text: edit.kind === "text" ? edit.value : picked.text } : null);
    setEditNote("");
    visualEdit.onApply(result.source, result.summary);
  }
  function undo() {
    if (!engine || !visualEdit || visualEdit.disabledReason) return;
    const last = history.at(-1);
    if (!last) return;
    setHistory(entries => entries.slice(0, -1));
    produced.current = last.source;
    restore.current = { ...restore.current, loc: last.loc ? engine.formatLoc(last.loc) : null, index: last.index };
    setPicked(null);
    visualEdit.onApply(last.source, "Undid a visual edit");
  }

  /** Try again re-renders the same files; it never asks the builder or regenerates. */
  function retryTransport() {
    retryingRef.current = true; setRetrying(true); setTransportError(""); setNotice("");
    setReloadKey(key => key + 1);
  }
  function submitPath(event: React.FormEvent) {
    event.preventDefault();
    const target = parsePreviewPath(pathValue.startsWith("/") ? pathValue : `/${pathValue}`);
    if (!target) { setPathError("Enter a path that starts with /, such as /menu or /menu#hours."); return; }
    go(target); setPathOpen(false); setPathValue("");
  }

  const width = WIDTHS[device];
  const problem = buildError || runtimeError;
  const missing = isMissingPage(page, routes);
  const pageTitle = previewPageTitle(page, routes, frameTitle);
  const knownRoutes = routes.map(route => ({ ...route, path: normalizePath(route.path) }));
  const editTitle = !visualEdit ? "" : building ? "Wait for the build to finish" : visualEdit.disabledReason ?? (editing ? "Stop editing" : "Click elements in the preview to edit them");
  const status = building ? "Building live…" : transportError ? "Preview connection lost" : retrying ? "Reconnecting…" : buildError ? "Needs a fix" : inspecting ? (picked ? "Editing" : "Click anything to edit it") : html ? missing ? "Page not found" : "Live preview" : "Preparing preview…";
  return <section className="lp" aria-label="Website preview" data-preview-path={formatPreviewPath(page)} data-preview-title={pageTitle} data-preview-focus={focusDescriptor || undefined}>
    <header className="lp-bar">
      <div className="lp-devices" role="group" aria-label="Preview size">
        {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([value, Icon]) =>
          <button key={value} type="button" aria-label={`${value} preview`} aria-pressed={device === value} onClick={() => setDevice(value)}><Icon size={15} /></button>)}
      </div>
      {(knownRoutes.length > 1 || missing) && <select className="dp-jump lp-page" aria-label="Preview page" value={missing ? "" : page.path}
        onChange={event => { const route = knownRoutes.find(item => item.path === event.target.value); if (route) go({ path: route.path, query: "", target: "" }); }}>
        {missing && <option value="" disabled>Not found · {page.path}</option>}
        {knownRoutes.map(route => <option key={route.path} value={route.path}>{route.title ? `${route.title} · ${route.path}` : route.path}</option>)}
      </select>}
      <span className="lp-status" role="status">{status}</span>
      <div className="lp-actions">
        {visualEdit && <button type="button" className="lp-edit" aria-pressed={inspecting} disabled={!editing && (Boolean(visualEdit.disabledReason) || Boolean(building) || !html)} title={editTitle} onClick={toggleEditing}>
          <MousePointerClick size={14} />{inspecting ? "Done" : "Edit"}</button>}
        {knownRoutes.length > 0 && <button type="button" aria-label="Go to a page path" aria-expanded={pathOpen} title="Open a page or section by its path" onClick={() => { setPathOpen(open => !open); setPathError(""); }}><CornerDownLeft size={15} /></button>}
        <button type="button" aria-label="Reload preview" title={PREVIEW_ACTIONS.reload.effect} onClick={() => setReloadKey(key => key + 1)}><RotateCw size={15} /></button>
        <button type="button" aria-label="Full screen preview" onClick={() => void frame.current?.requestFullscreen?.().catch(() => undefined)}><Maximize2 size={15} /></button>
      </div>
    </header>
    {pathOpen && <form className="lp-path" onSubmit={submitPath}>
      <label htmlFor={`lp-path-${scope.artifactId}`}>Page path</label>
      <input id={`lp-path-${scope.artifactId}`} value={pathValue} onChange={event => setPathValue(event.target.value)} placeholder="/menu#hours" autoComplete="off" spellCheck={false} maxLength={300}
        aria-describedby={`lp-path-help-${scope.artifactId}`} autoFocus onKeyDown={event => { if (event.key === "Escape") setPathOpen(false); }} />
      <button type="submit" className="button secondary small">Go</button>
      <small id={`lp-path-help-${scope.artifactId}`}>{pathError || "Opens a saved page or section in this preview. It never creates a page or asks the builder."}</small>
    </form>}
    {transportError && !building && <div className="lp-problem" role="alert">
      <AlertTriangle size={16} />
      <div><strong>Preview connection lost</strong><p>{transportError} This is a connection problem, not a build error. Your saved files are unchanged, nothing was sent to the builder, and the editor and chat keep working.</p></div>
      <button type="button" className="button secondary small" title={PREVIEW_ACTIONS.retryPreview.effect} onClick={retryTransport}>{PREVIEW_ACTIONS.retryPreview.label}</button>
    </div>}
    {problem && !building && !transportError && <div className="lp-problem" role="alert">
      <AlertTriangle size={16} />
      <div><strong>{buildError ? "The site has a build error" : "The site hit an error while running"}</strong><pre>{problem}</pre></div>
      {onFixError && <button type="button" className="button primary small" title={PREVIEW_ACTIONS.fixError.effect} onClick={() => onFixError(problem)}><Wand2 size={14} />{PREVIEW_ACTIONS.fixError.label}</button>}
    </div>}
    {missingImages > 0 && !building && <div className="lp-problem" role="status"><AlertTriangle size={16} /><div>{missingImages === 1 ? "One project image" : `${missingImages} project images`} couldn&apos;t be loaded, so the preview shows the rest.</div>
      <button type="button" className="button secondary small" onClick={() => setImageAttempt(attempt => attempt + 1)}>Load images again</button></div>}
    {!inspecting && editNote && <div className="lp-problem" role="status"><AlertTriangle size={16} /><div>{editNote}</div></div>}
    {notice && <p className="lp-notice" role="status">{notice}</p>}
    <div className="lp-body">
      <div className="lp-stage" data-device={device} data-editing={inspecting || undefined}>
        {html ? <iframe
          key={frameKey}
          ref={frame}
          title="Website preview"
          hidden={missing}
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={html}
          style={{ width: width ? `${width}px` : "100%" }}
        /> : <div className="lp-empty">{building || (!buildError && !transportError) ? "Your website will appear here as it's built." : transportError ? "Preview connection lost. Try again re-renders the same saved files." : "The first build needs a fix — ask the builder to repair it."}</div>}
        {html && missing && <div className="lp-missing" role="region" aria-labelledby={`lp-missing-${scope.artifactId}`}>
          <h2 id={`lp-missing-${scope.artifactId}`}>Page not found</h2>
          <p><code>{formatPreviewPath(page)}</code> isn&apos;t a page in this saved version of the site. Nothing was created, generated or charged.</p>
          <button type="button" className="button primary small" onClick={() => go(HOME)}>Go to the home page</button>
          {knownRoutes.length > 1 && <ul aria-label="Pages in this version">{knownRoutes.filter(route => route.path !== "/").map(route =>
            <li key={route.path}><button type="button" className="lp-missing-link" onClick={() => go({ path: route.path, query: "", target: "" })}>{route.title || route.path} <span>{route.path}</span></button></li>)}</ul>}
        </div>}
      </div>
      {inspecting && <VisualEditorPanel picked={picked} description={description} images={projectImages} swatches={visualEdit?.swatches} note={editNote} canUndo={history.length > 0}
        onEdit={apply} onUndo={undo} onClose={toggleEditing}
        onParent={() => toFrame({ type: "select-parent" })}
        onAsk={visualEdit?.onAsk} />}
    </div>
  </section>;
}
