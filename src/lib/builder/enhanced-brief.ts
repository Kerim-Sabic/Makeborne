/**
 * The enhanced brief: before a first website build, a small capped call expands the client's
 * own words (and their one-click answers) into a structured design brief: business, goal and
 * primary action, audience, every section the site needs, tone, imagery plan, facts given and
 * facts missing (shown as visible placeholders, never invented) and constraints.
 *
 * Shared by the server (validation, builder context, completeness gate) and the studio (the
 * "Enhanced brief" card). Nothing here calls a model; see brief-enhancer.ts for the call.
 * Explicit intent (M08): the client's original words always reach the builder verbatim and take
 * priority; the enhanced brief only adds, and the client may edit it or build from the original.
 */
import { z } from "zod";
import { designAnswerLabels, type DesignAnswers } from "./brief-questions";

/** Credits held while the brief is enhanced or analysed. The hold only bounds the provider spend: the step is
 * free to the client (its cost, about $0.001, is absorbed as platform cost when the hold is released). */
export const ENHANCER_CREDITS = 1;
/** Prompt analysis and enhancement never charge the client. */
export const ENHANCER_CHARGES = false;
export const MAX_ENHANCED_BRIEF_CHARS = 6000;
/** Briefs up to this many words are enhanced. In blind reviews the enhancer reached parity with the original
 * on short, vague prompts but lost every detailed brief (it added example content and sections the client's
 * own detailed brief did not need), so detailed briefs build from the client's words and answers alone. */
export const ENHANCE_MAX_WORDS = 60;
export const shouldEnhance = (brief: string) => { const words = brief.trim().split(/\s+/).filter(Boolean).length; return words > 0 && words <= ENHANCE_MAX_WORDS; };

const text = (max: number) => z.string().trim().min(1).max(max);
export const ACTION_KINDS = ["call", "book", "buy", "visit", "enquire", "signup", "other"] as const;
export const EnhancedSectionSchema = z.object({
  name: text(60),
  anchor: z.string().trim().regex(/^[a-z][a-z0-9-]{0,39}$/),
  purpose: text(220),
  include: z.array(text(160)).max(8).default([]),
}).strict();
export const EnhancedBriefSchema = z.object({
  business: text(240),
  /** A short working name when the client gave none (shown as an example, never as their real name). */
  workingName: z.string().trim().max(40).nullable().default(null),
  goal: text(240),
  primaryAction: z.object({ label: text(48), kind: z.enum(ACTION_KINDS) }).strict(),
  audience: text(240),
  sections: z.array(EnhancedSectionSchema).min(2).max(12),
  tone: z.enum(["quiet", "loud"]),
  toneWhy: text(240),
  imagery: z.object({ plan: z.enum(["illustration", "photo", "type", "mixed"]), notes: text(320), textInImage: z.string().trim().max(60).nullable() }).strict(),
  factsGiven: z.array(text(240)).max(24).default([]),
  /** Facts the site needs but the client did not give: labelled example content (or a bracketed placeholder for contact details). */
  factsMissing: z.array(z.object({ fact: text(140), placeholder: text(140), example: z.string().trim().max(240).nullable().default(null) }).strict()).max(16).default([]),
  constraints: z.array(text(240)).max(14).default([]),
  answersUsed: z.array(text(140)).max(10).default([]),
  /** Analysis of a detailed brief: contradictions or gaps that change the design, with the sensible default the builder takes. */
  conflicts: z.array(z.object({ issue: text(200), resolution: text(200) }).strict()).max(6).default([]),
}).strict();
export type EnhancedBrief = z.infer<typeof EnhancedBriefSchema>;

export const DesignAnswersSchema = z.object({
  theme: z.enum(["light", "dark"]).optional(),
  vibe: z.enum(["calm", "bold", "warm", "technical"]).optional(),
  imagery: z.enum(["photo", "illustration", "type"]).optional(),
  goal: z.enum(["call", "book", "buy", "visit", "enquire", "signup"]).optional(),
  sections: z.array(z.enum(["prices", "hours", "gallery", "team", "testimonials", "faq", "contact"])).max(7).optional(),
  colour: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
  logoColours: z.literal(true).optional(),
}).strict();

