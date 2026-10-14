import Link from "next/link";
import type { adminOverview } from "@/lib/admin/console";
import { CREATION_PLANS } from "@/lib/billing/plans";
import { count, exactTime, relative, titleCase, usdFromCents, usdFromMicro } from "./format";

type Overview = Awaited<ReturnType<typeof adminOverview>>;
const planName = (tier: string) => CREATION_PLANS.find(plan => plan.id === tier)?.name ?? (tier === "unknown" ? "Plan not observed yet" : tier);
const PROVIDER_NAMES: Record<string, string> = { global: "All providers", anthropic: "Anthropic", openai: "OpenAI", deepseek: "DeepSeek", qwen_hosted: "Qwen (hosted)", self_hosted: "Self-hosted models", media_worker: "Media worker" };
const LEDGER_LABELS: Record<string, string> = { plan_grant: "Plan allowances granted", trial: "Trial credits granted", topup: "Credit packs", adjust: "Manual adjustments", refund: "Refunded to customers", settle: "Used by AI runs", reserve: "Reserved for runs", release: "Released from runs", expire: "Expired" };

/** A group's label: current access first, then the provider status as recorded. */
function groupLabel(group: { status: string; current: boolean }): { text: string; tone: "good" | "warn" | "muted" | "bad" } {
  if (group.current) return group.status === "canceling" ? { text: "Cancelling", tone: "warn" } : { text: "Active", tone: "good" };
  if (group.status === "past_due") return { text: "Past due", tone: "bad" };
  if (["active", "canceling"].includes(group.status)) return { text: "Period ended", tone: "warn" };
  return { text: titleCase(group.status), tone: "muted" };
}

export function SubscriptionsTab({ data, now }: { data: Overview; now: number }) {
  const groups = [...data.subscriptions].sort((a, b) => Number(b.current) - Number(a.current) || b.count - a.count);
  return <>
    <section className="mbo-kpis" aria-label="Subscription figures">
      <div className="mbo-kpi"><span className="mbo-kpi-label">Current subscribers</span><strong>{count(data.revenue.currentSubscribers)}</strong><span>Active or cancelling, period not ended</span></div>
      <div className="mbo-kpi"><span className="mbo-kpi-label">Estimated monthly revenue</span><strong>{usdFromCents(data.revenue.monthlyCents)}</strong><span>{usdFromCents(data.revenue.annualCents)} a year at list prices</span></div>
      <div className="mbo-kpi"><span className="mbo-kpi-label">Checkouts started</span><strong>{count(data.checkouts.open24h)}</strong><span>In the last 24 hours · {count(data.checkouts.total)} ever</span></div>
      <div className="mbo-kpi"><span className="mbo-kpi-label">Allocation issues</span><strong>{count(data.openPlanIssues)}</strong><span>{data.openPlanIssues ? "Months without payment evidence" : "None open"}</span></div>
    </section>
    <section className="mbo-panel" aria-labelledby="subscriptions-heading">
      <header className="mbo-panel-head"><h2 id="subscriptions-heading">Subscriptions by plan and status</h2><Link href="?tab=customers&filter=subscribed">Subscribed customers</Link></header>
      {groups.length ? <div className="mbo-table-wrap"><table className="mbo-table"><caption className="mbo-sr">Subscriptions grouped by status, plan and billing interval</caption>
        <thead><tr><th scope="col">Status</th><th scope="col">Plan</th><th scope="col">Billing</th><th scope="col" className="is-num">Subscriptions</th></tr></thead>
        <tbody>{groups.map(group => { const label = groupLabel(group);
          return <tr key={`${group.status}:${group.tier}:${group.interval}:${group.current}`}><td><span className={`mbo-badge is-${label.tone}`}>{label.text}</span></td><td>{planName(group.tier)}</td><td>{group.interval === "unknown" ? "—" : titleCase(group.interval)}</td><td className="is-num">{count(group.count)}</td></tr>; })}</tbody></table></div>
        : <p className="mbo-empty">No subscriptions yet. They appear here after the first verified purchase.</p>}
    </section>
    <section className="mbo-panel" aria-labelledby="reconcile-heading">
      <header className="mbo-panel-head"><h2 id="reconcile-heading">Billing reconciliation</h2></header>
      <dl className="mbo-stats">
        <div><dt>Last successful run</dt><dd title={exactTime(data.billingJobs.lastSuccessAt)}>{data.billingJobs.lastSuccessAt ? relative(data.billingJobs.lastSuccessAt, now) : "Not run yet"}</dd></div>
        <div><dt>Failed runs (24 h)</dt><dd>{count(data.billingJobs.failuresLast24h)}</dd></div>
        <div><dt>Open allocation issues</dt><dd>{count(data.openPlanIssues)}</dd></div>
      </dl>
      <p className="mbo-footnote">The reconciliation job compares memberships and payments with Whop and grants each paid month once. While it is switched off (before launch), the last run does not move.</p>
    </section>
  </>;
}

