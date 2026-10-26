/**
 * Rendered contrast as a hard finish gate. At finish the builder's files are
 * prepared and measured in a headless browser with the studio's own
 * rendered-contrast check (contrast-probe.ts), plus covered text and panels cut off
 * by the screen edge, so a failing text pair is found
 * where it actually renders: muted text on a tinted block, accent numerals on a
 * dark panel, a hover or focus state. Each failing pair becomes one precise,
 * model-facing instruction; the agent's once-per-distinct-problem rule means a
 * finding blocks a finish once and can never strand the work.
 *
 * The browser page lives on the app's own origin (for /builder-runtime/*), and
 * every request to any other host is aborted. When no browser can start, the
 * gate reports null (unverified) and the build is not blocked, exactly like an
 * unavailable compiler.
 */
import type { Browser } from "playwright";
import type { ContrastFinding } from "./rendered-contrast";
import type { CompDeviation, CompReading, CoveredText, CutOff, FirstScreenMiss, PageOverflow, WrappedBand } from "./contrast-probe";

const HOST_PATH = "/__makeborne-contrast-host";
const STATE = { default: "", hover: " on hover", focus: " on keyboard focus", invalid: " in its error state" } as const;
export const MAX_CONTRAST_PROBLEMS = 6;

/** One model-facing instruction per failing pair. */
export function contrastProblem(finding: ContrastFinding) {
  if (finding.kind === "field-border") return `Contrast: the border of ${finding.element}${STATE[finding.state]} is ${finding.ratio}:1 (${finding.foreground} on ${finding.background}); form field borders need ${finding.required}:1. Darken the border colour until it reaches ${finding.required}:1.`;
  return `Contrast: ${finding.element}${STATE[finding.state]} is ${finding.ratio}:1 (${finding.foreground} on ${finding.background}) and needs ${finding.required}:1 at its size. Change that text's colour on that surface (mix it toward the ink, or use --ink on tinted blocks and --accent-on-dark on dark panels) or put the text on a solid panel, then call finish again.`;
}

/** Text painted over by another element (a card over the phone number): one instruction per covered line. */
export function coveredProblem(item: CoveredText) {
  return `Covered text: "${item.text}" (${item.element}) is hidden under ${item.by} at ${item.width} px wide. Move, resize or re-stack the overlapping element so this text is fully visible at every width, then call finish again.`;
}

/** A boxed element with text running past the screen edge (a hero card off the page). */
/** Problems that block finish every time they are found (never accepted on a repeat): text hidden under another
 * element, content past the screen edge, a page wider than the screen and a band wrapped onto a second row. */
export { BLOCKING_PROBLEM } from "./contrast-gate-rules";

/** The page scrolls sideways (W9). */
export function overflowProblem(item: PageOverflow) {
  return `Page overflow: the page is ${item.px} px wider than the screen at ${item.width} px wide; the outermost element past the edge is ${item.element}${item.text ? ` ("${item.text}")` : ""}. Size it to its column (max-width: 100%, min-width: 0, overflow-wrap: anywhere for long words, smaller display type on phones), or clip a full-bleed band with overflow: clip on its section; never overflow-x: hidden on html or body. Then call finish again.`;
}

/** A section built further from its design comp than allowed (measured at the comp's viewport). */
export function fidelityProblem(item: CompDeviation) {
  return `Comp fidelity: the "${item.section}" section (${item.viewport}) is off its comp: ${item.fix}, unless that breaks the 360 px, overlap or contrast rules. Then call finish again.`;
}

/** The first phone screen does not hold the h1 and the primary action (W16). Blocks a finish once. */
export function firstScreenProblem(item: FirstScreenMiss) {
  const what = item.missing.map(part => part === "h1"
    ? `the h1${item.h1 ? ` ("${item.h1}")` : ""} ${item.h1Bottom !== null ? `ends at ${item.h1Bottom} px` : "is missing"}`
    : `the primary action${item.action ? ` ("${item.action}")` : ""} ${item.actionBottom !== null ? `ends at ${item.actionBottom} px` : "is missing"}`).join(" and ");
  return `First screen: on a ${item.width} × ${item.height} phone screen ${what}; both must be fully visible without scrolling. Tighten the phone first screen as in the phone comp: a shorter header, the hero image as a band of about a quarter of the screen (or below the action), smaller phone headline sizes (clamp), less space above the h1, and the primary action as a filled pill right under the headline or value line. Then call finish again.`;
}

