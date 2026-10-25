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
export const ConceptInputSchema = z.object({
  concepts: z.array(ConceptSchema).min(2).max(3),
  chosen: z.number().int().min(0).max(2),
  why: text(300),
}).strict();
export type Concept = z.infer<typeof ConceptSchema>;
export type ConceptInput = z.infer<typeof ConceptInputSchema>;
export type ConceptRecord = { chosen: Concept; runnersUp: Concept[]; why: string };

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

/** The recorded concept, or the one problem to fix (returned to the model as a tool error). */
export function checkConcept(raw: unknown): { ok: true; record: ConceptRecord } | { ok: false; problem: string } {
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
  return { ok: true, record: { chosen: concepts[chosen], runnersUp: concepts.filter((_, index) => index !== chosen), why } };
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
  description: `First build only, before writing any file: record 2 or 3 genuinely distinct concepts for this brief and choose the strongest. Each concept: a name, a headline idea, the copy angle, one signature visual device tied to this business's own facts, the first-screen archetype and ground, and how it serves the primary action. Score each 1-5 on ${CONCEPT_RUBRIC_TEXT}; choose the highest total, then build only that concept. Concepts must differ in idea and device, not only in wording.`,
  input_schema: { type: "object" as const, properties: {
    concepts: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", properties: {
      name: { type: "string" }, headline: { type: "string" }, angle: { type: "string" }, device: { type: "string" }, archetype: { type: "string" }, ground: { type: "string" }, action: { type: "string" },
      scores: { type: "object", properties: { memorable: { type: "integer" }, specific: { type: "integer" }, action: { type: "integer" }, buildable: { type: "integer" } }, required: [...CONCEPT_RUBRIC], additionalProperties: false },
    }, required: ["name", "headline", "angle", "device", "archetype", "ground", "action", "scores"], additionalProperties: false } },
    chosen: { type: "integer", description: "Index of the chosen concept (the highest rubric total)" },
    why: { type: "string", description: "One or two sentences: why this concept beats the others for this brief" },
  }, required: ["concepts", "chosen", "why"], additionalProperties: false },
};
