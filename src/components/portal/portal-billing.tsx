import { CalendarClock, CreditCard, PauseCircle } from "lucide-react";
import { formatDay, formatPrice, type CareBilling } from "@/lib/portal/care";

/** "Payment due" / "Editing paused" with the agency's own Pay link. Nothing for a paid or unenforced plan. */
export function BillingNotice({ billing, agency }: { billing: CareBilling | null; agency: string }) {
  if (!billing || (billing.status !== "due" && billing.status !== "paused")) return null;
  const price = formatPrice(billing);
  const pay = billing.paymentUrl
    ? <a className="portal-button pe-pay" href={billing.paymentUrl} target="_blank" rel="noopener noreferrer"><CreditCard size={16} /> Pay {agency}</a>
    : <span className="portal-muted">Contact {agency} to pay.</span>;
  if (billing.status === "due") return <div className="pe-banner is-due" role="status"><CalendarClock size={16} />
    <div><strong>Your {billing.label} payment is due.</strong> {price && <span>{price}. </span>}Editing pauses on {formatDay(billing.pausesOn)} until {agency} receives it. Your website stays online either way.</div>{pay}</div>;
  return <div className="pe-banner is-paused" role="alert"><PauseCircle size={16} />
    <div><strong>Editing is paused until {agency} receives your {billing.label} payment.</strong> {price && <span>{price}. </span>}You can still see your content, and your website stays online.</div>{pay}</div>;
}

/** A quiet line for a plan in good standing. */
export function BillingLine({ billing }: { billing: CareBilling | null }) {
  if (!billing || billing.status !== "paid") return null;
  return <p className="portal-muted pe-billing">{billing.label}{formatPrice(billing) ? ` · ${formatPrice(billing)}` : ""} · paid through {formatDay(billing.paidThrough)}</p>;
}
