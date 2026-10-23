import { CalendarClock, Check, Clock, Gauge, LogOut, RotateCcw, ShieldCheck } from "lucide-react";
import { PLAN_INCLUDES, PLAN_INCLUDES_FOOTNOTE, PLAN_PROMISES, notReadyYet } from "@/lib/billing/plans";

const ICONS = { limit: Gauge, errors: ShieldCheck, carry: CalendarClock, cancel: LogOut, refund: RotateCcw } as const;
const AGENCY = `mailto:admin@makeborne.com?subject=${encodeURIComponent("Makeborne for my agency")}&body=${encodeURIComponent("Websites, books and decks per month:\n\nPeople who would use it:\n")}`;

/** Buying reassurance for visitors without a plan: the agency line, the promises that are true
 * under today's terms, what isn't ready yet, and the one shared list of what every plan includes.
 * Members never see it (billing-plans.tsx). */
export default function PlanAssurances({ topupsOpen = false, hasYearly = false }: { /** Credit packs on sale (drops their not-ready line). */ topupsOpen?: boolean; hasYearly?: boolean }) {
  return <>
    <section className="billing-agency" aria-labelledby="agency-heading"><div><h3 id="agency-heading">Need more than Scale?</h3><p>If you build for many clients, write to us with roughly how many websites, books and decks you make a month.</p></div><a className="billing-agency-button" href={AGENCY}>Email us</a></section>
    <section id="promises" className="billing-promises" aria-labelledby="promises-heading">
      <h2 id="promises-heading">No surprises</h2>
      <ul className="billing-promise-list">{PLAN_PROMISES.map(promise => { const Icon = ICONS[promise.id]; return <li key={promise.id}><span className="billing-promise-icon" aria-hidden="true"><Icon size={17} /></span><div><h3>{promise.title}</h3><p>{promise.body}</p></div></li>; })}
        <li className="billing-not-ready"><div><h3><Clock size={16} aria-hidden="true" />What isn’t ready yet</h3><ul>{notReadyYet({ hasYearly, topupsOpen }).map(item => <li key={item.id}>{item.text}</li>)}</ul></div></li>
      </ul>
      <a className="billing-promises-terms" href="/billing/terms">Read the full subscription, credit and refund terms</a>
    </section>
    <section className="billing-includes" aria-labelledby="includes-heading">
      <h3 id="includes-heading">Every plan includes everything. You only choose how many credits.</h3>
      <ul>{PLAN_INCLUDES.map(item => <li key={item}><Check size={16} aria-hidden="true" />{item}</li>)}</ul>
      <small>{PLAN_INCLUDES_FOOTNOTE}</small>
    </section>
  </>;
}
