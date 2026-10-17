"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Clock, LoaderCircle, PencilLine } from "lucide-react";
import type { PortalHome as Home } from "@/lib/portal/contracts";
import PortalShell from "./portal-shell";
import { PortalError, portalRequest } from "./portal-api";

const STATUS: Record<string, string> = { draft: "Unsent changes", pending: "Waiting for review", approved: "Changes approved", rejected: "Changes not approved", withdrawn: "" };

/** The client's sites, grouped by agency. */
export default function PortalHome() {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    portalRequest<Home>("/api/portal").then(setHome, cause => {
      if (cause instanceof PortalError && cause.status === 401) { window.location.replace("/portal/login?next=/portal"); return; }
      setError(cause instanceof Error ? cause.message : "Your sites couldn't load.");
    });
  }, []);

  if (error) return <PortalShell><div className="portal-card"><h1>Client portal</h1><p className="portal-error" role="alert">{error}</p></div></PortalShell>;
  if (!home) return <PortalShell><p className="portal-muted" aria-busy="true"><LoaderCircle size={16} className="portal-spin" /> Loading your sites…</p></PortalShell>;
  const brand = home.grants.length === 1 ? home.grants[0].agency : null;
  return <PortalShell brand={brand} email={home.email}>
    <h1 className="portal-title">Your websites</h1>
    {!home.grants.length && <div className="portal-card"><p>You don&apos;t have access to any websites yet. When your agency invites you, open the link in their email.</p></div>}
    {home.grants.map(grant => <section key={grant.accessId} className="portal-group" aria-label={`${grant.agency.name} for ${grant.client.name}`}>
      {home.grants.length > 1 && <h2>{grant.client.name} <span className="portal-muted">· {grant.agency.name}</span></h2>}
      {!grant.sites.length && <div className="portal-card"><p className="portal-muted">{grant.agency.name} hasn&apos;t turned on editing for any of your websites yet.</p></div>}
      <ul className="portal-sites">{grant.sites.map(site => <li key={site.artifactId} className="portal-card portal-site">
        <div>
          <h3>{site.title}</h3>
          {site.liveUrl ? <a className="portal-muted" href={site.liveUrl} target="_blank" rel="noreferrer noopener">{site.liveUrl.replace(/^https:\/\//, "")} <ArrowUpRight size={13} /></a> : <span className="portal-muted">Not published yet</span>}
          {site.change && STATUS[site.change.status] && <span className={`portal-chip is-${site.change.status}`}><Clock size={12} /> {STATUS[site.change.status]}</span>}
        </div>
        <Link className="portal-button" href={`/portal/sites/${site.artifactId}`}><PencilLine size={16} /> Edit content</Link>
      </li>)}</ul>
    </section>)}
  </PortalShell>;
}
