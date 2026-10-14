import { z } from "zod";

export const EFFORT_LEVELS = ["light", "medium", "high", "super_high", "ultra"] as const;
export const EffortLevelSchema = z.enum(EFFORT_LEVELS);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;
export const DEFAULT_EFFORT: EffortLevel = "medium";
export const EFFORT_POLICY_VERSION = "effort-v2";
export const ReasoningIntensitySchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const EFFORT_PRESENTATION: Readonly<Record<EffortLevel, Readonly<{ label: string; purpose: string }>>> = Object.freeze({
  light: Object.freeze({ label: "Light", purpose: "Focused work for small changes and clear requests." }),
  medium: Object.freeze({ label: "Medium", purpose: "A balanced approach for everyday creation." }),
  high: Object.freeze({ label: "High", purpose: "More room to plan and review detailed work." }),
  super_high: Object.freeze({ label: "Super high", purpose: "Deeper planning and review for complex projects." }),
  ultra: Object.freeze({ label: "Ultra", purpose: "The largest planning and review allowance for demanding work." }),
});

export type EffortPolicy = Readonly<{
  version: typeof EFFORT_POLICY_VERSION;
  level: EffortLevel;
  reasoningIntensity: z.infer<typeof ReasoningIntensitySchema>;
  maximumPlanningSteps: number;
  maximumReviewPasses: number;
  maximumAttemptsPerStep: number;
  minimumQuality: number;
}>;

// Provisional bounded orchestration policy, not measured model scores or a price card.
// Every level keeps the same acceptance floor. More effort permits additional work;
// it does not guarantee better output, grant spend, or force use of the whole budget.
const budgets: Record<EffortLevel, readonly [number, number, number]> = {
  light: [1, 1, 1], medium: [2, 1, 2], high: [3, 2, 2], super_high: [4, 3, 3], ultra: [6, 4, 3],
};
const reasoning: Record<EffortLevel, z.infer<typeof ReasoningIntensitySchema>> = {
  light: "low", medium: "medium", high: "high", super_high: "xhigh", ultra: "max",
};
export function getEffortPolicy(input: unknown): EffortPolicy {
  const level = EffortLevelSchema.parse(input);
  const [maximumPlanningSteps, maximumReviewPasses, maximumAttemptsPerStep] = budgets[level];
  return Object.freeze({ version: EFFORT_POLICY_VERSION, level, reasoningIntensity: reasoning[level], maximumPlanningSteps, maximumReviewPasses, maximumAttemptsPerStep, minimumQuality: 80 });
}

/** Resolve trusted job caps before routing each step. This never authorizes dispatch.
 * Include the version/level and all bounded step usage in the server quote/input hash.
 * Existing RoutingRequest.maximumAttempts applies to ONE step, not the whole workflow.
 * The server must also apply its operation-specific quality floor and allowed budgets.
 * A changed effort level invalidates a previous quote and requires fresh approval.
 */
export function effortRoutingBounds(input: unknown, operationQualityFloor: number) {
  const floor = z.number().int().min(0).max(100).parse(operationQualityFloor);
  const policy = getEffortPolicy(input);
  return Object.freeze({ maximumAttempts: policy.maximumAttemptsPerStep, minimumQuality: Math.max(policy.minimumQuality, floor) });
}
