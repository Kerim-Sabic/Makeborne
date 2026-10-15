/**
 * Client portal API contract (Phase 1: review mode). Clients edit content
 * collections; every change goes to the agency for approval. Shared by the
 * routes and the UI. Client-safe.
 */
import { z } from "zod";

export const PortalBrandSchema = z.object({
  name: z.string(), logo: z.string().nullable(),
  colors: z.object({ primary: z.string(), background: z.string(), text: z.string() }),
});
export type PortalBrand = z.infer<typeof PortalBrandSchema>;

export type PortalChangeStatus = "draft" | "pending" | "approved" | "rejected" | "withdrawn";
export type PortalChange = {
  id: string; status: PortalChangeStatus; baseVersion: number;
  /** path → proposed file text (only collection files). */
  files: Record<string, string>;
  summary: string; decisionNote: string | null; resultVersion: number | null;
  updatedAt: string; submittedAt: string | null; decidedAt: string | null;
};

/** GET /api/portal */
export type PortalHome = {
  email: string;
  grants: {
    accessId: string; agency: PortalBrand; client: { name: string };
    sites: { artifactId: string; title: string; liveUrl: string | null; change: Pick<PortalChange, "id" | "status" | "updatedAt"> | null }[];
  }[];
};

/** GET /api/portal/sites/[artifactId] */
export type PortalSite = {
  site: { artifactId: string; title: string; liveUrl: string | null };
  agency: PortalBrand;
  baseVersion: number;
  /** Raw src/content/collections.json text (validated by content-model on both sides). */
  manifest: string;
  /** Collection files the client may edit, with the sha256 of the current text. */
  collections: { key: string; path: string; sha256: string; text: string }[];
  /** Site images an image field may point at; previewUrl is a portal-served thumbnail. */
  images: { path: string; previewUrl: string }[];
  change: PortalChange | null;
};

const ContentPath = z.string().regex(/^src\/content\/[a-z][a-z0-9-]{0,39}\.json$/).refine(path => path !== "src/content/collections.json");
/** PUT /api/portal/sites/[artifactId]/draft (Idempotency-Key header) */
export const SaveDraftSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  files: z.record(ContentPath, z.string().max(200_000)).refine(files => Object.keys(files).length >= 1 && Object.keys(files).length <= 30, "Between 1 and 30 files."),
  summary: z.string().trim().max(2000).default(""),
}).strict();
/** POST /api/portal/sites/[artifactId]/changes */
export const ChangeActionSchema = z.object({ action: z.enum(["submit", "withdraw"]), changeId: z.string().uuid() }).strict();

/** GET /api/portal/invites/[token] (public) */
export type PortalInvite = { status: "open" | "accepted" | "expired" | "revoked"; agency: PortalBrand; client: { name: string }; maskedEmail: string };

// ---------------------------------------------------------------- agency side

export type PortalAccessStatus = "invited" | "active" | "revoked" | "expired";
export type PortalAccess = {
  id: string; email: string; displayName: string; status: PortalAccessStatus;
  invitedAt: string; acceptedAt: string | null; lastSeenAt: string | null; planLabel: string; paidThrough: string | null;
};
/** GET /api/cloud/workspaces/[ws]/clients/[clientId]/portal */
export type ClientPortalOverview = {
  available: boolean;
  access: PortalAccess[];
  sites: { artifactId: string; title: string; enabled: boolean; collections: string[] | null; hasContent: boolean; pending: number }[];
};
/** POST same: invite (returns the one-time link). */
export const InviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), displayName: z.string().trim().max(120).regex(/^[^<>]*$/).default("") }).strict();
/** PATCH .../portal/[accessId] */
export const AccessUpdateSchema = z.union([
  z.object({ action: z.literal("resend") }).strict(),
  z.object({ action: z.literal("update"), planLabel: z.string().trim().max(80).regex(/^[^<>]*$/), paidThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).strict(),
]);

/** GET/PUT /api/cloud/workspaces/[ws]/artifacts/[artifactId]/portal */
export type SitePortalSettings = {
  available: boolean; clientId: string | null; enabled: boolean; collections: string[] | null;
  /** Collections the current version declares (key + label). */
  declared: { key: string; label: string }[];
  pending: (PortalChange & { authorName: string; authorEmail: string; summaryLines: string[] })[];
};
export const SiteSettingsSchema = z.object({ enabled: z.boolean(), collections: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)).max(30).nullable() }).strict();
/** POST .../portal/changes/[changeId] */
export const DecisionSchema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(2000).default(""), overwrite: z.boolean().default(false) }).strict();
