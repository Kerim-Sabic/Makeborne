import Link from "next/link";
import { ArrowUpRight, Check, CircleDashed, CreditCard, Database, Globe2, Sparkles } from "lucide-react";
import type { getCapabilities } from "@/lib/capabilities/server";

type Operations = ReturnType<typeof getCapabilities>["operations"];

/** Configuration snapshot: what the app is set up to do, not a live health check. */
export default function SystemTab({ operations }: { operations: Operations }) {
  const { cloud, pilot, liveBuilder, hosting, billing, routing } = operations;
  const checks = [
    { label: "Supabase configuration", set: cloud.configured, detail: "Project URL and publishable key are accepted by the configuration reader." },
    { label: "Migration verification flag", set: cloud.migrationsVerified, detail: "Operator acknowledgement only; this page runs no database checks." },
    { label: "Cloud workspace enabled", set: cloud.enabled, detail: "Requires configuration, the migration acknowledgement and the cloud flag." },
  ];
  const services = [
    { icon: Sparkles, title: "Live builder", status: liveBuilder.enabledByConfiguration ? "Enabled by configuration · Health unverified" : liveBuilder.configured ? "Disabled by configuration" : "Setup incomplete", text: `${liveBuilder.reason} Provider spending limits still apply. Administrators are included.`, link: null },
    { icon: CircleDashed, title: "Legacy operator jobs", status: "Retired", text: `${pilot.reason} ${routing.configured} of ${routing.total} legacy model routes are configured; these counts do not determine live builder availability.`, link: null },
    { icon: CreditCard, title: "Payments & credits", status: billing.enabledByConfiguration ? "Enabled by configuration · Delivery unverified" : billing.configured ? "Disabled by configuration" : "Setup incomplete", text: billing.reason, link: { href: "/billing", label: "Plans & credits" } },
    { icon: Globe2, title: "Website hosting", status: hosting.configured ? "Configured" : "Setup incomplete", text: hosting.reason, link: { href: "/studio?tab=clients", label: "Client workspace" } },
  ];
  return <>
    <section className="mbo-panel" aria-labelledby="setup-heading">
      <header className="mbo-panel-head"><h2 id="setup-heading"><Database size={16} aria-hidden="true" />Cloud setup</h2><Link href="/studio/cloud">Cloud studio<ArrowUpRight size={13} aria-hidden="true" /></Link></header>
      <ul className="mbo-checklist">{checks.map(check => <li key={check.label}><span className={`mbo-check-icon${check.set ? " is-set" : ""}`} aria-hidden="true">{check.set ? <Check size={14} /> : <CircleDashed size={14} />}</span><div><strong>{check.label}</strong><p>{check.detail}</p></div><span className={`mbo-badge is-${check.set ? "good" : "muted"}`}>{check.set ? "Set" : "Not set"}</span></li>)}</ul>
      <p className="mbo-footnote">{cloud.enabled ? "Cloud is enabled by configuration; availability is not verified here." : cloud.reason}</p>
    </section>
    <section className="mbo-services" aria-label="Connected services">{services.map(service => <article key={service.title} className="mbo-panel mbo-service">
      <header className="mbo-panel-head"><h2><service.icon size={16} aria-hidden="true" />{service.title}</h2><span className="mbo-badge is-muted">{service.status}</span></header>
      <p>{service.text}</p>{service.link && <Link href={service.link.href}>{service.link.label}<ArrowUpRight size={13} aria-hidden="true" /></Link>}
    </article>)}</section>
    <p className="mbo-footnote">A configuration snapshot, not a service health check. No credentials are shown.</p>
  </>;
}
