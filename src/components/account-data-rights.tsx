"use client";
import "@/app/account-data.css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import StorageLabel from "./storage-label";
import { SETTINGS_STORAGE } from "@/lib/settings-storage";
import { BLOCKER_COPY, DELETION_EXPLAINED, SUPPORT_EMAIL, confirmationMatches, exportFailureMessage, type AccountDataStatus, type AccountExportSummary, type BlockerCode } from "@/lib/account-rights/contracts";
import { createClient } from "@/lib/supabase/client";
import { clearAccountLocalData } from "@/lib/account-local-data";

type Load = { state: "loading" } | { state: "signed-out" } | { state: "error" } | { state: "ready"; data: AccountDataStatus };
const SETTINGS_NEXT = "/login?next=%2Fstudio%3Ftab%3Dsettings";
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" });
const size = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

async function fetchStatus(accountId: string | null | undefined, signal?: AbortSignal): Promise<Load> {
  try {
    const response = await fetch("/api/account/data", { cache: "no-store", signal, headers: accountId ? { "X-Makeborne-Account": accountId } : {} });
    if (response.status === 401) return { state: "signed-out" };
    if (!response.ok) return { state: "error" };
    return { state: "ready", data: await response.json() as AccountDataStatus };
  } catch { return { state: "error" }; }
}

/** Read the account's data-rights status. The account header stops a stale tab acting for another account. */
export function useAccountData(accountId: string | null | undefined) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const refresh = useCallback(async () => { setLoad(await fetchStatus(accountId)); }, [accountId]);
  useEffect(() => {
    const abort = new AbortController();
    void fetchStatus(accountId, abort.signal).then(next => { if (!abort.signal.aborted) setLoad(next); });
    return () => abort.abort();
  }, [accountId]);
  return { load, refresh };
}

async function send(path: string, init: RequestInit, accountId: string | null | undefined) {
  const response = await fetch(path, { ...init, cache: "no-store", headers: { ...(init.headers ?? {}), ...(accountId ? { "X-Makeborne-Account": accountId } : {}) } });
  const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string }; blockers?: BlockerCode[] } | null;
  return { ok: response.ok, status: response.status, code: body?.error?.code, message: body?.error?.message, blockers: body?.blockers };
}

function Blockers({ codes }: { codes: BlockerCode[] }) {
  if (!codes.length) return null;
  return <ul className="data-blockers" aria-label="Before your account can be deleted">{codes.map(code => {
    const copy = BLOCKER_COPY[code];
    return <li key={code}><AlertTriangle size={15} aria-hidden="true" /><div><strong>{copy.title}</strong> {copy.action}
      {copy.href && <> {copy.href.startsWith("mailto:") ? <a className="text-link" href={copy.href}>{copy.label}</a> : <Link className="text-link" href={copy.href}>{copy.label}</Link>}</>}</div></li>;
  })}</ul>;
}

function ExportRow({ item }: { item: AccountExportSummary }) {
  const label = item.state === "ready" && item.expiresAt ? `Ready · available until ${when(item.expiresAt)}`
    : item.state === "queued" || item.state === "building" ? "Preparing… you can leave this page; it keeps going."
    : item.state === "expired" ? "Expired. The files were removed."
    : `Couldn't finish. ${exportFailureMessage(item.failureCode)}`;
  return <li className={`data-export is-${item.state}`}>
    <div><strong>Requested {when(item.requestedAt)}</strong><span>{label}</span></div>
    {item.state === "ready" && <div className="data-export-parts">{item.parts.map(part =>
      <a key={part.part} className="button secondary small" href={`/api/account/data/export/${item.id}/parts/${part.part}`} rel="noreferrer">
        <Download size={14} aria-hidden="true" />{item.parts.length > 1 ? `Part ${part.part} of ${item.parts.length}` : "Download"} ({size(part.bytes)})</a>)}</div>}
  </li>;
}

