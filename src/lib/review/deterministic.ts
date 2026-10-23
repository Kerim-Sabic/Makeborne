import type { ApprovedFacts, ClaimsCheck, Diagnostic, Finding, ReviewLocation, Severity } from "./contract";
import { CATEGORIES } from "./contract";
import type { ProbeReport, SlideProbe } from "./probe";
import type { PdfInspection } from "./pdf-inspect";
import type { PptxInspection } from "./pptx-inspect";

/**
 * Deterministic checks: measured results at exact locations. Each failed check
 * becomes a finding with grounding "measured" and a re-verification method
 * that re-runs the same check. A check that could not run is not_checked and
 * appears in the coverage limits, never as passed.
 *
 * Concepts follow qualification/beta-combined-20261022
 * infra/project-runtime/site-verifier.mjs (passed / failed / not_checked per
 * check, route and viewport) without its interactive checks (menus, focus,
 * forms sending), which need scripts this capture does not run.
 */
type Category = (typeof CATEGORIES)[number];
export type CheckSpec = Readonly<{ severity: Severity; category: Category; repair: string }>;
export const CHECKS: Readonly<Record<string, CheckSpec>> = Object.freeze({
  "site.render": { severity: "blocker", category: "broken", repair: "Make the route render its content." },
  "site.runtime-errors": { severity: "blocker", category: "broken", repair: "Fix the runtime error reported by the preview." },
  "site.broken-asset": { severity: "major", category: "broken", repair: "Point the image at an existing project asset or replace it with CSS/SVG art." },
  "site.overflow": { severity: "major", category: "layout", repair: "Constrain the element that runs past the screen edge (min-width: 0, max-width: 100%, wrapping); do not hide overflow on html or body." },
  "site.covered-text": { severity: "major", category: "layout", repair: "Move or restack the element painted over this text so the text is readable." },
  "site.clipped-text": { severity: "major", category: "legibility", repair: "Let the clipped text wrap or give its box room; do not cut text off with overflow." },
  "site.dead-link": { severity: "major", category: "broken", repair: "Give the link a real destination (an existing section id, route, tel: or mailto:) or make it plain text." },
  "site.form-label": { severity: "major", category: "accessibility", repair: "Give the field a visible label (label for=…) or an aria-label." },
  "site.form-submit": { severity: "minor", category: "accessibility", repair: "Add a submit button to the form." },
  "site.image-alt": { severity: "minor", category: "accessibility", repair: "Add alt text (alt=\"\" for decorative images)." },
  "site.claims": { severity: "major", category: "factual", repair: "Use the approved value from the client's facts or remove the claim." },
  "book.export": { severity: "blocker", category: "export", repair: "Fix the document so the PDF export completes." },
  "book.page-size": { severity: "major", category: "export", repair: "Restore the book trim size for every page." },
  "book.coverage": { severity: "blocker", category: "completeness", repair: "Make sure every chapter is present in the exported PDF." },
  "book.blank-page": { severity: "major", category: "layout", repair: "Remove the forced break that leaves an empty page inside the chapter." },
  "book.page-balance": { severity: "minor", category: "layout", repair: "Tighten or extend the chapter so its last page is not a few stray lines." },
  "book.claims": { severity: "major", category: "factual", repair: "Use the approved value from the client's facts or remove the claim." },
  "deck.export": { severity: "blocker", category: "export", repair: "Fix the deck so the PPTX export completes." },
  "deck.slide-count": { severity: "blocker", category: "completeness", repair: "Export every slide." },
  "deck.chart-editable": { severity: "major", category: "export", repair: "Export the chart as a native, editable chart with its data." },
  "deck.notes": { severity: "major", category: "completeness", repair: "Add speaker notes to the slide." },
  "deck.text-clipped": { severity: "major", category: "legibility", repair: "Shorten the text or use a layout with room for it." },
  "deck.claims": { severity: "major", category: "factual", repair: "Use the approved value from the client's facts or remove the claim." },
});
export type CheckId = keyof typeof CHECKS;

const diag = (check: string, key: string, location: ReviewLocation, status: Diagnostic["status"], measured: string, reason?: string): Diagnostic =>
  ({ id: `${check}:${key}`.slice(0, 160), check, location, status, measured: measured.slice(0, 300), ...(reason ? { reason: reason.slice(0, 200) } : {}) });

