import { RequestError } from "../server/http";
import { UnpricedModelError, textPrice } from "./prices";

/** Fails a request closed (before any hold or provider call) when a configured model has no verified price. */
export function requirePricedModel(model: string) {
  try { textPrice(model); } catch (error) {
    if (error instanceof UnpricedModelError) throw new RequestError("MODEL_UNPRICED", "The configured AI model has no verified price, so the builder is unavailable.", 503);
    throw error;
  }
}
