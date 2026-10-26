"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Globe, Presentation } from "lucide-react";
import { CREATION_PLANS, RECOMMENDED_BADGE, RECOMMENDED_PLAN, TAX_NOTE, YEARLY_DISCOUNT_PERCENT, creditMultiple, mediumFloor, planOutcomes, planPrice, usd, type BillingInterval, type PlanId, type PlanOutcome } from "@/lib/billing/plans";
import { authDestination } from "@/lib/supabase/auth-flow";
import { creationNavigationUrl } from "@/lib/billing/checkout-navigation";
import type { BuilderEstimates, MeasuredRun } from "@/lib/builder/credit-estimate";

type Availability = { authenticated: boolean; existingMember: boolean; offers: { tier: PlanId; interval: BillingInterval; totalCents: number; monthlyCredits: number }[] };
type Pending = { tier: PlanId; interval: BillingInterval; requestId: string; next: string };
type Notice = { text: string; role: "alert" | "status"; action?: "resume" | "retry" | "studio" | "support"; tier?: PlanId };
/** Same tab: the selection and its idempotency key. Another tab or device: only the key, bound to its account. */
const STORAGE = "makeborne-creation-checkout-v1";
const SHARED = "makeborne-creation-checkout-v2";
const LAST_SENT = "makeborne-creation-checkout-sent-v1";
const SHARED_TTL_MS = 2 * 60 * 60 * 1000;
/** A login link longer than this drops the nested brief link first; the plan always survives. */
const MAX_NEXT = 2000;
const SUPPORT = "admin@makeborne.com";
const isTier = (value: unknown): value is PlanId => CREATION_PLANS.some(plan => plan.id === value);
const isInterval = (value: unknown): value is BillingInterval => value === "monthly" || value === "yearly";
const isRequestId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const planName = (tier: PlanId) => CREATION_PLANS.find(plan => plan.id === tier)?.name ?? tier;
const read = (store: "session" | "local", key: string) => { try { return JSON.parse((store === "session" ? sessionStorage : localStorage).getItem(key) ?? "null"); } catch { return null; } };
const write = (store: "session" | "local", key: string, value: unknown) => { try { (store === "session" ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); } catch { /* Storage is optional; URL params and memory keep the flow. */ } };
const forget = () => { try { sessionStorage.removeItem(STORAGE); sessionStorage.removeItem(LAST_SENT); localStorage.removeItem(SHARED); } catch { /* Nothing stored. */ } };
const tests = (samples: number) => `(${samples} test${samples === 1 ? "" : "s"})`;
const OUTCOME_ROWS = { website: { Icon: Globe, label: "Websites", suffix: " first builds" }, presentation: { Icon: Presentation, label: "or presentations", suffix: "" }, book: { Icon: BookOpen, label: "or books", suffix: "" } } as const;
const span = (outcome: PlanOutcome) => outcome.low === outcome.typical ? `${outcome.low}` : `${outcome.low}–${outcome.typical}`;

/** Server availability controls every purchase; displayed prices are never submitted.
 * The plan choice travels through sign-up in allow-listed URL params (read here in an effect,
 * not the search-params hook, so no Suspense bailout), so it survives a confirmation email opened in another tab. */
