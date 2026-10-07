import { z } from "zod";
import { WebsiteDesignSchema } from "./website-contract";
export const PilotBriefSchema = z.object({
  attemptId: z.string().uuid(), kind: z.enum(["website", "book", "presentation"]),
  brief: z.string().trim().min(3).max(12000), audience: z.string().max(1000).optional(),
  purpose: z.string().max(2000).optional(), styleId: z.string().max(120),
  content: z.string().max(20000).optional(), mode: z.enum(["preserve", "improve", "summarise"]).optional(),
}).strict();
export const PilotDraftSchema = z.object({
 title: z.string().min(1).max(160),
 blocks: z.array(z.object({type:z.enum(["heading","paragraph","quote"]),text:z.string().min(1).max(6000)}).strict()).min(2).max(60),
}).strict();

export const PilotWebsiteSchema = PilotDraftSchema.extend({
 blocks:z.array(z.object({type:z.enum(["heading","paragraph","quote"]),text:z.string().min(1).max(150)}).strict()).length(2),
 website:WebsiteDesignSchema.extend({html:z.string().min(100).max(12000),css:z.string().min(100).max(9000),designNotes:z.string().min(1).max(400)}),
});
