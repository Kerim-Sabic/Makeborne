import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import { getAccountPrivileges } from "@/lib/account/privileges";
import { adminCustomer, adminCustomerPayments, adminCustomers, adminHealth, adminOverview, CUSTOMER_FILTERS, type CustomerFilter } from "@/lib/admin/console";
import { billingUser } from "@/lib/billing/access";
import { getCapabilities } from "@/lib/capabilities/server";
import { compilerSelfTest } from "@/lib/builder/compile";
import CustomersTab from "./customers";
import { CreditsTab, SubscriptionsTab } from "./money";
import OverviewTab, { overviewAlerts } from "./overview";
import SystemTab from "./system";
import HealthTab from "./health";
import { exactTime, requestTime } from "./format";
import "./admin.css";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "customers", label: "Customers" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "credits", label: "Credits & AI" },
  { id: "health", label: "Health" },
  { id: "system", label: "System" },
] as const;
type TabId = typeof TABS[number]["id"];
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await billingUser();
  if (!user) redirect("/login?next=%2Fadmin");
  const privileges = await getAccountPrivileges(user.id);
  if (!privileges.isAdmin) notFound();

  const params = await searchParams;
  const tab: TabId = TABS.some(item => item.id === one(params.tab)) ? one(params.tab) as TabId : "overview";
  const filter: CustomerFilter = CUSTOMER_FILTERS.includes(one(params.filter) as CustomerFilter) ? one(params.filter) as CustomerFilter : "all";
  const state = { q: (one(params.q) ?? "").trim().slice(0, 200), filter, page: Math.min(40_000, Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1)), customer: one(params.customer) ?? null };
  const now = requestTime();

  type Loaded =
    | { kind: "system"; compiler: Awaited<ReturnType<typeof compilerSelfTest>> }
    | { kind: "health"; data: Awaited<ReturnType<typeof adminHealth>> }
    | { kind: "customers"; page: Awaited<ReturnType<typeof adminCustomers>>; detail: Awaited<ReturnType<typeof adminCustomer>>; payments: Awaited<ReturnType<typeof adminCustomerPayments>> }
    | { kind: "overview"; data: Awaited<ReturnType<typeof adminOverview>> }
    | { kind: "error" };
  let loaded: Loaded;
  try {
    if (tab === "system") loaded = { kind: "system", compiler: await compilerSelfTest() };
    else if (tab === "health") loaded = { kind: "health", data: await adminHealth(user.id, [7, 30, 90].includes(Number(one(params.days))) ? Number(one(params.days)) : 7) };
    else if (tab === "customers") {
      // Payment records come from a later migration; their absence must not hide the customer.
      const [page, detail, payments] = await Promise.all([adminCustomers(user.id, { search: state.q, filter: state.filter, page: state.page }), state.customer ? adminCustomer(user.id, state.customer) : Promise.resolve(null),
        state.customer ? adminCustomerPayments(user.id, state.customer).catch(() => null) : Promise.resolve(null)]);
      loaded = { kind: "customers", page, detail, payments };
    } else loaded = { kind: "overview", data: await adminOverview(user.id) };
  } catch {
    loaded = { kind: "error" };
  }
  const alertCount = loaded.kind === "overview" ? overviewAlerts(loaded.data).length : 0;
  const generatedAt = loaded.kind === "overview" || loaded.kind === "health" ? loaded.data.generatedAt : null;
  const content = loaded.kind === "system" ? <SystemTab operations={getCapabilities({ administrator: true }).operations} compiler={loaded.compiler} />
    : loaded.kind === "health" ? <HealthTab data={loaded.data} now={now} />
    : loaded.kind === "customers" ? <CustomersTab page={loaded.page} detail={loaded.detail} payments={loaded.payments} state={state} now={now} />
    : loaded.kind === "overview" ? (tab === "overview" ? <OverviewTab data={loaded.data} now={now} /> : tab === "subscriptions" ? <SubscriptionsTab data={loaded.data} now={now} /> : <CreditsTab data={loaded.data} />)
    : <section className="mbo-panel mbo-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><h2>Admin data could not be loaded</h2><p>The database did not answer, or this deployment has not been migrated yet (<code>20261013100000_admin_console.sql</code>). Nothing was changed. Try again in a moment.</p></div></section>;

  const refresh = new URLSearchParams(Object.entries({ tab, q: state.q, filter: state.filter === "all" ? "" : state.filter, page: state.page > 1 ? String(state.page) : "", customer: state.customer ?? "" }).filter(([, value]) => value));
  return <div className="mbo-shell">
    <a className="mbo-skip" href="#admin-main">Skip to content</a>
    <header className="mbo-topbar">
      <Link className="mbo-brand" href="/studio"><BrandMark /><span>Makeborne<span className="mbo-brand-divider" aria-hidden="true">/</span><small>Admin</small></span></Link>
      <div className="mbo-top-actions"><span className="mbo-environment" title={user.email ?? undefined}><span aria-hidden="true" />{user.email}</span><Link href="/studio"><ArrowLeft size={15} aria-hidden="true" /><span>Back to studio</span></Link></div>
    </header>
    <nav className="mbo-tabs" aria-label="Admin sections"><div>{TABS.map(item => <Link key={item.id} href={`?tab=${item.id}`} aria-current={tab === item.id ? "page" : undefined}>{item.label}{item.id === "overview" && alertCount > 0 && <span className="mbo-tab-count" aria-label={`${alertCount} alert${alertCount === 1 ? "" : "s"}`}>{alertCount}</span>}</Link>)}</div></nav>
    <main id="admin-main" className="mbo-main">
      <div className="mbo-heading"><h1>{TABS.find(item => item.id === tab)?.label}</h1>
        <div className="mbo-heading-actions">{generatedAt && <span className="mbo-muted">Updated {exactTime(generatedAt)}</span>}<Link className="mbo-refresh" href={`?${refresh}`} prefetch={false}><RefreshCw size={14} aria-hidden="true" />Refresh</Link></div></div>
      {content}
      <footer className="mbo-note">Read-only except refund steps, which are recorded with your account. Access is checked on the server against your administrator role for every request. Customer data shown here is for support; do not copy it elsewhere.</footer>
    </main>
  </div>;
}
