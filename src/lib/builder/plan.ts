import { z } from "zod";
import { EFFORT_LEVELS, type EffortLevel } from "../routing/effort";
import { BUILDER_EFFORT } from "./pricing";

/**
 * Plan mode: a structured, editable website plan produced before any code is
 * written. Shared by the planner (server), the plan route and the plan card
 * (browser), so it must stay free of server-only imports.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const HEX = /^#[0-9a-fA-F]{6}$/;

export const PlanSectionSchema = z.object({
  name: text(80),
  purpose: text(400),
  content: text(800),
}).strict();

export const PlanPageSchema = z.object({
  name: text(80),
  path: z.string().trim().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/, "Use a route path like / or /about."),
  purpose: text(400),
  sections: z.array(PlanSectionSchema).min(1).max(14),
}).strict();

export const PlanColorSchema = z.object({
  name: text(40),
  hex: z.string().trim().regex(HEX, "Use a six-digit hex color like #1F2A44.").transform(value => value.toUpperCase()),
  role: text(120),
}).strict();

export const PlanDesignSchema = z.object({
  concept: text(600),
  typography: z.object({ display: text(120), body: text(120), rationale: text(400) }).strict(),
  palette: z.array(PlanColorSchema).min(3).max(8),
  layout: z.array(text(300)).min(1).max(6),
  imagery: text(500),
  signatureInteraction: text(400),
}).strict();

export const PlanChangeSchema = z.object({
  change: text(400),
  files: z.array(z.string().trim().min(1).max(160)).max(12),
}).strict();

export const SitePlanSchema = z.object({
  kind: z.enum(["new_site", "edit"]),
  title: text(120),
  summary: text(600),
  goal: text(500),
  audience: text(500),
  positioning: text(600),
  pages: z.array(PlanPageSchema).min(1).max(12),
  design: PlanDesignSchema,
  changes: z.array(PlanChangeSchema).max(20).default([]),
  questions: z.array(text(300)).max(3).default([]),
  assumptions: z.array(text(400)).max(12).default([]),
}).strict().superRefine((plan, context) => {
  const paths = new Set<string>();
  plan.pages.forEach((page, index) => {
    if (paths.has(page.path)) context.addIssue({ code: "custom", path: ["pages", index, "path"], message: `Duplicate page path ${page.path}.` });
    paths.add(page.path);
  });
  if (plan.kind === "edit" && plan.changes.length === 0) context.addIssue({ code: "custom", path: ["changes"], message: "An edit plan must list its concrete changes." });
});
export type SitePlan = z.infer<typeof SitePlanSchema>;
export type PlanPage = SitePlan["pages"][number];

export type CreditRange = { min: number; max: number };
export type PlanEstimate = Record<EffortLevel, CreditRange>;

/** Stored with the artifact so a reload restores the latest plan. */
export const StoredPlanSchema = z.object({
  plan: SitePlanSchema,
  status: z.enum(["draft", "built"]).default("draft"),
  basedOnVersion: z.number().int().nonnegative(),
  revision: z.number().int().positive().default(1),
  charged: z.number().int().nonnegative().default(0),
}).strict();
export type StoredPlan = z.infer<typeof StoredPlanSchema>;

/** Most a single planning call may charge. Planning is cheap on purpose. */
export const PLAN_CEILING_CREDITS = 10;
/** Largest serialized plan accepted from clients or stored (bytes of JSON). */
export const PLAN_MAX_BYTES = 48_000;

/** Validates model or client input, returning a readable error on failure. */
export function parsePlan(input: unknown): { plan: SitePlan; error?: undefined } | { plan?: undefined; error: string } {
  const result = SitePlanSchema.safeParse(input);
  if (result.success) {
    if (JSON.stringify(result.data).length > PLAN_MAX_BYTES) return { error: "The plan is too long. Keep it focused." };
    return { plan: result.data };
  }
  const issue = result.error.issues[0];
  return { error: `${issue?.path.join(".") || "plan"}: ${issue?.message ?? "invalid"}` };
}

/** Typical cost multipliers per effort, relative to medium. Deterministic so
 * the estimate never depends on the model's own guess. */
const EFFORT_FACTOR: Record<EffortLevel, number> = { light: 0.55, medium: 1, high: 1.45, super_high: 1.9, ultra: 2.6 };

/** Credit range to build the plan at each effort, clamped to effort ceilings. */
export function estimatePlanCredits(plan: SitePlan): PlanEstimate {
  const sections = plan.pages.reduce((total, page) => total + page.sections.length, 0);
  const base = plan.kind === "edit"
    ? 3 + plan.changes.length * 1.6 + new Set(plan.changes.flatMap(change => change.files)).size * 0.5
    : 10 + plan.pages.length * 2.5 + sections * 0.9;
  const estimate = {} as PlanEstimate;
  for (const level of EFFORT_LEVELS) {
    const ceiling = BUILDER_EFFORT[level].ceilingCredits;
    const center = base * EFFORT_FACTOR[level];
    const max = Math.min(ceiling, Math.max(3, Math.ceil(center * 1.3)));
    const min = Math.min(max, Math.max(2, Math.floor(center * 0.7)));
    estimate[level] = { min, max };
  }
  return estimate;
}

/** Lowest effort whose estimated maximum still fits under its own ceiling with
 * headroom; large plans need a level that can finish them in one run. */
