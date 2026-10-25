/**
 * Who is the same business, and who asked not to be contacted. Pure functions.
 *
 * Duplicates are SUGGESTED, never merged: two records match on a normalised
 * website domain, a business email address, an email domain that isn't a free
 * mail provider, a phone number (last 8 digits) or the same normalised name.
 * Every suggestion carries its reasons; a pair the person dismissed stays
 * dismissed.
 *
 * The do-not-contact list holds email addresses and whole domains. A domain
 * entry covers its subdomains and every address at it.
 */
export type MatchRecord = { id: string; name: string; company?: string | null; email?: string | null; website?: string | null; notes?: string | null; phone?: string | null };
export type DuplicateReason = { kind: "domain" | "email" | "email_domain" | "phone" | "name"; text: string };
export type DuplicatePair = { a: string; b: string; reasons: DuplicateReason[]; strength: "strong" | "possible" };

/** Free and ISP mail providers: sharing one says nothing about being the same business. */
export const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "gmx.com", "gmx.de", "gmx.net", "web.de", "proton.me", "protonmail.com", "mail.com", "yandex.com", "yandex.ru", "zoho.com", "t-online.de", "orange.fr", "libero.it", "seznam.cz", "wp.pl", "btinternet.com"]);
/** Shared hosts where the domain is the platform, not the business. */
const SHARED_HOSTS = /(^|\.)(wixsite\.com|squarespace\.com|wordpress\.com|weebly\.com|jimdosite\.com|webnode\.\w+|blogspot\.com|business\.site|godaddysites\.com|carrd\.co|linktr\.ee|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|linkedin\.com|google\.com|goo\.gl|maps\.app\.goo\.gl)$/;

export function normalizeDomain(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(value) ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\d?\./, "").replace(/\.$/, "");
    return /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host) ? host : "";
  } catch { return ""; }
}
export function normalizeEmail(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : "";
}
export const emailDomain = (email: string) => email.slice(email.lastIndexOf("@") + 1);
/** Digits only, compared on the last 8 so "+387 33 123 456" and "033 123 456" agree (country and trunk prefixes drop out). */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-8) : "";
}
const LEGAL = /\b(ltd|limited|llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|gmbh|ug|ag|kg|ohg|d\.o\.o|doo|d\.d|s\.r\.l|srl|s\.a|sa|bv|nv|oy|ab|as|plc|pty|sarl|sas|spa|s\.p\.a|e\.k|the)\b\.?/g;
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
/** Phone numbers the record carries: its own field, or "Phone: …" lines in its notes (how found leads are saved). */
export function phonesOf(record: MatchRecord): string[] {
  const found = [record.phone ?? "", ...[...(record.notes ?? "").matchAll(/^\s*(?:phone|tel(?:ephone)?)\s*:\s*([+\d][\d\s().\/-]{5,30})/gim)].map(match => match[1])];
  return [...new Set(found.map(normalizePhone).filter(Boolean))];
}

type Keys = { domain: string; email: string; emailDomain: string; phones: string[]; name: string };
export function keysOf(record: MatchRecord): Keys {
  const domain = normalizeDomain(record.website), email = normalizeEmail(record.email);
  const mailDomain = email ? emailDomain(email) : "";
  const name = normalizeName(record.company || record.name);
  return { domain: SHARED_HOSTS.test(domain) ? "" : domain, email, emailDomain: mailDomain && !FREE_MAIL.has(mailDomain) ? mailDomain : "", phones: phonesOf(record), name: name.length >= 3 ? name : "" };
}

