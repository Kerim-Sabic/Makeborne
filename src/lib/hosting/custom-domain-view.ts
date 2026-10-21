/** What the browser sees of a custom domain row (no Cloudflare ids or internals). */
import { checkHostname, dnsRecords, statusLabel, type DnsRecord, type DomainPhase, type DomainStatus } from "./custom-domains";

export type DomainRow = { id: string; hostname: string; status: DomainStatus; ssl_status: string | null; error: string | null; verification: unknown; created_at: string; last_checked_at: string | null };
/** lastCheckedAt is the last *successful* check: the server writes last_checked_at only when the
 * provider answered (adding the domain, or Check now with a status or a confirmed removal). A
 * provider error returns 503 and writes nothing, so a failed attempt never moves it. */
export type DomainView = { id: string; hostname: string; status: DomainStatus; phase: DomainPhase; inProgress: boolean; label: string; detail: string; error: string | null; records: DnsRecord[]; lastCheckedAt: string | null; url: string };

/** A check attempt made from this page (manual or the quiet 20-second poll). */
export type CheckAttempt = { at: string; ok: boolean };
/** "14:05" today, otherwise "19 Oct, 14:05" (in the viewer's locale and time zone). */
export function checkTime(iso: string, now = new Date(), locale?: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === now.toDateString() ? time : `${date.toLocaleDateString(locale, { day: "numeric", month: "short" })}, ${time}`;
}
/** The last successful check, kept apart from a later attempt that didn't reach the provider. */
export function checkTimes(lastSuccessAt: string | null, attempt: CheckAttempt | null, format: (iso: string) => string = iso => checkTime(iso)) {
  const success = lastSuccessAt ? `Last successful check ${format(lastSuccessAt)}` : "No successful check yet";
  const failedLater = !!attempt && !attempt.ok && (!lastSuccessAt || Date.parse(attempt.at) > Date.parse(lastSuccessAt));
  return { success, attempt: failedLater ? `Last attempt ${format(attempt!.at)} couldn’t reach the domain provider, so the status shown is from the last successful check.` : null };
}

const isRecord = (value: unknown): value is DnsRecord => !!value && typeof value === "object"
  && ["CNAME", "TXT", "ALIAS"].includes((value as DnsRecord).type) && typeof (value as DnsRecord).name === "string" && typeof (value as DnsRecord).value === "string" && typeof (value as DnsRecord).purpose === "string";

export const domainView = (target: string) => (row: DomainRow): DomainView => {
  const { phase, inProgress, label, detail } = statusLabel(row.status, row.ssl_status);
  const stored = Array.isArray(row.verification) ? row.verification.filter(isRecord).slice(0, 6) : [];
  // Names are rebuilt from the hostname, so rows saved before exact names were
  // stored (the CNAME name was only the first label) still show the full name.
  // Provider TXT records keep their own full name and value.
  const txt = stored.filter(record => record.type === "TXT")
    .map(record => ({ type: record.type, name: typeof record.fqdn === "string" ? record.fqdn : record.name, value: record.value, purpose: record.purpose }));
  const address = stored.find(record => record.type !== "TXT");
  const checked = checkHostname(row.hostname, { allowTest: true });
  const records = dnsRecords(row.hostname, checked.ok && checked.apex, target || address?.value || "", txt);
  return { id: row.id, hostname: row.hostname, status: row.status, phase, inProgress, label, detail, error: row.error, lastCheckedAt: row.last_checked_at, url: `https://${row.hostname}`,
    records: address ? records : records.slice(1) };
};
