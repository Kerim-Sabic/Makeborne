import { z } from "zod";
import { ExactAmountSchema, QuoteSchema } from "../jobs/contracts";

export const CapabilitySchema = z.enum(["text", "website_code", "book_content", "slide_content", "image", "visual_slide", "research_sources", "transcription", "clip_selection", "clip_render"]);
export type Capability = z.infer<typeof CapabilitySchema>;
const key = z.string().min(1).max(200);
const units = z.enum(["input_tokens", "output_tokens", "images", "audio_seconds", "video_seconds", "searches", "compute_seconds"]);
const positiveExact = ExactAmountSchema.refine((value) => BigInt(value) > BigInt(0));
export const RouteSchema = z.object({
  id: key, version: key, provider: z.enum(["openai", "anthropic", "deepseek", "qwen_hosted", "self_hosted", "media_worker"]),
  model: key.nullable(), capabilities: z.array(CapabilitySchema).min(1),
  status: z.enum(["disabled", "unconfigured", "ready"]), adapterVerified: z.boolean(),
  configurationRef: key.nullable(), // Internal secret-store reference, never a credential or client URL.
  dataBoundary: z.enum(["external", "workspace_private"]), policyApproved: z.boolean(), licenseApproved: z.boolean(),
  evaluation: z.object({ evidenceId: key, quality: z.number().int().min(0).max(100) }).strict().nullable(),
  priority: z.number().int().nonnegative(),
  price: z.object({
    version: key, evidenceId: key, expiresAt: z.string().datetime(),
    lines: z.array(z.object({ unit: units, perUnits: positiveExact, vendorMicrousd: ExactAmountSchema, customerCredits: ExactAmountSchema }).strict()).min(1).max(20),
    fixedVendorMicrousd: ExactAmountSchema, fixedCustomerCredits: ExactAmountSchema,
  }).strict().nullable(),
}).strict().superRefine((route, ctx) => {
  if (route.price && new Set(route.price.lines.map((line) => line.unit)).size !== route.price.lines.length) ctx.addIssue({ code: "custom", message: "Price units must be unique." });
});
export type ModelRoute = z.infer<typeof RouteSchema>;
export const RoutingRequestSchema = z.object({
  capabilities: z.array(CapabilitySchema).min(1),
  usage: z.array(z.object({ unit: units, maximum: positiveExact }).strict()).min(1).max(20),
  maximumAttempts: z.number().int().min(1).max(10), minimumQuality: z.number().int().min(0).max(100),
  allowedProviders: z.array(RouteSchema.shape.provider).min(1),
  externalProcessingAllowed: z.boolean(), sourceRightsConfirmed: z.boolean(),
  maximumVendorMicrousd: ExactAmountSchema, maximumCustomerCredits: ExactAmountSchema,
  preference: z.enum(["quality", "economy"]), now: z.string().datetime(),
}).strict().superRefine((request, ctx) => {
  if (new Set(request.usage.map((line) => line.unit)).size !== request.usage.length) ctx.addIssue({ code: "custom", message: "Usage units must be unique." });
});
export type RoutingRequest = z.infer<typeof RoutingRequestSchema>;
export type RouteRejection = "disabled" | "unconfigured" | "adapter_unverified" | "capability" | "provider_policy" | "privacy" | "rights" | "license" | "policy" | "quality" | "price_missing" | "price_expired" | "usage_unpriced" | "usage_missing" | "budget" | "amount_overflow";
export type RouteCandidate = { route: ModelRoute; maximumVendorMicrousd: string; customerCredits: string };
export type RoutingDecision = { selected: RouteCandidate | null; eligible: RouteCandidate[]; rejected: { routeId: string; reasons: RouteRejection[] }[] };

const ceil = (numerator: bigint, denominator: bigint) => (numerator + denominator - BigInt(1)) / denominator;

