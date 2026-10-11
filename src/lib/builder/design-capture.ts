/** Client-side capture for the visual self-review. Each viewport renders the
 * project in its own opaque sandboxed frame; the page rasterises itself (the
 * capture runtime is inlined by bundleProject "capture" mode) and posts a JPEG
 * back. The host slices it into viewport-sized tiles for the review request. */
import { bundleProject } from "./browser-bundler";
import { REVIEW_LIMITS, REVIEW_VIEWPORTS, type ReviewViewport } from "./review-policy";

export type ReviewShot = { viewport: ReviewViewport; index: number; of: number; mediaType: "image/jpeg"; width: number; height: number; data: string };
export type ViewportReport = { viewport: ReviewViewport; width: number; height: number; pageHeight: number; capturedHeight: number; overflowX: number; wide: string[]; brokenImages: string[]; missingAlt: number };
/** errors: problems in the site itself (sent to the review); failures: capture problems on our side. */
export type DesignCapture = { screenshots: ReviewShot[]; viewports: ViewportReport[]; errors: string[]; failures: string[] };

type Viewport = (typeof REVIEW_VIEWPORTS)[number];
type Raw = { dataUrl: string; width: number; height: number; fullHeight: number; diagnostics: { overflowX: number; wide: string[]; brokenImages: string[]; missingAlt: number } };

const clip = (text: unknown, max: number = REVIEW_LIMITS.maxErrorChars) => String(text ?? "").trim().slice(0, max);
const strings = (value: unknown, max: number) => Array.isArray(value) ? value.map(item => clip(item, 200)).filter(Boolean).slice(0, max) : [];
const whole = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

/** Render one viewport off-screen and ask the page to rasterise itself. */
function renderViewport(html: string, viewport: Viewport, errors: string[], signal?: AbortSignal): Promise<Raw> {
  const frame = document.createElement("iframe");
  // Scripts only: no same-origin access, forms, popups or top navigation.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.tabIndex = -1;
  // Inside the window (behind everything, invisible) rather than far off-screen:
  // pages reveal content with IntersectionObserver, which never fires for frames
  // outside the top-level viewport, and browsers throttle off-screen frames.
  Object.assign(frame.style, { position: "fixed", left: "0", top: "0", width: `${viewport.width}px`, height: `${viewport.height}px`, border: "0", opacity: "0", pointerEvents: "none", zIndex: "-1" });
  return new Promise<Raw>((resolve, reject) => {
    let requested = false;
    const timer = setTimeout(() => finish(new Error(`The ${viewport.label.toLowerCase()} screenshot timed out.`)), 45_000);
    const abort = () => finish(new Error("Capture cancelled."));
    const finish = (error: Error | null, raw?: Raw) => {
      clearTimeout(timer); window.removeEventListener("message", listen); signal?.removeEventListener("abort", abort); frame.remove();
      if (error) reject(error); else resolve(raw!);
    };
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.source !== "makeborne-preview") return;
      const data = event.data;
      if (data.type === "runtime-error" || data.type === "console-error") {
        const message = `${viewport.label}: ${clip(data.message, 400)}`;
        if (errors.length < REVIEW_LIMITS.maxErrors && !errors.includes(message)) errors.push(message);
      }
      if (data.type === "ready" && !requested) {
        requested = true;
        setTimeout(() => frame.contentWindow?.postMessage({ source: "makeborne-host", type: "capture", maxHeight: viewport.height * viewport.maxTiles, scale: viewport.scale, quality: 0.86 }, "*"), 700);
      }
      if (data.type === "capture-error") finish(new Error(clip(data.message, 200) || "Capture failed."));
      if (data.type === "capture" && typeof data.dataUrl === "string" && data.dataUrl.startsWith("data:image/")) {
        finish(null, { dataUrl: data.dataUrl, width: whole(data.width), height: whole(data.height), fullHeight: whole(data.fullHeight),
          diagnostics: { overflowX: whole(data.diagnostics?.overflowX), wide: strings(data.diagnostics?.wide, 6), brokenImages: strings(data.diagnostics?.brokenImages, 6), missingAlt: whole(data.diagnostics?.missingAlt) } });
      }
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort);
    window.addEventListener("message", listen);
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("The screenshot could not be decoded."));
  image.src = url;
});

/** Slice a full-page capture into viewport-tall JPEG tiles within the limits. */
async function tiles(raw: Raw, viewport: Viewport): Promise<ReviewShot[]> {
  const image = await loadImage(raw.dataUrl);
  const tileHeight = Math.round(viewport.height * viewport.scale);
  const width = Math.min(image.naturalWidth, REVIEW_LIMITS.maxShotEdge);
  const ratio = width / image.naturalWidth;
  const minimum = REVIEW_LIMITS.minTileHeight * viewport.scale;
  const parts: { top: number; height: number }[] = [];
  for (let top = 0; top < image.naturalHeight && parts.length < viewport.maxTiles; top += tileHeight) {
    const height = Math.min(tileHeight, image.naturalHeight - top);
    if (height < minimum && parts.length) break;
    parts.push({ top, height });
  }
  const shots: ReviewShot[] = [];
  for (const [index, part] of parts.entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = Math.max(1, Math.round(part.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screenshots are not supported in this browser.");
    context.drawImage(image, 0, part.top, image.naturalWidth, part.height, 0, 0, canvas.width, canvas.height);
    let data = "";
    for (const quality of [0.74, 0.6, 0.45]) {
      data = canvas.toDataURL("image/jpeg", quality).replace(/^data:image\/jpeg;base64,/, "");
      if (data.length <= REVIEW_LIMITS.maxShotBase64) break;
    }
    if (data.length > REVIEW_LIMITS.maxShotBase64) continue;
    shots.push({ viewport: viewport.id, index, of: parts.length, mediaType: "image/jpeg", width: canvas.width, height: canvas.height, data });
  }
  return shots;
}

/** Capture desktop and mobile screenshots, layout diagnostics and runtime
 * errors for the given project files. `assets` maps /images/... paths to data URLs. */
export async function captureDesign(files: Record<string, string>, assets: Record<string, string>, signal?: AbortSignal): Promise<DesignCapture> {
  const bundle = await bundleProject(files, assets, "capture");
  if (!bundle.ok) return { screenshots: [], viewports: [], errors: [clip(`Build error: ${bundle.error}`)], failures: [] };
  const errors: string[] = [];
  const results = await Promise.allSettled(REVIEW_VIEWPORTS.map(async viewport => {
    const raw = await renderViewport(bundle.html, viewport, errors, signal);
    const report: ViewportReport = { viewport: viewport.id, width: viewport.width, height: viewport.height, pageHeight: raw.fullHeight, capturedHeight: raw.height, ...raw.diagnostics };
    return { report, shots: await tiles(raw, viewport) };
  }));
  const screenshots: ReviewShot[] = [], viewports: ViewportReport[] = [], failures: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") { screenshots.push(...result.value.shots); viewports.push(result.value.report); }
    else failures.push(`${REVIEW_VIEWPORTS[index].label}: ${result.reason instanceof Error ? result.reason.message : "capture failed"}`);
  }
  if (signal?.aborted) throw new Error("Capture cancelled.");
  return { screenshots, viewports, errors, failures };
}