/** A marquee or tag band that wraps into a second row. */
export function wrappedProblem(item: WrappedBand) {
  return `Wrapped band: ${item.element} ("${item.text}") breaks into ${item.rows} rows at ${item.width} px wide. A marquee or tag band is always one row: flex-wrap: nowrap on the track, white-space: nowrap on its items and overflow: clip on the band; under prefers-reduced-motion it stops but stays one row (fade the edge with mask-image, hide the duplicate), never a wrapped second line. Then call finish again.`;
}

export function cutOffProblem(item: CutOff) {
  return `Cut off: ${item.element} ("${item.text}") runs past the ${item.side} edge of the screen at ${item.width} px wide. Keep everything inside the page margins at every width down to 360 px: size cards, panels and product mocks to their column (max-width: 100%), let rows wrap, and on small phones move secondary header items into the menu; only images and full-width bands may bleed. Then call finish again.`;
}

/** Findings to problems: the worst pairs first, at most MAX_CONTRAST_PROBLEMS. */
export function contrastProblems(findings: readonly ContrastFinding[]) {
  return [...findings].sort((a, b) => a.ratio / a.required - b.ratio / b.required).slice(0, MAX_CONTRAST_PROBLEMS).map(contrastProblem);
}

/**
 * A contrastCheck for runBuilder. `origin` serves /builder-runtime/* (the app
 * itself, or a local static server in the eval harness); `launch` opens the
 * browser (production: the export pipeline's Chromium).
 */
export function renderedContrastCheck(input: { origin: string; launch: () => Promise<Browser>; timeoutMs?: number }) {
  const origin = new URL(input.origin).origin;
  return async (files: ReadonlyMap<string, string>, options: { comps?: readonly CompReading[] } = {}): Promise<readonly string[] | null> => {
    let browser: Browser | null = null;
    try {
      browser = await input.launch();
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      await context.route("**/*", route => (new URL(route.request().url()).origin === origin || route.request().url().startsWith("data:") || route.request().url().startsWith("blob:") ? route.continue() : route.abort("blockedbyclient")));
      await context.route(`${origin}${HOST_PATH}`, route => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>" }));
      const page = await context.newPage();
      page.setDefaultTimeout(input.timeoutMs ?? 60_000);
      await page.goto(`${origin}${HOST_PATH}`, { waitUntil: "load" });
      await page.addScriptTag({ url: `${origin}/builder-runtime/contrast-probe.js` });
      const result = await page.evaluate(async record => {
        const probe = (window as unknown as { __makeborneContrast?: { probeContrast: (files: Record<string, string>, readings?: readonly CompReading[]) => Promise<{ findings: ContrastFinding[]; covered?: CoveredText[]; cutOff?: CutOff[]; wrapped?: WrappedBand[]; overflow?: PageOverflow[]; fidelity?: CompDeviation[]; firstScreen?: FirstScreenMiss[] }> } }).__makeborneContrast;
        if (!probe) throw new Error("contrast probe unavailable");
        return probe.probeContrast(record.files, record.readings);
      }, { files: Object.fromEntries(files), readings: [...(options.comps ?? [])] });
      return [...(result.covered ?? []).slice(0, 4).map(coveredProblem), ...(result.cutOff ?? []).slice(0, 2).map(cutOffProblem), ...(result.wrapped ?? []).slice(0, 1).map(wrappedProblem),
        ...(result.overflow ?? []).slice(0, 2).map(overflowProblem), ...(result.firstScreen ?? []).slice(0, 1).map(firstScreenProblem), ...(result.fidelity ?? []).slice(0, 3).map(fidelityProblem), ...contrastProblems(result.findings)];
    } catch (error) {
      console.error(JSON.stringify({ event: "builder_contrast_unverified", reason: error instanceof Error ? error.message.slice(0, 200) : "unavailable" }));
      return null;
    } finally {
      await browser?.close().catch(() => undefined);
    }
  };
}
