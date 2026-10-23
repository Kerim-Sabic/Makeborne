import type { SubscriptionSummary } from "@/lib/billing/subscription-summary";
import { TAX_NOTE, usd } from "@/lib/billing/plans";
/** Whop account management. Replace with the verified self-serve management URL once confirmed (launch gate). */
export const WHOP_MANAGE_URL = "https://whop.com/";
const date=(s:string)=>new Date(s).toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"})+" UTC";
export default function BillingSubscriptions({items}:{items:SubscriptionSummary[]|null}){
 return <section id="receipts" className="billing-control-section" aria-labelledby="subscription-heading"><h2 id="subscription-heading">Subscription &amp; receipts.</h2>
  {items===null?<p role="status">Subscription details could not be loaded. Check your Whop account or confirmation email.</p>:items.length===0?<p>No creation subscription is recorded for this account.</p>:items.map((s,i)=><div className="billing-subscription-row" key={i}><h3>{s.name} · {s.interval}</h3><p>Status: {s.status}. {usd(s.standardPriceCents)} a {s.interval==="yearly"?"year":"month"}. {TAX_NOTE.short}</p>{s.periodEnd&&<p>{s.status==="canceling"?"Recorded access ends":"Recorded billing period ends"}: {date(s.periodEnd)}.</p>}<small>Last checked {date(s.checkedAt)}. This is a stored observation, not a live invoice. Confirm your next charge, discounts, tax and any scheduled changes in Whop.</small></div>)}
  <div className="billing-control-actions"><a className="billing-control-primary" href={WHOP_MANAGE_URL} target="_blank" rel="noopener noreferrer">Cancel in Whop</a><a href={WHOP_MANAGE_URL} target="_blank" rel="noopener noreferrer">Open Whop for receipts</a><a href="mailto:admin@makeborne.com?subject=Cancel%20my%20Makeborne%20subscription">Ask us to cancel for you</a><a href="mailto:admin@makeborne.com?subject=Change%20my%20Makeborne%20plan">Request a plan change</a></div>
  <p>Cancel or manage your subscription in your Whop account. Cancelling stops the next renewal and keeps access to the end of the period you paid for; it doesn&rsquo;t request a refund by itself. If you can&rsquo;t find it, email admin@makeborne.com and we&rsquo;ll help. Refund requests go through support and are reviewed against the unused-credit rule and applicable requirements.</p>
  <p>Monthly included credits are released each billing month, including on annual plans. They expire two months after that allocation month ends. Non-expiring credits are used after expiring plan credits; your balance shows the next expiry. Unused holds return to their original funding lots and expiry.</p>
 </section>;
}
