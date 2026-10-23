/**
 * In-browser half of the rendered-contrast finish gate. Bundled by
 * scripts/prepare-builder-runtime.mjs into public/builder-runtime/contrast-probe.js
 * (window.__makeborneContrast) and run by the server in a headless browser on
 * the app's own origin (contrast-gate.ts): it prepares the site exactly as
 * publishing does (captureStaticSnapshot), then measures the prepared page in a
 * script-free frame with the studio's own rendered-contrast check, at desktop
 * and phone widths. Nothing leaves the page; images are not loaded (text over
 * images is reported as unmeasured, as in the studio check).
 */
import { captureStaticSnapshot } from "./browser-bundler";
import { canvasColorParser, measureRenderedContrast, summarizeFindings, type ContrastFinding } from "./rendered-contrast";
import { previewDocument } from "../hosting/prepared-preview";
import { coveredText, cutOffPanels, wrappedBands, type CoveredText, type CutOff, type WrappedBand } from "./layout-probe";

export type { CoveredText, CutOff, WrappedBand } from "./layout-probe";

function measure(html: string, width: number, parse: ReturnType<typeof canvasColorParser>, phoneOnly = false) {
  return new Promise<ReturnType<typeof measureRenderedContrast> & { covered: CoveredText[]; cutOff: CutOff[]; wrapped: WrappedBand[] }>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:900px;border:0`;
    const timer = window.setTimeout(() => { frame.remove(); reject(new Error("timeout")); }, 15_000);
    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument, view = frame.contentWindow;
        if (!doc || !view) throw new Error("unavailable");
        // The 360 px pass only looks for content past the screen edge; contrast and covered text are measured at 390.
        const contrast = phoneOnly ? { findings: [], measured: 0, unmeasured: { image: 0 } } as unknown as ReturnType<typeof measureRenderedContrast> : measureRenderedContrast(doc, view, "/", parse, 400);
        if (phoneOnly) { resolve({ ...contrast, covered: [], cutOff: cutOffPanels(doc, view, width, 2, true), wrapped: wrappedBands(doc, view, width) }); return; }
        // The whole page in one viewport, so every line can be hit-tested.
        frame.style.height = `${Math.min(20_000, doc.documentElement.scrollHeight)}px`;
        resolve({ ...contrast, covered: coveredText(doc, view, width), cutOff: cutOffPanels(doc, view, width), wrapped: wrappedBands(doc, view, width) });
      } catch (error) { reject(error); }
      finally { window.clearTimeout(timer); frame.remove(); }
    }, { once: true });
    frame.srcdoc = previewDocument(html);
    document.body.appendChild(frame);
  });
}

export async function probeContrast(files: Record<string, string>): Promise<{ findings: ContrastFinding[]; measured: number; unmeasuredImage: number; covered: CoveredText[]; cutOff: CutOff[]; wrapped: WrappedBand[] }> {
  const html = await captureStaticSnapshot(files, {});
  const parse = canvasColorParser(document);
  const findings: ContrastFinding[] = [];
  let measured = 0, unmeasuredImage = 0;
  const covered: CoveredText[] = [], cutOff: CutOff[] = [], wrapped: WrappedBand[] = [];
  for (const width of [1440, 390]) {
    const result = await measure(html, width, parse);
    findings.push(...result.findings); measured += result.measured; unmeasuredImage += result.unmeasured.image; covered.push(...result.covered); cutOff.push(...result.cutOff); wrapped.push(...result.wrapped);
  }
  const phone = await measure(html, 360, parse, true);
  cutOff.push(...phone.cutOff); wrapped.push(...phone.wrapped);
  return { findings: summarizeFindings(findings), measured, unmeasuredImage, covered, cutOff, wrapped };
}

declare global { interface Window { __makeborneContrast?: { probeContrast: typeof probeContrast } } }
if (typeof window !== "undefined") window.__makeborneContrast = { probeContrast };
