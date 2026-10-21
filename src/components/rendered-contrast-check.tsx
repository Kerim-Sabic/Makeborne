"use client";
import { useState } from "react";
import { Contrast, LoaderCircle } from "lucide-react";
import { canvasColorParser, measureRenderedContrast, type ContrastFinding, type ContrastState } from "@/lib/builder/rendered-contrast";
import { previewDocument } from "@/lib/hosting/prepared-preview";
import type { ScopeIds } from "@/lib/hosting/version-facts";
import { recordCheck } from "./use-check-record";

const STATE_LABELS: Record<ContrastState, string> = { default: "Normal", hover: "Hover", focus: "Keyboard focus", invalid: "Error (invalid field)" };
type Outcome = { findings: ContrastFinding[]; measured: number; pages: number; image: number; color: number; failedPages: string[] };

/** Loads one prepared page in a hidden, script-free frame and measures it from outside. */
function measurePage(path: string, html: string, parse: ReturnType<typeof canvasColorParser>) {
  return new Promise<ReturnType<typeof measureRenderedContrast>>((resolve, reject) => {
    const frame = document.createElement("iframe");
    // allow-same-origin without allow-scripts: nothing in the page can run; the parent reads computed styles.
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "Colour measurement";
    frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;visibility:hidden;pointer-events:none";
    const timer = window.setTimeout(() => { frame.remove(); reject(new Error("timeout")); }, 15_000);
    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument, view = frame.contentWindow;
        if (!doc || !view) throw new Error("unavailable");
        resolve(measureRenderedContrast(doc, view, path, parse));
      } catch (error) { reject(error); }
      finally { window.clearTimeout(timer); frame.remove(); }
    }, { once: true });
    frame.srcdoc = previewDocument(html);
    document.body.appendChild(frame);
  });
}

/** Measures text contrast in the prepared pages as rendered, in normal, hover, focus and
 * invalid-field states. Advice only; never blocks publishing. Mounted per preparation. */
export default function RenderedContrastCheck({ routes, version, dirty, scope }: { routes: readonly { path: string; html: string }[]; version: number; dirty: boolean; scope: ScopeIds }) {
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  async function run() {
    if (running || !routes.length) return;
    setRunning(true);
    const parse = canvasColorParser(document);
    const next: Outcome = { findings: [], measured: 0, pages: 0, image: 0, color: 0, failedPages: [] };
    for (const route of routes) {
      try {
        const result = await measurePage(route.path, route.html, parse);
        next.findings.push(...result.findings); next.measured += result.measured; next.pages++;
        next.image += result.unmeasured.image; next.color += result.unmeasured.color;
      } catch { next.failedPages.push(route.path); }
    }
    setOutcome(next); setRunning(false);
    if (next.pages === routes.length) recordCheck(scope, { version, dirty, kind: "rendered-contrast", prepared: true });
  }
  const states = outcome ? [...new Set(outcome.findings.map(finding => finding.state))] : [];
  return <section className="rendered-contrast" aria-label="Colour contrast in hover, focus and error states">
    <div className="rendered-contrast-heading">
      <Contrast size={16} aria-hidden="true" />
      <strong>Colours as rendered</strong>
      {outcome && <span className="rendered-contrast-summary" data-state={outcome.findings.length ? "check" : outcome.failedPages.length ? "error" : "clean"}>{outcome.findings.length ? `${outcome.findings.length} below WCAG AA` : outcome.failedPages.length ? "Couldn’t finish" : "No low contrast found"}</span>}
    </div>
    <p className="rendered-contrast-intro">Measures text over its real background in the prepared pages, at its rendered size, in normal, hover, keyboard-focus and error (invalid field) states, using the site’s own styles. Advice only: you can still publish.</p>
    <button type="button" className="button secondary small" disabled={running || !routes.length} onClick={() => void run()}>{running ? <LoaderCircle size={14} className="auth-spinner" /> : <Contrast size={14} />}{running ? "Measuring colours…" : outcome ? "Measure again" : "Measure colours in all states"}</button>
    {outcome && <div role="status" className="rendered-contrast-result">
      <p>Measured {outcome.measured} text and field colours on {outcome.pages === 1 ? "1 prepared page" : `${outcome.pages} prepared pages`} of version {version} at 1280 px wide.{outcome.failedPages.length ? ` Couldn’t measure ${outcome.failedPages.join(", ")}.` : ""}</p>
      {outcome.findings.length > 0 && <ul className="rendered-contrast-list">{states.map(state => <li key={state}><strong>{STATE_LABELS[state]}</strong><ul>
        {outcome.findings.filter(finding => finding.state === state).slice(0, 8).map((finding, index) => <li key={index}><code>{finding.page}</code> {finding.kind === "field-border" ? "field border of " : ""}{finding.element}: {finding.ratio}:1, needs {finding.required}:1 <span className="rendered-contrast-swatch" style={{ color: finding.foreground, background: finding.background }} aria-hidden="true">Aa</span> <small>{finding.foreground} on {finding.background}</small></li>)}
        {outcome.findings.filter(finding => finding.state === state).length > 8 && <li><small>and {outcome.findings.filter(finding => finding.state === state).length - 8} more</small></li>}
      </ul></li>)}</ul>}
      <p className="rendered-contrast-limits">Not measured: {outcome.image ? `${outcome.image} text over images or gradients, ` : "text over images or gradients, "}{outcome.color ? `${outcome.color} colours the browser couldn’t read, ` : ""}opacity and shadows, phone widths, the browser’s default focus ring and states the site’s scripts set. Nothing found here doesn’t certify accessibility.</p>
    </div>}
  </section>;
}