/** What a build request carries: the brief text the client approved (enhanced as returned, or edited by them). */
export const BuildBriefSchema = z.object({
  /** enhanced (short brief, expanded), edited (the client changed the enhanced text), analysis (detailed brief: a structured reading of the client's verbatim words). */
  mode: z.enum(["enhanced", "edited", "analysis"]),
  text: z.string().trim().min(1).max(MAX_ENHANCED_BRIEF_CHARS),
}).strict();
export type BuildBrief = z.infer<typeof BuildBriefSchema>;

const unique = <T,>(items: readonly T[]) => [...new Set(items)];
/** Digit groups, e-mail addresses and URLs: the facts most often invented or lost. */
const factTokens = (value: string) => unique([
  ...(value.match(/\d[\d.,:/-]*\d|\d/g) ?? []),
  ...(value.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []),
  ...(value.match(/\bhttps?:\/\/\S+|\bwww\.\S+/gi) ?? []),
].map(token => token.toLowerCase().replace(/[.,;:]+$/, "")));
const sentences = (value: string) => value.split(/(?<=[.!?])\s+|\n+/).map(line => line.trim()).filter(Boolean);

/**
 * Keep the enhanced brief honest against the client's words:
 * - a given fact, section detail or constraint carrying a number, address or link the client never
 *   wrote is dropped (the enhancer may not invent prices, hours, phone numbers or counts);
 * - every sentence of the client's brief that carries such a fact and is not reflected verbatim is
 *   appended to the given facts, so nothing the client wrote is lost;
 * - anchors are unique.
 */
export function groundEnhancedBrief(brief: EnhancedBrief, source: string): EnhancedBrief {
  const known = new Set(factTokens(source));
  const grounded = (value: string) => factTokens(value).every(token => known.has(token));
  const seen = new Set<string>();
  const sections = brief.sections.map(section => {
    let anchor = section.anchor;
    for (let index = 2; seen.has(anchor); index++) anchor = `${section.anchor.slice(0, 36)}-${index}`;
    seen.add(anchor);
    return { ...section, anchor, purpose: grounded(section.purpose) ? section.purpose : section.name, include: section.include.filter(grounded) };
  });
  const factsGiven = brief.factsGiven.filter(grounded);
  const rendered = JSON.stringify({ ...brief, sections, factsGiven }).toLowerCase();
  for (const sentence of sentences(source)) {
    const tokens = factTokens(sentence);
    if (tokens.length && tokens.some(token => !rendered.includes(token)) && factsGiven.length < 24) factsGiven.push(sentence.slice(0, 240));
  }
  return { ...brief, sections, factsGiven, constraints: brief.constraints.filter(grounded),
    // Examples are labelled as examples on the page, so they may carry illustrative numbers; labels may not.
    factsMissing: brief.factsMissing.filter(item => grounded(item.placeholder)) };
}

/** The brief as plain text: shown on the card, editable, and sent to the builder. */
export function renderEnhancedBrief(brief: EnhancedBrief): string {
  const list = (items: readonly string[]) => items.map(item => `- ${item}`).join("\n");
  return [
    `Business: ${brief.business}`,
    brief.workingName ? `Working name (an example until the client gives theirs): ${brief.workingName}` : "",
    `Goal: ${brief.goal}`,
    `Primary action: "${brief.primaryAction.label}" (${brief.primaryAction.kind})`,
    `Audience: ${brief.audience}`,
    `Tone: ${brief.tone} (${brief.toneWhy})`,
    `Imagery: ${brief.imagery.plan}. ${brief.imagery.notes}${brief.imagery.textInImage ? ` Words inside an image: "${brief.imagery.textInImage}".` : " No words inside images."}`,
    "",
    "Sections, in order (give each section the id shown):",
    ...brief.sections.map((section, index) => `${index + 1}. ${section.name} (#${section.anchor}): ${section.purpose}${section.include.length ? ` Include: ${section.include.join("; ")}.` : ""}`),
    brief.factsGiven.length ? `\nFacts given by the client (use exactly as written):\n${list(brief.factsGiven)}` : "",
    brief.factsMissing.length ? `\nFacts not given (labelled example content, or a bracketed placeholder for contact details; never presented as fact):\n${brief.factsMissing.map(item => `- ${item.fact} → ${item.example ? `example: ${item.example} (label: "${item.placeholder}")` : `"${item.placeholder}"`}`).join("\n")}` : "",
    brief.constraints.length ? `\nConstraints:\n${list(brief.constraints)}` : "",
    brief.answersUsed.length ? `\nAnswers used: ${brief.answersUsed.join("; ")}` : "",
  ].filter(line => line !== "").join("\n").slice(0, MAX_ENHANCED_BRIEF_CHARS);
}

