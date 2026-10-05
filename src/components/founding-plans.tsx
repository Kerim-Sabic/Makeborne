"use client";
import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { CREATION_PLANS, planPrice, usd, type BillingInterval } from "@/lib/billing/plans";

export default function FoundingPlans() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [founding, setFounding] = useState(true);
  return <section id="plans" className="billing-plans-section" aria-labelledby="plans-heading">
    <div className="billing-section-heading billing-plans-heading"><div><span className="billing-eyebrow">MAKE ROOM FOR WHAT’S NEXT</span><h2 id="plans-heading">Start early. Make more.</h2><p>Websites, books and presentations. One place for your ideas and client work.</p></div><span className="billing-coming-soon">Coming soon</span></div>
    <div className="founding-controls"><div className="founding-interval" aria-label="Billing interval">{(["monthly", "yearly"] as const).map(value => <button key={value} type="button" aria-pressed={interval === value} onClick={() => setInterval(value)}>{value === "monthly" ? "Monthly" : <>Yearly <span>Save 20%</span></>}</button>)}</div><label className="founding-toggle"><input type="checkbox" checked={founding} onChange={event => { setFounding(event.target.checked); }} /><span>Founding offer <strong>30% off your first term</strong></span></label></div>
    <div className="billing-plans">{CREATION_PLANS.map((plan, index) => {
      const price = planPrice(plan.id, interval, founding);
      return <article className={`billing-plan${index === 1 ? " billing-plan-featured" : ""}`} key={plan.id}>
        <div className="billing-plan-title"><h3>{plan.name}</h3>{index === 1 && <span>For client work</span>}</div><p className="billing-plan-description">{plan.description}</p>
        <div className="billing-plan-price">{usd(price.priceCents)}<span className="billing-plan-period">/ {interval === "yearly" ? "year" : "month"}</span></div>
        <p className="founding-price-detail">{founding ? `First ${interval === "yearly" ? "year" : "month"}, then ${usd(price.standardCents)} / ${interval === "yearly" ? "year" : "month"}.` : interval === "yearly" ? "Billed annually. Save 20% compared with monthly." : "Billed monthly once subscriptions open."}</p>
        <p className="billing-proposed-credits"><strong>{plan.monthlyCredits.toLocaleString("en-US")}</strong> credits per month of access</p><div className="billing-plan-rule" />
        <ul aria-label={`${plan.name} planned features`}>{plan.features.map(feature => <li key={feature}><Check size={15} aria-hidden="true" />{feature}</li>)}</ul>
        <button type="button" className="founding-cta" disabled>Opens at launch</button>
      </article>;
    })}</div>
    <div className="founding-assurance"><span>No payment taken before launch</span><span>30% off the first term</span><span>Cancel future renewals anytime</span></div>
    <p className="billing-plan-note">Coming soon. Checkout is closed until creation access and automatic credit delivery are ready. At launch, your subscription starts with your purchase and renews automatically at the standard price shown above until canceled. USD, before tax. Founding yearly pricing combines the 20% annual saving with 30% off the first annual term: 44% below twelve standard monthly payments. No voluntary change-of-mind refunds; applicable legal rights and Whop protections still apply. <Link href="/billing/terms">Read subscription, credit and refund terms</Link>.</p>
    <details className="billing-compare"><summary>Compare planned allowances <ChevronDown size={15} aria-hidden="true" /></summary><div className="billing-table-wrap"><table><caption className="billing-sr-only">Planned launch allowances; not available before launch</caption><thead><tr><th>Allowance</th>{CREATION_PLANS.map(plan => <th key={plan.id}>{plan.name}</th>)}</tr></thead><tbody><tr><th>Monthly credits</th>{CREATION_PLANS.map(plan => <td key={plan.id}>{plan.monthlyCredits.toLocaleString("en-US")}</td>)}</tr><tr><th>Team seats</th>{CREATION_PLANS.map(plan => <td key={plan.id}>{plan.seats}</td>)}</tr><tr><th>Hosted static sites</th>{CREATION_PLANS.map(plan => <td key={plan.id}>{plan.sites}</td>)}</tr><tr><th>Asset storage</th>{CREATION_PLANS.map(plan => <td key={plan.id}>{plan.storage}</td>)}</tr></tbody></table></div><p>Annual subscriptions release credits monthly. Domain registration is separate.</p></details>
  </section>;
}