/** Why `candidate` looks like `other` (empty when it doesn't). */
export function matchReasons(candidate: MatchRecord, other: MatchRecord): DuplicateReason[] {
  const a = keysOf(candidate), b = keysOf(other), out: DuplicateReason[] = [];
  if (a.domain && (a.domain === b.domain || a.domain === b.emailDomain)) out.push({ kind: "domain", text: `Same website (${a.domain})` });
  else if (b.domain && b.domain === a.emailDomain) out.push({ kind: "domain", text: `Same website (${b.domain})` });
  if (a.email && a.email === b.email) out.push({ kind: "email", text: `Same email (${a.email})` });
  else if (a.emailDomain && a.emailDomain === b.emailDomain && !out.some(item => item.kind === "domain")) out.push({ kind: "email_domain", text: `Email at the same domain (${a.emailDomain})` });
  const phone = a.phones.find(item => b.phones.includes(item));
  if (phone) out.push({ kind: "phone", text: "Same phone number" });
  if (a.name && a.name === b.name) out.push({ kind: "name", text: "Same name" });
  return out;
}
const strong = (reasons: DuplicateReason[]) => reasons.some(item => item.kind === "domain" || item.kind === "email" || item.kind === "phone") ? "strong" as const : "possible" as const;
const pairKey = (x: string, y: string) => x < y ? `${x}|${y}` : `${y}|${x}`;

/**
 * Suggested duplicate pairs in a list of records (bounded work: records are
 * bucketed by each key, so a large workspace isn't compared pairwise).
 */
export function duplicatePairs(records: readonly MatchRecord[], dismissed: Iterable<[string, string]> = [], limit = 200): DuplicatePair[] {
  const skip = new Set([...dismissed].map(([x, y]) => pairKey(x, y)));
  const buckets = new Map<string, MatchRecord[]>();
  for (const record of records) {
    const keys = keysOf(record);
    const own = [keys.domain && `d:${keys.domain}`, keys.emailDomain && `d:${keys.emailDomain}`, keys.email && `e:${keys.email}`, ...keys.phones.map(item => `p:${item}`), keys.name && `n:${keys.name}`].filter(Boolean) as string[];
    for (const key of new Set(own)) { const list = buckets.get(key) ?? []; if (list.length < 50) list.push(record); buckets.set(key, list); }
  }
  const out = new Map<string, DuplicatePair>();
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [x, y] = list[i].id < list[j].id ? [list[i], list[j]] : [list[j], list[i]];
      const key = pairKey(x.id, y.id);
      if (x.id === y.id || skip.has(key) || out.has(key)) continue;
      const reasons = matchReasons(x, y);
      if (reasons.length) out.set(key, { a: x.id, b: y.id, reasons, strength: strong(reasons) });
    }
  }
  return [...out.values()].sort((p, q) => (p.strength === q.strength ? 0 : p.strength === "strong" ? -1 : 1) || q.reasons.length - p.reasons.length).slice(0, limit);
}

/** Existing records that look like the candidate, strongest first. */
export function matchesFor(candidate: MatchRecord, records: readonly MatchRecord[], limit = 5) {
  return records.filter(record => record.id !== candidate.id).map(record => ({ id: record.id, name: record.name, reasons: matchReasons(candidate, record) }))
    .filter(item => item.reasons.length).map(item => ({ ...item, strength: strong(item.reasons) }))
    .sort((p, q) => (p.strength === q.strength ? 0 : p.strength === "strong" ? -1 : 1) || q.reasons.length - p.reasons.length).slice(0, limit);
}

// ---------- do not contact ----------
export type Suppression = { id?: string; kind: "email" | "domain"; value: string; reason?: string };
export function normalizeSuppression(kind: "email" | "domain", raw: string): Suppression | null {
  if (kind === "email") { const value = normalizeEmail(raw); return value ? { kind, value } : null; }
  const value = normalizeDomain(raw.includes("@") ? emailDomain(raw.trim().toLowerCase()) : raw);
  return value ? { kind, value } : null;
}
/** The entry that blocks contacting this email or website, if any. */
export function suppressionFor(list: readonly Suppression[], target: { email?: string | null; website?: string | null }): Suppression | null {
  const email = normalizeEmail(target.email), hosts = [email ? emailDomain(email) : "", normalizeDomain(target.website)].filter(Boolean);
  for (const entry of list) {
    if (entry.kind === "email" && email && entry.value === email) return entry;
    if (entry.kind === "domain" && hosts.some(host => host === entry.value || host.endsWith(`.${entry.value}`))) return entry;
  }
  return null;
}
