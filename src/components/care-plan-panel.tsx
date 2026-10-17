"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, CalendarClock, ExternalLink, LoaderCircle, PauseCircle, Pencil, Receipt, Undo2, Wallet } from "lucide-react";
import { CARE_GRACE_DAYS, PAYMENT_LINK, formatDay, formatMoney, formatPrice, parseAmount, type CareInterval, type CarePlan, type CarePlanResponse } from "@/lib/portal/care";
import { brandRequest } from "./brand-kit-api";
import "@/app/client-portal.css";

type Loaded = CarePlanResponse & { available: boolean };
const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "BAM", "RSD", "SEK", "NOK", "DKK", "PLN"];
const INTERVALS: [CareInterval, string][] = [["month", "Monthly"], ["quarter", "Every 3 months"], ["year", "Yearly"]];

/** On a client's "Brand & client access" tab: the client's care plan, paid with the agency's own payment link. */
export default function CarePlanPanel({ accountId, workspaceId, clientId, clientName, canEdit }: {
  accountId: string; workspaceId: string; clientId: string; clientName: string; canEdit: boolean;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const base = `/api/cloud/workspaces/${workspaceId}/clients/${clientId}/care-plan`;

  const run = useCallback(async (what: string, task: () => Promise<Loaded>, fallback: string) => {
    setBusy(what); setError("");
    try { setData(await task()); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : fallback); return false; }
    finally { setBusy(""); }
  }, []);
  useEffect(() => {
    let active = true;
    brandRequest<Loaded>(accountId, base).then(value => { if (active) setData(value); }, cause => { if (active) setError(cause instanceof Error ? cause.message : "The care plan couldn't load."); });
    return () => { active = false; };
  }, [accountId, base]);

  if (!data) return <section className="cpp" aria-busy={!error}><Header />{error ? <p className="cpp-error" role="alert">{error}</p> : <p className="cpp-muted"><LoaderCircle size={14} className="cpp-spin" /> Loading…</p>}</section>;
  if (!data.available) return <section className="cpp"><Header /><p className="cpp-muted">Care plans are being set up. Soon you&apos;ll be able to charge {clientName} a monthly fee for looking after their website.</p></section>;
  const plan = data.plan;
  const latest = data.payments.find(payment => !payment.undoneAt);

  async function record() {
    const key = crypto.randomUUID();
    if (await run("pay", () => brandRequest<Loaded>(accountId, `${base}/payments`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ note: note.trim() }) }), "The payment couldn't be recorded.")) setNote("");
  }

  return <section className="cpp ccp" aria-labelledby={`ccp-${clientId}`}>
    <Header id={`ccp-${clientId}`} />
    {plan && !editing && <div className="ccp-summary">
      <div className="ccp-plan">
        <strong>{plan.label}</strong>{formatPrice(plan) && <span>{formatPrice(plan)}</span>}
        <Status plan={plan} />
        {plan.paymentUrl && <a className="ccp-url" href={plan.paymentUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> {new URL(plan.paymentUrl).host}</a>}
      </div>
      {canEdit && <div className="ccp-actions">
        {plan.active && <div className="ccp-pay">
          <label>Note for the payment you received<input value={note} maxLength={300} onChange={event => setNote(event.target.value)} placeholder="Note, e.g. bank transfer (optional)" /></label>
          <button type="button" className="button primary small" disabled={Boolean(busy)} onClick={() => void record()}>{busy === "pay" ? <LoaderCircle size={14} className="cpp-spin" /> : <Receipt size={14} />} Record payment</button>
        </div>}
        <button type="button" className="button secondary small" onClick={() => setEditing(true)}><Pencil size={14} /> Edit plan</button>
      </div>}
      {plan.active && <p className="cpp-muted">Each payment you record moves &ldquo;paid through&rdquo; on by one {plan.interval === "quarter" ? "quarter" : plan.interval}. {CARE_GRACE_DAYS} days after that date {clientName}&apos;s portal becomes read-only until you record a payment. Their website always stays live.</p>}
    </div>}

    {(!plan || editing) && (canEdit
      ? <PlanForm plan={plan} busy={busy === "save"} onCancel={plan ? () => setEditing(false) : undefined}
        onSave={async body => { if (await run("save", () => brandRequest<Loaded>(accountId, base, { method: "PUT", body: JSON.stringify(body) }), "The plan couldn't be saved.")) setEditing(false); }} />
      : <p className="cpp-muted">No care plan for {clientName}.</p>)}

    {data.payments.length > 0 && <div className="ccp-history">
      <h4>Payments</h4>
      <ul>{data.payments.map(payment => <li key={payment.id} className={payment.undoneAt ? "is-undone" : undefined}>
        <div><strong>{formatDay(payment.coversFrom)} – {formatDay(payment.coversTo)}</strong>
          <span className="cpp-muted">{[formatMoney(payment.amountCents, payment.currency), `recorded ${new Date(payment.recordedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`, payment.note, payment.undoneAt ? "undone" : ""].filter(Boolean).join(" · ")}</span></div>
        {canEdit && payment.id === latest?.id && <button type="button" className="button secondary small" disabled={Boolean(busy)}
          onClick={() => void run("undo", () => brandRequest<Loaded>(accountId, `${base}/payments/${payment.id}`, { method: "DELETE" }), "The payment couldn't be undone.")}>
          {busy === "undo" ? <LoaderCircle size={14} className="cpp-spin" /> : <Undo2 size={14} />} Undo</button>}
      </li>)}</ul>
    </div>}
    {error && <p className="cpp-error" role="alert">{error}</p>}
  </section>;
}

