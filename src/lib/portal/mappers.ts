/**
 * Maps client-portal RPC results (supabase/migrations/20261016090000_client_portal.sql)
 * to the API contract in contracts.ts. Every database value is parsed, so an
 * unexpected shape fails closed instead of reaching a browser.
 */
import { z } from "zod";
import { siteAddress } from "@/lib/hosting/config";
import { PortalBrandSchema, type ClientPortalOverview, type PortalAccess, type PortalChange, type PortalHome, type PortalInvite,
  type PortalSite, type SitePortalSettings } from "./contracts";
import { collectionPath, describeChange, parseManifest, CONTENT_DIR } from "./content-model";

const uuid = z.string().uuid();
const stamp = z.string().min(1).max(64);
export const ChangeRowSchema = z.object({
  id: uuid, status: z.enum(["draft", "pending", "approved", "rejected", "withdrawn"]), baseVersion: z.number().int().positive(),
  files: z.record(z.string(), z.string()), summary: z.string(), decisionNote: z.string().nullable(), resultVersion: z.number().int().positive().nullable(),
  updatedAt: stamp, submittedAt: stamp.nullable(), decidedAt: stamp.nullable(),
}).passthrough();
const AccessRowSchema = z.object({
  id: uuid, clientId: uuid, email: z.string(), displayName: z.string(), status: z.enum(["invited", "active", "revoked", "expired"]),
  invitedAt: stamp, inviteExpiresAt: stamp, acceptedAt: stamp.nullable(), lastSeenAt: stamp.nullable(), planLabel: z.string(), paidThrough: z.string().nullable(),
}).passthrough();
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/).nullable();

export function mapChange(value: unknown): PortalChange {
  const row = ChangeRowSchema.parse(value);
  return { id: row.id, status: row.status, baseVersion: row.baseVersion, files: row.files, summary: row.summary, decisionNote: row.decisionNote,
    resultVersion: row.resultVersion, updatedAt: row.updatedAt, submittedAt: row.submittedAt, decidedAt: row.decidedAt };
}
export function mapAccess(value: unknown): PortalAccess {
  const row = AccessRowSchema.parse(value);
  return { id: row.id, email: row.email, displayName: row.displayName, status: row.status, invitedAt: row.invitedAt, acceptedAt: row.acceptedAt,
    lastSeenAt: row.lastSeenAt, planLabel: row.planLabel, paidThrough: row.paidThrough, inviteExpiresAt: row.inviteExpiresAt };
}
/** The access row's client, so agency routes can confirm a URL's client matches. */
export const accessClientId = (value: unknown) => AccessRowSchema.parse(value).clientId;
const liveUrl = (value: string | null) => value ? siteAddress(value) : null;

export function mapHome(value: unknown): PortalHome {
  const row = z.object({ email: z.string(), grants: z.array(z.object({
    accessId: uuid, agency: PortalBrandSchema, client: z.object({ name: z.string() }),
    sites: z.array(z.object({ artifactId: uuid, title: z.string(), slug, change: z.object({ id: uuid, status: ChangeRowSchema.shape.status, updatedAt: stamp }).nullable() })),
  })) }).parse(value);
  return { email: row.email, grants: row.grants.map(grant => ({ accessId: grant.accessId, agency: grant.agency, client: grant.client,
    sites: grant.sites.map(site => ({ artifactId: site.artifactId, title: site.title, liveUrl: liveUrl(site.slug), change: site.change })) })) };
}

export const SiteRowSchema = z.object({
  site: z.object({ artifactId: uuid, title: z.string(), slug }), agency: PortalBrandSchema, client: z.object({ name: z.string().nullable() }),
  baseVersion: z.number().int().nonnegative(), manifest: z.string().nullable(),
  collections: z.array(z.object({ key: z.string(), path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/), text: z.string() })),
  images: z.array(z.object({ path: z.string(), assetId: uuid })), routes: z.array(z.string()), change: z.unknown(),
});
export type SiteRow = z.infer<typeof SiteRowSchema>;
export const portalImageUrl = (artifactId: string, assetId: string) => `/api/portal/sites/${artifactId}/images/${assetId}`;