/** Settings › Your data: a copy of everything, and account deletion with a grace period. */
export default function AccountDataRights({ accountId }: { accountId: string | null | undefined }) {
  const { load, refresh } = useAccountData(accountId);
  const router = useRouter();
  const [busy, setBusy] = useState<"export" | "delete" | "cancel" | null>(null);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [refused, setRefused] = useState<BlockerCode[]>([]);
  const confirmInput = useRef<HTMLInputElement>(null);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const deletionKey = useRef<string | null>(null);
  const ids = { confirm: useId(), understood: useId() };

  const data = load.state === "ready" ? load.data : null;
  const preparing = data?.exports.some(item => item.state === "queued" || item.state === "building") ?? false;
  // Poll while an export is being prepared (every 4 s, for at most 6 minutes).
  useEffect(() => {
    if (!preparing) return;
    let ticks = 0;
    const timer = setInterval(() => { ticks++; if (ticks > 90) clearInterval(timer); else void refresh(); }, 4000);
    return () => clearInterval(timer);
  }, [preparing, refresh]);
  useEffect(() => { if (confirming) confirmInput.current?.focus(); }, [confirming]);

  async function prepareExport() {
    setBusy("export"); setMessage("");
    const result = await send("/api/account/data/export", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }, accountId).catch(() => null);
    if (!result) setMessage("Your export couldn't be requested. Check your connection and try again.");
    else if (!result.ok) setMessage(result.message ?? "Your export couldn't be requested. Try again.");
    else setMessage("We're preparing your data. This usually takes a few minutes; it will appear below with a download button.");
    await refresh(); setBusy(null);
  }

  async function scheduleDeletion(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !confirmationMatches(typed, data.email) || !understood) return;
    setBusy("delete"); setMessage(""); setReauth(false); setRefused([]);
    deletionKey.current ??= crypto.randomUUID();
    const result = await send("/api/account/data/deletion", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": deletionKey.current },
      body: JSON.stringify({ confirmation: typed, understood: true }) }, accountId).catch(() => null);
    setBusy(null);
    if (!result) { setMessage("Your request couldn't be sent. Nothing was changed. Try again."); return; }
    if (result.code === "REAUTH_REQUIRED") { setReauth(true); return; }
    if (result.code === "DELETION_BLOCKED") { setRefused(result.blockers ?? []); deletionKey.current = null; return; }
    if (!result.ok) { if (result.code === "REQUEST_KEY_USED") deletionKey.current = null; setMessage(result.message ?? "Your request couldn't be completed. Nothing was changed."); return; }
    deletionKey.current = null; setConfirming(false); setTyped(""); setUnderstood(false);
    await refresh();
    statusHeading.current?.focus();
  }

  async function cancelDeletion() {
    setBusy("cancel"); setMessage("");
    const result = await send("/api/account/data/deletion", { method: "DELETE" }, accountId).catch(() => null);
    setBusy(null);
    setMessage(!result ? "Cancelling didn't go through. Check your connection and try again." : result.ok ? "Deletion cancelled. Your account stays as it is." : result.message ?? "Cancelling didn't go through. Try again.");
    await refresh();
  }

  async function signInAgain() {
    try {
      const client = createClient();
      const { data: session } = await client.auth.getSession();
      await client.auth.signOut({ scope: "local" });
      clearAccountLocalData(session.session?.user.id);
    } finally { router.push(SETTINGS_NEXT); router.refresh(); }
  }

  const heading = <h2>Your data <StorageLabel where={SETTINGS_STORAGE.yourData} /></h2>;
  if (load.state === "loading") return <section className="data-rights" aria-busy="true">{heading}<p role="status">Checking your account data…</p></section>;
  if (load.state === "signed-out") return <section className="data-rights">{heading}<p>Sign in to download a copy of your account data or delete your account. Drafts on this device are covered by the backup above.</p><Link className="text-link" href={SETTINGS_NEXT}>Sign in</Link></section>;
  if (load.state === "error" || !data) return <section className="data-rights">{heading}<p role="status">Your data settings couldn&rsquo;t load. Nothing was changed.</p><button type="button" className="button secondary small" onClick={() => void refresh()}>Try again</button></section>;

  const deletion = data.deletion;
  // The server only reports a next time while the one-a-day limit applies.
  const nextExport = data.nextExportAt;
  const warnings = data.warnings;
  const canSubmit = confirmationMatches(typed, data.email) && understood && busy === null;

  return <section className="data-rights">
    {heading}
    <div className="data-rights-block">
      <h3>Download a copy of your data</h3>
      {data.exportEnabled ? <>
        <p>A ZIP with everything saved to your account: profile, workspaces you own, clients, notes and follow-ups, projects and every saved version, your uploaded files, client reviews and comments, published websites, emails saved in your workspaces, your project chat history, plans, payments, credits and usage, and the consents you gave. Records are JSON, with spreadsheets for the tabular parts. Sign-in keys and other people&rsquo;s private data are never included.</p>
        <p>You can prepare one export a day. Each download link is made when you click it, and the files are removed three days after they&rsquo;re ready.</p>
        <button type="button" className="button secondary" disabled={busy !== null || preparing || Boolean(nextExport)} onClick={() => void prepareExport()}>
          <Download size={16} aria-hidden="true" />{busy === "export" ? "Requesting…" : preparing ? "Preparing your data…" : "Prepare my data"}</button>
        {nextExport && !preparing && <p className="small-note">You can prepare another export after {when(nextExport)}.</p>}
        {data.exports.length > 0 && <ul className="data-exports" aria-label="Your exports">{data.exports.map(item => <ExportRow key={item.id} item={item} />)}</ul>}
      </> : <p>To get a copy of your account data, email <a className="text-link" href={`mailto:${SUPPORT_EMAIL}?subject=Copy%20of%20my%20Makeborne%20data`}>{SUPPORT_EMAIL}</a> from the address you sign in with. We reply within one month.</p>}
    </div>

    <div className="data-rights-block data-delete">
      <h3 ref={statusHeading} tabIndex={-1}>Delete your account</h3>
      {deletion ? <div className={`data-deletion is-${deletion.state}`} role="status">
        {deletion.state === "scheduled" && <><p><strong>Your account is scheduled for deletion on {day(deletion.scheduledFor)}.</strong> Until then everything works as usual and you can still download your data. Cancel any time before it starts.</p></>}
        {deletion.state === "processing" && <p><strong>Your account is being deleted.</strong> This can&rsquo;t be cancelled now. You&rsquo;ll be signed out when it finishes.</p>}
        {deletion.state === "blocked" && <><p><strong>{deletion.cancellable ? "Your deletion is paused." : "Your deletion needs our team to finish."}</strong> {deletion.cancellable ? "Something changed since you asked. Resolve the items below and ask again, or cancel." : `Email ${SUPPORT_EMAIL} if you have questions.`}</p><Blockers codes={deletion.blockedCodes.filter(code => code !== "BLOCKED")} /></>}
        {deletion.cancellable && <button type="button" className="button secondary" disabled={busy !== null} onClick={() => void cancelDeletion()}>{busy === "cancel" ? "Cancelling…" : "Cancel deletion"}</button>}
      </div> : !data.deletionEnabled ? <p>To delete your account, email <a className="text-link" href={`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20Makeborne%20account`}>{SUPPORT_EMAIL}</a> from the address you sign in with. We&rsquo;ll confirm what is deleted and what the law requires us to keep.</p> : <>
        <p>Your account is deleted {data.graceDays} days after you ask. You can cancel until then from this page. After that it can&rsquo;t be undone.</p>
        <details className="data-explained">
          <summary>What&rsquo;s deleted and what we keep</summary>
          <h4>Deleted</h4><ul>{DELETION_EXPLAINED.deleted.map(line => <li key={line}>{line}</li>)}</ul>
          <h4>Kept, and why</h4><ul>{DELETION_EXPLAINED.retained.map(line => <li key={line}>{line}</li>)}</ul>
          <p>{DELETION_EXPLAINED.shared} {DELETION_EXPLAINED.credits}</p>
        </details>
        {warnings && (warnings.liveSites > 0 || warnings.credits > 0 || warnings.portalClients > 0 || warnings.mailboxes > 0 || warnings.github || warnings.otherWorkspaces > 0) && <ul className="data-warnings" aria-label="This also affects">
          {warnings.liveSites > 0 && <li>{warnings.liveSites} published website{warnings.liveSites === 1 ? "" : "s"} will go offline{warnings.customDomains ? ", and connected domains will stop working" : ""}.</li>}
          {warnings.credits > 0 && <li>{warnings.credits.toLocaleString("en-US")} unused credits will be lost.</li>}
          {warnings.portalClients > 0 && <li>{warnings.portalClients} client{warnings.portalClients === 1 ? "" : "s"} will lose access to the client portal.</li>}
          {warnings.mailboxes > 0 && <li>Your connected mailbox{warnings.mailboxes === 1 ? "" : "es"} will be disconnected. You can also remove Makeborne&rsquo;s access in your email provider&rsquo;s account settings.</li>}
          {warnings.github && <li>Your code-hosting connection will be removed. You can also revoke it in that service&rsquo;s settings.</li>}
          {warnings.otherWorkspaces > 0 && <li>You&rsquo;ll be removed from {warnings.otherWorkspaces} workspace{warnings.otherWorkspaces === 1 ? "" : "s"} owned by someone else.</li>}
        </ul>}
        <Blockers codes={refused.length ? refused : data.blockers} />
        {!confirming ? <button type="button" className="button data-danger" disabled={data.blockers.length > 0 || busy !== null} onClick={() => setConfirming(true)}><Trash2 size={16} aria-hidden="true" />Delete my account…</button>
          : <form className="data-confirm" onSubmit={event => void scheduleDeletion(event)} noValidate>
            <label htmlFor={ids.confirm}>Type <strong>{data.email}</strong> to confirm</label>
            <input id={ids.confirm} ref={confirmInput} type="email" autoComplete="off" spellCheck={false} value={typed} onChange={event => setTyped(event.target.value)} aria-describedby={`${ids.confirm}-hint`} />
            <span id={`${ids.confirm}-hint`} className="small-note">The email address you sign in with.</span>
            <label className="data-check" htmlFor={ids.understood}><input id={ids.understood} type="checkbox" checked={understood} onChange={event => setUnderstood(event.target.checked)} />I&rsquo;ve downloaded anything I want to keep and understand deletion can&rsquo;t be undone once it starts.</label>
            {reauth && <div className="data-reauth" role="alert"><p>For your security, sign in again to confirm it&rsquo;s you. You&rsquo;ll come back to Settings; then confirm again.</p><button type="button" className="button secondary small" onClick={() => void signInAgain()}>Sign in again</button></div>}
            <div className="button-row">
              <button type="submit" className="button data-danger" disabled={!canSubmit}>{busy === "delete" ? "Scheduling…" : `Delete my account in ${data.graceDays} days`}</button>
              <button type="button" className="button secondary" onClick={() => { setConfirming(false); setTyped(""); setUnderstood(false); setReauth(false); }}>Keep my account</button>
            </div>
          </form>}
      </>}
    </div>
    <p className="small-note data-message" role="status" aria-live="polite">{message}</p>
  </section>;
}

/** Shown across the studio while a deletion is scheduled, so signing in is enough to find the cancel button. */
export function AccountDeletionNotice({ accountId, onOpenSettings }: { accountId: string | null | undefined; onOpenSettings: () => void }) {
  const { load } = useAccountData(accountId);
  const deletion = load.state === "ready" ? load.data.deletion : null;
  if (!deletion) return null;
  return <div className="data-deletion-notice" role="status">
    <AlertTriangle size={16} aria-hidden="true" />
    <span>{deletion.state === "scheduled" ? `Your account is scheduled for deletion on ${day(deletion.scheduledFor)}.` : deletion.state === "processing" ? "Your account is being deleted." : "Your account deletion is paused."}</span>
    {deletion.cancellable && <button type="button" className="text-link" onClick={onOpenSettings}>Review or cancel</button>}
  </div>;
}
