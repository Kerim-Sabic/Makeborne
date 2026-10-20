import { z } from "zod";

/** One explicit user action. Automatic stages always keep its server ID. */
export const OperationRequestSchema = z.union([
  z.object({ actionKey: z.string().uuid(), stepKey: z.string().uuid() }).strict(),
  z.object({ id: z.string().uuid(), stepKey: z.string().uuid(), kind: z.enum(["continuation", "review", "plan"]) }).strict(),
]);
export type OperationRequest = z.infer<typeof OperationRequestSchema>;
const credits = z.number().int().nonnegative();
export const OperationSnapshotSchema = z.object({
  id: z.string().uuid(), revision: credits,
  kind: z.enum(["build", "review", "plan"]), effort: z.enum(["light", "medium", "high", "super_high", "ultra"]),
  authorizedCredits: credits, chargedCredits: credits, reservedCredits: credits, remainingCredits: credits,
  maximumAdditionalCredits: credits,
  status: z.enum(["active", "running", "paused", "completed", "expired", "cancelled"]),
  cancelRequested: z.boolean().optional(),
  pendingKind: z.enum(["continuation", "review", "plan"]).nullable(),
  lastVersion: credits, canContinue: z.boolean(), recoverable: z.boolean(), expiresAt: z.string(),
});
export type OperationSnapshot = z.infer<typeof OperationSnapshotSchema>;
export type OperationEvent = { type: "operation"; operation: OperationSnapshot };
export const OperationResultSchema = z.object({
  runId: z.string().uuid().optional(), version: credits.optional(), summary: z.string().optional(),
  changed: z.boolean().optional(), finished: z.boolean().optional(), charged: credits,
  code: z.string().optional(), message: z.string().optional(), stored: z.unknown().optional(), persisted: z.boolean().optional(),
});
export type OperationResult = z.infer<typeof OperationResultSchema>;
export const OperationStatusSchema = z.object({
  operation: OperationSnapshotSchema,
  result: OperationResultSchema.nullable(),
  /** A completed candidate can be recovered without making another AI call. */
  recovery: z.object({ runId: z.string().uuid(), candidate: z.unknown() }).nullable(),
});
export type OperationStatus = z.infer<typeof OperationStatusSchema>;
export const OperationAuthorizationSchema = z.object({
  workspaceId: z.string().uuid(), artifactId: z.string().uuid(), id: z.string().uuid(),
  expectedRevision: credits, authorizationKey: z.string().uuid(),
  additionalCredits: z.number().int().positive().max(240), acknowledged: z.literal(true),
}).strict();
export type OperationAuthorization = z.infer<typeof OperationAuthorizationSchema>;
