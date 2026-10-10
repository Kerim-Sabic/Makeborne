"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Maximize2, Monitor, RotateCw, Smartphone, Tablet, Wand2 } from "lucide-react";
import { bundleProject } from "@/lib/builder/browser-bundler";
import { readCloudImage } from "./cloud-api";

type Asset = { id: string; path: string };
type Device = "desktop" | "tablet" | "mobile";
const WIDTHS: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 };

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Live React preview compiled in the browser. The site runs in an opaque,
 * script-only sandbox: no Makeborne cookies, storage or same-origin access. */
export default function LivePreview({ files, assets, scope, building, onFixError }: {
  files: Record<string, string>;
  assets: Asset[];
  scope: { accountId: string; workspaceId: string; artifactId: string };
  building?: boolean;
  onFixError?: (message: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [buildError, setBuildError] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const cache = useRef(new Map<string, string>());

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
  const fileKey = useMemo(() => JSON.stringify(Object.keys(files).sort().map(path => [path, files[path].length, files[path].slice(-64)])), [files]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await bundleProject(files, images, "preview");
      if (cancelled) return;
      if (result.ok) { setHtml(result.html); setBuildError(""); setRuntimeError(""); }
      else setBuildError(result.error);
    }, building ? 700 : 150);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fileKey summarises files
  }, [fileKey, images, building, reloadKey]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== "makeborne-preview") return;
      if (event.data.type === "runtime-error") setRuntimeError(String(event.data.message).slice(0, 600));
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);

  const width = WIDTHS[device];
  const problem = buildError || runtimeError;
  return <section className="lp" aria-label="Website preview">
    <header className="lp-bar">
      <div className="lp-devices" role="group" aria-label="Preview size">
        {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([value, Icon]) =>
          <button key={value} type="button" aria-label={`${value} preview`} aria-pressed={device === value} onClick={() => setDevice(value)}><Icon size={15} /></button>)}
      </div>
      <span className="lp-status" role="status">{building ? "Building live…" : buildError ? "Needs a fix" : html ? "Live preview" : "Preparing preview…"}</span>
      <div className="lp-actions">
        <button type="button" aria-label="Reload preview" onClick={() => setReloadKey(key => key + 1)}><RotateCw size={15} /></button>
        <button type="button" aria-label="Full screen preview" onClick={() => void frame.current?.requestFullscreen?.().catch(() => undefined)}><Maximize2 size={15} /></button>
      </div>
    </header>
    {problem && !building && <div className="lp-problem" role="alert">
      <AlertTriangle size={16} />
      <div><strong>{buildError ? "The site has a build error" : "The site hit an error while running"}</strong><pre>{problem}</pre></div>
      {onFixError && <button type="button" className="button primary small" onClick={() => onFixError(problem)}><Wand2 size={14} />Fix it</button>}
    </div>}
    <div className="lp-stage" data-device={device}>
      {html ? <iframe
        key={reloadKey}
        ref={frame}
        title="Website preview"
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={html}
        style={{ width: width ? `${width}px` : "100%" }}
      /> : <div className="lp-empty">{buildError ? "Fixing the first build…" : "Your website will appear here as it's built."}</div>}
    </div>
  </section>;
}
