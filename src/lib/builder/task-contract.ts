import type { DesignAnswers } from "./brief-questions";
import type { EnhancedBrief } from "./enhanced-brief";

/**
 * The task contract (docs/release-review/task-contract-workflows-context-20261022.md): a versioned, deterministic
 * interpretation of one request, recorded next to the original words. It never replaces them: where the two
 * disagree, the original wins and the disagreement is listed. Nothing here calls a model or invents a fact;
 * a fact the client did not give is `unknown`, or `placeholder-approved` when they said they will supply it.
 */

export const TASK_CONTRACT_VERSION = "task-contract-v1";
export const ACCEPTANCE_VERSION = "acceptance-v1";

export type ArtifactKind = "website" | "book" | "presentation";
export type Objective = "create" | "edit" | "repair" | "refine" | "export";
export type FactStatus = "verified" | "placeholder-approved" | "unknown";
export type FactSource = "request" | "brief" | "brand" | "client" | "attachment";
export type Scope =
  | { kind: "artifact" }
  | { kind: "files"; files: string[] }
  | { kind: "element"; file: string; line: number; label: string };

export type TaskContract = {
  version: typeof TASK_CONTRACT_VERSION;
  acceptance: typeof ACCEPTANCE_VERSION;
  /** The client's own words, verbatim and authoritative. */
  original: { message: string; plan: string | null; brief: string | null };
  artifact: ArtifactKind;
  objective: Objective;
  required: { text: string; kind: "section" | "action"; checks: string[] }[];
  exclusions: { text: string; source: "request" | "brief" | "plan" }[];
  facts: { text: string; source: FactSource; status: FactStatus }[];
  /** Assumptions the build makes on the client's behalf: always reversible and shown in the receipt. */
  assumptions: { text: string; reversible: true; why: string }[];
  audience: string | "unknown";
  outcome: string | "unknown";
  design: { constraints: string[]; preferences: string[] };
  integrations: string[];
  revision: { expectedVersion: number; sourceRevision: string | null; assetDigest: string | null };
  scope: Scope;
  checks: string[];
  limits: { capCredits: number; deadlineAt: string | null; repairs: number; escalations: number };
};

export type TaskContractInput = {
  artifact: ArtifactKind;
  objective: Objective;
  message: string;
  plan?: string | null;
  brief?: { text: string } | null;
  enhanced?: EnhancedBrief | null;
  design?: DesignAnswers | null;
  brand?: { name: string; colours?: string[] } | null;
  client?: { name: string } | null;
  attachments?: { name: string }[];
  revision: { expectedVersion: number; sourceRevision?: string | null; assetDigest?: string | null };
  target?: { file: string; line: number; label: string } | { files: string[] } | null;
  limits: { capCredits: number; deadlineAt?: string | null; repairs?: number; escalations?: number };
};

