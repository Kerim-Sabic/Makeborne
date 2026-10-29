/**
 * Account data rights: shared contract and customer copy (client-safe, no imports).
 * The server and the Settings section both read from here so the copy and the
 * behaviour cannot drift. No provider or model names appear in customer copy.
 */

/** Owner decision: days between asking and the deletion starting. The database clamps it to 1–30. */
export const ACCOUNT_DELETION_GRACE_DAYS = 7;
/** A deletion needs a sign-in this recent (seconds). */
export const DELETION_REAUTH_SECONDS = 10 * 60;
/** Prepared export files are kept this long, then removed (hours). */
export const EXPORT_RETENTION_HOURS = 72;
/** Each download link works for this long (seconds) and is made on click. */
export const EXPORT_LINK_SECONDS = 120;
/** Files are split into parts no larger than this, under the bucket's 50 MB object limit. */
export const EXPORT_PART_BYTES = 45 * 1024 * 1024;
/** Uploaded files above this total are listed in the manifest but not copied (owner can raise it). */
export const EXPORT_FILE_BUDGET_BYTES = 900 * 1024 * 1024;
export const SUPPORT_EMAIL = "admin@makeborne.com";

export type ExportState = "queued" | "building" | "ready" | "failed" | "expired";
export type DeletionState = "scheduled" | "processing" | "blocked";
export type BlockerCode = "ACTIVE_SUBSCRIPTION" | "SHARED_WORKSPACE" | "AUTO_TOPUP_ON" | "REFUND_IN_PROGRESS" | "ACCOUNT_HOLD" | "SHARED_CONTRIBUTIONS" | "MANUAL_REVIEW" | "BLOCKED";

export type AccountExportSummary = {
  id: string; state: ExportState; requestedAt: string; completedAt: string | null; expiresAt: string | null;
  failureCode: string | null; parts: { part: number; bytes: number }[];
};
export type AccountDeletionSummary = {
  id: string; state: DeletionState; requestedAt: string; scheduledFor: string; blockedCodes: BlockerCode[]; started: boolean; cancellable: boolean;
};
export type AccountDataWarnings = {
  liveSites: number; customDomains: number; credits: number; portalClients: number; otherWorkspaces: number; mailboxes: number; github: boolean;
};
export type AccountDataStatus = {
  exportEnabled: boolean; deletionEnabled: boolean; graceDays: number; email: string | null;
  exports: AccountExportSummary[]; nextExportAt: string | null; deletion: AccountDeletionSummary | null;
  blockers: BlockerCode[]; warnings: AccountDataWarnings | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}T/;
const iso = (value: unknown) => typeof value === "string" && ISO.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : 0;
const EXPORT_STATES: ExportState[] = ["queued", "building", "ready", "failed", "expired"];
const DELETION_STATES: DeletionState[] = ["scheduled", "processing", "blocked"];
const BLOCKERS: BlockerCode[] = ["ACTIVE_SUBSCRIPTION", "SHARED_WORKSPACE", "AUTO_TOPUP_ON", "REFUND_IN_PROGRESS", "ACCOUNT_HOLD", "SHARED_CONTRIBUTIONS", "MANUAL_REVIEW", "BLOCKED"];
const blockerList = (value: unknown): BlockerCode[] => Array.isArray(value) ? value.filter((code): code is BlockerCode => BLOCKERS.includes(code as BlockerCode)) : [];

/** Parse the database status (makeborne_account_rights_status) into the browser contract; unknown shapes fail closed. */
export function accountDataStatus(raw: unknown, options: { exportEnabled: boolean; deletionEnabled: boolean; email: string | null; graceDays?: number }): AccountDataStatus {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const checks = (value.checks && typeof value.checks === "object" ? value.checks : {}) as Record<string, unknown>;
  const warnings = checks.warnings && typeof checks.warnings === "object" ? checks.warnings as Record<string, unknown> : null;
  const exportRows = Array.isArray(value.exports) ? value.exports.flatMap((row): AccountExportSummary[] => {
    const item = row as Record<string, unknown>;
    const id = uuid(item.id), requestedAt = iso(item.requestedAt);
    if (!id || !requestedAt || !EXPORT_STATES.includes(item.state as ExportState)) return [];
    const parts = Array.isArray(item.parts) ? item.parts.flatMap(part => {
      const p = part as Record<string, unknown>;
      return Number.isSafeInteger(p.part) && (p.part as number) > 0 ? [{ part: p.part as number, bytes: count(p.bytes) }] : [];
    }) : [];
    return [{ id, state: item.state as ExportState, requestedAt, completedAt: iso(item.completedAt), expiresAt: iso(item.expiresAt),
      failureCode: typeof item.failureCode === "string" ? item.failureCode : null, parts }];
  }) : [];
  const d = value.deletion && typeof value.deletion === "object" ? value.deletion as Record<string, unknown> : null;
  const deletionId = d ? uuid(d.id) : null, requestedAt = d ? iso(d.requestedAt) : null, scheduledFor = d ? iso(d.scheduledFor) : null;
  const deletion = d && deletionId && requestedAt && scheduledFor && DELETION_STATES.includes(d.state as DeletionState)
    ? { id: deletionId, state: d.state as DeletionState, requestedAt, scheduledFor, blockedCodes: blockerList(d.blockedCodes), started: d.started === true, cancellable: d.cancellable === true }
    : null;
  return {
    exportEnabled: options.exportEnabled, deletionEnabled: options.deletionEnabled, graceDays: options.graceDays ?? ACCOUNT_DELETION_GRACE_DAYS, email: options.email,
    exports: exportRows, nextExportAt: iso(value.nextExportAt), deletion, blockers: blockerList(checks.blockers),
    warnings: warnings ? { liveSites: count(warnings.liveSites), customDomains: count(warnings.customDomains), credits: count(warnings.credits),
      portalClients: count(warnings.portalClients), otherWorkspaces: count(warnings.otherWorkspaces), mailboxes: count(warnings.mailboxes), github: warnings.github === true } : null,
  };
}

