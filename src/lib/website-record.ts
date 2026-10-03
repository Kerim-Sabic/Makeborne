import { z } from "zod";

export function websiteHref(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const link = z.string().trim().max(2000).refine(value => !value || websiteHref(value) !== null, "Use a complete HTTP or HTTPS link without a username or password.");
export const WebsiteRecordSchema = z.object({
  previewUrl: link,
  liveUrl: link,
  hosting: z.string().trim().max(200),
  notes: z.string().trim().max(5000),
  updatedAt: z.string().datetime(),
}).strict();
export type WebsiteRecord = z.infer<typeof WebsiteRecordSchema>;
export const WebsiteHistorySchema = z.array(z.object({
  id: z.string().uuid(), record: WebsiteRecordSchema,
  replacedAt: z.string().datetime(),
}).strict()).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length, "Website history IDs must be unique.");
export type WebsiteHistory = z.infer<typeof WebsiteHistorySchema>;

export function reviseWebsiteRecord(current: WebsiteRecord | undefined, history: WebsiteHistory, input: WebsiteRecord, id: string, at: string) {
  const previous = current ? WebsiteRecordSchema.parse(current) : undefined;
  const revisions = WebsiteHistorySchema.parse(history);
  const record = WebsiteRecordSchema.parse({ ...input, updatedAt: at });
  const fields = ["previewUrl", "liveUrl", "hosting", "notes"] as const;
  if (previous && fields.every(field => previous[field] === record[field]))
    return { record: previous, history: revisions, changed: false };
  if (previous && revisions.length >= 100) throw new Error("Website history has reached 100 revisions. These changes have not been saved; existing history is preserved.");
  return { record, history: WebsiteHistorySchema.parse(previous ? [...revisions, { id, record: previous, replacedAt: at }] : revisions), changed: true };
}
