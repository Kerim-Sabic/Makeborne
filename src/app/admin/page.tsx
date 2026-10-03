import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleDashed, CreditCard, Database, Globe2, Layers3, LockKeyhole, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import { getCloudStatus } from "@/lib/cloud/config";
import { PLANNED_ROUTES } from "@/lib/routing/registry";
import "./admin.css";

export const metadata: Metadata = { title: "Studio operations", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function AdminPage() {
  // Never expose an operations console through a client-side role or local storage.
  // Production remains closed until a server-owned administrator policy exists.
  if (process.env.NODE_ENV !== "development") notFound();
  const cloud = getCloudStatus();
  const configuredRoutes = PLANNED_ROUTES.filter(route => route.status !== "unconfigured").length;
  const checks = [
    { label: "Supabase configuration", set: cloud.configured, detail: "Project URL and publishable key are accepted by the app configuration reader." },
    { label: "Migration verification flag", set: cloud.migrationsVerified, detail: "Operator acknowledgement only. This page does not run database or permission checks." },
    { label: "Cloud workspace enabled", set: cloud.enabled, detail: "The app requires configuration, migration acknowledgement, and its cloud feature flag." },
  ];

  return <div className="mbo-shell">
    <a className="mbo-skip" href="#operations-main">Skip to operations</a>
    <header className="mbo-topbar">
      <Link className="mbo-brand" href="/studio"><BrandMark /><span>Makeborne<span className="mbo-brand-divider">/</span><small>Operations</small></span></Link>
      <div className="mbo-top-actions"><span className="mbo-environment"><span />Development</span><Link href="/studio"><ArrowLeft size={15} />Back to studio</Link></div>
    </header>
    <main id="operations-main" className="mbo-main">
      <section className="mbo-heading"><div><span className="mbo-eyebrow">YOUR STUDIO, BEHIND THE SCENES</span><h1>A clear view of what’s next.</h1><p>Configuration, connected services, and the path to launch.</p></div><form action="/admin" method="get"><button className="mbo-refresh" type="submit"><RefreshCw size={15} />Refresh status</button></form></section>

      <section className="mbo-overview" aria-labelledby="launch-heading">
        <div className="mbo-overview-copy"><span className="mbo-pill"><CircleDashed size={13} />Setup in progress</span><h2 id="launch-heading">Build with confidence.<br />Launch when it’s ready.</h2><p>Your local studio is available. Cloud accounts, generation, billing, and publishing need connected services and end-to-end verification.</p><Link href="#setup">Review setup<ChevronRight size={16} /></Link></div>
        <div className="mbo-overview-stats"><div><span className="mbo-stat-icon"><Layers3 size={20} /></span><strong>Local studio</strong><span>Browser workspace available</span></div><div><span className="mbo-stat-icon"><Sparkles size={20} /></span><strong>{configuredRoutes} / {PLANNED_ROUTES.length} routes</strong><span>Configured in the model registry</span></div><div><span className="mbo-stat-icon"><LockKeyhole size={20} /></span><strong>Live purchases off</strong><span>Payment processing not connected</span></div></div>
      </section>

      <div className="mbo-content-grid">
        <section id="setup" className="mbo-panel" aria-labelledby="setup-heading"><div className="mbo-section-heading"><div><span className="mbo-eyebrow">FOUNDATION</span><h2 id="setup-heading">Cloud setup</h2></div><Database size={20} /></div><p className="mbo-section-description">A configuration snapshot, not a live health check. No credentials are displayed.</p><div className="mbo-checks">{checks.map(check => <div className="mbo-check" key={check.label}><span className={`mbo-check-icon${check.set ? " is-set" : ""}`}>{check.set ? <Check size={15} /> : <CircleDashed size={15} />}</span><div><h3>{check.label}</h3><p>{check.detail}</p></div><span className={`mbo-status${check.set ? " is-set" : ""}`}>{check.set ? "Set" : "Not set"}</span></div>)}</div><div className="mbo-panel-footer"><span>{cloud.enabled ? "Cloud is enabled by configuration; availability is unverified." : cloud.reason}</span><Link href="/studio/cloud">Open cloud studio<ArrowUpRight size={14} /></Link></div></section>

        <section className="mbo-panel mbo-next" aria-labelledby="next-heading"><div className="mbo-section-heading"><div><span className="mbo-eyebrow">LAUNCH SEQUENCE</span><h2 id="next-heading">The next milestones</h2></div></div><ol><li><span>01</span><div><h3>Connect the foundation</h3><p>Configure a development database, apply migrations, and verify account isolation.</p></div></li><li><span>02</span><div><h3>Prove the creation flow</h3><p>Connect approved models and workers. Verify outputs, usage, retries, and cost limits.</p></div></li><li><span>03</span><div><h3>Activate commerce & hosting</h3><p>Verify checkout events, credit accounting, publishing, and recovery before launch.</p></div></li></ol></section>
      </div>

      <section aria-labelledby="services-heading" className="mbo-services"><div className="mbo-section-heading"><div><span className="mbo-eyebrow">CONNECTED SERVICES</span><h2 id="services-heading">The engines behind the studio</h2></div><span className="mbo-muted">No live service checks performed</span></div><div className="mbo-service-grid">
        <article><Sparkles size={21} /><span className="mbo-status">Not connected</span><h3>Generation & media</h3><p>Automatic routing contracts are prepared. Live generation and clipping workers are not installed.</p><details><summary>View generation capabilities</summary><ul>{["Content & website creation", "Image & slide design", "Media transcription", "Clip selection & rendering"].map(capability => <li key={capability}><span>{capability}</span><small>Not connected</small></li>)}</ul></details></article>
        <article><CreditCard size={21} /><span className="mbo-status">Not connected</span><h3>Payments & credits</h3><p>Billing views are prepared. A verified account ledger, checkout, and payment events are still required.</p><Link href="/billing">View plans & credits<ArrowUpRight size={15} /></Link></article>
        <article><Globe2 size={21} /><span className="mbo-status">Not connected</span><h3>Website hosting</h3><p>Client websites can have delivery links. Automatic deployment and domain management are not connected.</p><Link href="/studio?tab=clients">Open client workspace<ArrowUpRight size={15} /></Link></article>
      </div></section>
      <footer className="mbo-note"><ShieldCheck size={19} /><div><strong>Development operations only</strong><p>This read-only page is unavailable in production. It contains no customer records or account metrics. Production administration needs verified identity and a server-owned access policy.</p></div></footer>
    </main>
  </div>;
}
