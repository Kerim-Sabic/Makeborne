import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Bot, CheckCircle2, CreditCard, Globe2, Users, Wallet } from "lucide-react";
import type { adminOverview } from "@/lib/admin/console";
import { CREATION_PLANS } from "@/lib/billing/plans";
import { count, exactTime, relative, titleCase, usdFromCents, usdFromMicro } from "./format";

type Overview = Awaited<ReturnType<typeof adminOverview>>;
type Health = { staleOpenCalls?: number; overrunsToday?: number; scopes?: { scope: string; enabled: boolean; stopped: boolean; dailyLimitMicrousd: number; spentMicrousd: number; reservedMicrousd: number }[] | null };

/** What needs an operator's attention, worst first. Only real signals; no invented health. */
export function overviewAlerts(data: Overview) {
  const health = data.ai.limits as Health;
  const alerts: { tone: "danger" | "warning"; text: string; href: string }[] = [];
  for (const scope of health.scopes ?? []) if (scope.stopped) alerts.push({ tone: "danger", text: `AI spending for ${scope.scope} is stopped after an overrun. Review before clearing it.`, href: "?tab=credits" });
  if ((health.overrunsToday ?? 0) > 0) alerts.push({ tone: "danger", text: `${count(health.overrunsToday)} provider call${health.overrunsToday === 1 ? "" : "s"} cost more than their bound today.`, href: "?tab=credits" });
  if ((health.staleOpenCalls ?? 0) > 0) alerts.push({ tone: "warning", text: `${count(health.staleOpenCalls)} AI call${health.staleOpenCalls === 1 ? " is" : "s are"} still open past the hold deadline.`, href: "?tab=credits" });
  if (data.openPlanIssues > 0) alerts.push({ tone: "warning", text: `${count(data.openPlanIssues)} subscription credit allocation${data.openPlanIssues === 1 ? " needs" : "s need"} review.`, href: "?tab=subscriptions" });
  if (data.billingJobs.lastSuccessAt && data.billingJobs.overdue) alerts.push({ tone: "warning", text: "Billing reconciliation has not succeeded in the last 36 hours.", href: "?tab=subscriptions" });
  if (data.billingJobs.failuresLast24h > 0) alerts.push({ tone: "warning", text: `${count(data.billingJobs.failuresLast24h)} billing reconciliation run${data.billingJobs.failuresLast24h === 1 ? "" : "s"} failed in the last 24 hours.`, href: "?tab=subscriptions" });
  return alerts;
}