/** Pure server policy evaluation: no dispatch, network access, billing or credential reads. */
export function selectRoute(input: RoutingRequest, definitions: readonly ModelRoute[]): RoutingDecision {
  const request = RoutingRequestSchema.parse(input);
  const routes = definitions.map((route) => RouteSchema.parse(route));
  if (new Set(routes.map((route) => route.id)).size !== routes.length) throw new Error("Route IDs must be unique.");
  const eligible: RouteCandidate[] = [];
  const rejected: RoutingDecision["rejected"] = [];
  for (const route of routes) {
    const reasons: RouteRejection[] = [];
    if (route.status === "disabled") reasons.push("disabled");
    if (route.status === "unconfigured" || !route.model || !route.configurationRef) reasons.push("unconfigured");
    if (!route.adapterVerified) reasons.push("adapter_unverified");
    if (!request.capabilities.every((capability) => route.capabilities.includes(capability))) reasons.push("capability");
    if (!request.allowedProviders.includes(route.provider)) reasons.push("provider_policy");
    if (!request.externalProcessingAllowed && route.dataBoundary === "external") reasons.push("privacy");
    if (!request.sourceRightsConfirmed) reasons.push("rights");
    if (!route.licenseApproved) reasons.push("license");
    if (!route.policyApproved) reasons.push("policy");
    if (!route.evaluation || route.evaluation.quality < request.minimumQuality) reasons.push("quality");
    let vendor = BigInt(0), credits = BigInt(0);
    if (!route.price) reasons.push("price_missing");
    else {
      if (Date.parse(route.price.expiresAt) <= Date.parse(request.now)) reasons.push("price_expired");
      if (route.price.lines.some((line) => !request.usage.some((usage) => usage.unit === line.unit))) reasons.push("usage_missing");
      vendor = BigInt(route.price.fixedVendorMicrousd); credits = BigInt(route.price.fixedCustomerCredits);
      for (const usage of request.usage) {
        const line = route.price.lines.find((price) => price.unit === usage.unit);
        if (!line) { reasons.push("usage_unpriced"); continue; }
        vendor += ceil(BigInt(usage.maximum) * BigInt(line.vendorMicrousd), BigInt(line.perUnits));
        credits += ceil(BigInt(usage.maximum) * BigInt(line.customerCredits), BigInt(line.perUnits));
      }
      vendor *= BigInt(request.maximumAttempts); credits *= BigInt(request.maximumAttempts);
      if (!ExactAmountSchema.safeParse(vendor.toString()).success || !ExactAmountSchema.safeParse(credits.toString()).success) reasons.push("amount_overflow");
      if (vendor > BigInt(request.maximumVendorMicrousd) || credits > BigInt(request.maximumCustomerCredits)) reasons.push("budget");
    }
    if (reasons.length) rejected.push({ routeId: route.id, reasons: [...new Set(reasons)] });
    else eligible.push({ route, maximumVendorMicrousd: vendor.toString(), customerCredits: credits.toString() });
  }
  eligible.sort((a, b) => {
    const quality = b.route.evaluation!.quality - a.route.evaluation!.quality;
    const cost = BigInt(a.customerCredits) < BigInt(b.customerCredits) ? -1 : BigInt(a.customerCredits) > BigInt(b.customerCredits) ? 1 : 0;
    return (request.preference === "quality" ? quality || cost : cost || quality) || a.route.priority - b.route.priority || (a.route.id < b.route.id ? -1 : a.route.id > b.route.id ? 1 : 0);
  });
  return { selected: eligible[0] ?? null, eligible, rejected };
}

type QuoteContext = Pick<z.infer<typeof QuoteSchema>, "id" | "scope" | "version" | "inputHash" | "baseVersionId" | "expiresAt">;
/** The quote is an unapproved maximum reservation, not actual consumed credits. */
export function prepareRouteQuote(request: RoutingRequest, routes: readonly ModelRoute[], context: QuoteContext) {
  const decision = selectRoute(request, routes);
  if (!decision.selected) return { decision, quote: null };
  const selected = decision.selected;
  const expiresAt = Date.parse(context.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(request.now) || expiresAt > Date.parse(selected.route.price!.expiresAt)) throw new Error("Quote expiration must be future and within the price validity period.");
  const quote = QuoteSchema.parse({ ...context, routeVersion: `${selected.route.version}:${selected.route.price!.version}`,
    provider: selected.route.provider, model: selected.route.model,
    maximumVendorMicrousd: selected.maximumVendorMicrousd, customerCredits: selected.customerCredits,
    repairPolicy: "included_within_bound", approvedBy: null, approvedAt: null,
  });
  return { decision, quote };
}