export function recommendedEffort(plan: SitePlan): EffortLevel {
  const estimate = estimatePlanCredits(plan);
  const fits = EFFORT_LEVELS.filter(level => level !== "light" || plan.kind === "edit")
    .find(level => estimate[level].max < BUILDER_EFFORT[level].ceilingCredits * 0.85);
  return fits ?? "high";
}

const bullet = (items: string[]) => items.map(item => `- ${item}`).join("\n");

/** The approved plan rendered as the builder's binding brief. */
export function planToBrief(plan: SitePlan): string {
  const pages = plan.pages.map(page => [
    `### ${page.name} (${page.path}) — ${page.purpose}`,
    ...page.sections.map((section, index) => `${index + 1}. ${section.name}: ${section.purpose} Content: ${section.content}`),
  ].join("\n")).join("\n\n");
  const design = plan.design;
  return [
    `# ${plan.title}`,
    plan.summary,
    `Goal: ${plan.goal}`,
    `Audience: ${plan.audience}`,
    `Positioning: ${plan.positioning}`,
    plan.kind === "edit" && plan.changes.length ? `## Changes to make\n${plan.changes.map(change => `- ${change.change}${change.files.length ? ` (files: ${change.files.join(", ")})` : ""}`).join("\n")}` : "",
    `## Sitemap and sections\n${pages}`,
    [
      "## Design direction",
      `Concept: ${design.concept}`,
      `Type pairing: display ${design.typography.display}; body ${design.typography.body}. ${design.typography.rationale}`,
      `Palette: ${design.palette.map(color => `${color.name} ${color.hex} (${color.role})`).join("; ")}`,
      `Layout ideas:\n${bullet(design.layout)}`,
      `Imagery: ${design.imagery}`,
      `Signature interaction: ${design.signatureInteraction}`,
    ].join("\n"),
    plan.assumptions.length ? `## Assumptions (treat as decided)\n${bullet(plan.assumptions)}` : "",
    plan.questions.length ? `## Open questions (use the most sensible answer; do not stall)\n${bullet(plan.questions)}` : "",
  ].filter(Boolean).join("\n\n");
}

/** JSON schema of the planner's single tool. Mirrors SitePlanSchema; the
 * server re-validates every call with zod. */
export const PROPOSE_PLAN_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "title", "summary", "goal", "audience", "positioning", "pages", "design", "changes", "questions", "assumptions"],
  properties: {
    kind: { type: "string", enum: ["new_site", "edit"], description: "new_site when there is no website yet or the user wants a rebuild; edit for changes to the current site." },
    title: { type: "string", description: "Brand or business name used as the site title." },
    summary: { type: "string", description: "One or two decisive sentences: what will be built and why it will work." },
    goal: { type: "string", description: "The primary outcome the site must drive (one measurable action)." },
    audience: { type: "string", description: "Who it is for and what they need to believe to act." },
    positioning: { type: "string", description: "How the brand should feel against its alternatives; the one idea visitors remember." },
    pages: {
      type: "array", description: "Sitemap. For a single-page site, one page with path / and many sections.",
      items: {
        type: "object", additionalProperties: false, required: ["name", "path", "purpose", "sections"],
        properties: {
          name: { type: "string" },
          path: { type: "string", description: "Route path: / or /kebab-case." },
          purpose: { type: "string" },
          sections: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["name", "purpose", "content"],
              properties: {
                name: { type: "string" },
                purpose: { type: "string", description: "Why this section exists for the visitor." },
                content: { type: "string", description: "Key content: concrete headline idea, items, proof, calls to action." },
              },
            },
          },
        },
      },
    },
    design: {
      type: "object", additionalProperties: false, required: ["concept", "typography", "palette", "layout", "imagery", "signatureInteraction"],
      properties: {
        concept: { type: "string", description: "The art direction in a few vivid sentences." },
        typography: {
          type: "object", additionalProperties: false, required: ["display", "body", "rationale"],
          properties: { display: { type: "string", description: "Display typeface (named family plus a system fallback)." }, body: { type: "string" }, rationale: { type: "string" } },
        },
        palette: {
          type: "array", description: "3 to 8 colors.",
          items: {
            type: "object", additionalProperties: false, required: ["name", "hex", "role"],
            properties: { name: { type: "string" }, hex: { type: "string", description: "Six-digit hex like #1F2A44." }, role: { type: "string", description: "e.g. background, text, accent, surface." } },
          },
        },
        layout: { type: "array", items: { type: "string" }, description: "2 to 5 specific layout ideas." },
        imagery: { type: "string", description: "Photography/illustration approach and what images to create." },
        signatureInteraction: { type: "string", description: "One memorable, tasteful interaction or motion moment." },
      },
    },
    changes: {
      type: "array", description: "Edits only: the concrete list of changes, each with the files likely touched. Empty for new_site.",
      items: { type: "object", additionalProperties: false, required: ["change", "files"], properties: { change: { type: "string" }, files: { type: "array", items: { type: "string" } } } },
    },
    questions: { type: "array", items: { type: "string" }, description: "At most 3 questions whose answers would materially change the build. Empty if none." },
    assumptions: { type: "array", items: { type: "string" }, description: "Decisions you made in the absence of information (at most 8)." },
  },
} as const;
