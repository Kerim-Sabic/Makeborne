/** What the browser sees of a custom domain row (no Cloudflare ids or internals). */
import { statusLabel, type DnsRecord, type DomainStatus } from "./custom-domains";

export type DomainRow = { id: string; hostname: string; status: DomainStatus; ssl_status: string | null; error: string | null; verification: unknown; created_at: string; last_checked_at: string | null };
export type DomainView = { id: string; hostname: string; status: DomainStatus; label: string; detail: string; error: string | null; records: DnsRecord[]; lastCheckedAt: string | null; url: string };

const isRecord = (value: unknown): value is DnsRecord => !!value && typeof value === "object"
  && ["CNAME", "TXT", "ALIAS"].includes((value as DnsRecord).type) && typeof (value as DnsRecord).name === "string" && typeof (value as DnsRecord).value === "string" && typeof (value as DnsRecord).purpose === "string";

export const domainView = (target: string) => (row: DomainRow): DomainView => {
  const { label, detail } = statusLabel(row.status, row.ssl_status);
  const records = Array.isArray(row.verification) ? row.verification.filter(isRecord).slice(0, 6) : [];
  return { id: row.id, hostname: row.hostname, status: row.status, label, detail, error: row.error, lastCheckedAt: row.last_checked_at, url: `https://${row.hostname}`,
    records: records.map(record => target && record.type !== "TXT" ? { ...record, value: target } : record) };
};