/** Sections the build must contain, read back from the (possibly edited) brief text: "N. Name (#anchor): …". */
export function requiredSections(text: string): { name: string; anchor: string }[] {
  const out: { name: string; anchor: string }[] = [];
  for (const match of text.matchAll(/^\s*\d{1,2}\.\s+([^\n(]{1,60}?)\s*\(#([a-z][a-z0-9-]{0,39})\)/gm)) {
    if (!out.some(item => item.anchor === match[2])) out.push({ name: match[1].trim(), anchor: match[2] });
  }
  return out.slice(0, 12);
}

/** The tone line of an enhanced (or edited) brief, when it still names one. */
export function briefTone(text: string | undefined): "quiet" | "loud" | undefined {
  const tone = /^Tone: (quiet|loud)\b/m.exec(text ?? "")?.[1];
  return tone === "quiet" || tone === "loud" ? tone : undefined;
}

/** A detailed brief's analysis as plain text: what the client's words already ask for, nothing added or reworded. */
export function renderBriefAnalysis(brief: EnhancedBrief): string {
  const list = (items: readonly string[]) => items.map(item => `- ${item}`).join("\n");
  return [
    `Primary action: "${brief.primaryAction.label}" (${brief.primaryAction.kind})`,
    `Tone implied: ${brief.tone} (${brief.toneWhy})`,
    `Imagery implied: ${brief.imagery.plan}. ${brief.imagery.notes}`,
    "",
    "Sections and must-haves the brief asks for, in a sensible order (give each section the id shown):",
    ...brief.sections.map((section, index) => `${index + 1}. ${section.name} (#${section.anchor}): ${section.purpose}${section.include.length ? ` Include: ${section.include.join("; ")}.` : ""}`),
    brief.factsGiven.length ? `\nFacts the brief gives (use exactly as written):\n${list(brief.factsGiven)}` : "",
    brief.factsMissing.length ? `\nFacts it needs but does not give (a visible, labelled placeholder, never invented):\n${brief.factsMissing.map(item => `- ${item.fact} → "${item.placeholder}"`).join("\n")}` : "",
    brief.conflicts.length ? `\nConflicts or gaps (take the default shown and say so in the finish summary):\n${brief.conflicts.map(item => `- ${item.issue} → ${item.resolution}`).join("\n")}` : "",
    brief.constraints.length ? `\nConstraints the brief states:\n${list(brief.constraints)}` : "",
  ].filter(line => line !== "").join("\n").slice(0, MAX_ENHANCED_BRIEF_CHARS);
}

/** The builder-context block. The client's own brief stays above it, verbatim, and wins. */
export function enhancedBriefBlock(brief: BuildBrief) {
  if (brief.mode === "analysis") return [
    `<brief_analysis>`,
    `Makeborne read the client's detailed brief and listed what it asks for. The brief above, in the client's own words, is the authority: this analysis never adds to, rewords or overrides it. Build every section listed, each with the id shown (id="anchor" on the section element); a fact the brief does not give is a visible, labelled placeholder, never invented.`,
    brief.text,
    `</brief_analysis>`,
  ].join("\n");
  return [
    `<enhanced_brief source="${brief.mode}">`,
    `Makeborne expanded the client's brief into this design brief before the build${brief.mode === "edited" ? " and the client then edited it" : ""}. The client's own words in "Brief:" above take priority: nothing here may drop or contradict them. Build every section listed, in this order, each with the id shown (id="anchor" on the section element), designed and finished. Where a fact is not given, write the example content in the site's own voice so the section looks complete, and mark it with one small, tidy label per section (for example a muted "Example — replace with yours" tag), never one per item and never as loud highlighted boxes; phone, e-mail and street address stay bracketed placeholders such as [Your phone]. An example is never presented as a fact anywhere else: no reviews, awards, statistics or named people the client did not give (never invent it as fact).`,
    brief.text,
    "</enhanced_brief>",
  ].join("\n");
}

/** The answers block for the builder: one-click design answers in plain words (the seed applies them too). */
export function designAnswersBlock(design: DesignAnswers | undefined) {
  const labels = design ? designAnswerLabels(design) : [];
  return labels.length ? `Client's design answers (follow them): ${labels.join("; ")}.` : "";
}
