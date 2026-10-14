import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {RouteSchema, type ModelRoute} from "../routing/contracts";
import {ExactAmountSchema} from "../jobs/contracts";
import {canonicalSourceJson} from "../projects/canonical-json";
import {TextUsageSchema, type TextEvidence} from "./openai-text";

const EvidenceSchema = z.object({attemptId: z.string().uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  responseId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), providerRequestId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  model: z.string().min(1).max(160), usage: TextUsageSchema}).strict();

/** Pure tariff arithmetic, shared by pre-dispatch bounds and confirmed usage.
 * This computes no quality score and neither authorizes nor records spending. */
export function quotePlainTextUsage(routeInput: ModelRoute, usageInput: unknown) {
  const route = RouteSchema.parse(routeInput);
  const usage = z.object({input_tokens: ExactAmountSchema, output_tokens: ExactAmountSchema}).strict().parse(usageInput);
  if (!route.price || route.price.lines.length !== 2
    || !route.price.lines.every(line => ["input_tokens", "output_tokens"].includes(line.unit))) {
    throw new Error("TEXT_USAGE_TARIFF_UNCONFIRMED");
  }
  let cost = BigInt(route.price.fixedVendorMicrousd);
  for (const unit of ["input_tokens", "output_tokens"] as const) {
    const line = route.price.lines.find(item => item.unit === unit);
    if (!line) throw new Error("TEXT_USAGE_TARIFF_UNCONFIRMED");
    const numerator = BigInt(usage[unit]) * BigInt(line.vendorMicrousd), denominator = BigInt(line.perUnits);
    cost += (numerator + denominator - BigInt(1)) / denominator;
  }
  return ExactAmountSchema.parse(cost.toString());
}

/** Quote-compatible ceiling to micro-USD using the approved tariff. Does not
 * infer invoice reconciliation, authorise dispatch or fabricate missing usage.
 * Cache/tool/media tariffs need explicit units before being metered here. */
export function meterPlainText(routeInput: ModelRoute, evidenceInput: TextEvidence) {
  const route = RouteSchema.parse(routeInput), evidence = EvidenceSchema.parse(evidenceInput);
  if (!route.price || evidence.model !== route.model
    || evidence.usage.input_tokens_details.cached_tokens !== 0
    || (evidence.usage.input_tokens_details.cache_write_tokens ?? 0) !== 0
    || route.price.lines.length !== 2
    || !route.price.lines.every(line => ["input_tokens", "output_tokens"].includes(line.unit))) {
    throw new Error("TEXT_USAGE_TARIFF_UNCONFIRMED");
  }
  const actualVendorMicrousd = quotePlainTextUsage(route, {input_tokens: String(evidence.usage.input_tokens), output_tokens: String(evidence.usage.output_tokens)});
  const payload = {version: "plain-text-usage-v1", provider: route.provider, routeId: route.id, routeVersion: route.version,
    tariff: route.price, evidence, actualVendorMicrousd};
  const bytes = Buffer.from(canonicalSourceJson(payload));
  return {actualVendorMicrousd, providerRequestId: evidence.providerRequestId, tariffVersion: route.price.version,
    evidenceHash: createHash("sha256").update(bytes).digest("hex"), payload, bytes};
}