/** Typed confirmation: the account email, ignoring case and surrounding spaces. */
export function confirmationMatches(typed: string, email: string | null | undefined) {
  return Boolean(email) && typed.trim().toLowerCase() === email!.trim().toLowerCase();
}

/** What each blocker means and what to do. Links are relative app paths or support mail. */
export const BLOCKER_COPY: Readonly<Record<BlockerCode, { title: string; action: string; href?: string; label?: string }>> = Object.freeze({
  ACTIVE_SUBSCRIPTION: { title: "Your subscription is still active.", action: "Cancel it first so you aren't charged again. Cancelling keeps access until the end of the period you paid for; come back here once it shows as cancelled.", href: "/billing#receipts", label: "Manage subscription" },
  SHARED_WORKSPACE: { title: "Other people work in your workspace.", action: `Your workspace has other members. Email ${SUPPORT_EMAIL} so we can transfer the workspace or remove the members before your account is deleted.`, href: `mailto:${SUPPORT_EMAIL}?subject=Transfer%20my%20Makeborne%20workspace`, label: "Email support" },
  SHARED_CONTRIBUTIONS: { title: "You have saved work in someone else's workspace.", action: `Saved versions you made there belong to that workspace. Email ${SUPPORT_EMAIL} and we'll hand them to the workspace owner first.`, href: `mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20Makeborne%20account`, label: "Email support" },
  AUTO_TOPUP_ON: { title: "Automatic top-ups are on.", action: "Turn off automatic top-ups so no new charge can start.", href: "/billing#credits", label: "Credit settings" },
  REFUND_IN_PROGRESS: { title: "A refund is still being processed.", action: "We'll finish it first. You can ask again once it's done, or email support to check on it.", href: `mailto:${SUPPORT_EMAIL}?subject=Refund%20and%20account%20deletion`, label: "Email support" },
  ACCOUNT_HOLD: { title: "Your account is on hold.", action: `We're required to keep this account for now. Email ${SUPPORT_EMAIL} for details.`, href: `mailto:${SUPPORT_EMAIL}?subject=Account%20hold`, label: "Email support" },
  MANUAL_REVIEW: { title: "Your deletion needs our team to finish.", action: `Some records still need a person to resolve them. Your data is no longer available in the app. Email ${SUPPORT_EMAIL} if you have questions; we'll complete it.` },
  BLOCKED: { title: "Deletion is paused.", action: `Something changed since you asked. Review the items below, or email ${SUPPORT_EMAIL}.` },
});

/** Exactly what deletion does. Shown before confirming and mirrored in the data map document. */
export const DELETION_EXPLAINED = Object.freeze({
  deleted: [
    "Your sign-in and profile, and your sign-in sessions on every device.",
    "Workspaces you own, with their projects, saved versions, uploaded files, styles and brand kits.",
    "Your clients, contacts, notes, follow-ups, review links and client comments, and client portal logins.",
    "Websites you published: they go offline and their addresses and connected domains are released.",
    "Your project chat history, connected mailboxes (with their saved emails) and your code-hosting connection.",
    "Any data export you prepared.",
  ],
  retained: [
    "Payment, refund, subscription and credit records, kept for tax and accounting law (currently up to 10 years). Your account id in them is replaced by a random reference, so they are no longer linked to a sign-in.",
    "Records of consent you gave for automatic top-ups, kept as proof for the same period.",
    "Cost and usage totals for work you ran, without its content, for accounting.",
    "Anything we are legally required to keep, such as during a dispute or a legal hold.",
    "Copies outside Makeborne: pages visitors or search engines saved, and emails already delivered.",
  ],
  shared: "If you're a member of someone else's workspace, you're removed from it. What you created there stays with that workspace's owner.",
  credits: "Unused credits can't be refunded or moved and are lost when the account is deleted.",
});

/** Plain-language reasons for an export that didn't finish. */
export function exportFailureMessage(code: string | null) {
  if (code === "ATTEMPTS_EXHAUSTED" || code === "EXPORT_TIMEOUT") return "It took too long to prepare. Try again; if it keeps happening, email support and we'll send it another way.";
  return "Something went wrong while preparing it. Nothing was changed in your account. Try again.";
}
