"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Copy, ExternalLink, Globe, HelpCircle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";
import type { DomainView } from "@/lib/hosting/custom-domain-view";
import "@/app/website-domains.css";

type State = { configured: boolean; target: string | null; published: boolean; live: boolean; domains: DomainView[] };
const POLL_MS = 20_000, POLL_LIMIT_MS = 30 * 60_000;
/** Chip tone: live, expected progress, stopped and needing the owner, or not recognised. */
const tone = (domain: DomainView) => domain.status === "active" ? "active" : domain.inProgress ? "pending" : domain.phase === "unknown" ? "unknown" : "failed";

const PROVIDERS: [string, string][] = [
  ["Cloudflare", "DNS → Records → Add record. Choose CNAME, enter the name and target, and set Proxy status to “DNS only” (grey cloud). Root domains work directly: Cloudflare flattens a CNAME at the root."],
  ["GoDaddy", "My Products → your domain → DNS → Add New Record. Choose CNAME, enter the name and the value. GoDaddy has no ALIAS for root domains: connect www and use Forwarding to send the root domain to it."],
  ["Namecheap", "Domain List → Manage → Advanced DNS → Add New Record. Choose CNAME Record (or ALIAS Record for the root, with host @)."],
  ["Squarespace Domains", "Domains → your domain → DNS → Custom records. Add a CNAME with the name and data shown."],
  ["IONOS", "Domains & SSL → your domain → DNS → Add record. Choose CNAME and enter the host name and points-to value."],
  ["Porkbun", "Domain Management → Details → DNS Records. Choose CNAME (or ALIAS for the root domain) and enter the host and answer."],
];

