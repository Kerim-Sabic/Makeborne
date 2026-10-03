"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, Globe, Link2, Presentation, Sparkles } from "lucide-react";
import { createOpportunityBrief, OpportunityInputSchema, recommendOffers, type OfferDirection, type OpportunityInput, type OpportunityKind } from "@/lib/client-opportunity";
import "@/app/client-opportunity.css";

export type ClientOpportunityProps = {
  clientName?: string;
  onClose: () => void;
  onCreateBrief: (kind: OpportunityKind, brief: string, title: string) => void;
};
const goals = [["audience", "Grow an audience"], ["product", "Package expertise"], ["services", "Win service clients"], ["pitch", "Pitch an offer"]] as const;
const icons = { website: Globe, book: BookOpen, presentation: Presentation };

export default function ClientOpportunity({ clientName = "", onClose, onCreateBrief }: ClientOpportunityProps) {
  const [profileUrl, setProfileUrl] = useState("");
  const [context, setContext] = useState("");
  const [goal, setGoal] = useState<OpportunityInput["goal"]>("product");
  const [rights, setRights] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<{ input: OpportunityInput; directions: OfferDirection[] } | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (plan) resultsHeading.current?.focus(); }, [plan]);
  const selected = plan?.directions.find(item => item.id === selectedId);
  return <section className="co-workspace" aria-labelledby="co-title">
    <button type="button" className="co-back" onClick={onClose}><ArrowLeft size={16} /> Back to clients</button>
    <header className="co-header"><span className="co-kicker"><Sparkles size={14} /> OFFER PLANNER</span><h1 id="co-title">Turn expertise into an offer.</h1><p>{clientName ? `Explore the right first product for ${clientName}.` : "Start with a person, an audience, and a problem worth solving."}</p></header>
    <p className="co-local-note">Planning suggestions use the details you supply. Profile links are saved in the brief; live profile analysis is not connected yet.</p>
    {!plan ? <form className="co-input-panel" onSubmit={event => {
      event.preventDefault();
      const result = OpportunityInputSchema.safeParse({ clientName, profileUrl, context, goal, rightsConfirmed: rights });
      if (!result.success) { setError(result.error.issues[0]?.message ?? "Check the details and try again."); return; }
      const directions = recommendOffers(result.data);
      setPlan({ input: result.data, directions }); setSelectedId(directions[0].id); setError("");
    }}>
      <label htmlFor="co-profile"><span><Link2 size={15} /> Profile or website <small>Optional</small></span><input id="co-profile" type="url" maxLength={2000} value={profileUrl} onChange={event => setProfileUrl(event.target.value)} placeholder="https://instagram.com/…" /></label>
      <label htmlFor="co-context"><span>What do they know, offer, and help people do?</span><textarea id="co-context" rows={7} minLength={30} maxLength={8000} required value={context} onChange={event => setContext(event.target.value)} placeholder="Paste their bio, describe their services and audience, and include approved facts or questions their audience often asks." /><small>Include the audience’s problem, existing expertise, and any evidence of demand.</small></label>
      <fieldset><legend>What is the first goal?</legend><div className="co-goals">{goals.map(([id, label]) => <label key={id}><input type="radio" name="offerGoal" value={id} checked={goal === id} onChange={() => setGoal(id)} /><span>{label}</span></label>)}</div></fieldset>
      <label className="co-consent"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} /><span>I have permission to use the profile material and details I provide.</span></label>
      {error && <p role="alert" className="co-error">{error}</p>}
      <button className="co-primary" type="submit">Explore offer directions <ArrowRight size={16} /></button>
    </form> : <div className="co-results">
      <div className="co-results-heading"><div><h2 ref={resultsHeading} tabIndex={-1}>Planning suggestions</h2><p>Choose a direction, then shape the first deliverable.</p></div><button type="button" className="co-back" onClick={() => setPlan(null)}>Edit details</button></div>
      <div className="co-result-grid"><div className="co-directions" role="group" aria-label="Offer directions">{plan.directions.map((direction, index) => {
        const Icon = icons[direction.kind];
        return <button type="button" key={direction.id} className="co-direction" aria-pressed={selectedId === direction.id} onClick={() => setSelectedId(direction.id)}><span className="co-direction-icon"><Icon size={19} /></span><span className="co-direction-copy"><small>{index === 0 ? "Suggested starting point" : direction.format}</small><strong>{direction.title}</strong><span>{direction.description}</span></span>{selectedId === direction.id && <Check size={17} aria-hidden="true" />}</button>;
      })}</div>{selected && <aside className="co-plan" aria-label="Selected offer plan"><span className="co-kicker">YOUR FIRST DELIVERABLE</span><h2>{selected.title}</h2><span className="co-format">{selected.format}</span><h3>Why explore this</h3><p>{selected.reason}</p><h3>Start with this structure</h3><ol>{selected.outline.map(item => <li key={item}>{item}</li>)}</ol><h3>Validate before launch</h3><ul>{selected.questions.map(item => <li key={item}>{item}</li>)}</ul><button type="button" className="co-primary" onClick={() => { const draft = createOpportunityBrief(plan.input, selected.id); onCreateBrief(draft.kind, draft.brief, draft.title); }}>Use this brief <ArrowRight size={16} /></button><small className="co-handoff-note">Opens project setup. Nothing is generated, published, or charged here.</small></aside>}</div>
    </div>}
  </section>;
}
