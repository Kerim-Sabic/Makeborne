import { z } from "zod";

/** Tokens a template or sequence step can use. Unknown tokens are left visible and reported, never sent silently. */
export const MAIL_TOKENS = ["first_name", "name", "company", "website", "sender_name", "sender_first_name"] as const;
export type MailVariables = Record<typeof MAIL_TOKENS[number], string>;

/** Best-effort first name: the first word of the client's name, otherwise empty. */
export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "") ?? "";

export function mailVariables(client: { name: string; company?: string; website?: string }, sender: { name: string }): MailVariables {
  return {
    first_name: firstNameOf(client.name), name: client.name.trim(), company: client.company?.trim() ?? "", website: client.website?.trim() ?? "",
    sender_name: sender.name.trim(), sender_first_name: firstNameOf(sender.name),
  };
}

/** Fills {{token}} and {{token|fallback}}. Returns the text and any tokens that had no value and no fallback. */
export function renderTemplate(text: string, variables: MailVariables) {
  const missing = new Set<string>();
  const output = text.replace(/\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi, (whole, raw: string, fallback?: string) => {
    const key = raw.toLowerCase() as keyof MailVariables;
    if (!(MAIL_TOKENS as readonly string[]).includes(key)) { missing.add(raw); return whole; }
    const value = variables[key];
    if (value) return value;
    if (fallback !== undefined) return fallback;
    missing.add(key); return whole;
  });
  return { text: output, missing: [...missing] };
}

export const SequenceStepSchema = z.object({
  delayDays: z.number().int().min(0).max(60),
  /** Empty subject on a later step: sent as a reply in the same thread. */
  subject: z.string().trim().max(300),
  body: z.string().trim().min(1).max(20000),
}).strict();
export const SequenceStepsSchema = z.array(SequenceStepSchema).min(1).max(8).superRefine((steps, ctx) => {
  if (!steps[0].subject) ctx.addIssue({ code: "custom", path: [0, "subject"], message: "The first email needs a subject." });
  if (steps.slice(1).some(step => step.delayDays < 1)) ctx.addIssue({ code: "custom", message: "Follow-up emails must wait at least one day." });
});
export type SequenceStep = z.infer<typeof SequenceStepSchema>;

/** RFC 2047 encoded-word for non-ASCII header values. */
function header(value: string) {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}
const address = (email: string, name?: string) => {
  if (!/^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(email)) throw new Error("Invalid email address.");
  return name?.trim() ? `${header(name.replace(/"/g, ""))} <${email}>` : email;
};

/** A plain-text email as RFC 5322 bytes, base64url-encoded for the Gmail API. Plain text reads as a personal message. */
export function buildMime(message: { from: string; fromName?: string; to: string; toName?: string; subject: string; text: string; inReplyTo?: string | null; references?: string | null }) {
  const lines = [
    `From: ${address(message.from, message.fromName)}`,
    `To: ${address(message.to, message.toName)}`,
    `Subject: ${header(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    ...(message.inReplyTo ? [`In-Reply-To: ${message.inReplyTo}`, `References: ${[message.references, message.inReplyTo].filter(Boolean).join(" ")}`] : []),
  ];
  const body = Buffer.from(message.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
}

export const replySubject = (subject: string) => /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
