/**
 * The concept step of a first website build. Blind reviews kept preferring the version with "the
 * sharper idea" (a struck-through "Not in January" for a bookkeeping app, hazard stripes for an
 * industrial tool). So before writing any file, the builder records 2–3 genuinely distinct concepts
 * in one `concept` tool call inside the same build run (no separate paid call), scores each against
 * an explicit rubric, and builds only the strongest. The choice is checked here (the chosen concept
 * must have the highest total, the concepts must differ), written into the source as a comment and
 * reported on the run receipt. Pure and client-safe.
 */
import { z } from "zod";

export const CONCEPT_RUBRIC = ["memorable", "specific", "action", "buildable"] as const;
export const CONCEPT_RUBRIC_TEXT = "memorable (one idea a visitor would describe to a friend), specific (it could only belong to this business, built from its own facts), action (it makes the primary action more obvious, never hides it), buildable (it can be built well in this run with HTML, CSS, SVG and the available images)";
const score = z.number().int().min(1).max(5);
const text = (max: number) => z.string().trim().min(3).max(max);
export const ConceptSchema = z.object({
  name: text(48),
  headline: text(140),
  angle: text(220),
  device: text(220),
  archetype: text(48),
  ground: text(80),
  action: text(200),
  scores: z.object({ memorable: score, specific: score, action: score, buildable: score }).strict(),
}).strict();
/** Named section compositions for a website's section plan (the deck's frame set, adapted to scrolling pages). */
export const SECTION_COMPOSITIONS = ["full-bleed-photo", "editorial-split", "giant-numeral", "gallery-strip", "steps-over-plate", "type-statement",
  "cutout-on-colour", "index-rows", "product-mock", "price-list", "quote", "form-panel", "contact-card", "bento"] as const;
export type SectionComposition = typeof SECTION_COMPOSITIONS[number];
export const COMPOSITION_NOTES: Record<SectionComposition, string> = {
  "full-bleed-photo": "a photograph fills the band edge to edge; the headline sits on a solid panel over its calm side",
  "editorial-split": "image and type in two fields (7/5 or 5/7), the image bleeding off the viewport edge",
  "giant-numeral": "one huge figure, date or count is the hero, with a short label and a small image or none",
  "gallery-strip": "two to four images in a strip or uneven grid, one clearly larger, with captions",
  "steps-over-plate": "numbered steps or a timeline along one line, over a colour field or a quiet image plate",
  "type-statement": "a typographic statement: very large type is the image, little or no picture",
  "cutout-on-colour": "a cut-out object over a saturated colour field, crossing the section edge",
  "index-rows": "full-width linked rows with large numerals, title and detail",
  "product-mock": "a crafted product or interface mock is the hero, with the photograph of its world beside it",
  "price-list": "a printed-card price or menu list with dotted leaders and tabular figures",
  quote: "one real quotation the client gave, set large with generous space",
  "form-panel": "the enquiry or booking form on its own panel beside the details a visitor needs",
  "contact-card": "address, hours, phone and map link as one crafted card or ticket",
  bento: "cells of unequal spans mixing image, figure, quote and micro-UI",
};
const anchor = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/, "a short section anchor or name");
/** The site's one art system, like a design studio's, written before any file. */
export const ArtSystemSchema = z.object({
  palette: text(300),
  type: text(300),
  imagery: text(400),
  motif: text(220),
  motion: text(200),
}).strict();
export const SectionPlanSchema = z.object({
  id: anchor,
  composition: z.enum(SECTION_COMPOSITIONS),
  job: text(200),
}).strict();

