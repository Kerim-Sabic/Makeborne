import {z} from "zod";

export const PREVIEW_SESSION_MAX_MS=20*60_000;
export const PREVIEW_HANDOFF_MAX_MS=60_000;
// Read-time sanity tolerance between app/database/browser clocks. Database
// constraints and current-session checks still enforce the exact grant expiry.
export const PREVIEW_CLOCK_SKEW_MS=5_000;

export const PreviewIdentitySchema=z.object({jobId:z.string().uuid(),versionId:z.string().uuid(),
  buildHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const PreviewViewerSchema=z.object({p_actor:z.string().uuid(),p_session:z.string().uuid(),
  p_expires:z.string().datetime({offset:true})}).strict();
export const PreviewIssuedSchema=z.object({identity:PreviewIdentitySchema,
  scope:z.object({workspaceId:z.string().uuid(),projectId:z.string().uuid(),artifactId:z.string().uuid()}).strict(),
  handoffUntil:z.string().datetime({offset:true}),expiresAt:z.string().datetime({offset:true})}).strict();
export const PreviewConsumedSchema=PreviewIssuedSchema.pick({identity:true,expiresAt:true});
export const PreviewSessionSchema=z.object({identity:PreviewIdentitySchema,viewer:PreviewViewerSchema,authorized:z.unknown()}).strict();
/** Never persist this handoff in browser storage or place it in a URL. */
export const PreviewLaunchSchema=z.object({url:z.string().url(),handoff:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  handoffUntil:z.string().datetime({offset:true}),expiresAt:z.string().datetime({offset:true})}).strict();
