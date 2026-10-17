"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, CalendarClock, ExternalLink, LoaderCircle, PauseCircle, Receipt, RefreshCw, Wallet } from "lucide-react";
import { formatDay, formatMoney, formatPrice, monthlyRecurring, type CareOverview } from "@/lib/portal/care";
import { brandRequest } from "./brand-kit-api";
import "@/app/client-portal.css";

type Plan = CareOverview["plans"][number];
type Filter = "attention" | "all" | "paid" | "off";
const FILTERS: [Filter, string][] = [["attention", "Needs attention"], ["all", "All plans"], ["paid", "Paid up"], ["off", "Not started or off"]];
const needsAttention = (plan: Plan) => plan.active && (plan.status === "paused" || plan.status === "due");
const matches = (plan: Plan, filter: Filter) => filter === "all" ? true : filter === "attention" ? needsAttention(plan)
  : filter === "paid" ? plan.active && plan.status === "paid" : !plan.active || plan.status === "none";
const totals = (list: { currency: string; amountCents: number }[]) => list.length ? list.map(item => formatMoney(item.amountCents, item.currency)).join(" + ") : "—";

/** Clients → Care plans: who owes the agency, recurring income, and this month's payments. */
export default function CareDashboard({ accountId, workspaceId, canEdit, onOpenClient }: {
  accountId: string; workspaceId: string; canEdit: boolean; onOpenClient: (clientId: string) => void;
}) {
  const [data, setData] = useState<CareOverview | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const path = `/api/cloud/workspaces/${workspaceId}/care-plans`;

  const load = useCallback(async () => {
    try { setData(await brandRequest<CareOverview>(accountId, path)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Care plans couldn't load."); }
  }, [accountId, path]);
  useEffect(() => {
    let active = true;
    brandRequest<CareOverview>(accountId, path).then(value => { if (active) setData(value); }, cause => { if (active) setError(cause instanceof Error ? cause.message : "Care plans couldn't load."); });
    return () => { active = false; };
  }, [accountId, path]);

  const plans = useMemo(() => data?.plans ?? [], [data]);
  const attention = plans.filter(needsAttention);
  const shown = filter ?? (attention.length ? "attention" : "all");
  const list = plans.filter(plan => matches(plan, shown));

  async function record(plan: Plan) {
    const key = crypto.randomUUID();
    setBusy(plan.clientId); setNotice("");
    try {
      await brandRequest(accountId, `/api/cloud/workspaces/${workspaceId}/clients/${plan.clientId}/care-plan/payments`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ note: "" }) });
      await load(); setNotice(`Payment recorded for ${plan.clientName}.`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "The payment couldn't be recorded."); }
    finally { setBusy(""); }
  }

  if (!data) return <section className="cpp cdb" aria-busy={!error}><Head />{error ? <p className="cpp-error" role="alert">{error}</p> : <p className="cpp-muted"><LoaderCircle size={14} className="cpp-spin" /> Loading…</p>}</section>;
  if (!data.available) return <section className="cpp cdb"><Head /><p className="cpp-muted">Care plans are being set up. Soon you&apos;ll see who owes you and your monthly recurring income here.</p></section>;
  const month = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(new Date(`${data.month}T00:00:00Z`));

  return <section className="cpp cdb" aria-labelledby="cdb-title">
    <div className="cdb-head"><Head id="cdb-title" /><button type="button" className="button secondary small" onClick={() => void load()} aria-label="Refresh care plans"><RefreshCw size={14} /></button></div>
    <div className="cdb-stats">
      <div><span>Monthly recurring</span><strong>{totals(monthlyRecurring(plans))}</strong><small>{plans.filter(plan => plan.active).length} active plan{plans.filter(plan => plan.active).length === 1 ? "" : "s"}</small></div>
      <div><span>Recorded in {month}</span><strong>{totals(data.collected)}</strong><small>{data.collected.reduce((sum, item) => sum + item.payments, 0)} payment{data.collected.reduce((sum, item) => sum + item.payments, 0) === 1 ? "" : "s"}</small></div>
      <div className={attention.length ? "is-alert" : undefined}><span>Needs attention</span><strong>{attention.length}</strong>
        <small>{attention.length ? `${plans.filter(plan => plan.active && plan.status === "paused").length} paused · ${plans.filter(plan => plan.active && plan.status === "due").length} due` : "Everyone is paid up"}</small></div>
    </div>

    {!plans.length ? <div className="cdb-empty"><Wallet size={22} /><p><strong>No care plans yet.</strong> Open a client, go to <em>Brand &amp; client access</em> and set up a care plan to charge them monthly for looking after their website.</p></div> : <>
      <div className="cdb-filters" role="tablist" aria-label="Show plans">{FILTERS.map(([id, label]) => {
        const count = plans.filter(plan => matches(plan, id)).length;
        return <button key={id} type="button" role="tab" aria-selected={shown === id} onClick={() => setFilter(id)}>{label}<span>{count}</span></button>;
      })}</div>
      {!list.length ? <p className="cpp-muted">Nothing here.</p> : <ul className="cdb-list">{list.map(plan => <li key={plan.clientId} className={`is-${plan.active ? plan.status : "off"}`}>
        <button type="button" className="cdb-client" onClick={() => onOpenClient(plan.clientId)}><strong>{plan.clientName}</strong><span className="cpp-muted">{plan.label}{formatPrice(plan) ? ` · ${formatPrice(plan)}` : ""}</span></button>
        <Status plan={plan} />
        <span className="cpp-muted cdb-last">{plan.lastPaymentAt ? `Last paid ${new Date(plan.lastPaymentAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "No payments yet"}</span>
        <span className="cdb-actions">
          {plan.paymentUrl && <a className="cpp-icon" href={plan.paymentUrl} target="_blank" rel="noopener noreferrer" title="Open your payment link" aria-label={`Open the payment link for ${plan.clientName}`}><ExternalLink size={15} /></a>}
          {canEdit && plan.active && <button type="button" className="button secondary small" disabled={Boolean(busy)} onClick={() => void record(plan)}>
            {busy === plan.clientId ? <LoaderCircle size={14} className="cpp-spin" /> : <Receipt size={14} />} Record payment</button>}
        </span>
      </li>)}</ul>}
    </>}
    {notice && <p className="cpp-muted" role="status">{notice}</p>}
    {error && <p className="cpp-error" role="alert">{error}</p>}
  </section>;
}

function Status({ plan }: { plan: Plan }) {
  if (!plan.active) return <span className="cpp-chip">Off</span>;
  if (plan.status === "paused") return <span className="cpp-chip ccp-paused"><PauseCircle size={12} /> Paused since {formatDay(plan.pausesOn)}</span>;
  if (plan.status === "due") return <span className="cpp-chip ccp-due"><CalendarClock size={12} /> Due · pauses {formatDay(plan.pausesOn)}</span>;
  if (plan.status === "paid") return <span className="cpp-chip is-active"><BadgeCheck size={12} /> Paid through {formatDay(plan.paidThrough)}</span>;
  return <span className="cpp-chip"><AlertTriangle size={12} /> No paid-through date</span>;
}

function Head({ id }: { id?: string }) {
  return <div className="cpp-head"><h3 id={id}><Wallet size={17} /> Care plans</h3><p className="cpp-muted">Who owes you, your monthly recurring income, and payments recorded this month. Clients pay you through your own payment links.</p></div>;
}
