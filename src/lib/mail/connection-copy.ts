import type { MailAccount, MailboxSequenceUse } from "@/components/mail/mail-api";

/**
 * What a mailbox's connection card says about where the mailbox is used, when it last sent,
 * how to stop its automatic emails and what disconnecting does (audit: connection clarity).
 * Disconnect deletes Makeborne's stored tokens and pauses running enrollments on the server
 * (api/cloud/workspaces/[workspaceId]/mail/accounts DELETE); the provider grant itself stays
 * until the person removes it at Google or Microsoft. Client-safe.
 */
export const PROVIDER_PERMISSION_PAGES = Object.freeze({
  google: "https://myaccount.google.com/connections",
  microsoftPersonal: "https://account.live.com/consent/Manage",
  microsoftWork: "https://myapps.microsoft.com",
});

const providerName = (account: Pick<MailAccount, "provider">) => account.provider === "google" ? "Google" : "Microsoft";
export const runningOn = (account: Pick<MailAccount, "sequences">) => (account.sequences ?? []).reduce((sum, use) => sum + use.active, 0);
export const sequenceUseCounts = (use: MailboxSequenceUse) => [use.active && `${use.active} running`, use.paused && `${use.paused} paused`].filter(Boolean).join(", ");

export function mailboxUse(account: Pick<MailAccount, "status" | "lastSentAt" | "sequences">) {
  if (account.status === "disconnected") return null;
  const running = runningOn(account);
  return {
    lastSentAt: account.lastSentAt ?? null,
    sequences: account.sequences ?? [],
    unused: "No sequence uses it. It sends only the emails you send from a client.",
    stop: running > 0 ? "To stop its automatic emails, pause or stop those clients under Sequences → Clients, or disconnect this mailbox: that pauses all of them and nothing queued is sent." : null,
  };
}

export function disconnectQuestion(account: Pick<MailAccount, "email" | "provider" | "sequences">) {
  const running = runningOn(account);
  return `Disconnect ${account.email}? Makeborne deletes its stored access to this mailbox${running ? ` and pauses ${running} running sequence client${running === 1 ? "" : "s"}` : ""}. Nothing queued is sent, and sent history is kept. ${providerName(account)} keeps listing Makeborne until you remove it in your ${providerName(account)} account.`;
}

export const disconnectedMessage = (account: Pick<MailAccount, "provider">) =>
  `Mailbox disconnected. Nothing queued will be sent and sent history is kept. ${providerName(account)} still lists Makeborne until you remove it there (links below).`;
