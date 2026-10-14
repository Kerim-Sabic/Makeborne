import Link from "next/link";
import { ArrowLeft, ArrowRight, Search, ShieldCheck, X } from "lucide-react";
import { CUSTOMER_FILTERS, CUSTOMER_PAGE_SIZE, type AdminCustomer, type AdminCustomerDetail, type AdminCustomerPage, type AdminMembership, type CustomerFilter } from "@/lib/admin/console";
import { CREATION_PLANS } from "@/lib/billing/plans";
import { count, day, exactTime, relative, titleCase, usdFromMicro } from "./format";

const FILTER_LABELS: Record<CustomerFilter, string> = { all: "All", subscribed: "Subscribed", admin: "Administrators", unconfirmed: "Unconfirmed email" };
const FILTER_HEADINGS: Record<CustomerFilter, string> = { all: "All customers", subscribed: "Subscribed customers", admin: "Administrators", unconfirmed: "Email not confirmed" };
const planName = (tier: string | null) => CREATION_PLANS.find(plan => plan.id === tier)?.name ?? null;

/** One status label per membership, worded for support: what the customer can do now. */
export function membershipLabel(membership: AdminMembership | null, now: number): { text: string; tone: "good" | "warn" | "muted" | "bad" } {
  if (!membership) return { text: "No subscription", tone: "muted" };
  const ended = !membership.periodEnd || Date.parse(membership.periodEnd) <= now;
  if (membership.status === "canceling" && !ended) return { text: `Cancels ${day(membership.periodEnd)}`, tone: "warn" };
  if (membership.current) return { text: "Active", tone: "good" };
  if (membership.status === "past_due") return { text: "Past due", tone: "bad" };
  if (["active", "canceling"].includes(membership.status) && ended) return { text: "Period ended", tone: "warn" };
  return { text: titleCase(membership.status), tone: "muted" };
}

function query(base: { q: string; filter: CustomerFilter; page: number }, change: Partial<{ q: string; filter: CustomerFilter; page: number; customer: string | null }>) {
  const next = { ...base, ...change };
  const params = new URLSearchParams({ tab: "customers" });
  if (next.q) params.set("q", next.q);
  if (next.filter !== "all") params.set("filter", next.filter);
  if (next.page > 1) params.set("page", String(next.page));
  if (change.customer) params.set("customer", change.customer);
  // Jump to the detail panel, which sits below the list on narrower screens.
  return `?${params}${change.customer ? "#customer-detail" : ""}`;
}

export default function CustomersTab({ page, detail, state, now }: { page: AdminCustomerPage; detail: AdminCustomerDetail | null; state: { q: string; filter: CustomerFilter; page: number; customer: string | null }; now: number }) {
  const pages = Math.max(1, Math.ceil(page.total / CUSTOMER_PAGE_SIZE));
  const from = page.total ? page.offset + 1 : 0, to = page.offset + page.rows.length;
  return <div className={`mbo-customers${detail ? " has-detail" : ""}`}>
    <section className="mbo-panel" aria-labelledby="customers-heading">
      <header className="mbo-panel-head mbo-customers-head">
        <h2 id="customers-heading">{FILTER_HEADINGS[state.filter]} <span className="mbo-count">{count(page.total)}</span></h2>
        <form className="mbo-search" action="/admin" method="get" role="search">
          <input type="hidden" name="tab" value="customers" />
          {state.filter !== "all" && <input type="hidden" name="filter" value={state.filter} />}
          <label><Search size={15} aria-hidden="true" /><span className="mbo-sr">Search customers by email or ID</span>
            <input name="q" type="search" defaultValue={state.q} placeholder="Search email or customer ID" maxLength={200} autoComplete="off" spellCheck={false} /></label>
          <button type="submit">Search</button>
          {state.q && <Link className="mbo-clear" href={query(state, { q: "", page: 1 })} aria-label="Clear search"><X size={14} aria-hidden="true" /></Link>}
        </form>
      </header>
      <nav className="mbo-filters" aria-label="Filter customers">{CUSTOMER_FILTERS.map(filter => <Link key={filter} href={query(state, { filter, page: 1 })} aria-current={state.filter === filter ? "page" : undefined}>{FILTER_LABELS[filter]}</Link>)}</nav>
      {page.rows.length ? <div className="mbo-table-wrap"><table className="mbo-table">
        <caption className="mbo-sr">Customers {from} to {to} of {page.total}, newest first</caption>
        <thead><tr><th scope="col">Customer</th><th scope="col">Subscription</th><th scope="col" className="is-num">Credits</th><th scope="col">Joined</th><th scope="col">Last sign-in</th></tr></thead>
        <tbody>{page.rows.map(row => <CustomerRow key={row.id} row={row} state={state} now={now} selected={state.customer === row.id} />)}</tbody>
      </table></div> : <p className="mbo-empty">{state.q ? `No customer matches “${state.q}”.` : "No customers in this view yet."}</p>}
      {page.total > CUSTOMER_PAGE_SIZE && <nav className="mbo-pager" aria-label="Customer pages">
        <span>{count(from)}–{count(to)} of {count(page.total)}</span>
        {state.page > 1 ? <Link href={query(state, { page: state.page - 1 })} rel="prev"><ArrowLeft size={14} aria-hidden="true" />Previous</Link> : <span aria-disabled="true" className="is-disabled"><ArrowLeft size={14} aria-hidden="true" />Previous</span>}
        {state.page < pages ? <Link href={query(state, { page: state.page + 1 })} rel="next">Next<ArrowRight size={14} aria-hidden="true" /></Link> : <span aria-disabled="true" className="is-disabled">Next<ArrowRight size={14} aria-hidden="true" /></span>}
      </nav>}
    </section>
    {state.customer && <CustomerDetail detail={detail} close={query(state, {})} now={now} />}
  </div>;
}

