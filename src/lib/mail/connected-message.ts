import type { MailOverview } from "@/components/mail/mail-api";

/**
 * What to say after a mailbox connection returns (audit capability states).
 * The connection is acknowledged first; capabilities are described only once
 * the overview confirms them for that mailbox, and background sending is only
 * promised when the schedule is actually enabled. Client-safe.
 */
export function connectedMessage(email: string, overview: MailOverview | null, loadFailed: boolean): string {
  const connected = `Connected ${email}.`;
  if (!overview) return loadFailed ? `${connected} We couldn't confirm what it can do yet.` : `${connected} Checking what it can do…`;
  const matches = overview.accounts.filter(account => account.mine && account.status !== "disconnected" && account.email.toLowerCase() === email.trim().toLowerCase());
  const account = matches.find(item => item.status === "active") ?? matches[0];
  if (!account) return connected;
  if (account.status !== "active" || !account.canSend) return `${connected} It needs reconnecting before it can send.`;
  const inbox = account.provider === "google" ? "Gmail" : "Outlook";
  if (!account.canTrackReplies) return `${connected} You can send reviewed emails; read replies in ${inbox} and update client stages yourself.`;
  if (!account.canAutomate) return `${connected} You can send reviewed emails and replies are tracked; follow-up sequences are unavailable for this mailbox.`;
  return overview.automation
    ? `${connected} You can send reviewed emails, track replies and run follow-up sequences.`
    : `${connected} You can send reviewed emails, track replies and run follow-up sequences. Until automatic sending is enabled, due follow-ups go out when you press Check now.`;
}
