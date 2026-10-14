import { z } from "zod";

/** Client-safe receipt summary. Amounts are the frozen purchase values. */
export const CreditTopupStatusSchema = z.object({
  orderId: z.string().uuid(),
  packId: z.enum(["boost_100", "boost_300", "boost_1000"]),
  credits: z.number().int().positive().safe(),
  priceCents: z.number().int().positive().safe(),
  currency: z.literal("usd"),
  state: z.enum(["pending", "delivered", "under_review", "refunded"]),
}).strict();

export type CreditTopupStatus = z.infer<typeof CreditTopupStatusSchema>;
