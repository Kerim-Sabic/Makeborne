import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleDashed, CreditCard, Database, Globe2, LockKeyhole, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import { getAccountPrivileges } from "@/lib/account/privileges";
import { billingUser } from "@/lib/billing/access";
import { getCapabilities } from "@/lib/capabilities/server";
import "./admin.css";

export const metadata: Metadata = { title: "Studio operations", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await billingUser();
  if (!user) redirect("/login?next=%2Fadmin");
  const accountPrivileges = await getAccountPrivileges(user.id);
  if (!accountPrivileges.isAdmin) notFound();
  const { operations } = getCapabilities({ administrator: true });
  const { cloud, pilot, hosting, billing, routing } = operations;
  const checks = [
    { label: "Supabase configuration", set: cloud.configured, detail: "Project URL and publishable key are accepted by the app configuration reader." },
    { label: "Migration verification flag", set: cloud.migrationsVerified, detail: "Operator acknowledgement only. This page does not run database or permission checks." },
    { label: "Cloud workspace enabled", set: cloud.enabled, detail: "The app requires configuration, migration acknowledgement, and its cloud feature flag." },
  ];

  return <div className="mbo-shell">
    <a className="mbo-skip" href="#operations-main">Skip to operations</a>
    <header className="mbo-topbar">
      <Link className="mbo-brand" href="/studio"><BrandMark /><span>Makeborne<span className="mbo-brand-divider">/</span><small>Operations</small></span></Link>
      <div className="mbo-top-actions"><span className="mbo-environment"><span />Administrator</span><Link href="/studio"><ArrowLeft size={15} />Back to studio</Link></div>
    </header>
    <main id="operations-main" className="mbo-main">
      <section className="mbo-heading"><div><span className="mbo-eyebrow">YOUR STUDIO, BEHIND THE SCENES</span><h1>A clear view of what’s next.</h1><p>Configuration, connected services, and the path to launch.</p></div><form action="/admin" method="get"><button className="mbo-refresh" type="submit"><RefreshCw size={15} />Refresh status</button></form></section>

      <section className="mbo-overview" aria-labelledby="launch-heading">
        <div className="mbo-overview-copy"><span className="mbo-pill"><ShieldCheck size={13} />Administrator access</span><h2 id="launch-heading">Your studio.<br />A clear view ahead.</h2><p>{accountPrivileges.unlimitedCredits ? "Your administrator credit allowance requires no creation subscription. Provider spending limits still apply. " : "Your account can view studio operations. "}{pilot.reason}</p><Link href="/billing#credits">View your allowance<ChevronRight size={16} /></Link></div>
        <div className="mbo-overview-stats"><div><span className="mbo-stat-icon"><ShieldCheck size={20} /></span><strong>{accountPrivileges.unlimitedCredits ? "Unlimited credits" : "Administrator account"}</strong><span>{accountPrivileges.unlimitedCredits ? "Administrator allowance" : "Operations access enabled"}</span></div><div><span className="mbo-stat-icon"><Sparkles size={20} /></span><strong>{routing.configured} / {routing.total} routes</strong><span>Registry configuration; pilot tracked separately</span></div><div><span className="mbo-stat-icon"><LockKeyhole size={20} /></span><strong>{pilot.available ? "Administrator pilot" : "Pilot unavailable"}</strong><span>Public generation is not active</span></div></div>
      </section>

      <div className="mbo-content-grid">
        <section id="setup" className="mbo-panel" aria-labelledby="setup-heading"><div className="mbo-section-heading"><div><span className="mbo-eyebrow">FOUNDATION</span><h2 id="setup-heading">Cloud setup</h2></div><Database size={20} /></div><p className="mbo-section-description">A configuration snapshot, not a live health check. No credentials are displayed.</p><div className="mbo-checks">{checks.map(check => <div className="mbo-check" key={check.label}><span className={`mbo-check-icon${check.set ? " is-set" : ""}`}>{check.set ? <Check size={15} /> : <CircleDashed size={15} />}</span><div><h3>{check.label}</h3><p>{check.detail}</p></div><span className={`mbo-status${check.set ? " is-set" : ""}`}>{check.set ? "Set" : "Not set"}</span></div>)}</div><div className="mbo-panel-footer"><span>{cloud.enabled ? "Cloud is enabled by configuration; availability is unverified." : cloud.reason}</span><Link href="/studio/cloud">Open cloud studio<ArrowUpRight size={14} /></Link></div></section>

        <section className="mbo-panel mbo-next" aria-labelledby="next-heading"><div className="mbo-section-heading"><div><span className="mbo-eyebrow">LAUNCH SEQUENCE</span><h2 id="next-heading">The next milestones</h2></div></div><ol><li><span>01</span><div><h3>Review the foundation</h3><p>Review migrations, account isolation, access controls, and workspace recovery.</p></div></li><li><span>02</span><div><h3>Prove the creation flow</h3><p>Connect approved models and workers. Verify outputs, usage, retries, and cost limits.</p></div></li><li><span>03</span><div><h3>Activate commerce & hosting</h3><p>Verify checkout events, credit accounting, publishing, and recovery before launch.</p></div></li></ol></section>
      </div>

      <section aria-labelledby="services-heading" className="mbo-services"><div className="mbo-section-heading"><div><span className="mbo-eyebrow">CONNECTED SERVICES</span><h2 id="services-heading">The engines behind the studio</h2></div><span className="mbo-muted">No live service checks performed</span></div><div className="mbo-service-grid">
        <article><Sparkles size={21} /><span className="mbo-status">{pilot.available ? "Restricted testing" : "Pilot unavailable"}</span><h3>Generation & media</h3><p>{pilot.reason} The pilot covers static websites and text drafts; image generation and media processing remain unavailable.</p><details><summary>View generation capabilities</summary><ul>{[{name:"Static websites & text drafts",status:pilot.available ? "Admin testing" : "Unavailable"},{name:"Image & full-slide generation",status:"Unavailable"},{name:"Media transcription",status:"Unavailable"},{name:"Clip selection & rendering",status:"Unavailable"}].map(capability => <li key={capability.name}><span>{capability.name}</span><small>{capability.status}</small></li>)}</ul></details></article>
        <article><CreditCard size={21} /><span className="mbo-status">Credit delivery incomplete</span><h3>Payments & credits</h3><p>{billing.reason} Coffee support does not unlock creation.</p><Link href="/billing">View plans & credits<ArrowUpRight size={15} /></Link></article>
        <article><Globe2 size={21} /><span className="mbo-status">{hosting.configured ? "Configuration set" : "Setup incomplete"}</span><h3>Website hosting</h3><p>{hosting.reason} Customer backends and self-service custom domains require further implementation.</p><Link href="/studio?tab=clients">Open client workspace<ArrowUpRight size={15} /></Link></article>
      </div></section>
      <footer className="mbo-note"><ShieldCheck size={19} /><div><strong>Protected administrator workspace</strong><p>Access is checked against your authenticated account and its administrator role on the server, including in production. This page shows configuration and your allowance; it does not certify service availability or launch readiness.</p></div></footer>
    </main>
  </div>;
}
