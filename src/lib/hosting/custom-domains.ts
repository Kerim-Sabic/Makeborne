/** Customer custom domains: hostname rules, the DNS records a customer adds,
 * and a small Cloudflare for SaaS (custom hostnames) client. The Worker serves
 * a hostname only after it is active here AND its site is live. */
import { z } from "zod";

export type DomainStatus = "pending" | "active" | "failed";
export type DnsRecord = { type: "CNAME" | "TXT" | "ALIAS"; name: string; value: string; purpose: string };
export type HostnameCheck = { ok: true; hostname: string; apex: boolean } | { ok: false; message: string };

/** Two-label public suffixes common among our customers (so "bakery.co.uk" counts as a root domain). */
const MULTI_SUFFIX = new Set(["co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "org.nz", "co.za", "com.br", "com.mx", "co.jp", "co.in", "com.tr", "com.sg", "com.hr", "co.ba", "com.ba", "co.rs", "co.il", "com.cy", "com.mt"]);
const RESERVED = ["makeborne.com", "makeborne.site", "localhost", "local", "internal", "invalid", "example", "example.com", "example.net", "example.org", "onion"];

/** Normalises what people paste ("https://www.MyBakery.com/menu") to a hostname and checks it. */
export function checkHostname(input: string, options: { allowTest?: boolean } = {}): HostnameCheck {
  let value = input.trim().toLowerCase();
  if (!value) return { ok: false, message: "Enter a domain, like www.yourbakery.com." };
  if (/\s/.test(value)) return { ok: false, message: "A domain can't contain spaces." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `http://${value}`;
  let host: string;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return { ok: false, message: "Enter just the domain, without a port or login." };
    host = url.hostname.replace(/\.$/, "");
  } catch { return { ok: false, message: "That doesn't look like a domain. Try www.yourbakery.com." }; }
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return { ok: false, message: "Use a domain name, not an IP address." };
  const labels = host.split(".");
  if (host.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
    return { ok: false, message: "That doesn't look like a complete domain. Try www.yourbakery.com." };
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) return { ok: false, message: "That domain ending isn't valid." };
  if (tld === "test" && !options.allowTest) return { ok: false, message: "Use a real domain you own." };
  if (RESERVED.some(reserved => host === reserved || host.endsWith(`.${reserved}`))) return { ok: false, message: "That domain can't be connected. Use a domain you own." };
  const suffix = labels.slice(-2).join(".");
  const apex = labels.length === (MULTI_SUFFIX.has(suffix) ? 3 : 2);
  return { ok: true, hostname: host, apex };
}

/** The records the customer adds at their DNS provider. */
export function dnsRecords(hostname: string, apex: boolean, target: string, extra: readonly DnsRecord[] = []): DnsRecord[] {
  const main: DnsRecord = apex
    ? { type: "ALIAS", name: "@", value: target, purpose: "Points your root domain to your Makeborne site. If your provider has no ALIAS, ANAME or CNAME flattening, connect www instead and forward the root domain to it." }
    : { type: "CNAME", name: hostname.split(".")[0], value: target, purpose: "Points this address to your Makeborne site." };
  return [main, ...extra.filter(record => record.name && record.value)];
}

// ----------------------------------------------------------------- Cloudflare

const CloudflareHostname = z.object({
  id: z.string().min(1).max(64),
  hostname: z.string(),
  status: z.string().max(40).optional(),
  ssl: z.object({
    status: z.string().max(40).optional(),
    validation_records: z.array(z.object({ txt_name: z.string().max(300).optional(), txt_value: z.string().max(300).optional() }).passthrough()).optional(),
    validation_errors: z.array(z.object({ message: z.string().max(500) }).passthrough()).optional(),
  }).passthrough().optional(),
  ownership_verification: z.object({ type: z.string().optional(), name: z.string().max(300).optional(), value: z.string().max(300).optional() }).passthrough().optional(),
  verification_errors: z.array(z.string().max(500)).optional(),
}).passthrough();
type CloudflareHostname = z.infer<typeof CloudflareHostname>;
const Envelope = z.object({ success: z.boolean(), errors: z.array(z.object({ code: z.number().optional(), message: z.string().max(500) }).passthrough()).default([]), result: z.unknown().optional() }).passthrough();

export type DomainConfig = { zoneId: string; token: string; target: string };
export function customDomainConfig(env: Record<string, string | undefined> = process.env): DomainConfig | null {
  const zoneId = env.CLOUDFLARE_SAAS_ZONE_ID?.trim(), token = env.CLOUDFLARE_SAAS_API_TOKEN?.trim(), target = env.MAKEBORNE_CUSTOM_DOMAIN_TARGET?.trim().toLowerCase();
  if (!zoneId || !/^[a-f0-9]{32}$/.test(zoneId) || !token || token.length < 20 || !target) return null;
  // The target is our own fallback origin (e.g. customers.makeborne.site), so customer-domain rules don't apply.
  const validTarget = target.length <= 253 && target.split(".").length >= 3 && target.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  return validTarget ? { zoneId, token, target } : null;
}

export class CloudflareError extends Error {
  constructor(message: string, public status: number, public code?: number) { super(message); }
}

/** Minimal custom-hostnames client. `fetchImpl` is injectable for offline tests. */
export function cloudflareHostnames(config: DomainConfig, fetchImpl: typeof fetch = fetch) {
  const base = `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/custom_hostnames`;
  async function call(path: string, method: string, body?: unknown) {
    const response = await fetchImpl(`${base}${path}`, {
      method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed = Envelope.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new CloudflareError("Cloudflare returned an unexpected response.", response.status);
    if (!response.ok || !parsed.data.success) {
      const first = parsed.data.errors[0];
      throw new CloudflareError(first?.message ?? "Cloudflare refused the request.", response.status, first?.code);
    }
    return parsed.data.result;
  }
  const hostname = (value: unknown) => {
    const parsed = CloudflareHostname.safeParse(value);
    if (!parsed.success) throw new CloudflareError("Cloudflare returned an unexpected hostname.", 502);
    return parsed.data;
  };
  return {
    // HTTP validation: once the customer's CNAME points at us, Cloudflare verifies ownership and issues the certificate itself.
    create: async (name: string) => hostname(await call("", "POST", { hostname: name, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } })),
    get: async (id: string) => hostname(await call(`/${encodeURIComponent(id)}`, "GET")),
    remove: async (id: string) => { try { await call(`/${encodeURIComponent(id)}`, "DELETE"); } catch (error) { if (!(error instanceof CloudflareError && error.status === 404)) throw error; } },
  };
}

const FAILED_HOSTNAME = new Set(["blocked", "moved", "deleted", "pending_blocked", "test_failed"]);

/** Our status, the SSL state and any message, from Cloudflare's hostname record. */
export function domainState(result: CloudflareHostname): { status: DomainStatus; sslStatus: string | null; error: string | null; extra: DnsRecord[] } {
  const sslStatus = result.ssl?.status ?? null;
  const errors = [...(result.verification_errors ?? []), ...(result.ssl?.validation_errors ?? []).map(item => item.message)].map(message => message.slice(0, 240));
  const status: DomainStatus = result.status === "active" && sslStatus === "active" ? "active" : FAILED_HOSTNAME.has(result.status ?? "") ? "failed" : "pending";
  // Optional pre-validation records: lets a site go live before its CNAME switches over (e.g. moving from another host).
  const extra: DnsRecord[] = [];
  if (result.ownership_verification?.name && result.ownership_verification.value)
    extra.push({ type: "TXT", name: result.ownership_verification.name, value: result.ownership_verification.value, purpose: "Optional: proves you own the domain before switching it over." });
  return { status, sslStatus, error: status === "active" ? null : errors[0] ?? null, extra };
}

/** Plain-words label for the UI. */
export function statusLabel(status: DomainStatus, sslStatus: string | null): { label: string; detail: string } {
  if (status === "active") return { label: "Live", detail: "Your site is live on this domain, with a secure https certificate." };
  if (status === "failed") return { label: "Needs attention", detail: "Cloudflare couldn't connect this domain. Check the records below, or remove and add it again." };
  if (sslStatus && sslStatus !== "initializing" && sslStatus !== "pending_validation") return { label: "Securing", detail: "DNS is connected. The https certificate is being issued, which usually takes a few minutes." };
  return { label: "Waiting for DNS", detail: "Add the record below at your domain provider. Changes usually show up within minutes, sometimes up to a day." };
}