// ---- Websites ----
export type WebsiteProbe = Readonly<{
  route: string; viewport: "desktop" | "phone"; report: ProbeReport | null; error?: string;
  /** Image URLs the capture refused to fetch (outside the project): their state is unknown, not broken. */
  blocked: readonly string[];
}>;

export function websiteDiagnostics(input: { probes: readonly WebsiteProbe[]; runtimeErrors: readonly string[]; facts: ApprovedFacts | null; claims: ClaimsCheck }): Diagnostic[] {
  const out: Diagnostic[] = [];
  const first = input.probes[0];
  const at = (probe: WebsiteProbe, selector: string | null = null): ReviewLocation => ({ kind: "route", route: probe.route, viewport: probe.viewport, selector: selector?.slice(0, 200) ?? null });
  if (first) out.push(input.runtimeErrors.length
    ? diag("site.runtime-errors", first.route, at(first), "failed", input.runtimeErrors.slice(0, 3).join(" | "))
    : diag("site.runtime-errors", first.route, at(first), "not_checked", "", "scripts are not executed in the review capture; only errors reported by the preview are listed"));
  for (const probe of input.probes) {
    const key = `${probe.route}:${probe.viewport}`;
    const report = probe.report;
    if (!report) { out.push(diag("site.render", key, at(probe), "failed", probe.error ?? "the route did not render")); continue; }
    const rendered = report.text.trim().length > 0;
    out.push(diag("site.render", key, at(probe), rendered ? "passed" : "failed", rendered ? `${report.text.length} characters of visible text` : "no visible text"));
    if (!rendered) continue;
    const blocked = new Set(probe.blocked);
    const broken = report.failedImages.filter(image => !blocked.has(image.src));
    broken.forEach((image, index) => out.push(diag("site.broken-asset", `${key}:${index}`, at(probe, image.element), "failed", `image failed to load: ${image.src || "(empty src)"}`)));
    if (!broken.length) out.push(diag("site.broken-asset", key, at(probe), report.failedImages.length ? "not_checked" : "passed",
      report.failedImages.length ? `${report.failedImages.length} external image(s) not loaded` : `${report.failedImages.length} broken of the page's images`, report.failedImages.length ? "external images are not fetched by the review capture" : undefined));
    out.push(report.overflow
      ? diag("site.overflow", key, at(probe, report.overflow.element), "failed", `page is ${report.overflow.px}px wider than the ${report.width}px screen; outermost: ${report.overflow.element} "${report.overflow.text}"`)
      : diag("site.overflow", key, at(probe), "passed", "no horizontal overflow"));
    report.covered.forEach((item, index) => out.push(diag("site.covered-text", `${key}:${index}`, at(probe, item.element), "failed", `"${item.text}" (${item.element}) is painted over by ${item.by}`)));
    if (!report.covered.length) out.push(diag("site.covered-text", key, at(probe), "passed", "no text painted over"));
    report.clipped.forEach((item, index) => out.push(diag("site.clipped-text", `${key}:${index}`, at(probe, item.element), "failed",
      item.axis === "page" ? `"${item.text}" runs ${item.px}px past the screen edge and is cut off by a clipping html/body` : `"${item.text}" is cut off by its box (${item.px}px hidden, ${item.axis === "x" ? "horizontally" : "vertically"})`)));
    if (!report.clipped.length) out.push(diag("site.clipped-text", key, at(probe), "passed", "no clipped text"));
    // Links, forms and alt text are the same at every width: check them once per route (desktop).
    if (probe.viewport !== "desktop") continue;
    const dead = report.links.filter(link => link.dead);
    dead.forEach((link, index) => out.push(diag("site.dead-link", `${probe.route}:${index}`, at(probe, link.element), "failed", `link "${link.text || link.href}" → ${link.reason}`)));
    if (!dead.length) out.push(diag("site.dead-link", probe.route, at(probe), "passed", `${report.links.length} link(s); none lead nowhere on this page`));
    report.unnamedFields.forEach((field, index) => out.push(diag("site.form-label", `${probe.route}:${index}`, at(probe, field.element), "failed", `${field.type} field ${field.name ? `"${field.name}" ` : ""}has no label`)));
    if (!report.unnamedFields.length) out.push(diag("site.form-label", probe.route, at(probe), "passed", "every form field has a label"));
    report.formsWithoutSubmit.forEach((form, index) => out.push(diag("site.form-submit", `${probe.route}:${index}`, at(probe, form.element), "failed", "form has no submit button")));
    report.missingAlt.slice(0, 6).forEach((image, index) => out.push(diag("site.image-alt", `${probe.route}:${index}`, at(probe, image.element), "failed", `image without alt: ${image.src}`)));
    out.push(...claimDiagnostics("site.claims", probe.route, at(probe), report.text, input));
  }
  return out;
}

