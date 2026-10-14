import { z } from "zod";
import { websiteHref } from "./website-record";
/** Sales pipeline for a client. Delivery of the work is tracked per project
 * (see ./project-delivery): one client can have several projects at different
 * delivery stages, so it is not part of the client's stage. */
export const outreachStages = ["Lead", "Contacted", "Conversation", "Proposal", "Won", "Lost"] as const;
export type OutreachStage = typeof outreachStages[number];
export const closedOutreachStages: readonly string[] = ["Won", "Lost"];
/** Stages used before the sales/delivery split and what they mean now. Stored
 * legacy stages are read through this mapping; the database rewrites them the
 * same way (audited) in the post-deploy contract step, see
 * docs/CRM_STAGE_TRANSITION.md. This app never writes a legacy stage. */
export const LEGACY_OUTREACH_STAGES: Readonly<Record<string, OutreachStage>> = {
  Replied: "Conversation", Meeting: "Conversation",
  // Delivery moved to the project; the sale itself was won.
  Review: "Won", Delivered: "Won",
};
export const normalizeOutreachStage = (stage: unknown): unknown =>
  typeof stage === "string" && Object.hasOwn(LEGACY_OUTREACH_STAGES, stage) ? LEGACY_OUTREACH_STAGES[stage] : stage;
export const outreachChannels = ["Not set", "Email", "Instagram", "LinkedIn", "Phone", "Other"] as const;
const day = z.iso.date().nullable();
export const OutreachActivitySchema = z.object({ id: z.string().uuid(), at: z.string().datetime(), text: z.string().trim().min(1).max(2000), type: z.enum(["update", "contact", "note"]) }).strict();
export const ClientOutreachSchema = z.object({
  stage: z.preprocess(normalizeOutreachStage, z.enum(outreachStages)), channel: z.enum(outreachChannels),
  profileUrl: z.string().trim().max(2000).refine(value => !value || websiteHref(value) !== null, "Use an HTTP or HTTPS profile link without embedded credentials."),
  lastContact: day, nextFollowUp: day, notes: z.string().max(5000),
  activity: z.array(OutreachActivitySchema).max(300).refine(items => new Set(items.map(item => item.id)).size === items.length, "Activity IDs must be unique."),
}).strict();
export type ClientOutreach = z.infer<typeof ClientOutreachSchema>;
export const emptyOutreach = (): ClientOutreach => ({ stage: "Lead", channel: "Not set", profileUrl: "", lastContact: null, nextFollowUp: null, notes: "", activity: [] });
export function followUpDue(outreach: ClientOutreach | undefined, day: string) { return !!outreach?.nextFollowUp && !closedOutreachStages.includes(outreach.stage) && outreach.nextFollowUp <= day; }
export function saveOutreach(previous: ClientOutreach | undefined, raw: unknown, entry: { id: string; at: string; text?: string; type?: "update" | "contact" | "note" }) {
  const prior = previous ? ClientOutreachSchema.parse(previous) : emptyOutreach();
  const next = ClientOutreachSchema.parse(raw);
  const keys = ["stage", "channel", "profileUrl", "lastContact", "nextFollowUp", "notes"] as const;
  const changed = keys.filter(key => prior[key] !== next[key]);
  const note = entry.text?.trim();
  if (!changed.length && !note) return prior;
  if (prior.activity.length >= 300) throw new Error("This client has 300 outreach updates. Existing history is preserved; no changes were saved.");
  const text = note || changed.map(key => key === "stage" ? `Stage: ${prior.stage} → ${next.stage}` : ({ channel: "Channel updated", profileUrl: "Profile link updated", lastContact: "Last contact updated", nextFollowUp: "Follow-up date updated", notes: "Outreach notes updated" }[key])).join(" · ");
  return ClientOutreachSchema.parse({ ...next, activity: [...prior.activity, { id: entry.id, at: entry.at, text, type: entry.type ?? "update" }] });
}
