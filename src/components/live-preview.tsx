"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Maximize2, Monitor, MousePointerClick, RotateCw, Smartphone, Tablet, Wand2 } from "lucide-react";
import { bundleProject } from "@/lib/builder/browser-bundler";
import { previewFileRevision } from "@/lib/builder/preview-revision";
import type { ElementDescription, ElementLoc, StyleField, VisualEdit } from "@/lib/builder/visual-edit";
import type { WebsiteProjectSource } from "@/lib/projects/website-source";
import type { PickedElement } from "./visual-editor-panel";
import { readCloudImage } from "./cloud-api";
import "@/app/visual-editor.css";

const VisualEditorPanel = dynamic(() => import("./visual-editor-panel"), { ssr: false });
type EditEngine = typeof import("@/lib/builder/visual-edit");

type Asset = { id: string; path: string };
type Device = "desktop" | "tablet" | "mobile";
const WIDTHS: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 };
const STYLE_KEYS: StyleField[] = ["color", "backgroundColor", "fontSize", "fontWeight", "textAlign", "padding", "margin", "borderRadius"];

/** Saved project source plus where click-to-edit changes go. */
export type VisualEditHost = {
  source: WebsiteProjectSource;
  /** Set while editing would conflict with saving, building or review state. */
  disabledReason?: string;
  onApply: (next: WebsiteProjectSource, summary: string) => void;
  onAsk?: (text: string) => void;
  /** Brand colours offered first in the colour pickers. */
  swatches?: { label: string; value: string }[];
  /** The site belongs to a client: offer "Let my client edit this" on texts. */
  clientEditing?: boolean;
};

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Live React preview compiled in the browser. The site runs in an opaque,
 * script-only sandbox: no Makeborne cookies, storage or same-origin access.
 * With `visualEdit`, owners and editors can click elements to change text,
 * links, images and style directly in the source — no model call. */
