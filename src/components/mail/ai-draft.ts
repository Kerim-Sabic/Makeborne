"use client";
import { readExpertStream } from "../expert-stream";

export type DraftNotes = { niche: string; audience: string; angle: string; confidence: "high" | "medium" | "low" | ""; check: string };

/** Splits "Subject: …" + blank line + body + optional "---NOTES---" block. Tolerates markdown bold, quotes and a missing blank line. */
export function parseEmailDraft(text: string): { subject: string; body: string; notes: DraftNotes | null } {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  const [main, notesText] = clean.split(/\n?-{3}\s*NOTES\s*-{3}\n?/i);
  let notes: DraftNotes | null = null;
  if (notesText !== undefined) {
    const field = (name: string) => new RegExp(`^\\W*${name}\\W*:\\s*(.+)$`, "im").exec(notesText)?.[1]?.replace(/\*+/g, "").trim() ?? "";
    const level = /\b(high|medium|low)\b/i.exec(field("confidence"))?.[1]?.toLowerCase() as DraftNotes["confidence"] | undefined;
    const check = field("check");
    notes = { niche: field("niche"), audience: field("audience"), angle: field("angle"), confidence: level ?? "", check: /^none\.?$/i.test(check) ? "" : check };
  }
  const match = /^\**\s*subject\s*:?\**\s*:?\s*(.+)\n+([\s\S]*)$/i.exec(main.trim());
  if (!match) return { subject: "", body: main.trim(), notes };
  return { subject: match[1].replace(/^["“]|["”]$/g, "").replace(/\*+/g, "").trim().slice(0, 300), body: match[2].trim(), notes };
}

/** While streaming, show only the email part (the notes arrive last). */
export const visibleDraft = (text: string) => text.split(/\n?-{3}\s*NOTES/i)[0];

export type DraftOptions = { goal: string; tone: "warm" | "direct" | "formal"; mode: "standard" | "genius"; senderName: string; campaign?: "audience_value" | "website" | "redesign" | "custom"; research?: boolean };

/** One personalised email for one client: the server reads their linked public pages, then Rex (Haiku) writes from record + research. */
export async function generateEmailDraft(input: { accountId: string; workspaceId: string; clientId: string; options: DraftOptions; signal: AbortSignal; onText?: (text: string) => void }) {
  const { mode: _mode, ...options } = input.options;
  void _mode;
  const result = await readExpertStream(`/api/cloud/workspaces/${input.workspaceId}/clients/${input.clientId}/follow-up-draft`,
    { ...options, mode: "standard", format: "email", campaign: options.campaign ?? "custom", research: options.research ?? true },
    { signal: input.signal, headers: { "X-Makeborne-Account": input.accountId }, onText: text => input.onText?.(visibleDraft(text)) });
  return { ...result, ...parseEmailDraft(result.text) };
}