function claimDiagnostics(check: string, key: string, location: ReviewLocation, text: string, input: { facts: ApprovedFacts | null; claims: ClaimsCheck }): Diagnostic[] {
  if (!input.facts) return [diag(check, key, location, "not_checked", "", "no approved facts snapshot is available for this client")];
  const results = input.claims(text, input.facts);
  const unsupported = results.filter(result => !result.supported);
  if (!unsupported.length) return [diag(check, key, location, "passed", results.length ? `${results.length} price/percentage claim(s), all in the approved facts` : "no price or percentage claims")];
  return unsupported.slice(0, 10).map((result, index) => diag(check, `${key}:${index}`, location, "failed", `"${result.text}" (${result.kind}) is not in the approved facts`));
}

// ---- Books ----
export const BOOK_PAGE_PT = Object.freeze({ width: 432, height: 648 });
export function bookDiagnostics(input: { pdf: PdfInspection | null; exportError: string | null; chapters: readonly { id: string; title: string; text: string }[]; facts: ApprovedFacts | null; claims: ClaimsCheck }): Diagnostic[] {
  const whole: ReviewLocation = { kind: "artifact" };
  if (input.exportError) return [diag("book.export", "pdf", whole, "failed", input.exportError)];
  const out: Diagnostic[] = [diag("book.export", "pdf", whole, "passed", "PDF exported")];
  const pdf = input.pdf;
  if (!pdf) {
    for (const check of ["book.page-size", "book.coverage", "book.blank-page", "book.page-balance"]) out.push(diag(check, "pdf", whole, "not_checked", "", "the exported PDF could not be read by the inspector"));
  } else {
    const off = pdf.pages.filter(page => Math.abs(page.width - BOOK_PAGE_PT.width) > 0.5 || Math.abs(page.height - BOOK_PAGE_PT.height) > 0.5);
    off.slice(0, 5).forEach(page => out.push(diag("book.page-size", `page-${page.page}`, { kind: "page", page: page.page, chapterId: null }, "failed", `page ${page.page} is ${page.width}×${page.height} pt (expected ${BOOK_PAGE_PT.width}×${BOOK_PAGE_PT.height})`)));
    if (!off.length) out.push(diag("book.page-size", "pdf", whole, "passed", `${pdf.pageCount} page(s), all ${BOOK_PAGE_PT.width}×${BOOK_PAGE_PT.height} pt`));
    // Chapter spans from the outline: a chapter runs from its outline page to the page before the next chapter.
    const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const starts = input.chapters.map(chapter => ({ chapter, page: pdf.outline.find(entry => norm(entry.title) === norm(chapter.title))?.page ?? null }));
    for (const { chapter, page } of starts) out.push(page
      ? diag("book.coverage", chapter.id, { kind: "page", page, chapterId: chapter.id }, "passed", `"${chapter.title}" starts on page ${page}`)
      : diag("book.coverage", chapter.id, whole, "failed", `chapter "${chapter.title}" is missing from the exported PDF`));
    const located = starts.filter((item): item is { chapter: typeof item.chapter; page: number } => item.page !== null).sort((a, b) => a.page - b.page);
    let blank = 0, runt = 0;
    located.forEach((item, index) => {
      const end = (located[index + 1]?.page ?? pdf.pageCount + 1) - 1;
      const span = pdf.pages.filter(page => page.page > item.page && page.page <= end);
      for (const page of span) if (page.glyphs === 0 && page.images === 0 && page.page !== end) {
        blank++; out.push(diag("book.blank-page", `page-${page.page}`, { kind: "page", page: page.page, chapterId: item.chapter.id }, "failed", `page ${page.page} inside "${item.chapter.title}" is empty`));
      }
      const body = span.filter(page => page.glyphs > 0);
      if (body.length >= 3) {
        const sorted = body.slice(0, -1).map(page => page.glyphs).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
        const last = body[body.length - 1];
        if (last.glyphs < median * 0.06) { runt++; out.push(diag("book.page-balance", `page-${last.page}`, { kind: "page", page: last.page, chapterId: item.chapter.id }, "failed", `last page of "${item.chapter.title}" holds ${last.glyphs} glyphs (chapter median ${median})`)); }
      }
    });
    if (!blank) out.push(diag("book.blank-page", "pdf", whole, "passed", "no empty pages inside chapters"));
    if (!runt) out.push(diag("book.page-balance", "pdf", whole, "passed", `glyphs per page: ${pdf.pages.map(page => page.glyphs).join(", ").slice(0, 240)}`));
  }
  for (const chapter of input.chapters) out.push(...claimDiagnostics("book.claims", chapter.id, { kind: "page", page: chapterPage(pdf, chapter.title), chapterId: chapter.id }, chapter.text, input));
  return out;
}
const chapterPage = (pdf: PdfInspection | null, title: string) => Math.max(1, pdf?.outline.find(entry => entry.title.trim().toLowerCase() === title.trim().toLowerCase())?.page ?? 1);

