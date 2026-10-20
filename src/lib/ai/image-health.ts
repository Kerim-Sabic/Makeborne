/**
 * Fail-closed health of image models whose bounds are measured (D8, 2.5 models):
 * a call whose output tokens exceed its bound disables routing to that model in
 * this server process until someone reviews it and restarts or clears it. The
 * event is logged as JSON for the operator. A dollar overrun additionally trips
 * the provider scope's emergency stop in the database gate, which persists across
 * instances (live_provider_limits.emergency_stop) until an operator clears it.
 */
export type ImageOverrun = { model: string; quality: string; size: string; outputTokens: number; boundTokens: number; at: string };

const disabled = new Map<string, ImageOverrun>();

export function reportImageOverrun(overrun: Omit<ImageOverrun, "at">, now = Date.now()) {
  const record = { ...overrun, at: new Date(now).toISOString() };
  if (!disabled.has(overrun.model)) disabled.set(overrun.model, record);
  console.error(JSON.stringify({ event: "image_model_overrun", ...record, action: "routing to this model is stopped until reviewed" }));
  return record;
}
export const imageModelDisabled = (model: string) => disabled.has(model);
export const disabledImageModels = () => [...disabled.values()];
/** Operator or test reset after review. */
export function clearImageOverrun(model?: string) { if (model) disabled.delete(model); else disabled.clear(); }
