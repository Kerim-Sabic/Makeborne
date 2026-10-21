import { z } from "zod";
export const CreditPreferencesSchema = z.object({
  alertBelow: z.number().int().min(1).max(1000000).nullable(),
  monthlyLimit: z.number().int().min(1).max(1000000000).nullable(),
  used: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(), available: z.number().int().nonnegative(),
}).strict();
export type CreditPreferences = z.infer<typeof CreditPreferencesSchema>;
export const CreditPreferenceInput = CreditPreferencesSchema.pick({alertBelow:true,monthlyLimit:true}).strict();