export function CreditsTab({ data }: { data: Overview }) {
  const ledger = Object.entries(data.credits.ledger30d).sort((a, b) => Math.abs(b[1].credits) - Math.abs(a[1].credits));
  const runs = Object.entries(data.ai.runs7d);
  const health = data.ai.limits as { scopes?: { scope: string; enabled: boolean; stopped: boolean; dailyLimitMicrousd: number; spentMicrousd: number; reservedMicrousd: number }[] | null; openCalls?: number; staleOpenCalls?: number; overrunsToday?: number; uncertainTodayMicrousd?: number };
  return <>
    <section className="mbo-kpis" aria-label="Credit figures">
      <div className="mbo-kpi"><span className="mbo-kpi-label">Credits outstanding</span><strong>{count(data.credits.balance)}</strong><span>Across {count(data.credits.wallets)} wallet{data.credits.wallets === 1 ? "" : "s"}</span></div>
      <div className="mbo-kpi"><span className="mbo-kpi-label">Reserved now</span><strong>{count(data.credits.reserved)}</strong><span>Held for runs in progress</span></div>
      <div className="mbo-kpi"><span className="mbo-kpi-label">AI calls open</span><strong>{count(health.openCalls)}</strong><span>{count(health.staleOpenCalls)} past their deadline</span></div>
      <div className="mbo-kpi"><span className="mbo-kpi-label">Uncertain spend today</span><strong>{usdFromMicro(health.uncertainTodayMicrousd)}</strong><span>Counted at the bound until reconciled</span></div>
    </section>
    <div className="mbo-two">
      <section className="mbo-panel" aria-labelledby="ledger-heading">
        <header className="mbo-panel-head"><h2 id="ledger-heading">Credit movements · 30 days</h2></header>
        {ledger.length ? <ul className="mbo-list">{ledger.map(([kind, value]) => <li key={kind}><span>{LEDGER_LABELS[kind] ?? titleCase(kind)}</span><span className={value.credits < 0 ? "is-negative" : "is-positive"}>{value.credits > 0 ? "+" : ""}{count(value.credits)} <small>({count(value.entries)})</small></span></li>)}</ul> : <p className="mbo-empty">No credit movements in the last 30 days.</p>}
      </section>
      <section className="mbo-panel" aria-labelledby="runs-heading">
        <header className="mbo-panel-head"><h2 id="runs-heading">AI runs · 7 days</h2></header>
        {runs.length ? <ul className="mbo-list">{runs.map(([outcome, value]) => <li key={outcome}><span>{titleCase(outcome)} · {count(value.runs)} run{value.runs === 1 ? "" : "s"}</span><span>{count(value.chargedCredits)} charged · {count(value.absorbedCredits)} absorbed · {usdFromMicro(value.providerMicrousd)}</span></li>)}</ul> : <p className="mbo-empty">No AI runs in the last 7 days.</p>}
      </section>
    </div>
    <section className="mbo-panel" aria-labelledby="limits-heading">
      <header className="mbo-panel-head"><h2 id="limits-heading">Daily AI spending limits</h2></header>
      <div className="mbo-table-wrap"><table className="mbo-table"><caption className="mbo-sr">Provider spending limits for today (UTC)</caption>
        <thead><tr><th scope="col">Provider</th><th scope="col">State</th><th scope="col" className="is-num">Spent today</th><th scope="col" className="is-num">Reserved</th><th scope="col" className="is-num">Daily limit</th><th scope="col">Used</th></tr></thead>
        <tbody>{(health.scopes ?? []).map(scope => { const used = scope.dailyLimitMicrousd ? Math.min(1, (scope.spentMicrousd + scope.reservedMicrousd) / scope.dailyLimitMicrousd) : 0;
          return <tr key={scope.scope}><th scope="row">{PROVIDER_NAMES[scope.scope] ?? titleCase(scope.scope)}</th><td><span className={`mbo-badge is-${scope.stopped ? "bad" : scope.enabled ? "good" : "muted"}`}>{scope.stopped ? "Stopped" : scope.enabled ? "On" : "Off"}</span></td><td className="is-num">{usdFromMicro(scope.spentMicrousd)}</td><td className="is-num">{usdFromMicro(scope.reservedMicrousd)}</td><td className="is-num">{scope.enabled ? usdFromMicro(scope.dailyLimitMicrousd) : "—"}</td>
            <td>{scope.enabled ? <span className="mbo-meter" role="img" aria-label={`${Math.round(used * 100)}% of the daily limit used`}><i className={used >= .8 ? "is-high" : ""} style={{ width: `${Math.max(used * 100, 1)}%` }} /></span> : "—"}</td></tr>; })}</tbody></table></div>
      <p className="mbo-footnote">Limits are changed only by the database owner (`set_live_provider_limit`); this page cannot change them. A stopped provider stays stopped until an overrun is reviewed.</p>
    </section>
  </>;
}
