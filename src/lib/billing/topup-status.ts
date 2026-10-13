import "server-only";
import { z } from "zod";
import { RequestError } from "@/lib/server/http";
import { billingDatabase } from "./database";
import { CreditTopupStatusSchema, type CreditTopupStatus } from "./topup-status-contract";

export function topupStatusUnavailable() {
  return new RequestError("CREDIT_PACK_STATUS_UNAVAILABLE", "Your credit pack status is temporarily unavailable. Please try again.", 503);
}

/** Reads durable delivery state only; never creates checkout or grants credits. */
export async function readTopupStatus(userId: string, orderId: string): Promise<CreditTopupStatus> {
  const parsedOrder = z.string().uuid().safeParse(orderId);
  if (!parsedOrder.success) throw new RequestError("INVALID_CREDIT_PACK_ORDER", "This credit pack purchase link is invalid.", 400);
  let result;
  try {
    result = await billingDatabase().rpc("makeborne_topup_order_status", { p_user: userId, p_order: parsedOrder.data });
  } catch { throw topupStatusUnavailable(); }
  if (result.error) throw topupStatusUnavailable();
  // Missing and another user's purchase deliberately have the same response.
  if (result.data === null) throw new RequestError("CREDIT_PACK_ORDER_NOT_FOUND", "This credit pack purchase could not be found.", 404);
  const parsed = CreditTopupStatusSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.orderId.toLowerCase() !== parsedOrder.data.toLowerCase()) throw topupStatusUnavailable();
  return parsed.data;
}
