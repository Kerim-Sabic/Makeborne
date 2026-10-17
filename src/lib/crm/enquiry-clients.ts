/** Turning a website enquiry into a CRM lead. Pure and deterministic: the same
 * enquiry always yields the same request key and activity id, so retries never
 * create a second client or a second activity entry. */
import { createHash } from "node:crypto";
import { ClientOutreachSchema, emptyOutreach, type ClientOutreach } from "@/lib/client-outreach";

export type SiteEnquiry = { id: string; name: string; email: string; message: string; created_at: string; artifact_id?: string };

/** A UUID derived from a namespace and a value (name-based, like UUID v5 but SHA-256). */
export function derivedUuid(namespace: string, value: string) {
  const hex = createHash("sha256").update(`${namespace}\u0000${value}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const enquiryRequestKey = (enquiryId: string) => derivedUuid("makeborne.enquiry.client", enquiryId);
export const enquiryActivityId = (enquiryId: string) => derivedUuid("makeborne.enquiry.activity", enquiryId);
export const normalEmail = (email: string) => email.trim().toLowerCase();

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Fields for makeborne_create_record('create_client'). */
export function enquiryClientFields(enquiry: SiteEnquiry, siteTitle: string) {
  const name = clip(enquiry.name.replace(/\s+/g, " ").trim(), 120) || normalEmail(enquiry.email);
  const notes = `Website enquiry via ${clip(siteTitle || "your website", 160)} on ${day(enquiry.created_at)}:\n\n${enquiry.message.trim()}`;
  return { name, email: normalEmail(enquiry.email), company: "", website: "", notes: clip(notes, 10_000) };
}

/** Outreach for a new lead: channel Email, follow up today, the enquiry as a note. */
export function enquiryOutreach(enquiry: SiteEnquiry, siteTitle: string, today: string, previous?: ClientOutreach): ClientOutreach {
  const base = previous ? ClientOutreachSchema.parse(previous) : { ...emptyOutreach(), channel: "Email" as const };
  const activityId = enquiryActivityId(enquiry.id);
  if (base.activity.some(item => item.id === activityId) || base.activity.length >= 300) return base;
  const text = clip(`Website enquiry via ${siteTitle || "your website"}: “${enquiry.message.replace(/\s+/g, " ").trim()}”`, 2000);
  const nextFollowUp = !base.nextFollowUp || base.nextFollowUp > today ? today : base.nextFollowUp;
  return ClientOutreachSchema.parse({
    ...base, nextFollowUp: ["Won", "Lost"].includes(base.stage) ? base.nextFollowUp : nextFollowUp,
    activity: [...base.activity, { id: activityId, at: new Date(enquiry.created_at).toISOString(), text, type: "note" }],
  });
}

/** Existing clients by normalised email (first match wins, like the directory). */
export function clientsByEmail(rows: readonly { id: string; email: string | null }[]) {
  const map = new Map<string, string>();
  for (const row of rows) { const email = row.email ? normalEmail(row.email) : ""; if (email && !map.has(email)) map.set(email, row.id); }
  return map;
}
