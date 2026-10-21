/**
 * Rendered contrast as a hard finish gate. At finish the builder's files are
 * prepared and measured in a headless browser with the studio's own
 * rendered-contrast check (contrast-probe.ts), so a failing text pair is found
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
import type { CoveredText } from "./contrast-probe";

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
  return async (files: ReadonlyMap<string, string>): Promise<readonly string[] | null> => {
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
        const probe = (window as unknown as { __makeborneContrast?: { probeContrast: (files: Record<string, string>) => Promise<{ findings: ContrastFinding[]; covered?: CoveredText[] }> } }).__makeborneContrast;
        if (!probe) throw new Error("contrast probe unavailable");
        return probe.probeContrast(record);
      }, Object.fromEntries(files));
      return [...(result.covered ?? []).slice(0, 4).map(coveredProblem), ...contrastProblems(result.findings)];
    } catch (error) {
      console.error(JSON.stringify({ event: "builder_contrast_unverified", reason: error instanceof Error ? error.message.slice(0, 200) : "unavailable" }));
      return null;
    } finally {
      await browser?.close().catch(() => undefined);
    }
  };
}
