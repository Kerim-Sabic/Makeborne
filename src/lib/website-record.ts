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
