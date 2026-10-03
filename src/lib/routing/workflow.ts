import { z } from "zod";
import { ExactAmountSchema } from "../jobs/contracts";
import { EffortLevelSchema, getEffortPolicy } from "./effort";
import { RoutingRequestSchema, selectRoute, type Capability, type ModelRoute } from "./contracts";

const StageSchema = z.enum(["planning", "draft", "review", "images"]);
type Stage = z.infer<typeof StageSchema>;
export const WorkflowPreparationSchema = z.object({
  output: z.enum(["website", "book", "presentation"]), effort: EffortLevelSchema,
  presentationMode: z.enum(["editable", "full_visual"]).optional(), includeImages: z.boolean(),
  now: z.string().datetime(), maximumVendorMicrousd: ExactAmountSchema, maximumCustomerCredits: ExactAmountSchema,
  stages: z.array(z.object({ stage: StageSchema, request: RoutingRequestSchema }).strict()).min(3).max(4),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.stages.map(stage => stage.stage)).size !== input.stages.length) ctx.addIssue({ code: "custom", message: "Duplicate stages are forbidden." });
  if (input.output === "presentation" && !input.presentationMode) ctx.addIssue({ code: "custom", message: "Presentation mode is required." });
  if (input.output !== "presentation" && input.presentationMode) ctx.addIssue({ code: "custom", message: "Presentation mode applies only to presentations." });
  if ((input.output === "book" || input.presentationMode === "full_visual") && !input.includeImages) ctx.addIssue({ code: "custom", message: "This output requires image generation." });
});
export type WorkflowPreparationInput = z.infer<typeof WorkflowPreparationSchema>;

function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
const minAmount = (a: string, b: string) => BigInt(a) < BigInt(b) ? a : b;

/** Pure preparation only. Caller must provide trusted server policy, authorize scope,
 * bind this snapshot to canonical input/quote hashes, approve, and reserve atomically.
 * Prices include each step's retry cap and each stage's execution cap exactly once.
 */
export function prepareWorkflow(input: unknown, configuredRoutes: readonly ModelRoute[]) {
  const request = WorkflowPreparationSchema.parse(input);
  const effort = getEffortPolicy(request.effort);
  const required: Stage[] = ["planning", "draft", "review", ...(request.includeImages ? ["images" as const] : [])];
  const blocked: { stage: Stage | "workflow"; reason: "missing_stage" | "unexpected_stage" | "image_policy" | "route_unavailable" | "workflow_budget" | "amount_overflow" }[] = [];
  const planned = [];
  let vendor = BigInt(0), credits = BigInt(0);
  const draftCapability: Capability = request.output === "website" ? "website_code" : request.output === "book" ? "book_content" : "slide_content";
  for (const extra of request.stages.filter(stage => !required.includes(stage.stage))) blocked.push({ stage: extra.stage, reason: "unexpected_stage" });
  for (const stage of required) {
    const definition = request.stages.find(item => item.stage === stage);
    if (!definition) { blocked.push({ stage, reason: "missing_stage" }); continue; }
    const mandatoryOpenAI = stage === "images" && (request.output === "book" || request.presentationMode === "full_visual");
    if (mandatoryOpenAI && !definition.request.allowedProviders.includes("openai")) { blocked.push({ stage, reason: "image_policy" }); continue; }
    const capability: Capability = stage === "images" ? (request.presentationMode === "full_visual" ? "visual_slide" : "image") : stage === "draft" ? draftCapability : "text";
    const routeRequest = RoutingRequestSchema.parse({ ...definition.request,
      capabilities: [...new Set([...definition.request.capabilities, capability])],
      allowedProviders: mandatoryOpenAI ? ["openai"] : definition.request.allowedProviders,
      now: request.now, maximumAttempts: Math.min(definition.request.maximumAttempts, effort.maximumAttemptsPerStep),
      minimumQuality: Math.max(definition.request.minimumQuality, effort.minimumQuality),
      maximumVendorMicrousd: minAmount(request.maximumVendorMicrousd, definition.request.maximumVendorMicrousd),
      maximumCustomerCredits: minAmount(request.maximumCustomerCredits, definition.request.maximumCustomerCredits),
    });
    const candidate = selectRoute(routeRequest, configuredRoutes).selected;
    if (!candidate) { blocked.push({ stage, reason: "route_unavailable" }); continue; }
    const maximumExecutions = stage === "planning" ? effort.maximumPlanningSteps : stage === "review" ? effort.maximumReviewPasses : 1;
    const maximumVendorMicrousd = (BigInt(candidate.maximumVendorMicrousd) * BigInt(maximumExecutions)).toString();
    const maximumCustomerCredits = (BigInt(candidate.customerCredits) * BigInt(maximumExecutions)).toString();
    vendor += BigInt(maximumVendorMicrousd); credits += BigInt(maximumCustomerCredits);
    planned.push({ stage, maximumExecutions, request: routeRequest, route: candidate.route, maximumVendorMicrousd, maximumCustomerCredits });
  }
  if (!ExactAmountSchema.safeParse(vendor.toString()).success || !ExactAmountSchema.safeParse(credits.toString()).success) blocked.push({ stage: "workflow", reason: "amount_overflow" });
  if (vendor > BigInt(request.maximumVendorMicrousd) || credits > BigInt(request.maximumCustomerCredits)) blocked.push({ stage: "workflow", reason: "workflow_budget" });
  const operation = request.output === "website" ? "Create website" : request.output === "book" ? "Create book" : "Create presentation";
  if (blocked.length) return immutable({ status: "blocked" as const, snapshot: null, blocked, customerView: { operation, maximumCredits: null, readyForApproval: false } });
  const expiresAt = planned.map(stage => stage.route.price!.expiresAt).sort((a,b) => Date.parse(a)-Date.parse(b))[0];
  return immutable({ status: "prepared" as const, blocked, snapshot: {
    version: "workflow-v1" as const, effort, output: request.output, presentationMode: request.presentationMode ?? null,
    includeImages: request.includeImages, preparedAt: request.now, expiresAt, stages: planned,
    maximumVendorMicrousd: vendor.toString(), maximumCustomerCredits: credits.toString(),
    maximumExecutions: planned.reduce((total, stage) => total + stage.maximumExecutions, 0),
    approved: false as const,
  }, customerView: { operation, maximumCredits: credits.toString(), readyForApproval: true } });
}