function Status({ plan }: { plan: CarePlan }) {
  if (!plan.active) return <span className="cpp-chip">Off</span>;
  if (plan.status === "none") return <span className="cpp-chip">No payment recorded yet</span>;
  if (plan.status === "paid") return <span className="cpp-chip is-active"><BadgeCheck size={12} /> Paid through {formatDay(plan.paidThrough)}</span>;
  if (plan.status === "due") return <span className="cpp-chip ccp-due"><CalendarClock size={12} /> Payment due · editing pauses {formatDay(plan.pausesOn)}</span>;
  return <span className="cpp-chip ccp-paused"><PauseCircle size={12} /> Editing paused since {formatDay(plan.pausesOn)}</span>;
}

type PlanBody = { label: string; amountCents: number | null; currency: string | null; interval: CareInterval; paymentUrl: string | null; paidThrough: string | null; active: boolean };
function PlanForm({ plan, busy, onSave, onCancel }: { plan: CarePlan | null; busy: boolean; onSave: (body: PlanBody) => Promise<void>; onCancel?: () => void }) {
  const [label, setLabel] = useState(plan?.label ?? "Website care");
  const [amount, setAmount] = useState(plan?.amountCents != null ? (plan.amountCents / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState(plan?.currency ?? "EUR");
  const [interval, setPeriod] = useState<CareInterval>(plan?.interval ?? "month");
  const [url, setUrl] = useState(plan?.paymentUrl ?? "");
  const [paidThrough, setPaidThrough] = useState(plan?.paidThrough ?? "");
  const [active, setActive] = useState(plan?.active ?? true);
  const [problem, setProblem] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = parseAmount(amount);
    if (cents === undefined) return setProblem("Enter the price as a number, like 49 or 49.90.");
    if (url.trim() && !PAYMENT_LINK.test(url.trim())) return setProblem("Use the full https:// payment link from Stripe, PayPal or your invoicing tool.");
    setProblem("");
    void onSave({ label: label.trim(), amountCents: cents, currency: cents === null ? null : currency, interval, paymentUrl: url.trim() || null, paidThrough: paidThrough || null, active });
  }

  return <form className="ccp-form" onSubmit={submit}>
    {!plan && <p className="cpp-muted">Charge your client for looking after their website. They pay you directly through your own payment link; Makeborne never handles the money.</p>}
    <div className="cpp-row">
      <label>Plan name<input required value={label} maxLength={80} onChange={event => setLabel(event.target.value)} /></label>
      <label className="ccp-amount">Price<span><input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="49.00" />
        <select aria-label="Currency" value={currency} onChange={event => setCurrency(event.target.value)}>{CURRENCIES.map(code => <option key={code}>{code}</option>)}</select></span></label>
      <label>Billing<select value={interval} onChange={event => setPeriod(event.target.value as CareInterval)}>{INTERVALS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    </div>
    <div className="cpp-row">
      <label>Your payment link<input type="url" value={url} maxLength={500} onChange={event => setUrl(event.target.value)} placeholder="https://buy.stripe.com/…" /></label>
      <label>Paid through<input type="date" value={paidThrough} onChange={event => setPaidThrough(event.target.value)} /></label>
    </div>
    <p className="cpp-muted">Your client sees the plan and a Pay button in their portal. Leave &ldquo;paid through&rdquo; empty until the first payment: nothing is enforced until then.</p>
    {plan && <label className="cpp-switch"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} /> <span>{active ? "Plan on" : "Plan off (nothing is shown or enforced)"}</span></label>}
    <div className="cpp-row">
      <button type="submit" className="button primary small" disabled={busy || !label.trim()}>{busy ? <LoaderCircle size={14} className="cpp-spin" /> : <Wallet size={14} />} {plan ? "Save plan" : "Set up care plan"}</button>
      {onCancel && <button type="button" className="button secondary small" onClick={onCancel}>Cancel</button>}
    </div>
    {problem && <p className="cpp-error" role="alert">{problem}</p>}
  </form>;
}

function Header({ id }: { id?: string }) {
  return <div className="cpp-head"><h3 id={id}><Wallet size={17} /> Care plan</h3><p className="cpp-muted">A monthly fee for looking after their website, paid to you through your own payment link.</p></div>;
}