// Clause-level prohibition detection: the same rule as Codex's negation fix in quality-gates.ts (missingSections):
// a clause containing one of these words is a prohibition, never a request. check-task-contract.cjs keeps them in step.
const NEGATION = /\b(?:no|not|never|without|avoid|omit|exclude|remove|skip|don't|don’t|do not)\b/i;
const clauses = (text: string) => text.split(/[.!?;\n]+|\bbut\b/i).map(clause => clause.trim()).filter(Boolean);
export const prohibitions = (text: string) => clauses(text).filter(clause => NEGATION.test(clause));
// "I will send the prices later", "show them as placeholders": the client approved a marked gap.
const SUPPLY_LATER = /\b(?:later|placeholder|placeholders|to be confirmed|tbc|will send|will supply|i'll send|i will provide)\b/i;

const CHECKS: Record<ArtifactKind, string[]> = {
  website: ["W-H1", "W-H2", "W-H3", "W-H4", "W-H5", "W-H6", "W-H7", "W-H8", "W-D1", "W-D2", "W-D3", "W-O1"],
  book: ["B-H1", "B-H2", "B-H3", "B-H4", "B-D1", "B-D2"],
  presentation: ["S-H1", "S-H2", "S-H3", "S-H4", "S-H5", "S-D1", "S-D2", "S-D3"],
};
// A localised change is verified where it can break things; the rest of the artifact keeps its last results.
const LOCAL_WEBSITE_CHECKS = ["W-H1", "W-H2", "W-H5", "W-H7", "W-D1", "W-D2"];
const OPERATIONAL = ["O1", "O2", "O3", "O4", "O5"];

const unique = <T>(items: T[], key: (item: T) => string) => { const seen = new Set<string>(); return items.filter(item => { const k = key(item).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };

export function buildTaskContract(input: TaskContractInput): TaskContract {
  const brief = input.brief?.text ?? null, plan = input.plan ?? null, enhanced = input.enhanced ?? null, design = input.design ?? {};
  const originalText = [input.message, plan ?? "", brief ?? ""].join("\n");
  const exclusions = unique([
    ...prohibitions(input.message).map(text => ({ text, source: "request" as const })),
    ...(brief ? prohibitions(brief).map(text => ({ text, source: "brief" as const })) : []),
    ...(plan ? prohibitions(plan).map(text => ({ text, source: "plan" as const })) : []),
  ], item => item.text);
  const required = unique([
    ...(enhanced?.sections ?? []).map(section => ({ text: `${section.name} section`, kind: "section" as const, checks: input.artifact === "website" ? ["W-H6"] : [] })),
    ...(design.sections ?? []).map(section => ({ text: `${section} section`, kind: "section" as const, checks: ["W-H6"] })),
    ...(enhanced ? [{ text: `Primary action: ${enhanced.primaryAction.label}`, kind: "action" as const, checks: ["W-H4"] }] : []),
  ], item => item.text);
  const supplyLater = SUPPLY_LATER.test(originalText);
  const facts = unique([
    ...(enhanced?.factsGiven ?? []).map(text => ({ text, source: "brief" as FactSource, status: "verified" as FactStatus })),
    ...(input.brand ? [{ text: `Brand: ${input.brand.name}`, source: "brand" as FactSource, status: "verified" as FactStatus }] : []),
    ...(input.client ? [{ text: `Client: ${input.client.name}`, source: "client" as FactSource, status: "verified" as FactStatus }] : []),
    // A missing fact is never filled: unknown, or a marked gap the client approved.
    ...(enhanced?.factsMissing ?? []).map(item => ({ text: item.fact, source: "request" as FactSource, status: (supplyLater ? "placeholder-approved" : "unknown") as FactStatus })),
  ], item => item.text);
  const assumptions = [
    ...(enhanced?.conflicts ?? []).map(conflict => ({ text: conflict.resolution, reversible: true as const, why: conflict.issue })),
    ...(enhanced?.workingName ? [{ text: `Working name "${enhanced.workingName}" until the client gives one`, reversible: true as const, why: "no business name was given" }] : []),
  ];
  const constraints = [
    ...(enhanced?.constraints ?? []),
    ...(input.brand?.colours?.length ? [`Brand colours ${input.brand.colours.join(", ")}`] : []),
    ...(design.colour ? [`Accent colour ${design.colour}`] : []),
    ...(design.theme ? [`${design.theme} theme`] : []),
  ];
  const preferences = [
    ...(design.vibe ? [`${design.vibe} feel`] : []),
    ...(design.imagery ? [`${design.imagery} imagery`] : []),
    ...(enhanced ? [`${enhanced.tone} tone`] : []),
  ];
  const scope: Scope = !input.target ? { kind: "artifact" } : "files" in input.target ? { kind: "files", files: [...input.target.files] } : { kind: "element", ...input.target };
  const checks = input.artifact === "website" && scope.kind !== "artifact" ? LOCAL_WEBSITE_CHECKS : CHECKS[input.artifact];
  return {
    version: TASK_CONTRACT_VERSION, acceptance: ACCEPTANCE_VERSION,
    original: { message: input.message, plan, brief },
    artifact: input.artifact, objective: input.objective,
    required, exclusions, facts, assumptions,
    audience: enhanced?.audience ?? "unknown",
    outcome: enhanced?.goal ?? (design.goal ? `visitors ${design.goal}` : "unknown"),
    design: { constraints, preferences },
    integrations: enhanced?.primaryAction.kind === "enquire" || design.goal === "enquire" ? ["hosted-enquiry-form"] : [],
    revision: { expectedVersion: input.revision.expectedVersion, sourceRevision: input.revision.sourceRevision ?? null, assetDigest: input.revision.assetDigest ?? null },
    scope,
    checks: [...checks, ...OPERATIONAL],
    // The router may lower these, never raise them.
    limits: { capCredits: input.limits.capCredits, deadlineAt: input.limits.deadlineAt ?? null, repairs: input.limits.repairs ?? 1, escalations: input.limits.escalations ?? 1 },
  };
}

// A section's own name words, singular ("testimonials" -> "testimonial"), so "no testimonial carousel" still matches.
const keyWords = (text: string) => text.toLowerCase().replace(/ section$/, "").split(/[^a-z0-9]+/).filter(word => word.length > 3).map(word => word.replace(/s$/, ""));
/** Where the structured reading disagrees with the client's own words, the words win: every required section the original prohibits. */
export function contractConflicts(contract: TaskContract) {
  const conflicts: { required: string; prohibitedBy: string }[] = [];
  for (const item of contract.required.filter(candidate => candidate.kind === "section")) {
    const words = keyWords(item.text);
    const exclusion = contract.exclusions.find(candidate => words.some(word => candidate.text.toLowerCase().includes(word)));
    if (exclusion) conflicts.push({ required: item.text, prohibitedBy: exclusion.text });
  }
  return conflicts;
}