export function mapSite(row: SiteRow): PortalSite {
  return {
    site: { artifactId: row.site.artifactId, title: row.site.title, liveUrl: liveUrl(row.site.slug) }, agency: row.agency,
    client: { name: row.client.name ?? "" }, baseVersion: row.baseVersion, manifest: row.manifest ?? "",
    collections: row.collections, images: row.images.map(image => ({ path: image.path, previewUrl: portalImageUrl(row.site.artifactId, image.assetId) })),
    routes: row.routes, change: row.change ? mapChange(row.change) : null,
  };
}

export function mapInvite(value: unknown): PortalInvite {
  return z.object({ status: z.enum(["open", "accepted", "expired", "revoked"]), agency: PortalBrandSchema, client: z.object({ name: z.string() }), maskedEmail: z.string() })
    .parse(value);
}

export function mapOverview(value: unknown): ClientPortalOverview {
  const row = z.object({ access: z.array(z.unknown()), sites: z.array(z.object({ artifactId: uuid, title: z.string(), enabled: z.boolean(),
    collections: z.array(z.string()).nullable(), hasContent: z.boolean(), pending: z.number().int().nonnegative() })) }).parse(value);
  return { available: true, access: row.access.map(mapAccess), sites: row.sites };
}

const parseJson = (text: string | null | undefined): unknown => { try { return text === null || text === undefined ? null : JSON.parse(text); } catch { return null; } };
const collectionKey = (path: string) => path.startsWith(CONTENT_DIR) && path.endsWith(".json") ? path.slice(CONTENT_DIR.length, -".json".length) : "";

export const SettingsRowSchema = z.object({
  clientId: uuid.nullable(), enabled: z.boolean(), collections: z.array(z.string()).nullable(), version: z.number().int().nonnegative(),
  manifest: z.string().nullable(), images: z.array(z.string()), routes: z.array(z.string()),
  pending: z.array(ChangeRowSchema.extend({ authorName: z.string(), authorEmail: z.string(), currentFiles: z.record(z.string(), z.string().nullable()) })),
});
export type SettingsRow = z.infer<typeof SettingsRowSchema>;

/** "Menu: 2 changed, 1 added" for each collection file a change touches (current version vs proposal). */
export function summaryLines(manifestText: string | null, files: Record<string, string>, current: Record<string, string | null>) {
  const parsed = parseManifest(manifestText ?? undefined);
  const lines: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const key = collectionKey(path);
    const collection = parsed.ok && Object.hasOwn(parsed.manifest.collections, key) ? parsed.manifest.collections[key] : null;
    if (!collection || collectionPath(key) !== path) { lines.push(`${path}: changed`); continue; }
    const line = describeChange(collection, parseJson(current[path]), parseJson(text));
    if (line) lines.push(line);
  }
  return lines;
}

export function mapSettings(value: unknown): SitePortalSettings {
  const row = SettingsRowSchema.parse(value);
  const parsed = parseManifest(row.manifest ?? undefined);
  return {
    available: true, clientId: row.clientId, enabled: row.enabled, collections: row.collections,
    declared: parsed.ok ? Object.entries(parsed.manifest.collections).map(([key, collection]) => ({ key, label: collection.label })) : [],
    pending: row.pending.map(change => ({ ...mapChange(change), authorName: change.authorName, authorEmail: change.authorEmail,
      summaryLines: summaryLines(row.manifest, change.files, change.currentFiles) })),
  };
}

export const UNAVAILABLE_OVERVIEW: ClientPortalOverview = { available: false, access: [], sites: [] };
export const UNAVAILABLE_SETTINGS: SitePortalSettings = { available: false, clientId: null, enabled: false, collections: null, declared: [], pending: [] };

/** "Client edit by Ana: Menu (2 changed, 1 added); Opening hours (updated)" — the version summary for an approved change. */
export function approvalSummary(author: string, lines: string[]) {
  const parts = lines.map(line => { const at = line.lastIndexOf(": "); return at > 0 ? `${line.slice(0, at)} (${line.slice(at + 2)})` : line; });
  const text = `Client edit by ${author || "your client"}${parts.length ? `: ${parts.join("; ")}` : ""}`;
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}