export default function CreationPlans({ estimates = null, mediumCeilingCredits = null, currentTier = null, measuredRun = null, accountId = null }: { /** Measured first-build credits at the live rate; null hides every outcome figure. */ estimates?: BuilderEstimates | null; /** Credit ceiling of one request at the default effort. */ mediumCeilingCredits?: number | null; /** The member's plan, when it can be told exactly. */ currentTier?: PlanId | null; measuredRun?: MeasuredRun | null; /** Signed-in account; binds the cross-tab checkout key to it. */ accountId?: string | null }) {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<PlanId | "resume" | null>(null);
  const [resume, setResume] = useState<{ tier: PlanId; interval: BillingInterval } | null>(null);
  const [unavailable, setUnavailable] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const opening = useRef(false);
  const pending = useRef<Pending | null>(null);
  const lastSent = useRef<Pending | null>(null);
  const resumed = useRef(false);
  const resumeButton = useRef<HTMLButtonElement>(null);
  const cards = useRef<HTMLDivElement>(null);
  const owner = accountId ?? "anon";

  function remember(value: Pending) {
    pending.current = value;
    write("session", STORAGE, value);
    write("local", SHARED, { tier: value.tier, interval: value.interval, requestId: value.requestId, owner, savedAt: Date.now() });
  }
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
      if (data.existingMember) { forget(); pending.current = null; return; }
      const query = new URLSearchParams(window.location.search);
      const sent = read("session", LAST_SENT);
      if (sent && isTier(sent.tier) && isInterval(sent.interval) && isRequestId(sent.requestId) && typeof sent.next === "string") lastSent.current = { ...sent, next: authDestination(sent.next) };
      const saved = read("session", STORAGE);
      const tab = saved && isTier(saved.tier) && isInterval(saved.interval) && isRequestId(saved.requestId) && typeof saved.next === "string" ? saved as Pending : null;
      const fromUrl = isTier(query.get("plan")) && isInterval(query.get("interval")) ? { tier: query.get("plan") as PlanId, interval: query.get("interval") as BillingInterval } : null;
      const choice = fromUrl ?? (tab ? { tier: tab.tier, interval: tab.interval } : null);
      // localStorage alone never selects a plan: on a shared browser it may be someone else's.
      const shared = read("local", SHARED);
      const sharedUsable = Boolean(shared && isRequestId(shared.requestId) && Number(shared.savedAt) > Date.now() - SHARED_TTL_MS && (shared.owner === "anon" || shared.owner === owner));
      // Expired, malformed or another account's key: never reuse it.
      if (shared && !sharedUsable) { try { localStorage.removeItem(SHARED); } catch { /* Nothing stored. */ } }
      const sharedKey = sharedUsable && choice && shared.tier === choice.tier && shared.interval === choice.interval ? shared.requestId as string : null;
      if (!choice) return;
      const next = authDestination(query.get("next") ?? tab?.next ?? "/studio");
      const requestId = tab && tab.tier === choice.tier && tab.interval === choice.interval ? tab.requestId : sharedKey ?? crypto.randomUUID();
      if (!data.offers.some((offer: Availability["offers"][number]) => offer.tier === choice.tier && offer.interval === choice.interval)) {
        if (fromUrl && data.authenticated) setUnavailable(`${planName(choice.tier)} isn’t available right now. Pick another plan below.`);
        forget(); pending.current = null; return;
      }
      setInterval(choice.interval);
      remember({ ...choice, requestId, next });
      if (data.authenticated) setResume(choice);
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
    // The account is fixed for the life of the page; only a retry reloads availability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);
  useEffect(() => {
    if (!resume) return;
    resumeButton.current?.scrollIntoView({ block: "center" });
    resumeButton.current?.focus({ preventScroll: true });
  }, [resume]);

  const offered = (tier: PlanId, value: BillingInterval = interval) => Boolean(availability?.offers.some(offer => offer.tier === tier && offer.interval === value));
  function login(choice: Pending) {
    const billing = (next: string | null) => `/billing?plan=${choice.tier}&interval=${choice.interval}${next ? `&next=${encodeURIComponent(next)}` : ""}#plans`;
    const full = billing(choice.next === "/studio" ? null : choice.next);
    // The nested brief link goes first; /studio still lists the saved draft.
    const target = encodeURIComponent(full).length > MAX_NEXT ? billing(null) : full;
    router.push(`/login?mode=signup&next=${encodeURIComponent(target)}`);
  }
  async function send(choice: Pending, isResume: boolean) {
    const previous = lastSent.current;
    lastSent.current = choice;
    write("session", LAST_SENT, choice);
    const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(choice) });
    if (response.status === 401) { login(choice); return; }
    const data = await response.json().catch(() => null);
    if (response.ok) {
      window.location.assign(creationNavigationUrl(data?.url, window.location.origin));
      return;
    }
    const code = typeof data?.error?.code === "string" ? data.error.code : "";
    const stillPending = "That checkout is still being prepared or waiting for payment confirmation. Please don’t pay twice; check again in a minute or email admin@makeborne.com.";
    if (code === "CHECKOUT_ALREADY_OPEN") {
      if (isResume) setNotice({ role: "alert", text: stillPending });
      else if (previous && !resumed.current) { lastSent.current = previous; write("session", LAST_SENT, previous); setNotice({ role: "alert", action: "resume", text: `You already started a checkout for ${planName(previous.tier)}, ${previous.interval}. You can finish it now, or email admin@makeborne.com to switch plans.` }); }
      else setNotice({ role: "alert", text: "You already have a checkout in progress. Finish it in the Whop page you opened, or email admin@makeborne.com to switch plans." });
    } else if (code === "CHECKOUT_PENDING") setNotice({ role: "alert", text: isResume ? stillPending : "Your last checkout is still being confirmed. Please don’t pay twice; try again in a minute, or email admin@makeborne.com if this doesn’t change." });
    else if (code === "CHECKOUT_ALREADY_COMPLETED") { forget(); pending.current = null; setResume(null); setNotice({ role: "status", action: "studio", text: "That checkout is already complete." }); }
    else if (code === "SUBSCRIPTION_ALREADY_EXISTS") setNotice({ role: "alert", text: "You already have a plan." });
    else if (code === "SUBSCRIPTION_REPURCHASE_REQUIRES_SUPPORT") setNotice({ role: "alert", action: "support", text: "Before you subscribe again, we need to check your previous subscription allowance. Contact support to continue. No new checkout was opened." });
    else if (code === "CREATION_PLANS_NOT_OPEN") setNotice({ role: "alert", text: "Plans aren’t open yet. Nothing was charged." });
    else if (isResume && response.status === 409) setNotice({ role: "alert", text: stillPending });
    else if (response.status === 409) {
      // The key belongs to another selection (or an unknown conflict): never reuse it.
      remember({ ...choice, requestId: crypto.randomUUID() });
      setNotice({ role: "alert", action: "retry", tier: choice.tier, text: "Checkout couldn’t open. Nothing was charged. Please try again." });
    } else setNotice({ role: "alert", text: "Checkout couldn’t open. Nothing was charged. Try again or email admin@makeborne.com." });
  }
  async function purchase(tier: PlanId) {
    if (opening.current || availability?.existingMember || !offered(tier)) return;
    opening.current = true; setBusy(tier); setNotice(null);
    try {
      const next = pending.current?.next ?? authDestination(new URLSearchParams(window.location.search).get("next"));
      if (!pending.current || pending.current.tier !== tier || pending.current.interval !== interval) remember({ tier, interval, requestId: crypto.randomUUID(), next });
      else remember(pending.current);
      if (!availability?.authenticated) { login(pending.current!); return; }
      await send(pending.current!, false);
    } catch { setNotice({ role: "alert", text: "Checkout couldn’t open. Nothing was charged. Try again or email admin@makeborne.com." }); }
    finally { opening.current = false; setBusy(null); }
  }
  async function resumeLast() {
    const choice = lastSent.current;
    if (opening.current || !choice || resumed.current) return;
    resumed.current = true; opening.current = true; setBusy("resume"); setNotice(null);
    try { await send(choice, true); }
    catch { setNotice({ role: "alert", text: "Checkout couldn’t open. Nothing was charged. Try again or email admin@makeborne.com." }); }
    finally { opening.current = false; setBusy(null); }
  }
  function chooseAgain() {
    forget(); pending.current = null; setResume(null); setNotice(null);
    cards.current?.focus();
  }

  const loaded = availability !== null;
  const member = availability?.existingMember === true;
  const hasYearly = Boolean(availability?.offers.some(offer => offer.interval === "yearly"));
  const prelaunch = loaded && !member && availability.offers.length === 0;
  const resumePrice = resume ? planPrice(resume.tier, resume.interval, false) : null;
  const period = (value: BillingInterval) => value === "yearly" ? "year" : "month";
  const until = (tier: PlanId, value: BillingInterval) => { const price = usd(planPrice(tier, value, false).standardCents); return `${price} today, then ${price} a ${period(value)} until you cancel.`; };
  const switchHref = (target: string) => `mailto:${SUPPORT}?subject=${encodeURIComponent(`Plan change: ${currentTier ? planName(currentTier) : "my plan"} to ${target}`)}`;
  const fewest = (planOutcomes(CREATION_PLANS[0].monthlyCredits, estimates) ?? []).filter(outcome => outcome.few).map(outcome => outcome.samples).sort((a, b) => a - b)[0];
  return <section id="plans" className="billing-plans-section" aria-labelledby="plans-heading">
    <div className="billing-plans-heading"><h2 id="plans-heading" className="billing-sr-only">Plans</h2>{prelaunch && <span className="billing-coming-soon">Opens at launch</span>}</div>
    {unavailable && !resume && <p className="billing-plan-unavailable" role="status">{unavailable}</p>}
    {resume && resumePrice && loaded && !member && <div className="billing-resume" role="region" aria-labelledby="resume-heading">
      <h3 id="resume-heading">Ready to finish: {planName(resume.tier)}, {usd(resumePrice.standardCents)} a {period(resume.interval)}, {resumePrice.monthlyCredits.toLocaleString("en-US")} credits every month.</h3>
      <p>{usd(resumePrice.standardCents)} today{TAX_NOTE.inline}, then {usd(resumePrice.standardCents)} a {period(resume.interval)} until you cancel in your Whop account. A payment is refundable in full while none of its credits are used. Your statutory rights, including any EU or UK right to withdraw, still apply.</p>
      <div className="billing-resume-actions"><button ref={resumeButton} type="button" className="billing-resume-cta" disabled={busy !== null} aria-busy={busy === resume.tier} onClick={() => void purchase(resume.tier)}>{busy === resume.tier ? "Opening secure checkout…" : "Continue to secure checkout"}</button><button type="button" className="billing-text-button" disabled={busy !== null} onClick={chooseAgain}>Choose a different plan</button></div>
      <small>Payment is handled by Whop. After payment we take you to the studio, or back to your saved brief.</small>
    </div>}
    {hasYearly && <div className="plans-interval" role="radiogroup" aria-label="Billing interval">
      {(["monthly", "yearly"] as const).map(value => <button key={value} type="button" role="radio" aria-checked={interval === value} disabled={busy !== null} onClick={() => { setInterval(value); setNotice(null); }}>
        {value === "monthly" ? "Monthly" : <>Yearly <span className="plans-save">Save {YEARLY_DISCOUNT_PERCENT}%</span></>}
      </button>)}
    </div>}
    <div className="billing-plans" ref={cards} tabIndex={-1} role="group" aria-label="Plans">{CREATION_PLANS.map((plan, index) => {
      const price = planPrice(plan.id, interval, false);
      const perMonth = price.standardCents / price.months;
      const recommended = plan.id === RECOMMENDED_PLAN;
      const outcomes = planOutcomes(plan.monthlyCredits, estimates);
      const floor = outcomes ? mediumFloor(plan.monthlyCredits, mediumCeilingCredits) : null;
      const multiple = creditMultiple(plan.id);
      const available = offered(plan.id, interval);
      const label = busy === plan.id ? "Opening secure checkout…" : !loaded ? "Checking…" : member ? currentTier === plan.id ? "Your plan" : "Already subscribed" : available ? `Get ${plan.name}` : prelaunch ? "Opens at launch" : "Not available yet";
      return <article id={`plan-${plan.id}`} className={`billing-plan${recommended ? " billing-plan-featured" : ""}`} key={plan.id} aria-labelledby={`plan-${plan.id}-name`}>
        <div className="billing-plan-title"><h3 id={`plan-${plan.id}-name`}>{plan.name}</h3>{recommended && <span>{RECOMMENDED_BADGE}</span>}</div>
        <p className="billing-plan-description">{plan.description}</p>
        <div className="billing-plan-price"><span className="billing-sr-only">{usd(perMonth)} per month</span><span aria-hidden="true">{usd(perMonth)}<span className="billing-plan-period">/ month</span></span></div>
        <p className="plans-billed">{interval === "yearly" ? `${usd(price.standardCents)} billed today for 12 months · ${usd(plan.monthlyCents * 12 - price.standardCents)} less than paying monthly` : "Billed monthly"}</p>
        <p className="billing-proposed-credits"><strong>{plan.monthlyCredits.toLocaleString("en-US")} credits</strong> every month{multiple && ` · ${multiple} ${CREATION_PLANS[0].name}`}</p>
        {outcomes && <div className="billing-outcomes"><p className="billing-outcomes-heading">Each month, about<a href="#how-we-counted" aria-label="How we counted">*</a></p><ul aria-label={`${plan.name}: first builds a month`}>{outcomes.map(outcome => { const row = OUTCOME_ROWS[outcome.kind]; return <li key={outcome.kind}><row.Icon size={16} aria-hidden="true" /><span>{`${row.label}: ${span(outcome)}${row.suffix}`}{outcome.few && <span className="billing-outcome-tests">{` ${tests(outcome.samples)}`}</span>}</span></li>; })}</ul><a className="billing-outcomes-link" href="#how-we-counted">How we counted</a></div>}
        {floor !== null && <p className="billing-plan-floor">{`At least ${floor} requests at the default effort${index === 0 ? `, each capped at ${mediumCeilingCredits} credits` : ""}, unless you approve going past a limit.`}</p>}
        {member && currentTier && currentTier !== plan.id
          ? <a className="founding-cta" href={switchHref(plan.name)} aria-describedby="creation-availability">Ask to switch</a>
          : <button type="button" className="founding-cta" disabled={busy !== null || member || !available} aria-busy={!loaded && !loadError ? true : undefined} onClick={() => void purchase(plan.id)} aria-describedby={`creation-availability plan-terms-${plan.id}`}>{label}</button>}
        {!member && <p className="billing-plan-terms" id={`plan-terms-${plan.id}`}>{until(plan.id, interval)} {TAX_NOTE.short}</p>}
      </article>;
    })}</div>
    <div className="billing-plan-status"><p id="creation-availability" role="status" aria-live="polite">{loadError ? "Plan availability could not be loaded." : !availability ? "Checking plan availability…" : member ? "You already have a creation subscription. Plan changes go through support for now; you don’t need a second subscription." : availability.offers.length ? availability.authenticated ? "Next: secure Whop checkout, where you see your total, including any tax or fee, before you pay. Your plan starts once Whop confirms the payment." : "Next: create your account, then pay in secure Whop checkout. Your plan choice is kept." : "Plans open at launch. Nothing can be bought or charged before then."}</p>
      {loadError && <button type="button" className="billing-retry" onClick={() => { setLoadError(false); setAvailability(null); setRetry(value => value + 1); }}>Retry availability</button>}
      {member && <p>Manage or cancel your plan in your Whop account. <a href={`mailto:${SUPPORT}`}>Email support</a></p>}
    </div>
    {notice && <div className="billing-plan-notice" role={notice.role}><p>{notice.text}</p>{notice.action === "resume" && <button type="button" className="billing-retry" disabled={busy !== null} onClick={() => void resumeLast()}>Resume that checkout</button>}{notice.action === "retry" && notice.tier && <button type="button" className="billing-retry" disabled={busy !== null} onClick={() => void purchase(notice.tier!)}>Try again</button>}{notice.action === "studio" && <Link className="billing-retry" href="/studio">Open studio</Link>}{notice.action === "support" && <a className="billing-retry" href={`mailto:${SUPPORT}?subject=Subscription%20restart`}>Contact support</a>}</div>}
    {estimates && <div id="how-we-counted" className="billing-counted"><p>*Each line assumes a whole month’s credits go to one kind of first build. Ranges run from the most expensive to the typical first build in our {measuredRun?.label ?? "test runs"} at the default (Medium) effort without AI images:</p>
      <ul><li>{`${estimates.firstBuild.website.samples} websites (${estimates.firstBuild.website.min}–${estimates.firstBuild.website.max} credits, typically ${estimates.firstBuild.website.median});`}</li><li>{`${estimates.firstBuild.presentation.samples} presentations${measuredRun?.presentationSlides.length === estimates.firstBuild.presentation.samples ? ` of ${measuredRun.presentationSlides.join(" and ")} slides` : ""} (${estimates.firstBuild.presentation.min}–${estimates.firstBuild.presentation.max});`}</li><li>{`${estimates.firstBuild.book.samples} books${measuredRun?.bookPages.length === estimates.firstBuild.book.samples ? ` of ${measuredRun.bookPages.join(" and ")} pages` : ""} (${estimates.firstBuild.book.min}–${estimates.firstBuild.book.max}).`}</li></ul>
      <p>{fewest !== undefined && `${fewest === 2 ? "Two" : fewest} tests are too few to call typical, so treat those lines as a rough guide. `}These runs predate our latest efficiency changes, and we update the figures when we re-measure. Edits, design reviews, AI images and higher effort use more, so real projects make fewer. Every request shows its limit before it starts.</p></div>}
    <p className="billing-plan-note">Prices in US dollars. Plans renew automatically at the same price until you cancel in your Whop account; you keep access to the end of the period you paid for. {TAX_NOTE.long} <Link href="/billing/terms">Subscription, credit and refund terms</Link></p>
  </section>;
}
