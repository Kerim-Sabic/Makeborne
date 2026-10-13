"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { CREATION_PLANS, planPrice, usd, YEARLY_DISCOUNT_PERCENT, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { authDestination } from "@/lib/supabase/auth-flow";

/** The recommended middle plan (good-better-best): highlighted, never preselected for payment. */
const RECOMMENDED = "studio";

type Availability = { authenticated: boolean; existingMember: boolean; offers: { tier: PlanId; interval: BillingInterval; totalCents: number; monthlyCredits: number }[] };
const STORAGE = "makeborne-creation-checkout-v1";

/** Server availability controls every purchase; displayed prices are never submitted. */
export default function CreationPlans() {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [selected, setSelected] = useState<PlanId | null>(null);
  const [error, setError] = useState("");
  const opening = useRef(false);
  const pending = useRef<{ tier: PlanId; interval: BillingInterval; requestId: string; next: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/billing/availability", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Availability unavailable");
      const data = await response.json();
      if (typeof data?.authenticated !== "boolean" || typeof data?.existingMember !== "boolean" || !Array.isArray(data.offers)
        || !data.offers.every((offer: Availability["offers"][number]) => CREATION_PLANS.some(plan => plan.id === offer?.tier)
          && ["monthly", "yearly"].includes(offer.interval) && offer.totalCents === planPrice(offer.tier, offer.interval, false).standardCents
          && offer.monthlyCredits === planPrice(offer.tier, offer.interval, false).monthlyCredits)) throw new Error("Invalid availability");
      if (controller.signal.aborted) return;
      setAvailability(data);
      try {
        if (data.existingMember) { sessionStorage.removeItem(STORAGE); pending.current = null; return; }
        const saved = JSON.parse(sessionStorage.getItem(STORAGE) ?? "null");
        if (saved && CREATION_PLANS.some(plan => plan.id === saved.tier) && ["monthly", "yearly"].includes(saved.interval)
          && /^[0-9a-f-]{36}$/i.test(saved.requestId) && typeof saved.next === "string") {
          pending.current = { tier: saved.tier, interval: saved.interval, requestId: saved.requestId, next: authDestination(saved.next) };
          setInterval(saved.interval); setSelected(saved.tier);
        }
      } catch { /* Storage can be unavailable; in-memory retries still retain the key. */ }
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [retry]);

  async function purchase(tier: PlanId) {
    if (opening.current || availability?.existingMember || !availability?.offers.some(offer => offer.tier === tier && offer.interval === interval)) return;
    opening.current = true; setBusy(tier); setError(""); setSelected(tier);
    try {
      const next = authDestination(new URLSearchParams(window.location.search).get("next"));
      if (!pending.current || pending.current.tier !== tier || pending.current.interval !== interval)
        pending.current = { tier, interval, requestId: crypto.randomUUID(), next };
      try { sessionStorage.setItem(STORAGE, JSON.stringify(pending.current)); } catch { /* Retry remains safe in this page. */ }
      const login = () => router.push(`/login?next=${encodeURIComponent(`/billing?next=${encodeURIComponent(pending.current!.next)}#plans`)}`);
      if (!availability.authenticated) { login(); return; }
      const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      if (response.status === 401) { login(); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Checkout could not be opened. Try again or contact support.");
      const url = new URL(data.url);
      const localSandbox = ["localhost", "127.0.0.1"].includes(window.location.hostname) && url.origin === "https://sandbox.whop.com";
      if ((!localSandbox && url.origin !== "https://whop.com") || url.username || url.password || !/^\/checkout\/ch_[A-Za-z0-9]+\/?$/.test(url.pathname)) throw new Error("The checkout link could not be verified.");
      window.location.assign(url.href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Checkout could not be opened. Please try again."); }
    finally { opening.current = false; setBusy(null); }
  }
  return <section id="plans" className="billing-plans-section" aria-labelledby="plans-heading">
    <div className="billing-section-heading billing-plans-heading">
      <div><span className="billing-eyebrow">CREATION PLANS</span><h2 id="plans-heading">Pick the room you need.</h2><p>Every plan makes websites, books and presentations. Choose how many credits you want each month.</p></div>
      {!availability?.offers.length && !availability?.existingMember && <span className="billing-coming-soon">Opens at launch</span>}
    </div>
    <div className="plans-interval" role="radiogroup" aria-label="Billing interval">
      {(["monthly", "yearly"] as const).map(value => <button key={value} type="button" role="radio" aria-checked={interval === value} disabled={busy !== null} onClick={() => { setInterval(value); setError(""); }}>
        {value === "monthly" ? "Monthly" : <>Yearly <span className="plans-save">Save {YEARLY_DISCOUNT_PERCENT}%</span></>}
      </button>)}
    </div>
    <div className="billing-plans">{CREATION_PLANS.map(plan => {
      const price = planPrice(plan.id, interval, false);
      const perMonth = price.standardCents / price.months;
      const recommended = plan.id === RECOMMENDED;
      return <article className={`billing-plan${recommended ? " billing-plan-featured" : ""}`} key={plan.id} aria-labelledby={`plan-${plan.id}`}>
        <div className="billing-plan-title"><h3 id={`plan-${plan.id}`}>{plan.name}</h3>{recommended && <span>Recommended</span>}</div>
        <p className="billing-plan-description">{plan.description}</p>
        <div className="billing-plan-price"><span className="billing-sr-only">{usd(perMonth)} per month</span><span aria-hidden="true">{usd(perMonth)}<span className="billing-plan-period">/ month</span></span></div>
        <p className="plans-billed">{interval === "yearly" ? `${usd(price.standardCents)} billed once a year` : "Billed monthly"}</p>
        <p className="billing-proposed-credits"><strong>{plan.monthlyCredits.toLocaleString("en-US")} credits</strong> every month</p>
        <p className="plans-allowance">Unlimited websites<br /><span>Fair use: 50 new sites per day, 1,000 live sites per workspace.</span></p>
        <div className="billing-plan-rule" />
        <ul aria-label={`${plan.name} includes`}>{plan.features.map(feature => <li key={feature}><Check size={15} aria-hidden="true" />{feature}</li>)}</ul>
        <button type="button" className="founding-cta" disabled={busy !== null || !availability?.offers.some(offer => offer.tier === plan.id && offer.interval === interval)} onClick={() => void purchase(plan.id)} aria-describedby="creation-availability">
          {busy === plan.id ? "Opening checkout…" : availability?.existingMember ? "Already subscribed" : availability?.offers.some(offer => offer.tier === plan.id && offer.interval === interval) ? `${availability.authenticated ? "Continue with" : "Sign in for"} ${plan.name}` : "Opens at launch"}
        </button>
        {selected === plan.id && <p role="status">Selected: {plan.name}, {interval}. {usd(price.standardCents)} before tax, renewing {interval === "yearly" ? "annually" : "monthly"} at the same price.</p>}
      </article>;
    })}</div>
    <p id="creation-availability" role="status">{loadError ? "Plan availability could not be loaded." : !availability ? "Checking plan availability…" : availability.existingMember ? "You already have a creation subscription. Plan switching is not available yet. Contact support to discuss a change; you do not need another subscription." : availability.offers.length ? "Continue to review your total and tax in secure Whop checkout. Payment alone does not activate access until verified." : "Creation memberships are not available for purchase yet."}</p>
    {availability?.existingMember && <p>Manage billing using the link in your Whop confirmation email. <a href="mailto:admin@makeborne.com">Contact support about your plan</a></p>}
    {loadError && <button type="button" onClick={() => { setLoadError(false); setAvailability(null); setRetry(value => value + 1); }}>Retry availability</button>}
    {error && <p role="alert">{error} <a href="mailto:admin@makeborne.com">Contact support</a></p>}
    <p className="billing-plan-note">Prices in US dollars, before tax. Plans renew automatically until you cancel; when you cancel, you keep access until the end of the period you paid for. Unused credits carry over for two months. Yearly plans release their credits month by month. <Link href="/billing/terms">Subscription, credit and refund terms</Link></p>
    <details className="billing-compare"><summary>Compare plans <ChevronDown size={15} aria-hidden="true" /></summary><div className="billing-table-wrap"><table><caption className="billing-sr-only">Plan allowances</caption><thead><tr><th scope="col">Included</th>{CREATION_PLANS.map(plan => <th scope="col" key={plan.id}>{plan.name}</th>)}</tr></thead><tbody><tr><th scope="row">Credits each month</th>{CREATION_PLANS.map(plan => <td key={plan.id}>{plan.monthlyCredits.toLocaleString("en-US")}</td>)}</tr><tr><th scope="row">Websites</th>{CREATION_PLANS.map(plan => <td key={plan.id}>Unlimited, subject to fair use</td>)}</tr><tr><th scope="row">Monthly price</th>{CREATION_PLANS.map(plan => <td key={plan.id}>{usd(plan.monthlyCents)}</td>)}</tr><tr><th scope="row">Yearly price</th>{CREATION_PLANS.map(plan => <td key={plan.id}>{usd(planPrice(plan.id, "yearly", false).standardCents)}</td>)}</tr></tbody></table></div><p>Website fair use: 50 new sites per day and 1,000 live sites per workspace. Custom-domain connections are not available yet.</p></details>
  </section>;
}
