"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, ChevronDown, LoaderCircle } from "lucide-react";
import EffortControl from "./effort-control";
import { DEFAULT_EFFORT, type EffortLevel } from "@/lib/routing/effort";

const proposals = [
  { name: "Create", price: 29, credits: "300", description: "For your next independent project.", seats: 1, sites: 1, storage: "2 GB", features: ["Websites, books and presentations", "Client tracking and follow-ups", "Custom styles and editable exports"] },
  { name: "Studio", price: 79, credits: "1,000", description: "For a growing client business.", seats: 3, sites: 5, storage: "10 GB", features: ["Everything planned for Create", "More capacity for client projects", "Shared reviews and spending controls"] },
  { name: "Scale", price: 199, credits: "2,800", description: "For a team with bigger ambitions.", seats: 5, sites: 15, storage: "30 GB", features: ["Everything planned for Studio", "More work running at once", "Expanded hosting and asset storage"] },
] as const;

type SupportCheckout = { available: boolean; authenticated: boolean };

function SupportPlan() {
  const router = useRouter();
  const [checkout, setCheckout] = useState<SupportCheckout | null>(null);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const opening = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/billing/support-checkout", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Checkout availability could not be loaded.");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("available" in data) || typeof data.available !== "boolean" || !("authenticated" in data) || typeof data.authenticated !== "boolean") throw new Error("Checkout availability could not be loaded.");
        setCheckout({ available: data.available, authenticated: data.authenticated });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCheckout({ available: false, authenticated: false });
      });
    return () => controller.abort();
  }, [availabilityAttempt]);

  async function openCheckout() {
    if (opening.current || !checkout?.available) return;
    opening.current = true;
    setBusy(true);
    setError("");
    const signIn = () => {
      const returnTo = `${window.location.pathname}${window.location.search}#support`;
      router.push(`/login?next=${encodeURIComponent(returnTo)}`);
    };
    try {
      if (!checkout.authenticated) { signIn(); return; }
      const next = new URLSearchParams(window.location.search).get("next") ?? "/billing";
      const response = await fetch("/api/billing/support-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next }),
      });
      if (response.status === 401) { signIn(); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data?.error?.message === "string" ? data.error.message : "Checkout could not be opened. Please try again.");
      if (typeof data?.url !== "string") throw new Error("Checkout could not be opened. Please try again.");
      const destination = new URL(data.url);
      if (destination.origin !== "https://whop.com" || destination.username || destination.password || !/^\/checkout\/(?:plan|ch)_[A-Za-z0-9]+\/?$/.test(destination.pathname)) throw new Error("The checkout link could not be verified. Please try again.");
      window.location.assign(destination.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout could not be opened. Please try again.");
      opening.current = false;
      setBusy(false);
    }
  }

  return <section id="support" className="billing-support" aria-labelledby="support-heading">
    <div className="billing-support-art" aria-hidden="true"><Image src="/brand/coffee-support-v1.png" alt="" width={152} height={152} sizes="(max-width: 760px) 104px, 152px" /></div>
    <div className="billing-support-copy">
      <div className="billing-support-kicker"><span>SUPPORT MAKEBORNE</span>{checkout?.available && <span className="billing-support-live"><i aria-hidden="true" />Available now</span>}</div>
      <h2 id="support-heading">Pay a coffee</h2>
      <p>A little support to help us keep building.</p>
    </div>
    <div className="billing-support-action">
      <div className="billing-support-price"><strong><span>$</span>1</strong><span>USD / month</span></div>
      {checkout?.available ? <button className="billing-support-button" type="button" disabled={busy} onClick={() => void openCheckout()}>
        {busy ? <><LoaderCircle className="billing-loading" size={16} />Continuing…</> : <>Pay a coffee<ArrowUpRight size={15} /></>}
      </button> : checkout === null ? <span className="billing-support-status" role="status">Checking checkout…</span> : <><span className="billing-support-status" role="status">Checkout is unavailable right now</span><button className="billing-support-retry" type="button" onClick={() => { setCheckout(null); setAvailabilityAttempt(attempt => attempt + 1); }}>Try again</button></>}
      <span>{checkout?.authenticated ? "Checkout with Whop · Cancel anytime" : "Sign in to continue · Checkout with Whop"}</span>
      {error && <p className="billing-checkout-error" role="alert">{error}</p>}
    </div>
    <p className="billing-support-note">Optional monthly support. App access and AI credits require a separate creation membership.</p>
  </section>;
}

export default function BillingPlans() {
  const [effort, setEffort] = useState<EffortLevel>(DEFAULT_EFFORT);
  return <><section id="plans" className="billing-plans-section" aria-labelledby="plans-heading">
    <div className="billing-section-heading billing-plans-heading">
      <div><span className="billing-eyebrow">CREATION MEMBERSHIPS</span><h2 id="plans-heading">Find your room to create.</h2><p>Choose a creation plan when memberships open. These plans are not available to purchase yet.</p></div>
      <span className="billing-coming-soon">Coming soon</span>
    </div>
    <div className="billing-plans">{proposals.map((plan, index) => <article className={`billing-plan${index === 1 ? " billing-plan-featured" : ""}`} key={plan.name}>
      <div className="billing-plan-title"><h3>{plan.name}</h3>{index === 1 && <span>For client work</span>}</div>
      <p className="billing-plan-description">{plan.description}</p>
      <div className="billing-plan-price"><span className="billing-plan-currency">$</span>{plan.price}<span className="billing-plan-period">/ month</span></div>
      <p className="billing-proposed-credits"><strong>{plan.credits}</strong> proposed credits per month</p>
      <div className="billing-plan-rule" />
      <ul aria-label={`${plan.name} planned features`}>{plan.features.map(feature => <li key={feature}><Check size={15} aria-hidden="true" />{feature}</li>)}</ul>
      <span className="billing-plan-state">Planned membership</span>
    </article>)}</div>
    <p className="billing-plan-note">Proposed prices in USD, before tax. Generation, hosting, collaboration, and allowances are still being prepared.</p>
    <details className="billing-compare"><summary>Compare proposed allowances <ChevronDown size={15} aria-hidden="true" /></summary><div className="billing-table-wrap"><table><caption className="billing-sr-only">Proposed membership allowances, not currently available</caption><thead><tr><th>Monthly allowance</th>{proposals.map(plan => <th key={plan.name}>{plan.name}</th>)}</tr></thead><tbody><tr><th>Generation credits</th>{proposals.map(plan => <td key={plan.name}>{plan.credits}</td>)}</tr><tr><th>Team seats</th>{proposals.map(plan => <td key={plan.name}>{plan.seats}</td>)}</tr><tr><th>Hosted static sites</th>{proposals.map(plan => <td key={plan.name}>{plan.sites}</td>)}</tr><tr><th>Asset storage</th>{proposals.map(plan => <td key={plan.name}>{plan.storage}</td>)}</tr></tbody></table></div><p>Domain registration is separate. Final allowances and terms will be published before creation memberships open.</p></details>
    </section><SupportPlan />
    <details className="billing-effort-details"><summary><span>How does thinking effort affect credits?</span><ChevronDown size={16} aria-hidden="true" /></summary><div className="billing-effort-preview"><div><h3>Set the pace for each project.</h3><p>Higher effort allows more planning and review, which can use more credits. Your estimate will depend on the work, including its length and artwork.</p><small>Try the slider. This preview changes no project settings.</small></div><EffortControl value={effort} onChange={setEffort} /></div></details>
  </>;
}