function CustomerRow({ row, state, now, selected }: { row: AdminCustomer; state: { q: string; filter: CustomerFilter; page: number }; now: number; selected: boolean }) {
  const status = membershipLabel(row.membership, now);
  const plan = planName(row.membership?.tier ?? null);
  return <tr aria-selected={selected || undefined}>
    <th scope="row"><Link href={query(state, { customer: row.id })} className="mbo-customer-link">{row.email ?? "No email"}</Link>
      <span className="mbo-tags">{row.isAdmin && <span className="mbo-tag"><ShieldCheck size={11} aria-hidden="true" />Admin</span>}{!row.confirmed && <span className="mbo-tag is-warn">Unconfirmed</span>}{row.sites > 0 && <span className="mbo-tag">{row.sites} live site{row.sites === 1 ? "" : "s"}</span>}</span></th>
    <td><span className={`mbo-badge is-${status.tone}`}>{status.text}</span>{plan && <span className="mbo-sub">{plan} · {row.membership?.interval}</span>}</td>
    <td className="is-num">{row.unlimitedCredits ? "Unlimited" : count(row.credits.available)}{row.credits.reserved > 0 && <span className="mbo-sub">{count(row.credits.reserved)} reserved</span>}</td>
    <td><time dateTime={row.createdAt} title={exactTime(row.createdAt)}>{day(row.createdAt)}</time></td>
    <td><time dateTime={row.lastSignInAt ?? undefined} title={exactTime(row.lastSignInAt)}>{relative(row.lastSignInAt, now)}</time></td>
  </tr>;
}

