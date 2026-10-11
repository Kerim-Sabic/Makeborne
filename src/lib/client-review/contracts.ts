import { z } from "zod";

/** A review token is 32 random bytes in base64url (43 characters, 256 bits). */
export const REVIEW_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const validReviewToken = (value: string) => REVIEW_TOKEN.test(value);

export const ReviewAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("general") }).strict(),
  z.object({ kind: z.literal("section"), ref: z.string().regex(/^[A-Za-z0-9:_.-]{1,100}$/), label: z.string().max(160).default("") }).strict(),
  z.object({
    kind: z.literal("point"), ref: z.string().regex(/^[A-Za-z0-9:_.-]{1,100}$/), label: z.string().max(160).default(""),
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  }).strict(),
]);
export type ReviewAnchor = z.infer<typeof ReviewAnchorSchema>;

export const ReviewCommentSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["comment", "approved", "changes_requested"]),
  authorName: z.string(),
  body: z.string(),
  anchor: ReviewAnchorSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  resolved: z.boolean(),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const ReviewDecisionSchema = z.object({
  value: z.enum(["approved", "changes_requested"]),
  name: z.string(),
  at: z.string(),
  version: z.number().int().positive().nullable(),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const ReviewPayloadSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("active"),
    kind: z.enum(["website", "book", "presentation"]),
    title: z.string(),
    version: z.number().int().positive(),
    pinned: z.boolean(),
    mode: z.enum(["html", "content"]),
    html: z.string().nullable(),
    content: z.unknown().nullable(),
    style: z.unknown().nullable(),
    recipientName: z.string(),
    message: z.string(),
    expiresAt: z.string(),
    decision: ReviewDecisionSchema.nullable(),
    comments: z.array(ReviewCommentSchema),
  }),
  z.object({ status: z.literal("preparing"), title: z.string(), kind: z.enum(["website", "book", "presentation"]) }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("revoked") }),
]);
export type ReviewPayload = z.infer<typeof ReviewPayloadSchema>;
export type ActiveReview = Extract<ReviewPayload, { status: "active" }>;

const name = z.string().trim().min(1, "Add your name.").max(80);
const email = z.string().trim().max(254).refine(value => !value || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), "Use a valid email or leave it empty.");
export const ReviewCommentInputSchema = z.object({
  name, email: email.default(""), body: z.string().trim().min(1, "Write a comment.").max(2000), anchor: ReviewAnchorSchema,
}).strict();
export const ReviewDecisionInputSchema = z.object({
  name, email: email.default(""), decision: z.enum(["approved", "changes_requested"]), note: z.string().trim().max(2000).default(""),
}).strict();

/** Freelancer-side link record (never includes the token or its hash). */
export const ReviewLinkSchema = z.object({
  id: z.string().uuid(),
  artifactId: z.string().uuid(),
  projectId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
  recipientName: z.string(),
  message: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  decision: z.enum(["approved", "changes_requested"]).nullable(),
  decisionName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedVersion: z.number().int().nullable(),
  viewCount: z.number().int().nonnegative(),
  lastViewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ReviewLink = z.infer<typeof ReviewLinkSchema>;
export const StudioReviewCommentSchema = ReviewCommentSchema.extend({
  linkId: z.string().uuid(), authorEmail: z.string(), resolvedAt: z.string().nullable(),
});
export type StudioReviewComment = z.infer<typeof StudioReviewCommentSchema>;

export const ReviewCreateSchema = z.object({
  scope: z.enum(["version", "latest"]),
  version: z.number().int().positive(),
  days: z.number().int().min(1).max(90),
  recipientName: z.string().trim().max(120).default(""),
  message: z.string().trim().max(2000).default(""),
  snapshot: z.string().max(4_000_000).optional(),
}).strict();
export const ReviewSnapshotSchema = z.object({ version: z.number().int().positive(), snapshot: z.string().max(4_000_000).optional() }).strict();

export function linkState(link: Pick<ReviewLink, "revokedAt" | "expiresAt">, now = Date.now()) {
  if (link.revokedAt) return "revoked" as const;
  return Date.parse(link.expiresAt) <= now ? "expired" as const : "active" as const;
}
