"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, LoaderCircle, Mail, RefreshCw, UserPlus, X } from "lucide-react";
import type { ClientPortalOverview, PortalAccess } from "@/lib/portal/contracts";
import { brandRequest } from "./brand-kit-api";
import "@/app/client-portal.css";

const STATUS: Record<PortalAccess["status"], string> = { invited: "Invited", active: "Active", revoked: "Access removed", expired: "Invite expired" };
const day = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

/** On a client's "Brand & client access" tab: invite the client to edit their website content, and manage access. */
export default function ClientPortalPanel({ accountId, workspaceId, clientId, clientName, contactName, clientEmail, canEdit }: {
  accountId: string; workspaceId: string; clientId: string; clientName: string; contactName: string; clientEmail: string; canEdit: boolean;
}) {
  const [data, setData] = useState<ClientPortalOverview | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState(clientEmail);
  const [name, setName] = useState(contactName);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const base = `/api/cloud/workspaces/${workspaceId}/clients/${clientId}/portal`;

  const load = useCallback(async () => {
    try { setData(await brandRequest<ClientPortalOverview>(accountId, base)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Client editing couldn't load."); }
  }, [accountId, base]);
  useEffect(() => {
    let active = true;
    brandRequest<ClientPortalOverview>(accountId, base).then(value => { if (active) setData(value); }, cause => { if (active) setError(cause instanceof Error ? cause.message : "Client editing couldn't load."); });
    return () => { active = false; };
  }, [accountId, base]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy("invite"); setError(""); setLink(null);
    try {
      const result = await brandRequest<{ access: PortalAccess; inviteUrl: string }>(accountId, base, { method: "POST", body: JSON.stringify({ email: email.trim(), displayName: name.trim() }) });
      setLink({ url: result.inviteUrl, email: result.access.email }); setCopied(false); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The invite couldn't be created."); }
    finally { setBusy(""); }
  }
  async function resend(access: PortalAccess) {
    setBusy(access.id); setError("");
    try { const result = await brandRequest<{ inviteUrl: string }>(accountId, `${base}/${access.id}`, { method: "PATCH", body: JSON.stringify({ action: "resend" }) }); setLink({ url: result.inviteUrl, email: access.email }); setCopied(false); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "A new invite link couldn't be made."); }
    finally { setBusy(""); }
  }
  async function revoke(access: PortalAccess) {
    setBusy(access.id); setError("");
    try { await brandRequest(accountId, `${base}/${access.id}`, { method: "DELETE" }); setConfirm(null); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Access couldn't be removed."); }
    finally { setBusy(""); }
  }
  async function toggleSite(artifactId: string, enabled: boolean, collections: string[] | null) {
    setBusy(artifactId); setError("");
    try { await brandRequest(accountId, `/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/portal`, { method: "PUT", body: JSON.stringify({ enabled, collections }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The website setting couldn't be saved."); }
    finally { setBusy(""); }
  }

  if (!data) return <section className="cpp" aria-busy={!error}><Header />{error ? <p className="cpp-error" role="alert">{error}</p> : <p className="cpp-muted"><LoaderCircle size={14} className="cpp-spin" /> Loading…</p>}</section>;
  if (!data.available) return <section className="cpp"><Header /><p className="cpp-muted">Client editing is being set up. Soon you&apos;ll be able to invite {clientName} to update their own menu, prices, hours and news.</p></section>;
  const active = data.access.filter(access => access.status === "active" || access.status === "invited");
  const mail = link && `mailto:${encodeURIComponent(link.email)}?subject=${encodeURIComponent("Edit your website content")}&body=${encodeURIComponent(`Hi${name ? ` ${name.split(" ")[0]}` : ""},\n\nYou can now update your website's content (like your menu, prices, opening hours and news) yourself. Open this link and sign in with this email address:\n\n${link.url}\n\nI'll review each change before it goes live.\n`)}`;

  return <section className="cpp" aria-labelledby={`cpp-${clientId}`}>
    <Header id={`cpp-${clientId}`} />
    <div className="cpp-sites">
      <h4>Websites they can edit</h4>
      {!data.sites.length && <p className="cpp-muted">No websites for this client yet.</p>}
      <ul>{data.sites.map(site => <li key={site.artifactId}>
        <div><strong>{site.title}</strong>
          <span className="cpp-muted">{!site.hasContent ? "No editable content yet. Open the website’s Publish tab and choose “Make this site client-editable”." : site.pending ? `${site.pending} change${site.pending === 1 ? "" : "s"} waiting for your review in the website's Publish tab` : site.enabled ? "Client can edit content; you approve every change" : "Editing is off"}</span></div>
        {canEdit && site.hasContent && <label className="cpp-switch"><input type="checkbox" checked={site.enabled} disabled={busy === site.artifactId} onChange={event => void toggleSite(site.artifactId, event.target.checked, site.collections)} /> <span>{site.enabled ? "On" : "Off"}</span></label>}
      </li>)}</ul>
    </div>

    <div className="cpp-people">
      <h4>People with access</h4>
      {!data.access.length && <p className="cpp-muted">Nobody yet.</p>}
      <ul>{data.access.map(access => <li key={access.id}>
        <div><strong>{access.displayName || access.email}</strong> <span className={`cpp-chip is-${access.status}`}>{STATUS[access.status]}</span>
          <span className="cpp-muted">{access.email} · {access.status === "active" ? `joined ${day(access.acceptedAt)}${access.lastSeenAt ? `, last seen ${day(access.lastSeenAt)}` : ""}` : `invited ${day(access.invitedAt)}`}{access.planLabel ? ` · ${access.planLabel}` : ""}{access.paidThrough ? ` · access until ${day(access.paidThrough)}` : ""}</span></div>
        {canEdit && (access.status === "invited" || access.status === "expired") && <button type="button" className="button secondary small" disabled={Boolean(busy)} onClick={() => void resend(access)}><RefreshCw size={14} /> New link</button>}
        {canEdit && access.status !== "revoked" && (confirm === access.id
          ? <span className="cpp-confirm"><button type="button" className="button small cpp-danger" disabled={Boolean(busy)} onClick={() => void revoke(access)}>Remove access</button><button type="button" className="button secondary small" onClick={() => setConfirm(null)}>Keep</button></span>
          : <button type="button" className="cpp-icon" aria-label={`Remove access for ${access.email}`} title="Remove access" onClick={() => setConfirm(access.id)}><X size={15} /></button>)}
      </li>)}</ul>
    </div>

    {canEdit && <form className="cpp-invite" onSubmit={invite}>
      <h4><UserPlus size={15} /> {active.length ? "Invite someone else" : `Invite ${clientName}`}</h4>
      <div className="cpp-row">
        <label>Email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} maxLength={254} placeholder="owner@business.com" /></label>
        <label>Name<input value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Their name" /></label>
      </div>
      <button type="submit" className="button primary" disabled={busy === "invite" || !email.trim()}>{busy === "invite" ? <LoaderCircle size={15} className="cpp-spin" /> : <KeyRound size={15} />} Create invite link</button>
      <p className="cpp-muted">They sign in with a one-time code sent to this email. They can only edit the content you allow, never the design or code, and every change waits for your approval.</p>
    </form>}

    {link && <div className="cpp-link" role="status">
      <p><strong>Invite link for {link.email}</strong> · send it now: it&apos;s shown only once and works for 14 days.</p>
      <div className="cpp-row"><input readOnly value={link.url} aria-label="Invite link" onFocus={event => event.currentTarget.select()} />
        <button type="button" className="button secondary small" onClick={async () => { await navigator.clipboard.writeText(link.url); setCopied(true); }}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button>
        {mail && <a className="button secondary small" href={mail}><Mail size={14} /> Email it</a>}</div>
    </div>}
    {error && <p className="cpp-error" role="alert">{error}</p>}
  </section>;
}

function Header({ id }: { id?: string }) {
  return <div className="cpp-head"><h3 id={id}><KeyRound size={17} /> Client editing</h3><p className="cpp-muted">Let your client update their own content, like menus, prices, opening hours and news, in a simple portal with your branding.</p></div>;
}