function CustomerDetail({ detail, close, now }: { detail: AdminCustomerDetail | null; close: string; now: number }) {
  if (!detail) return <aside id="customer-detail" className="mbo-panel mbo-detail" aria-label="Customer"><header className="mbo-panel-head"><h2>Customer not found</h2><Link href={close} aria-label="Close customer"><X size={16} aria-hidden="true" /></Link></header><p className="mbo-empty">This customer no longer exists, or the link is incomplete.</p></aside>;
  const { profile, credits } = detail;
  const current = detail.memberships[0] ?? null;
  const status = membershipLabel(current, now);
  return <aside id="customer-detail" className="mbo-panel mbo-detail" aria-labelledby="customer-heading">
    <header className="mbo-panel-head"><div><h2 id="customer-heading">{profile.email ?? "No email"}</h2><p className="mbo-id"><span className="mbo-sr">Customer ID </span>{profile.id}</p></div><Link href={close} className="mbo-close" aria-label="Close customer"><X size={16} aria-hidden="true" /></Link></header>
    <dl className="mbo-facts">
      <div><dt>Subscription</dt><dd><span className={`mbo-badge is-${status.tone}`}>{status.text}</span>{current && planName(current.tier) && <> {planName(current.tier)} · {current.interval}</>}</dd></div>
      <div><dt>Credits available</dt><dd>{detail.privileges?.unlimitedCredits ? "Unlimited (administrator allowance)" : count(credits.available)}{credits.reserved > 0 && ` · ${count(credits.reserved)} reserved`}</dd></div>
      <div><dt>Joined</dt><dd title={exactTime(profile.createdAt)}>{day(profile.createdAt)}</dd></div>
      <div><dt>Last sign-in</dt><dd title={exactTime(profile.lastSignInAt)}>{relative(profile.lastSignInAt, now)}</dd></div>
      <div><dt>Email</dt><dd>{profile.confirmed ? "Confirmed" : "Not confirmed"}</dd></div>
      <div><dt>Sign-in methods</dt><dd>{profile.providers.length ? profile.providers.map(titleCase).join(", ") : "—"}</dd></div>
      {detail.privileges?.isAdmin && <div><dt>Role</dt><dd>Administrator{detail.privileges.reason ? ` · ${detail.privileges.reason}` : ""}</dd></div>}
    </dl>

    {detail.openIssues.length > 0 && <section className="mbo-detail-block"><h3>Needs review</h3><ul className="mbo-list">{detail.openIssues.map(issue => <li key={`${issue.membershipId}:${issue.allocationStart}`}><span>{titleCase(issue.kind)}</span><span>Allocation from {day(issue.allocationStart)}</span></li>)}</ul></section>}

    <section className="mbo-detail-block"><h3>Subscriptions <span className="mbo-count">{detail.memberships.length}</span></h3>
      {detail.memberships.length ? <ul className="mbo-list">{detail.memberships.map(membership => <li key={membership.membershipId}><span><span className={`mbo-badge is-${membershipLabel(membership, now).tone}`}>{membershipLabel(membership, now).text}</span> {planName(membership.tier) ?? membership.planId}{membership.interval ? ` · ${membership.interval}` : ""}</span><span>{membership.periodEnd ? `Period ends ${day(membership.periodEnd)}` : "No period"}<code>{membership.membershipId}</code></span></li>)}</ul> : <p className="mbo-empty">Never subscribed.</p>}</section>

    <section className="mbo-detail-block"><h3>Credit history</h3>
      {credits.ledger.length ? <div className="mbo-table-wrap"><table className="mbo-table is-compact"><caption className="mbo-sr">Latest credit changes</caption><thead><tr><th scope="col">When</th><th scope="col">Change</th><th scope="col" className="is-num">Credits</th><th scope="col" className="is-num">Balance</th></tr></thead>
        <tbody>{credits.ledger.map((entry, index) => <tr key={`${entry.createdAt}:${index}`}><td title={exactTime(entry.createdAt)}>{day(entry.createdAt)}</td><td>{titleCase(entry.kind)}</td><td className={`is-num ${entry.delta < 0 ? "is-negative" : "is-positive"}`}>{entry.delta > 0 ? "+" : ""}{count(entry.delta)}</td><td className="is-num">{count(entry.balanceAfter)}</td></tr>)}</tbody></table></div> : <p className="mbo-empty">No credit activity.</p>}
      {credits.lots.length > 0 && <details className="mbo-more"><summary>Credit lots ({credits.lots.length})</summary><ul className="mbo-list">{credits.lots.map((lot, index) => <li key={`${lot.createdAt}:${index}`}><span>{titleCase(lot.source)} · {count(lot.amount - lot.spent - lot.held - lot.lapsed)} left of {count(lot.amount)}</span><span>{lot.expiresAt ? `Expires ${day(lot.expiresAt)}` : "No expiry"}</span></li>)}</ul></details>}
    </section>

    {detail.runs.length > 0 && <section className="mbo-detail-block"><h3>Recent AI runs</h3><ul className="mbo-list">{detail.runs.map((run, index) => <li key={`${run.recordedAt}:${index}`}><span>{titleCase(run.outcome)} · {count(run.chargedCredits)} credits charged{run.absorbedCredits ? `, ${count(run.absorbedCredits)} absorbed` : ""}</span><span>{usdFromMicro(run.providerMicrousd)} · {day(run.recordedAt)}</span></li>)}</ul></section>}

    <section className="mbo-detail-block"><h3>Workspaces & websites</h3>
      <ul className="mbo-list">{detail.workspaces.map(workspace => <li key={workspace.id}><span>{workspace.name}</span><span>{count(workspace.artifacts)} project{workspace.artifacts === 1 ? "" : "s"}</span></li>)}
        {detail.sites.map(site => <li key={site.slug}><span>{site.slug}</span><span>{site.live ? "Live" : "Offline"}{site.enquiriesEnabled ? ` · ${count(site.enquiries)} enquir${site.enquiries === 1 ? "y" : "ies"}` : ""}</span></li>)}
        {!detail.workspaces.length && !detail.sites.length && <li><span className="mbo-empty">No workspaces or websites.</span></li>}</ul>
    </section>
  </aside>;
}