// ---- Decks ----
export function deckDiagnostics(input: { pptx: PptxInspection | null; exportError: string | null; slides: readonly { id: string; title: string; notes: string; hasChart: boolean }[]; probes: readonly SlideProbe[] | null; facts: ApprovedFacts | null; claims: ClaimsCheck }): Diagnostic[] {
  const whole: ReviewLocation = { kind: "artifact" };
  const slideAt = (index: number): ReviewLocation => ({ kind: "slide", slide: index + 1, slideId: input.slides[index]?.id ?? null });
  const out: Diagnostic[] = [];
  if (input.exportError) out.push(diag("deck.export", "pptx", whole, "failed", input.exportError));
  else if (!input.pptx) out.push(diag("deck.export", "pptx", whole, "failed", "the exported PPTX could not be opened"));
  else {
    out.push(diag("deck.export", "pptx", whole, "passed", `PPTX with ${input.pptx.slides.length} slide(s)`));
    const pptx = input.pptx;
    out.push(diag("deck.slide-count", "pptx", whole, pptx.slides.length === input.slides.length ? "passed" : "failed", `${pptx.slides.length} exported of ${input.slides.length} slide(s)`));
    input.slides.forEach((slide, index) => {
      const exported = pptx.slides[index];
      if (!exported) return;
      if (slide.hasChart) {
        const native = exported.charts.filter(chart => chart.native && chart.embeddedData);
        out.push(native.length
          ? diag("deck.chart-editable", slide.id, slideAt(index), "passed", `native ${native[0].type} with embedded data (${native[0].part})`)
          : diag("deck.chart-editable", slide.id, slideAt(index), "failed", exported.charts.length ? `chart part ${exported.charts[0].part} is not an editable native chart` : `no chart part on the slide (${exported.pictures} picture(s))`));
      }
      out.push(exported.notes
        ? diag("deck.notes", slide.id, slideAt(index), "passed", `${exported.notes.length} characters of speaker notes`)
        : diag("deck.notes", slide.id, slideAt(index), "failed", "the exported slide has no speaker notes"));
    });
  }
  if (!input.probes) out.push(diag("deck.text-clipped", "slides", whole, "not_checked", "", "slides could not be rendered for measurement"));
  else for (const probe of input.probes) {
    const index = probe.slide - 1, id = input.slides[index]?.id ?? String(probe.slide);
    probe.clipped.forEach((item, n) => out.push(diag("deck.text-clipped", `${id}:${n}`, slideAt(index), "failed", `"${item.text}" overflows ${item.axis === "box" ? "its text frame" : "the slide"} by ${item.px}px`)));
    if (!probe.clipped.length) out.push(diag("deck.text-clipped", id, slideAt(index), "passed", "all text fits its frame"));
    out.push(...claimDiagnostics("deck.claims", id, slideAt(index), `${probe.text}\n${input.slides[index]?.notes ?? ""}`, input));
  }
  return out;
}

/** Failed diagnostics as findings (source deterministic, grounding measured). */
export function deterministicFindings(diagnostics: readonly Diagnostic[]): Finding[] {
  return diagnostics.filter(item => item.status === "failed").map(item => {
    const spec = CHECKS[item.check];
    return {
      id: item.id.toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 80) || "check",
      category: spec?.category ?? "broken", location: item.location,
      evidence: { type: "measured" as const, diagnosticId: item.id, value: item.measured || item.check },
      severity: spec?.severity ?? "major", briefRequirement: null, factRefs: [],
      proposedRepair: spec?.repair ?? "Fix the measured problem.",
      verificationMethod: { type: "deterministic" as const, checkId: item.check },
      source: "deterministic" as const, grounding: "measured" as const,
    };
  });
}
