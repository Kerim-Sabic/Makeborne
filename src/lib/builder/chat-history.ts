import { z } from "zod";
export const ChatMessageSchema = z.object({ id: z.string().uuid(), role: z.enum(["user", "assistant"]), text: z.string().min(1).max(8000) }).strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export const ChatPageSchema = z.object({ messages: z.array(ChatMessageSchema).max(50), next: z.string().regex(/^[1-9][0-9]{0,18}$/).nullable() });
export const ChatAppendSchema = z.object({ messages: z.array(ChatMessageSchema).min(1).max(10) }).strict();
export function mergeChat(previous: ChatMessage[], incoming: ChatMessage[]) {
  const messages = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming) messages.set(item.id, item);
  return [...messages.values()];
}