export default function WebsiteDomains({ accountId, workspaceId, artifactId }: { accountId: string; workspaceId: string; artifactId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const startedPolling = useRef(0);
  const path = `/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/domains`;

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const guard = cloudAccountGuard(accountId); guard();
    const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId, ...init?.headers } });
    const value = await response.json().catch(() => ({}));
    guard();
    if (!response.ok) throw new Error(value?.error?.message ?? "Something went wrong. Try again.");
    return value;
  }, [accountId]);
  useEffect(() => {
    let active = true;
    request(path).then(value => { if (active) setState(value as State); }, cause => { if (active) setError(cause instanceof Error ? cause.message : "Domains couldn't load."); });
    return () => { active = false; };
  }, [path, request]);

  const replace = (domain: DomainView) => setState(current => current && { ...current, domains: current.domains.map(item => item.id === domain.id ? domain : item) });
  const check = useCallback(async (id: string, quiet = false) => {
    if (!quiet) { setBusy(`check:${id}`); setError(""); }
    try { replace((await request(`${path}/${id}`, { method: "POST" })).domain as DomainView); }
    catch (cause) { if (!quiet) setError(cause instanceof Error ? cause.message : "The status couldn't be checked."); }
    finally { if (!quiet) setBusy(null); }
  }, [path, request]);

  // While a domain is expected to progress on its own, check quietly every 20 s for up to 30 minutes
  // (only while the tab is visible). Stopped, expired or unrecognised states wait for the owner.
  const waiting = state?.domains.filter(domain => domain.inProgress).map(domain => domain.id).join(",") ?? "";
  useEffect(() => {
    if (!waiting) return;
    if (!startedPolling.current) startedPolling.current = Date.now();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - startedPolling.current > POLL_LIMIT_MS) return;
      for (const id of waiting.split(",")) void check(id, true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, check]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!hostname.trim()) return;
    setBusy("add"); setError("");
    try {
      const { domain } = await request(path, { method: "POST", body: JSON.stringify({ hostname }) }) as { domain: DomainView };
      setState(current => current && { ...current, domains: [...current.domains, domain] });
      setHostname(""); startedPolling.current = Date.now();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The domain couldn't be added."); }
    finally { setBusy(null); }
  }
  async function remove(id: string) {
    setBusy(`remove:${id}`); setError("");
    try { await request(`${path}/${id}`, { method: "DELETE" }); setState(current => current && { ...current, domains: current.domains.filter(item => item.id !== id) }); setConfirm(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The domain couldn't be removed."); }
    finally { setBusy(null); }
  }
  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied(current => current === key ? "" : current), 1500); }
    catch { setError("Copy isn't available here. Select the text and copy it instead."); }
  }

  if (!state) return <section className="website-publish wd" aria-label="Custom domains"><h3><Globe size={16} />Your own domain</h3><p role="status">{error || "Loading domains…"}</p></section>;
  return <section className="website-publish wd" aria-label="Custom domains">
    <h3><Globe size={16} />Your own domain</h3>
    {!state.configured ? <p>Custom domains are being set up. Your site stays available on its Makeborne address.</p>
      : !state.published ? <p>Publish this website once, then connect a domain like <strong>www.yourbusiness.com</strong>.</p>
      : <>
        <p>Show this website on a domain you own. Add it here, then add one record at your domain provider. The secure https certificate is set up for you.</p>
        <form className="wd-add" onSubmit={event => void add(event)}>
          <label htmlFor="wd-hostname" className="wd-label">Domain</label>
          <div className="wd-add-row">
            <input id="wd-hostname" value={hostname} onChange={event => setHostname(event.target.value)} placeholder="www.yourbusiness.com" autoComplete="off" spellCheck={false} maxLength={300} disabled={Boolean(busy)} />
            <button type="submit" className="button primary small" disabled={Boolean(busy) || !hostname.trim()}>{busy === "add" ? <Loader2 size={14} className="wd-spin" /> : null}Connect</button>
          </div>
          <small>We recommend www. Most providers can&apos;t point a root domain (yourbusiness.com) straight at a website, so you can forward it to www.</small>
        </form>
        {!state.live && state.domains.length > 0 && <p className="wd-note">Your site isn&apos;t live right now. The domain will show it as soon as you publish.</p>}
        {state.domains.length > 0 && <p className="wd-note wd-policy">Both addresses show the same site, and neither one redirects to the other. Your Makeborne address stays the main address for search engines: every page names it as the original, and only it lists a sitemap.</p>}
      </>}
    {error && <p className="wd-error" role="alert">{error}</p>}
    {state.domains.map(domain => <article key={domain.id} className="wd-domain" data-status={domain.status} data-phase={domain.phase}>
      <header className="wd-domain-head">
        <strong>{domain.hostname}</strong>
        <span className={`wd-chip is-${tone(domain)}`}>{tone(domain) === "active" ? <Check size={12} aria-hidden="true" /> : tone(domain) === "pending" ? <Loader2 size={12} className="wd-spin" aria-hidden="true" /> : tone(domain) === "unknown" ? <HelpCircle size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}{domain.label}</span>
        {domain.status === "active" && <a className="wd-open" href={domain.url} target="_blank" rel="noopener noreferrer">Open<ExternalLink size={12} /></a>}
      </header>
      <p className="wd-detail" id={`wd-detail-${domain.id}`}>{domain.detail}</p>
      {domain.error && domain.status !== "active" && <p className="wd-error">{domain.error}</p>}
      {domain.status !== "active" && domain.records.length > 0 && <div className="wd-records" role="table" aria-label={`DNS records for ${domain.hostname}`}>
        <div className="wd-row wd-row-head" role="row"><span role="columnheader">Type</span><span role="columnheader">Name</span><span role="columnheader">Value</span></div>
        {domain.records.map((record, index) => <div className="wd-row" role="row" key={index} title={record.purpose}>
          <span role="cell"><code>{record.type}</code></span>
          <span role="cell" className="wd-name">
            <span className="wd-copyable"><code>{record.name}</code><button type="button" onClick={() => void copy(record.name, `${domain.id}:${index}:n`)} aria-label={`Copy name ${record.name}${record.zone ? ` (in the ${record.zone} zone)` : ""}`}>{copied === `${domain.id}:${index}:n` ? <Check size={12} /> : <Copy size={12} />}</button></span>
            {record.fqdn && record.fqdn !== record.name && <span className="wd-copyable wd-fqdn"><small>Full name</small><code>{record.fqdn}</code><button type="button" onClick={() => void copy(record.fqdn!, `${domain.id}:${index}:f`)} aria-label={`Copy full name ${record.fqdn}`}>{copied === `${domain.id}:${index}:f` ? <Check size={12} /> : <Copy size={12} />}</button></span>}
          </span>
          <span role="cell" className="wd-copyable"><code>{record.value}</code><button type="button" onClick={() => void copy(record.value, `${domain.id}:${index}:v`)} aria-label={`Copy value ${record.value}`}>{copied === `${domain.id}:${index}:v` ? <Check size={12} /> : <Copy size={12} />}</button></span>
        </div>)}
        <p className="wd-purpose">{domain.records[0].purpose}</p>
        {domain.records[0].zone && <p className="wd-purpose wd-zone">The name is for the DNS zone <strong>{domain.records[0].zone}</strong>{domain.records[0].name === "@" ? " (@ means the zone itself)" : ""}. If your provider manages a different zone for this domain, or asks for the whole name, enter the full name <code>{domain.records[0].fqdn}</code> instead.</p>}
      </div>}
      <footer className="wd-actions">
        {domain.status !== "active" && <button type="button" className="button secondary small" disabled={Boolean(busy)} onClick={() => void check(domain.id)} aria-describedby={`wd-detail-${domain.id}`}>{busy === `check:${domain.id}` ? <Loader2 size={14} className="wd-spin" /> : <RefreshCw size={14} />}Check now</button>}
        {domain.lastCheckedAt && <small>Checked {new Date(domain.lastCheckedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</small>}
        {confirm === domain.id
          ? <span className="wd-confirm" role="group" aria-label={`Confirm removing ${domain.hostname}`}><span>Disconnect {domain.hostname}?</span><button type="button" className="wd-danger" disabled={Boolean(busy)} onClick={() => void remove(domain.id)}>Disconnect</button><button type="button" className="wd-link" onClick={() => setConfirm(null)}>Keep</button></span>
          : <button type="button" className="wd-link wd-remove" disabled={Boolean(busy)} onClick={() => setConfirm(domain.id)}><Trash2 size={13} />Remove</button>}
      </footer>
    </article>)}
    {state.configured && state.domains.some(domain => domain.status !== "active") && <details className="wd-help">
      <summary>Step-by-step for your domain provider</summary>
      <dl>{PROVIDERS.map(([name, steps]) => <div key={name}><dt>{name}</dt><dd>{steps}</dd></div>)}</dl>
      <p>Other providers work the same way: add a CNAME record with the name and value above. DNS changes usually show up within minutes, sometimes up to a day.</p>
    </details>}
  </section>;
}
