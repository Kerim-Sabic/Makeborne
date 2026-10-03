"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import EffortControl from "./effort-control";
import { DEFAULT_EFFORT, type EffortLevel } from "@/lib/routing/effort";

const proposals = [
  { name: "Create", price: 29, credits: "300", description: "Make your first complete product.", seats: 1, sites: 1, storage: "2 GB", features: ["Websites, books and presentations", "Your client CRM and follow-ups", "Editable exports and custom styles"] },
  { name: "Studio", price: 79, credits: "1,000", description: "A home for your client business.", seats: 3, sites: 5, storage: "10 GB", features: ["Everything proposed in Create", "More capacity for client delivery", "Shared reviews and spending controls"] },
  { name: "Scale", price: 199, credits: "2,800", description: "Room for a growing studio.", seats: 5, sites: 15, storage: "30 GB", features: ["Everything proposed in Studio", "Higher workflow concurrency", "More hosting and asset capacity"] },
] as const;

export default function BillingPlans() {
  const [expanded, setExpanded] = useState<string | null>("Studio");
  const [effort, setEffort] = useState<EffortLevel>(DEFAULT_EFFORT);
  return <section id="plans" className="billing-plans-section">
    <div className="billing-section-heading"><div><span className="billing-eyebrow">PLANNED MEMBERSHIPS</span><h2>A plan for the way you work.</h2><p>Proposed monthly pricing in USD, before tax. Plans are not available to buy yet.</p></div></div>
    <div className="billing-plans">{proposals.map((plan, index) => <article className={`billing-plan ${index === 1 ? "billing-plan-featured" : ""}`} key={plan.name}>
      <div className="billing-plan-title"><h3>{plan.name}</h3>{index === 1 && <span>For client work</span>}</div>
      <p>{plan.description}</p><div className="billing-plan-price">${plan.price}<span>/ month · proposed</span></div>
      <p className="billing-proposed-credits"><strong>{plan.credits}</strong> generation credits / month</p>
      <button type="button" aria-expanded={expanded === plan.name} aria-controls={`plan-${plan.name}`} onClick={() => setExpanded(expanded === plan.name ? null : plan.name)}>{expanded === plan.name ? "Hide details" : "Explore plan"}<ChevronDown size={15} /></button>
      <ul>{plan.features.map(feature => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
      {expanded === plan.name && <div id={`plan-${plan.name}`} className="billing-plan-limits"><dl><div><dt>Team seats</dt><dd>{plan.seats}</dd></div><div><dt>Hosted static sites</dt><dd>{plan.sites}</dd></div><div><dt>Asset storage</dt><dd>{plan.storage}</dd></div></dl><p>Proposed allowances. Hosting, collaboration, generation and paid subscriptions still require activation and verification. Domain registration is separate.</p></div>}
      <small>Planning preview · no purchase or charge</small>
    </article>)}</div>
    <div className="billing-effort-preview"><div><span className="billing-eyebrow">YOU SET THE PACE</span><h3>Small refinements. Ambitious projects.</h3><p>Try the effort selector. More planning and review can use more credits. Each job needs its own estimate; one credit is not one slide or one image.</p><p className="billing-effort-note">This preview changes no project setting and starts no job. Paid generation remains disabled.</p></div><EffortControl value={effort} onChange={setEffort} /></div>
  </section>;
}