export default function LivePreview({ files, assets, scope, building, onFixError, visualEdit }: {
  files: Record<string, string>;
  assets: Asset[];
  scope: { accountId: string; workspaceId: string; artifactId: string };
  building?: boolean;
  onFixError?: (message: string) => void;
  visualEdit?: VisualEditHost;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [buildError, setBuildError] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const cache = useRef(new Map<string, string>());

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
      for (const asset of assets) {
        let url = cache.current.get(asset.id);
        if (!url) {
          try {
            const blob = await readCloudImage(`/api/cloud/workspaces/${scope.workspaceId}/artifacts/${scope.artifactId}/assets/${asset.id}`, scope.accountId, controller.signal);
            url = await toDataUrl(blob);
            cache.current.set(asset.id, url);
          } catch { continue; }
        }
        next[`/${asset.path.replace(/^public\//, "")}`] = url;
      }
      if (!controller.signal.aborted) setImages(next);
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assetKey captures the asset list
  }, [assetKey, scope.accountId, scope.workspaceId, scope.artifactId]);

  // Rebuild shortly after files settle; keep the last good render on errors.
  const fileKey = useMemo(() => previewFileRevision(files), [files]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await bundleProject(files, images, "preview", { inspect: inspecting });
      if (cancelled) return;
      if (result.ok) { setHtml(result.html); setBuildError(""); setRuntimeError(""); }
      else if (inspecting) { setEditing(false); setPicked(null); setEditNote("Click-to-edit couldn't read this project's code. Use Code, or ask the builder."); }
      else setBuildError(result.error);
    }, building ? 700 : 150);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fileKey captures every path and full file content
  }, [fileKey, images, building, reloadKey, inspecting]);

  const toFrame = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ source: "makeborne-host", ...message }, "*");
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== "makeborne-preview") return;
      const data = event.data;
      if (data.type === "runtime-error") setRuntimeError(String(data.message).slice(0, 600));
      if (data.type === "ready" && inspecting) (event.source as Window).postMessage({ source: "makeborne-host", type: "edit-mode", on: true, ...restore.current }, "*");
      if (data.type === "scroll" && Number.isFinite(data.y)) restore.current.y = Math.max(0, Math.round(data.y));
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
  }, [inspecting, engine]);

  // Turning edit mode off clears the selection; the rebuild drops the tags.
  function toggleEditing() {
    if (editing) { setEditing(false); setPicked(null); setEditNote(""); restore.current = { loc: null, index: 0, y: restore.current.y }; return; }
    setEditNote(""); setEditing(true);
  }

  const description: ElementDescription | null = useMemo(() => engine && picked && source ? engine.describeElement(source, picked.loc, picked.text) : null, [engine, picked, source]);
  const projectImages = useMemo(() => (source?.assets ?? []).map(asset => {
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
    setEditNote(edit.kind === "extract" ? `Handed over. Your client can now edit “${edit.label.trim()}” in their portal, under Website text.` : "");
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

  const width = WIDTHS[device];
  const problem = buildError || runtimeError;
  const editTitle = !visualEdit ? "" : building ? "Wait for the build to finish" : visualEdit.disabledReason ?? (editing ? "Stop editing" : "Click elements in the preview to edit them");
  return <section className="lp" aria-label="Website preview">
    <header className="lp-bar">
      <div className="lp-devices" role="group" aria-label="Preview size">
        {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([value, Icon]) =>
          <button key={value} type="button" aria-label={`${value} preview`} aria-pressed={device === value} onClick={() => setDevice(value)}><Icon size={15} /></button>)}
      </div>
      <span className="lp-status" role="status">{building ? "Building live…" : buildError ? "Needs a fix" : inspecting ? (picked ? "Editing" : "Click anything to edit it") : html ? "Live preview" : "Preparing preview…"}</span>
      <div className="lp-actions">
        {visualEdit && <button type="button" className="lp-edit" aria-pressed={inspecting} disabled={!editing && (Boolean(visualEdit.disabledReason) || Boolean(building) || !html)} title={editTitle} onClick={toggleEditing}>
          <MousePointerClick size={14} />{inspecting ? "Done" : "Edit"}</button>}
        <button type="button" aria-label="Reload preview" onClick={() => setReloadKey(key => key + 1)}><RotateCw size={15} /></button>
        <button type="button" aria-label="Full screen preview" onClick={() => void frame.current?.requestFullscreen?.().catch(() => undefined)}><Maximize2 size={15} /></button>
      </div>
    </header>
    {problem && !building && <div className="lp-problem" role="alert">
      <AlertTriangle size={16} />
      <div><strong>{buildError ? "The site has a build error" : "The site hit an error while running"}</strong><pre>{problem}</pre></div>
      {onFixError && <button type="button" className="button primary small" onClick={() => onFixError(problem)}><Wand2 size={14} />Fix it</button>}
    </div>}
    {!inspecting && editNote && <div className="lp-problem" role="status"><AlertTriangle size={16} /><div>{editNote}</div></div>}
    <div className="lp-body">
      <div className="lp-stage" data-device={device} data-editing={inspecting || undefined}>
        {html ? <iframe
          key={reloadKey}
          ref={frame}
          title="Website preview"
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={html}
          style={{ width: width ? `${width}px` : "100%" }}
        /> : <div className="lp-empty">{building || !buildError ? "Your website will appear here as it's built." : "The first build needs a fix — ask the builder to repair it."}</div>}
      </div>
      {inspecting && <VisualEditorPanel picked={picked} description={description} images={projectImages} swatches={visualEdit?.swatches} clientEditing={visualEdit?.clientEditing} note={editNote} canUndo={history.length > 0}
        onEdit={apply} onUndo={undo} onClose={toggleEditing}
        onParent={() => toFrame({ type: "select-parent" })}
        onAsk={visualEdit?.onAsk} />}
    </div>
  </section>;
}
