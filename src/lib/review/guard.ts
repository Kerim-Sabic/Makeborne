import { canonicalSourceJson } from "../projects/canonical-json";
import type { DocumentSource } from "../documents/schema";
import type { Finding } from "./contract";
import type { ProbeReport } from "./probe";

/**
 * Diff guards for repairs: a repair may change only the places its findings
 * name, and never the brand identity. A repair that touches anything else is
 * rejected (the loop stops with the findings attached) instead of being
 * accepted as a fix.
 */
export type GuardResult = { ok: true; changed: string[] } | { ok: false; changed: string[]; violations: string[] };
const same = (a: unknown, b: unknown) => canonicalSourceJson(a ?? null) === canonicalSourceJson(b ?? null);
const done = (changed: string[], violations: string[]): GuardResult => violations.length ? { ok: false, changed, violations } : { ok: true, changed };

/** Decks and books: slides/chapters by id; theme (palette, type, motif, direction) and top matter are identity. */
export function documentGuard(before: DocumentSource, after: DocumentSource, findings: readonly Finding[]): GuardResult {
  const violations: string[] = [], changed: string[] = [];
  if (before.kind !== after.kind) return { ok: false, changed: ["kind"], violations: ["the document kind changed"] };
  if (!same(before.theme, after.theme)) violations.push("brand identity changed (theme: palette, type pairing, motif or direction)");
  if (before.title !== after.title || before.author !== after.author) violations.push("the document title or author changed");
  if (before.kind === "deck" && after.kind === "deck") {
    const allowed = new Set(findings.flatMap(item => item.location.kind === "slide" ? [item.location.slideId ?? before.slides[item.location.slide - 1]?.id].filter(Boolean) as string[] : []));
    if (before.slides.map(slide => slide.id).join() !== after.slides.map(slide => slide.id).join()) violations.push("slides were added, removed or reordered");
    for (const slide of before.slides) {
      const next = after.slides.find(item => item.id === slide.id);
      if (same(slide, next)) continue;
      changed.push(`slide ${slide.id}`);
      if (!allowed.has(slide.id)) violations.push(`slide ${slide.id} changed but no finding named it`);
    }
  } else if (before.kind === "book" && after.kind === "book") {
    const allowed = new Set(findings.flatMap(item => item.location.kind === "page" && item.location.chapterId ? [item.location.chapterId] : []));
    if (before.chapters.map(chapter => chapter.id).join() !== after.chapters.map(chapter => chapter.id).join()) violations.push("chapters were added, removed or reordered");
    if (!same(before.cover, after.cover) || before.dedication !== after.dedication) violations.push("the cover or front matter changed");
    for (const chapter of before.chapters) {
      const next = after.chapters.find(item => item.id === chapter.id);
      if (same(chapter, next)) continue;
      changed.push(`chapter ${chapter.id}`);
      if (!allowed.has(chapter.id)) violations.push(`chapter ${chapter.id} changed but no finding named it`);
    }
  }
  return done(changed, violations);
}

/** The sections a finding may touch on one route: those holding its selector, or (without a selector) its quoted text. */
export function allowedSections(report: ProbeReport, findings: readonly Finding[]): Set<string> {
  const allowed = new Set<string>();
  for (const finding of findings) {
    if (finding.location.kind !== "route") continue;
    const selector = finding.location.selector;
    const target = selector ? report.targets?.find(item => item.target === selector) : undefined;
    for (const key of target?.sections ?? []) allowed.add(key);
    if (selector && target?.sections.length) continue;
    const value = finding.evidence.type === "measured" ? finding.evidence.value : finding.evidence.type === "quote" ? `"${finding.evidence.text}"` : "";
    const quotes = [...value.matchAll(/"([^"]{2,80})"/g)].map(match => match[1].toLowerCase());
    for (const section of report.sections) if (quotes.some(quote => section.text.toLowerCase().includes(quote))) allowed.add(section.key);
  }
  return allowed;
}

/** Websites, from the rendered DOM before and after (same route and viewport). */
export function websiteGuard(before: ProbeReport, after: ProbeReport, findings: readonly Finding[]): GuardResult {
  const violations: string[] = [], changed: string[] = [];
  if (!same(before.brand.variables, after.brand.variables)) violations.push("brand identity changed (CSS design tokens on :root)");
  if (before.brand.bodyFont !== after.brand.bodyFont || before.brand.headingFont !== after.brand.headingFont) violations.push("brand identity changed (typefaces)");
  if (before.brand.logo !== after.brand.logo) violations.push("brand identity changed (logo)");
  const allowed = allowedSections(before, findings);
  for (const section of before.sections) {
    const next = after.sections.find(item => item.key === section.key);
    if (next && next.html === section.html) continue;
    changed.push(section.key);
    if (!allowed.has(section.key)) violations.push(`section ${section.key} (${section.selectorHint}) changed but no finding named it`);
  }
  for (const section of after.sections) if (!before.sections.some(item => item.key === section.key)) { changed.push(section.key); violations.push(`section ${section.key} was added`); }
  return done(changed, violations);
}
