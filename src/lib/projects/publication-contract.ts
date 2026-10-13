import {z} from "zod";

/** Browser-visible progress contains identifiers and verified presentation only,
 * never worker credentials, source files or an authorization-bearing receipt. */
export const PublicationPreparationSchema = z.object({
  id: z.string().uuid(), state: z.enum(["queued", "building", "ready", "published", "failed", "expired", "cancelled"]),
  workspaceId: z.string().uuid(), artifactId: z.string().uuid(), version: z.number().int().positive(),
  publicationRevision: z.number().int().nonnegative(), slug: z.string().min(3).max(48), interactive: z.boolean(),
  expiresAt: z.string(), error: z.string().nullable(),
  previewHtml: z.string().max(4_000_000).nullable(),
  previewRoutes: z.array(z.object({path:z.string().max(240),html:z.string().max(4_000_000)}).strict()).max(20),
}).strict();
export type PublicationPreparation = z.infer<typeof PublicationPreparationSchema>;
export const PreparePublicationSchema = z.object({
  version: z.number().int().positive(), revision: z.number().int().nonnegative(),
  slug: z.string().min(3).max(48), interactive: z.boolean(),
}).strict();
export const PromotePublicationSchema = z.object({preparationId: z.string().uuid(), acknowledged: z.literal(true)}).strict();