/** One planned image: the section, the job it does for the visitor, and how it is shot and placed. */
export const ShotSchema = z.object({
  section: text(60),
  job: text(200),
  shot: text(160),
  aspect: z.enum(["landscape", "portrait", "square"]),
  focal: text(200),
  layout: text(160),
}).strict();
/** The image set planned before any image is generated: one entry per image and one house style. */
export const ImagePlanSchema = z.object({
  houseStyle: text(400),
  shots: z.array(ShotSchema).max(12),
}).strict();
export const ConceptInputSchema = z.object({
  concepts: z.array(ConceptSchema).min(2).max(3),
  chosen: z.number().int().min(0).max(2),
  why: text(300),
  imagePlan: ImagePlanSchema.optional(),
  artSystem: ArtSystemSchema.optional(),
  sections: z.array(SectionPlanSchema).min(3).max(14).optional(),
}).strict();
export type Concept = z.infer<typeof ConceptSchema>;
export type ConceptInput = z.infer<typeof ConceptInputSchema>;
export type ImagePlan = z.infer<typeof ImagePlanSchema>;
export type ArtSystem = z.infer<typeof ArtSystemSchema>;
export type SectionPlan = z.infer<typeof SectionPlanSchema>;
/** A design comp: a generated picture of a finished website screen, a reference for the build only (never shipped). */
export type DesignComp = { section: string; viewport: "desktop" | "mobile"; asset: string; ground?: string; reading?: CompReadingValues & { ground?: string } };
/** What the builder read from a comp (read_comp), measured against the built page at finish. */
export const CompReadingSchema = z.object({
  section: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/), viewport: z.enum(["desktop", "mobile"]),
  headlineCapHeightPct: z.number().min(0.5).max(40), imageAreaPct: z.number().min(0).max(100), imageSide: z.enum(["left", "right", "full", "none"]),
}).strict();
export type CompReadingValues = z.infer<typeof CompReadingSchema>;
export type ConceptRecord = { chosen: Concept; runnersUp: Concept[]; why: string; imagePlan?: ImagePlan; artSystem?: ArtSystem; sections?: SectionPlan[]; comps?: DesignComp[] };
/** At most this many design comps per first build (the first screen, the phone first screen and the key sections). */
export const MAX_COMPS = 6;
const COMP_ENTRY = /([A-Za-z0-9][A-Za-z0-9 _-]{0,39})@(desktop|mobile)=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\[h([0-9.]+),i([0-9.]+),(left|right|full|none)(?:,g(#[0-9A-Fa-f]{6}))?\])?/g;
/** The design comps recorded in the concept comment of src/App.tsx (read back by the review), at most MAX_COMPS. */
export function compsFromSource(app: string | undefined): DesignComp[] {
  const line = /^ \* {3}Comps: (.+)$/m.exec(/^\/\*\n \* Makeborne concept:[\s\S]*?\*\//.exec(app ?? "")?.[0] ?? "")?.[1] ?? "";
  return [...line.matchAll(COMP_ENTRY)].slice(0, MAX_COMPS).map(match => {
    const comp: DesignComp = { section: match[1].trim(), viewport: match[2] as DesignComp["viewport"], asset: match[3] };
    if (match[4]) comp.reading = { section: comp.section, viewport: comp.viewport, headlineCapHeightPct: Number(match[4]), imageAreaPct: Number(match[5]), imageSide: match[6] as CompReadingValues["imageSide"], ...(match[7] ? { ground: match[7].toUpperCase() } : {}) };
    if (match[7]) comp.ground = match[7].toUpperCase();
    return comp;
  });
}

/** Section-plan problems: never one composition in two consecutive sections, and at least four (or one per section
 * on a shorter page) different compositions, so the page reads as designed spreads rather than one repeated block. */
export function sectionPlanIssues(sections: readonly SectionPlan[]): string[] {
  const issues: string[] = [];
  for (let i = 1; i < sections.length; i++) if (sections[i].composition === sections[i - 1].composition)
    issues.push(`Sections "${sections[i - 1].id}" and "${sections[i].id}" both use the ${sections[i].composition} composition: give consecutive sections different compositions.`);
  const distinct = new Set(sections.map(section => section.composition)).size, want = Math.min(4, sections.length);
  if (distinct < want) issues.push(`The plan uses ${distinct} composition${distinct === 1 ? "" : "s"} across ${sections.length} sections; use at least ${want} different ones.`);
  return issues;
}

export const conceptTotal = (concept: Concept) => CONCEPT_RUBRIC.reduce((sum, key) => sum + concept.scores[key], 0);
const words = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
/** Share of the smaller word set that the two texts have in common (1 = the same idea reworded). */
function overlap(a: string, b: string) {
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.min(left.size, right.size);
}

/** The recorded concept, or the one problem to fix (returned to the model as a tool error).
 * `images`: the run's image allowance; when above 0 the concept must carry the image plan (a shot
 * list within the allowance, every shot with its own job, and one house style). */
export function checkConcept(raw: unknown, options: { images?: number; sitePlan?: boolean } = {}): { ok: true; record: ConceptRecord } | { ok: false; problem: string } {
  const parsed = ConceptInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: `Invalid concept input: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message ?? ""}`.trim() };
  const { concepts, chosen, why } = parsed.data;
  if (chosen >= concepts.length) return { ok: false, problem: `chosen is ${chosen}, but only ${concepts.length} concepts were given.` };
  const best = Math.max(...concepts.map(conceptTotal));
  if (conceptTotal(concepts[chosen]) < best) return { ok: false, problem: `Choose the concept with the highest rubric total (${best}); "${concepts[chosen].name}" scores ${conceptTotal(concepts[chosen])}. Rescore honestly or choose the stronger one.` };
  for (let i = 0; i < concepts.length; i++) for (let j = i + 1; j < concepts.length; j++) {
    const a = concepts[i], b = concepts[j];
    if (overlap(a.device, b.device) > 0.6 || overlap(a.headline, b.headline) > 0.6)
      return { ok: false, problem: `"${a.name}" and "${b.name}" are the same idea reworded. Make each concept genuinely different: another headline idea and another signature device.` };
  }
  const { artSystem, sections } = parsed.data;
  if (options.sitePlan) {
    if (!artSystem || !sections) return { ok: false, problem: "Add the art system (palette, type, imagery, motif, motion) and the section plan (every section with its id, one named composition and its job) to the concept: they are the design every file follows." };
    const issues = sectionPlanIssues(sections);
    if (issues.length) return { ok: false, problem: issues.join(" ") };
  }
  const plan = parsed.data.imagePlan;
  const allowance = options.images ?? 0;
  if (allowance > 0) {
    if (!plan) return { ok: false, problem: `Image generation is available, so add imagePlan: one house style sentence and a shot list with one entry per image you will generate (at most ${allowance}), each with its section, its job, shot type and distance, aspect, focal point and text-safe area, and its relation to the layout (an empty list only when the brief rules generated images out).` };
    if (plan.shots.length > allowance) return { ok: false, problem: `imagePlan lists ${plan.shots.length} images but this run allows ${allowance}. Keep the images that do the most distinct jobs.` };
    for (let i = 0; i < plan.shots.length; i++) for (let j = i + 1; j < plan.shots.length; j++) {
      const a = plan.shots[i], b = plan.shots[j];
      if (overlap(a.job, b.job) > 0.7)
        return { ok: false, problem: `Shots ${i + 1} (${a.section}) and ${j + 1} (${b.section}) do the same job. Give every image its own job, or drop one.` };
    }
  }
  return { ok: true, record: { chosen: concepts[chosen], runnersUp: concepts.filter((_, index) => index !== chosen), why, ...(plan && allowance > 0 ? { imagePlan: plan } : {}),
    ...(options.sitePlan && artSystem && sections ? { artSystem, sections } : {}) } };
}

/** The tool result's reminder of the art system and the section plan. */
export function sitePlanNote(record: Pick<ConceptRecord, "artSystem" | "sections">) {
  if (!record.artSystem || !record.sections) return "";
  const art = record.artSystem;
  return `Art system recorded: palette ${art.palette}; type ${art.type}; imagery ${art.imagery}; motif ${art.motif} (repeat it in every section); motion ${art.motion}. Section plan: ${record.sections.map(section => `${section.id} = ${section.composition} (${COMPOSITION_NOTES[section.composition]})`).join("; ")}. Build every section as planned.`;
}

/** The tool result's reminder of the recorded image plan, in generation order. */
/** The design comps to make, named by section id: the first section at desktop and on the phone, then the next two
 * sections that carry an image or a strong composition (the live quality-v14 runs made only the first two when the
 * instruction said "the two heart sections" without naming them). */
export function compPlan(sections: readonly SectionPlan[] | undefined) {
  const ids = (sections ?? []).map(section => section.id);
  const first = ids[0] ?? "top";
  const heart = (sections ?? []).slice(1).filter(section => !/form-panel|contact-card|quote/.test(section.composition)).slice(0, 2).map(section => section.id);
  return [`${first} (desktop)`, `${first} (mobile)`, ...heart.map(id => `${id} (desktop)`)];
}
export function compsNextStep(sections: readonly SectionPlan[] | undefined) {
  const plan = compPlan(sections);
  return `Your next step is the design comps: in one response call generate_comp ${plan.length} times, for exactly these: ${plan.join(", ")}, plus other key sections while the image budget allows. Then record each comp with read_comp.`;
}
export function imagePlanNote(plan: ImagePlan, options: { comps?: boolean; sections?: readonly SectionPlan[] } = {}) {
  if (!plan.shots.length) return "Image plan recorded: no generated images (the brief rules them out); carry the page with typography, colour and CSS/SVG drawing.";
  return `Image plan recorded (${plan.shots.length} image${plan.shots.length === 1 ? "" : "s"}): ${plan.shots.map((shot, index) => `${index + 1}. ${shot.section}: ${shot.job} (${shot.shot}, ${shot.aspect}; ${shot.layout})`).join(" ")} End every image prompt with the house style sentence verbatim: "${plan.houseStyle}". ${options.comps
    ? `${compsNextStep(options.sections)} After them, generate exactly these images together in one response, each matching its comp's subject, crop and light, inspect each one when it comes back, and build each section to its comp.`
    : "Generate exactly these images together in your next step (all the calls in one response, the hero first), inspect each one when it comes back, and place it as planned."}`;
}

const clean = (value: string) => value.replace(/\*\//g, "* /").replace(/\s+/g, " ").trim();
export const CONCEPT_COMMENT_MARK = "Makeborne concept:";
/** The comment block at the top of src/App.tsx: the chosen concept and the runners-up, for anyone editing later. */
export function conceptComment(record: ConceptRecord) {
  const line = (concept: Concept) => `${clean(concept.name)}: "${clean(concept.headline)}"; device: ${clean(concept.device)} (${conceptTotal(concept)}/20)`;
  return [
    "/*",
    ` * ${CONCEPT_COMMENT_MARK} ${line(record.chosen)}`,
    ` *   Angle: ${clean(record.chosen.angle)}. First screen: ${clean(record.chosen.archetype)} on ${clean(record.chosen.ground)}. Action: ${clean(record.chosen.action)}.`,
    ` *   Why: ${clean(record.why)}`,
    ...(record.artSystem ? [` *   Art system: palette ${clean(record.artSystem.palette)}; type ${clean(record.artSystem.type)}; imagery ${clean(record.artSystem.imagery)}; motif ${clean(record.artSystem.motif)}; motion ${clean(record.artSystem.motion)}.`] : []),
    ...(record.sections ? [` *   Sections: ${record.sections.map(section => `${clean(section.id)} = ${section.composition}`).join(", ")}.`] : []),
    ...(record.comps?.length ? [` *   Comps: ${record.comps.map(comp => `${clean(comp.section)}@${comp.viewport}=${comp.asset}${comp.reading ? `[h${comp.reading.headlineCapHeightPct},i${comp.reading.imageAreaPct},${comp.reading.imageSide}${comp.reading.ground ?? comp.ground ? `,g${comp.reading.ground ?? comp.ground}` : ""}]` : ""}`).join(", ")}.`] : []),
    ...record.runnersUp.map(concept => ` * Runner-up: ${line(concept)}`),
    " */",
  ].join("\n");
}

/** Prepend (or replace) the concept comment in a source file. */
export function withConceptComment(source: string, record: ConceptRecord) {
  const existing = /^\/\*\n \* Makeborne concept:[\s\S]*?\*\/\n/.exec(source);
  const body = existing ? source.slice(existing[0].length) : source;
  return `${conceptComment(record)}\n${body}`;
}

/** Receipt lines: names only (the full concepts are in the source comment). */
const nameOf = (value: string | { name: string }) => typeof value === "string" ? value : value.name;
export const conceptSummary = (record: { chosen: string | { name: string }; runnersUp: readonly (string | { name: string })[] }) =>
  `${nameOf(record.chosen)}${record.runnersUp.length ? ` (runners-up: ${record.runnersUp.map(nameOf).join(", ")})` : ""}`;

/** The tool the builder calls once on a first build, before writing files. */
export const CONCEPT_TOOL = {
  name: "concept",
  description: `First build only, before writing any file: record 2 or 3 genuinely distinct concepts for this brief and choose the strongest, with its art system and section plan and, when image generation is available, its image plan. Each concept: a name, a headline idea, the copy angle, one signature visual device tied to this business's own facts, the first-screen archetype and ground, and how it serves the primary action. Score each 1-5 on ${CONCEPT_RUBRIC_TEXT}; choose the highest total, then build only that concept. Concepts must differ in idea and device, not only in wording.`,
  input_schema: { type: "object" as const, properties: {
    concepts: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", properties: {
      name: { type: "string" }, headline: { type: "string" }, angle: { type: "string" }, device: { type: "string" }, archetype: { type: "string" }, ground: { type: "string" }, action: { type: "string" },
      scores: { type: "object", properties: { memorable: { type: "integer" }, specific: { type: "integer" }, action: { type: "integer" }, buildable: { type: "integer" } }, required: [...CONCEPT_RUBRIC], additionalProperties: false },
    }, required: ["name", "headline", "angle", "device", "archetype", "ground", "action", "scores"], additionalProperties: false } },
    chosen: { type: "integer", description: "Index of the chosen concept (the highest rubric total)" },
    why: { type: "string", description: "One or two sentences: why this concept beats the others for this brief" },
    artSystem: { type: "object", description: "Required: the chosen concept's one art system, written like a design studio's before anything is made.", properties: {
      palette: { type: "string", description: "Palette tokens (ground, surface, ink, accent, inverse) and the subject's materials each comes from" },
      type: { type: "string", description: "Display and text faces from the font library and how the display is set: condensed or high-contrast, case, tight leading, the statement scale" },
      imagery: { type: "string", description: "The image language: one photographer or artist, light, lens or technique, colour grade (the house style sentence)" },
      motif: { type: "string", description: "One recurring motif from the subject (a rule, an arc, numerals, a colour band, a crop, a stamp) that appears in every section" },
      motion: { type: "string", description: "The motion style: which reveals and the one signature effect" },
    }, required: ["palette", "type", "imagery", "motif", "motion"], additionalProperties: false },
    sections: { type: "array", minItems: 3, maxItems: 14, description: "Required: the page's sections in order (the first is the first screen), each with one named composition. Never the same composition twice in a row; at least four different ones.", items: { type: "object", properties: {
      id: { type: "string", description: "The section's anchor or short name" },
      composition: { type: "string", enum: [...SECTION_COMPOSITIONS] },
      job: { type: "string", description: "What the section does for the visitor and what its image or graphic carries" },
    }, required: ["id", "composition", "job"], additionalProperties: false } },
    imagePlan: { type: "object", description: "Required when image generation is available: the image set for the chosen concept, planned before any image is generated.", properties: {
      houseStyle: { type: "string", description: "One sentence appended verbatim to every image prompt: one photographer or artist, one day and light, one colour grade from the palette, the camera and lens or the technique" },
      shots: { type: "array", maxItems: 12, description: "One entry per image, the hero first. No image without a job; no two images doing the same job. Empty only when the brief rules generated images out (drawings or typography only).", items: { type: "object", properties: {
        section: { type: "string", description: "The section anchor or name" },
        job: { type: "string", description: "What the visitor should feel or learn from this image there" },
        shot: { type: "string", description: "Shot type and distance (wide establishing, mid at work, close detail, overhead, cut-out object)" },
        aspect: { type: "string", enum: ["landscape", "portrait", "square"] },
        focal: { type: "string", description: "Where the focal point sits and where the calm, text-safe area is" },
        layout: { type: "string", description: "Its relation to the layout: full-bleed band, editorial split bleeding off the edge, type overlapping its edge, cut-out over colour breaking a section boundary, gallery strip" },
      }, required: ["section", "job", "shot", "aspect", "focal", "layout"], additionalProperties: false } },
    }, required: ["houseStyle", "shots"], additionalProperties: false },
  }, required: ["concepts", "chosen", "why"], additionalProperties: false },
};