export default function OverviewTab({ data, now }: { data: Overview; now: number }) {
  const alerts = overviewAlerts(data);
  const health = data.ai.limits as Health;
  const spentToday = data.ai.today.reduce((total, scope) => total + Number(scope.spentMicrousd), 0);
  const enabledLimits = (health.scopes ?? []).filter(scope => scope.enabled);
  const granted = Object.entries(data.credits.ledger30d).filter(([, value]) => value.credits > 0).reduce((total, [, value]) => total + value.credits, 0);
  return <>
    <section className="mbo-alerts" aria-label="Needs attention">
      {alerts.length ? alerts.map(alert => <Link key={alert.text} href={alert.href} className={`mbo-alert is-${alert.tone}`}><AlertTriangle size={16} aria-hidden="true" /><span>{alert.text}</span><ArrowUpRight size={14} aria-hidden="true" /></Link>)
        : <p className="mbo-alert is-ok"><CheckCircle2 size={16} aria-hidden="true" /><span>Nothing needs attention. Figures as of {exactTime(data.generatedAt)}.</span></p>}
    </section>

    <section className="mbo-kpis" aria-label="Key figures">
      <Link href="?tab=customers" className="mbo-kpi"><span className="mbo-kpi-label"><Users size={15} aria-hidden="true" />Customers</span><strong>{count(data.users.total)}</strong><span>{count(data.users.new7d)} new this week · {count(data.users.active7d)} active</span></Link>
      <Link href="?tab=subscriptions" className="mbo-kpi"><span className="mbo-kpi-label"><CreditCard size={15} aria-hidden="true" />Subscribers</span><strong>{count(data.revenue.currentSubscribers)}</strong><span>{usdFromCents(data.revenue.monthlyCents)} estimated monthly revenue</span></Link>
      <Link href="?tab=credits" className="mbo-kpi"><span className="mbo-kpi-label"><Wallet size={15} aria-hidden="true" />Credits outstanding</span><strong>{count(data.credits.balance)}</strong><span>{count(data.credits.reserved)} reserved · {count(granted)} granted in 30 days</span></Link>
      <Link href="?tab=credits" className="mbo-kpi"><span className="mbo-kpi-label"><Bot size={15} aria-hidden="true" />AI spend today</span><strong>{usdFromMicro(spentToday)}</strong><span>{enabledLimits.length ? `${enabledLimits.length} provider limit${enabledLimits.length === 1 ? "" : "s"} on` : "All provider limits off · generation paused"}</span></Link>
    </section>

    <div className="mbo-two">
      <section className="mbo-panel" aria-labelledby="growth-heading">
        <header className="mbo-panel-head"><h2 id="growth-heading">Customers</h2><Link href="?tab=customers">View all<ArrowUpRight size={13} aria-hidden="true" /></Link></header>
        <dl className="mbo-stats">
          <div><dt>Total accounts</dt><dd>{count(data.users.total)}</dd></div>
          <div><dt>Email confirmed</dt><dd>{count(data.users.confirmed)}</dd></div>
          <div><dt>New in 7 days</dt><dd>{count(data.users.new7d)}</dd></div>
          <div><dt>New in 30 days</dt><dd>{count(data.users.new30d)}</dd></div>
          <div><dt>Signed in within 7 days</dt><dd>{count(data.users.active7d)}</dd></div>
          <div><dt>Administrators</dt><dd>{count(data.users.admins)}</dd></div>
        </dl>
      </section>
      <section className="mbo-panel" aria-labelledby="revenue-heading">
        <header className="mbo-panel-head"><h2 id="revenue-heading">Recurring revenue</h2><Link href="?tab=subscriptions">Subscriptions<ArrowUpRight size={13} aria-hidden="true" /></Link></header>
        <p className="mbo-big">{usdFromCents(data.revenue.monthlyCents)}<span>/ month · {usdFromCents(data.revenue.annualCents)} / year</span></p>
        {data.revenue.plans.length ? <ul className="mbo-bars">{data.revenue.plans.map(plan => {
          const share = data.revenue.monthlyCents ? plan.monthlyCents / data.revenue.monthlyCents : 0;
          return <li key={`${plan.tier}:${plan.interval}`}><span>{CREATION_PLANS.find(item => item.id === plan.tier)?.name} {plan.interval}</span><span className="mbo-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, share * 100)}%` }} /></span><span>{count(plan.subscribers)} · {usdFromCents(plan.monthlyCents)}</span></li>;
        })}</ul> : <p className="mbo-empty">No current subscribers yet.</p>}
        <p className="mbo-footnote">At standard list prices; discounts, tax, payment fees and refunds are not reflected.{data.revenue.unpricedSubscribers ? ` ${count(data.revenue.unpricedSubscribers)} subscriber${data.revenue.unpricedSubscribers === 1 ? "" : "s"} on an unrecognised plan are excluded.` : ""}</p>
      </section>
    </div>

    <div className="mbo-two">
      <section className="mbo-panel" aria-labelledby="hosting-heading">
        <header className="mbo-panel-head"><h2 id="hosting-heading"><Globe2 size={16} aria-hidden="true" />Websites & content</h2></header>
        <dl className="mbo-stats">
          <div><dt>Live websites</dt><dd>{count(data.hosting.live)}</dd></div>
          <div><dt>With interactivity</dt><dd>{count(data.hosting.interactive)}</dd></div>
          <div><dt>Enquiries in 7 days</dt><dd>{count(data.hosting.enquiries7d)}</dd></div>
          <div><dt>Workspaces</dt><dd>{count(data.content.workspaces)}</dd></div>
          {Object.entries(data.content.artifacts).map(([kind, total]) => <div key={kind}><dt>{titleCase(kind)}s</dt><dd>{count(total)}</dd></div>)}
        </dl>
      </section>
      <section className="mbo-panel" aria-labelledby="billing-job-heading">
        <header className="mbo-panel-head"><h2 id="billing-job-heading">Billing reconciliation</h2></header>
        <dl className="mbo-stats">
          <div><dt>Last success</dt><dd title={exactTime(data.billingJobs.lastSuccessAt)}>{data.billingJobs.lastSuccessAt ? relative(data.billingJobs.lastSuccessAt, now) : "Not run yet"}</dd></div>
          <div><dt>Failures (24 h)</dt><dd>{count(data.billingJobs.failuresLast24h)}</dd></div>
          <div><dt>Open allocation issues</dt><dd>{count(data.openPlanIssues)}</dd></div>
          <div><dt>Checkouts started (24 h)</dt><dd>{count(data.checkouts.open24h)}</dd></div>
        </dl>
      </section>
    </div>
  </>;
}
