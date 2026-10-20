/** What the browser sees of a custom domain row (no Cloudflare ids or internals). */
import { checkHostname, dnsRecords, statusLabel, type DnsRecord, type DomainPhase, type DomainStatus } from "./custom-domains";

export type DomainRow = { id: string; hostname: string; status: DomainStatus; ssl_status: string | null; error: string | null; verification: unknown; created_at: string; last_checked_at: string | null };
export type DomainView = { id: string; hostname: string; status: DomainStatus; phase: DomainPhase; inProgress: boolean; label: string; detail: string; error: string | null; records: DnsRecord[]; lastCheckedAt: string | null; url: string };

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
