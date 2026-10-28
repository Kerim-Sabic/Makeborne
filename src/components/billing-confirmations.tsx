import type { PurchaseRecords } from "@/lib/legal/withdrawal";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const amount = (cents: number, currency: string) => currency.toLowerCase() === "usd" ? `US$${(cents / 100).toFixed(2)}` : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
const MAIL: Record<string, string> = { sent: "emailed", pending: "email queued", sending: "email queued", failed: "email not delivered: ask admin@makeborne.com", none: "" };

/** Each purchase's confirmation (the stored text, exactly as emailed) and any withdrawal notices. */
export default function BillingConfirmations({ records }: { records: PurchaseRecords | null }) {
  if (!records || (!records.confirmations.length && !records.withdrawals.length)) return null;
  return <section id="confirmations" className="billing-control-section" aria-labelledby="confirmations-heading">
    <h2 id="confirmations-heading">Purchase confirmations.</h2>
    {records.confirmations.map(item => <details key={item.id} className="billing-confirmation">
      <summary>{item.product}{item.interval ? ` · ${item.interval}` : ""} · {amount(item.amountCents, item.currency)} · {when(item.paidAt)}{MAIL[item.mail] ? ` · ${MAIL[item.mail]}` : ""}</summary>
      <pre className="billing-confirmation-text">{item.body}</pre>
    </details>)}
    {records.withdrawals.length > 0 && <>
      <h3>Withdrawal notices</h3>
      <ul className="billing-withdrawals">{records.withdrawals.map(item => <li key={item.reference}>{item.reference} · received {when(item.receivedAt)}{item.paymentId ? ` · ${item.paymentId}` : ""}{MAIL[item.mail] ? ` · ${MAIL[item.mail]}` : ""}</li>)}</ul>
    </>}
    <p>To withdraw from a purchase within 14 days, use the <a href="/withdraw">withdrawal page</a>.</p>
  </section>;
}
