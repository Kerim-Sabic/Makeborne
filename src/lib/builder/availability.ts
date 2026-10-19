/**
 * What GET /api/build tells the studio before any work is offered.
 * `configured`: this deployment has the live builder. `available`: a new
 * request can start now (priced model, provider spending enabled and under
 * today's limit). Reasons only, never amounts.
 */
export type BuilderState = "ready" | "off" | "paused" | "limit" | "unavailable";
export type BuilderAvailability = { available: boolean; configured: boolean; state: BuilderState };
export type ProviderCapacity = "available" | "paused" | "limit" | "unavailable";

export const BUILDER_OFF: BuilderAvailability = { available: false, configured: false, state: "off" };

/** The same gates a build request passes, in the same order, without reserving anything. */
export async function builderAvailability(input: { configured: boolean; priced: () => void; capacity: () => Promise<ProviderCapacity> }): Promise<BuilderAvailability> {
  if (!input.configured) return BUILDER_OFF;
  try { input.priced(); } catch { return { available: false, configured: true, state: "unavailable" }; }
  const capacity = await input.capacity().catch((): ProviderCapacity => "unavailable");
  return capacity === "available" ? { available: true, configured: true, state: "ready" } : { available: false, configured: true, state: capacity };
}

const STATES: readonly BuilderState[] = ["ready", "off", "paused", "limit", "unavailable"];
/** Reads a GET /api/build body. Anything unexpected is off; servers before `state` sent only `available`. */
export function parseBuilderAvailability(value: unknown): BuilderAvailability {
  if (!value || typeof value !== "object") return BUILDER_OFF;
  const body = value as Partial<Record<keyof BuilderAvailability, unknown>>;
  if (body.state === undefined) return body.available === true ? { available: true, configured: true, state: "ready" } : BUILDER_OFF;
  const state = STATES.find(item => item === body.state);
  if (!state || state === "off" || body.configured !== true) return BUILDER_OFF;
  return state === "ready" && body.available === true ? { available: true, configured: true, state } : { available: false, configured: true, state: state === "ready" ? "unavailable" : state };
}

/** Shown in the builder while it is configured but cannot start new work. */
export const BUILDER_WAITING_COPY: Record<Exclude<BuilderState, "ready" | "off">, string> = {
  // Exports differ by format and environment (production has no standard export for outline records), so none is promised here.
  paused: "AI building is paused right now. Your saved work is safe, and you can still open and edit it.",
  limit: "Today's AI building capacity has been reached. Your saved work is safe; please try again later.",
  unavailable: "AI building is temporarily unavailable. Your saved work is safe; please try again shortly.",
};
