"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import LegalLinks from "@/components/legal/legal-links";
import { ArrowUpRight, Bookmark, CircleHelp, CreditCard, Layers3, ReceiptText, Search, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import BrandMark from "./brand-mark";
import BillingPlans from "./billing-plans";
import BillingTopupReturn from "./billing-topup-return";
import BillingAutotopup from "./billing-autotopup";
import BillingControls from "./billing-controls";
import BillingSubscriptions from "./billing-subscriptions";
import BillingConfirmations from "./billing-confirmations";
import type { SubscriptionSummary } from "@/lib/billing/subscription-summary";
import type { PurchaseRecords } from "@/lib/legal/withdrawal";
import CreditBalance, { creditExpiryLabel, type CreditBalanceData } from "./credit-balance";
import { formatBillingCredits } from "./billing-amount";
import BillingCreditCosts from "./billing-credit-costs";
import type { BuilderEstimates, MeasuredRun } from "@/lib/builder/credit-estimate";
import type { PlanId } from "@/lib/billing/plans";
import { readBillingView, filterBillingEntries, billingStatement, usageCoverage, USAGE_EXCLUDED, type BillingViewModel } from "@/lib/billing/view";
import { adjacentUsagePeriods } from "@/lib/billing/usage-history";
export type { BillingEntry, BillingViewModel } from "@/lib/billing/view";

const categories = ["All activity", "Creation", "Media", "Hosting", "Research", "Account"] as const;
const usageHref = (period: string, before?: string) => `/billing?usage=${period}${before ? `&usageBefore=${encodeURIComponent(before)}` : ""}#activity`;

/** Plan prices for the hero, formatted on the server from CREATION_PLANS (this file imports no catalogue). */
export type PlanChip = { id: string; name: string; price: string };
const LIVE = ["active", "canceling", "past_due"];
const utcDate = (value: string) => new Date(value).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

export default function BillingWorkspace({ launchLine = null, summary: input, membershipRequired = false, refundedPeriod = null, autotopupSetup = false, accountPrivileges, trialCredits = null, signedIn = true, subscriptions = null, purchaseRecords = null, topupOrderId, costs = null, plansFirst = false, savedBrief = false, planChips = null, pricePerCredit = null, plansOpen = null, mediumCeilingCredits = null, measuredRun = null, currentTier = null, topupsOpen = false, hasYearly = false, accountId = null, taxNote = null }: { /** Informational launch countdown line near the plans (server-gated). */ launchLine?: ReactNode; summary: BillingViewModel; /** Measured builder costs, in credits at the live rate. */ costs?: BuilderEstimates | null; membershipRequired?: boolean; /** Current billing period whose payment was refunded or charged back. */ refundedPeriod?: { periodEnd: string; reason: string } | null; /** Automatic top-up setup (qualification flag only; never charges). */ autotopupSetup?: boolean; accountPrivileges?: { isAdmin: boolean; unlimitedCredits: boolean }; /** Live free-tier trial size; null when the free tier is off. */ trialCredits?: number | null; /** Signed-out visitors see plans first and a header sign-in link instead of an empty balance. */ signedIn?: boolean; subscriptions?: SubscriptionSummary[] | null; /** Stored purchase confirmations and withdrawal notices (signed-in only). */ purchaseRecords?: PurchaseRecords | null; topupOrderId?: string; /** Plans before the account (signed out, plan-less, or sent here to get a plan). Off keeps the dashboard order. */ plansFirst?: boolean; /** The return link carries a saved brief (draft= or claim=). */ savedBrief?: boolean; planChips?: PlanChip[] | null; /** Customer price per plan credit, in cents. */ pricePerCredit?: { min: number; max: number } | null; /** False before launch (no plan on sale); null when unknown. */ plansOpen?: boolean | null; mediumCeilingCredits?: number | null; measuredRun?: MeasuredRun | null; currentTier?: PlanId | null; topupsOpen?: boolean; hasYearly?: boolean; accountId?: string | null; /** TAX_NOTE.long, from the catalogue. */ taxNote?: string | null }) {
  const summary = readBillingView(input);
  const unlimitedCredits = accountPrivileges?.unlimitedCredits === true;
  const [category, setCategory] = useState<(typeof categories)[number]>("All activity");
  const [query, setQuery] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [credits, setCredits] = useState<CreditBalanceData | null>(null);
  const entries = filterBillingEntries(summary.entries, category, query);
  function downloadUsage() {
    setDownloadError("");
    let url: string | undefined;
    try {
      const statement = billingStatement(summary, category, query);
      url = URL.createObjectURL(new Blob([statement], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "makeborne-usage.json";
      link.click();
      const downloadUrl = url;
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch {
      if (url) URL.revokeObjectURL(url);
      setDownloadError("Usage could not be downloaded. Please try again.");
    }
  }
  const format = formatBillingCredits;
  const noRecordedActivity = summary.entries.length === 0;
  const coverage = summary.status === "ready" ? usageCoverage(summary) : null;
  const pages = summary.status === "ready" ? adjacentUsagePeriods(summary.history.periodKey) : null;

  const liveSubscription = subscriptions?.find(item => LIVE.includes(item.status)) ?? null;
  /** Members keep the dashboard first and never see the buying reassurance. Unknown subscriptions count as members. */
  const isMember = signedIn && (subscriptions === null || liveSubscription !== null);
  const buying = !isMember && !unlimitedCredits;
  const fromPrice = planChips?.[0]?.price;
  const firstBuild = costs?.firstBuild;
  const sampleNote = firstBuild ? firstBuild.presentation.samples === firstBuild.book.samples ? ` (${firstBuild.presentation.samples} tests each)` : ` (${firstBuild.presentation.samples} and ${firstBuild.book.samples} tests)` : "";
  const notice = unlimitedCredits ? <div className="billing-membership-note"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Unlimited credits · Administrator allowance</strong><p>No creation subscription or credit top-ups are required for this account.</p><Link className="billing-allowance-link" href="/studio">Open studio<ArrowUpRight size={13} aria-hidden="true" /></Link></div></div>
    : refundedPeriod ? <div className="billing-membership-note" role="status"><CircleHelp size={18} aria-hidden="true" /><div><strong>{refundedPeriod.reason === "dispute_lost" ? "This billing period's payment was charged back." : "This billing period's payment was refunded."}</strong><p>Creation access for this billing period (until {utcDate(refundedPeriod.periodEnd)}, UTC) ended with it, and the period&rsquo;s unused credits were removed. Access returns with your next paid period. Questions: <a href="mailto:admin@makeborne.com">admin@makeborne.com</a>.</p></div></div>
    : liveSubscription?.status === "past_due" ? <div className="billing-membership-note" role="status"><CreditCard size={18} aria-hidden="true" /><div><strong>Your last payment didn&rsquo;t go through.</strong><p>Update your payment method in your Whop account. Your receipts and subscription details are below.</p><p className="billing-note-links"><a href="https://whop.com/" target="_blank" rel="noopener noreferrer">Open Whop</a><a href="mailto:admin@makeborne.com">Email support</a></p></div></div>
    : liveSubscription?.status === "canceling" ? <div className="billing-membership-note" role="status"><CircleHelp size={18} aria-hidden="true" /><div><strong>Your plan is set to end{liveSubscription.periodEnd ? ` on ${utcDate(liveSubscription.periodEnd)}` : ""}.</strong><p>You keep access until then. To keep your plan, manage it in your Whop account or email <a href="mailto:admin@makeborne.com">admin@makeborne.com</a>.</p></div></div>
    : membershipRequired && savedBrief ? <div className="billing-membership-note" role="status"><Bookmark size={18} aria-hidden="true" /><div><strong>Your brief is saved.</strong><p>Choose a plan below. After checkout we take you back to it.</p></div></div>
    : membershipRequired ? <div className="billing-membership-note" role="status"><CircleHelp size={18} aria-hidden="true" /><div><strong>Creating starts with a plan.</strong><p>Choose one below. After checkout we take you to the studio.</p></div></div>
    : trialCredits && !isMember ? <div className="billing-membership-note" role="status"><CircleHelp size={18} aria-hidden="true" /><div><p>Confirmed accounts can start with {trialCredits} free trial credits while the free tier is open. <Link href="/login?mode=signup&next=%2Fstudio">Create a free account</Link></p></div></div>
    : null;
  const plans = <BillingPlans unlimitedCredits={unlimitedCredits} isMember={isMember} topupsOpen={topupsOpen} hasYearly={hasYearly} estimates={costs} mediumCeilingCredits={mediumCeilingCredits} currentTier={currentTier} measuredRun={measuredRun} accountId={accountId} />;
  const questions = <section className="billing-details" aria-labelledby="billing-questions"><h2 id="billing-questions">Questions</h2>
    {plansOpen === false && !unlimitedCredits && <details id="faq-launch" open><summary>When can I buy a plan?</summary><p>Plans open at launch. Until then the plan buttons stay off and nothing can be charged. Prices are in US dollars.</p></details>}
    {unlimitedCredits && <details id="faq-admin" open><summary>Do I need a creation subscription?</summary><p>No. This account has an unlimited administrator credit allowance, so no creation subscription or top-up is required. Generation depends on current service availability and safety limits.</p></details>}
    <details id="faq-credit" open={plansOpen !== false && !unlimitedCredits}><summary>What is a credit?</summary><p>Credits measure the AI work in a request: planning, writing, building and reviewing.{firstBuild && ` In our ${measuredRun?.label ?? "test runs"} at the default effort, a first website used ${firstBuild.website.min}–${firstBuild.website.max} credits (typically ${firstBuild.website.median}, ${firstBuild.website.samples} tests), a first presentation ${firstBuild.presentation.min}–${firstBuild.presentation.max} and a first book ${firstBuild.book.min}–${firstBuild.book.max}${sampleNote}.`} A credit isn&rsquo;t a fixed number of pages, slides or images.{pricePerCredit && ` On a plan, a credit costs between ${pricePerCredit.min}¢ and ${pricePerCredit.max}¢.`}</p></details>
    <details id="faq-failed"><summary>What if a request fails, or I don&rsquo;t like the result?</summary><p>A request that stops with an error, runs out of time before saving or can&rsquo;t be saved costs nothing, and neither does a plan that fails to finish or the tailored questions about a new brief. A request that runs but doesn&rsquo;t produce a usable change is charged for what it used, and so is a design review that finds nothing to fix. If you press Stop, only confirmed work is charged and unused credits go back.</p></details>
    {!unlimitedCredits && <details id="faq-low"><summary>What happens when I run low?</summary><p>Each request needs enough credits to cover its limit before it starts, so when your balance is lower you can pick a lighter effort or wait for your next monthly credits. You get a low-balance alert at the level you choose, and you can set a monthly usage limit. Editing by hand, previews, versions, source download and hosting your published sites use no credits. To move to a bigger plan, email admin@makeborne.com; plan switching isn&rsquo;t self-serve yet.</p></details>}
    {!unlimitedCredits && <details id="faq-expire"><summary>Do unused credits expire?</summary><p>Unused plan credits stay usable for two months after the month they were added, then expire. The credits expiring soonest are used first, and your balance shows the exact expiry time. If a run fails or you stop it, unused credits go back with their original expiry.{trialCredits ? " Trial credits do not expire." : ""}</p></details>}
    {!unlimitedCredits && <details id="faq-cancel"><summary>How do I cancel, and can I get a refund?</summary><p>Cancel any time in your Whop account before your next renewal; your plan stays active until the end of the period you paid for, and cancelling doesn&rsquo;t request a refund by itself. Any payment whose credits are all unused can be refunded in full: email admin@makeborne.com with your Whop payment reference. A refund ends that period&rsquo;s access. Beyond your statutory rights, including any EU or UK right to withdraw, there are no partial refunds once a payment&rsquo;s credits are used.</p></details>}
    <details id="faq-payment"><summary>Who handles payment and tax?</summary><p>Whop runs our secure checkout and sends your receipts. Prices are in US dollars.{taxNote ? ` ${taxNote}` : ""} You see your total in Whop checkout before you pay.</p></details>
    {!unlimitedCredits && (trialCredits ? <details id="faq-trial"><summary>How does the free tier work?</summary><p>Confirm your email to start free with {trialCredits} one-time trial credits. Credits are held while work runs, and only what is used is charged. Creation plans add monthly credits.</p></details>
      : <details id="faq-trial"><summary>{hasYearly ? "Is there a free trial?" : "Is there a free trial or yearly billing?"}</summary><p>{hasYearly ? "No." : "Not at launch."} Instead, every request shows its credit limit before it starts, errors and unsaved work aren&rsquo;t charged, and a payment is refundable while none of its credits are used.{hasYearly ? "" : " Yearly billing isn’t available yet."}</p></details>)}
  </section>;
  const costTable = <details className="billing-costs-details"><summary>Credit limits for every effort level</summary><p className="billing-costs-caption">Higher effort can plan and review more, so its limits are higher. Nothing above Medium has been measured yet.</p><BillingCreditCosts estimates={costs} /></details>;
  const subscriptionHistory = Boolean(subscriptions?.length);
  const memberAccount = <>
    <BillingSubscriptions items={subscriptions} />
    <BillingConfirmations records={purchaseRecords} />
    {!unlimitedCredits && <BillingControls />}
    {autotopupSetup && !unlimitedCredits && <BillingAutotopup />}
  </>;

  return <div className="billing-shell">
    <header className="billing-top"><Link href="/" className="billing-brand" aria-label="Makeborne home"><BrandMark size={27} /><span>Makeborne</span></Link><div className="billing-top-actions">{accountPrivileges?.isAdmin && <Link className="billing-admin-link" href="/admin"><ShieldCheck size={15} aria-hidden="true" />Administrator</Link>}{signedIn ? <Link className="billing-top-link" href="/studio">Open studio</Link> : <><Link className="billing-top-link billing-top-help" href="/help">Help</Link><Link className="billing-top-link billing-top-signin" href="/login?next=%2Fbilling%23plans">Sign in</Link></>}</div></header>
    <main className="billing-main">
      {topupOrderId !== undefined && <BillingTopupReturn orderId={topupOrderId} />}
      {notice}
      <div className={`billing-hero${!plansFirst && signedIn ? " billing-hero-member" : ""}`}><span className="billing-eyebrow">PRICING</span><h1>{signedIn && plansFirst ? "Choose a plan to start creating." : signedIn ? "Your plan & credits." : "Pick how much you make each month."}</h1>
        <p>{!plansFirst && signedIn ? "Your balance, usage and receipts come first. Plans and questions follow below." : `Every plan includes websites, books, presentations and the client CRM. Plans differ only in monthly credits${fromPrice ? `, from ${fromPrice} a month` : ""}, and every request shows its credit limit before it starts.`}</p>
        {launchLine}
        {buying && planChips?.length ? <nav className="billing-plan-chips" aria-label="Jump to a plan">{planChips.map(chip => <a key={chip.id} href={`#plan-${chip.id}`}>{chip.name} {chip.price}</a>)}</nav> : null}
      </div>
      {!plansFirst && signedIn && <nav className="billing-section-nav" aria-label="Billing sections"><a href="#credits">Your credits</a><a href="#activity">Usage</a><a href="#receipts">Subscription &amp; receipts</a><a href="#plans">Plans</a>{!unlimitedCredits && isMember && <a href="#topups">Credit packs</a>}<a href="#billing-questions">Questions</a></nav>}
      {plansFirst ? <>
        {plans}
        {questions}
        {costTable}
        {signedIn && <section className="billing-account" aria-labelledby="account-heading"><h2 id="account-heading" className="billing-account-heading">Your account</h2>
      <section id="credits" className="billing-credit-section" aria-labelledby="credits-heading">
        <div className="billing-section-heading"><div><h2 id="credits-heading">Your credits, at a glance.</h2><p>{unlimitedCredits ? "Your administrator allowance has no credit limit. Recorded usage is shown when available." : trialCredits ? `Available and reserved, always separate. Start free with ${trialCredits} trial credits; plans add monthly credits.` : "Available and reserved, always separate. Creation plans add monthly credits."}</p></div><span className="billing-soft-tag">{unlimitedCredits ? "Administrator allowance" : credits ? "Account balance" : "Checking balance"}</span></div>
        <div className="billing-overview">
          <div className="billing-balance"><div className="billing-card-heading"><span><Wallet size={17} /> {unlimitedCredits ? "Administrator allowance" : "Available credits"}</span></div><CreditBalance variant="hero" onLoad={setCredits} /><div className="billing-balance-bottom"><span>{unlimitedCredits || credits?.unlimited ? "No subscription required" : credits?.nextExpiry ? creditExpiryLabel(credits.nextExpiry) : "Your current account balance"}</span>{unlimitedCredits ? <Link href="/studio">Open studio</Link> : isMember ? <a href="#topups" className="billing-balance-topup">View credit packs <ArrowUpRight size={12} aria-hidden="true" /></a> : <a href="#plans" className="billing-balance-topup">See plans <ArrowUpRight size={12} aria-hidden="true" /></a>}</div></div>
          <div className="billing-metrics"><div><span className="billing-metric-icon"><Layers3 size={18} /></span><div><span>Reserved</span><strong>{credits ? format(String(credits.reserved)) : format(summary.reserved)}</strong><p>Set aside for work in progress</p></div></div><div><span className="billing-metric-icon"><Sparkles size={18} /></span><div><span>Used {summary.period ? `· ${summary.period}` : "this period"}</span><strong>{format(summary.used)}</strong><p>Finalised credit usage</p></div></div></div>
        </div>
      </section>
        <section id="activity" className="billing-activity" aria-labelledby="activity-heading">
        <div className="billing-section-heading"><div><h2 id="activity-heading">Usage history</h2><p>See the project and action behind each charge.{summary.status === "ready" && coverage && <> <span className="billing-usage-coverage">{coverage.text}. {USAGE_EXCLUDED}.</span></>}</p></div>{summary.status === "ready" && <button disabled={entries.length === 0} onClick={downloadUsage}>Download usage (JSON)</button>}</div>
        {downloadError && <p className="billing-checkout-error" role="alert">{downloadError}</p>}
        <div className="billing-ledger">
          {summary.status === "ready" && <div className="billing-ledger-tools"><div className="billing-filters" aria-label="Filter credit activity">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="billing-search"><Search size={16} /><span className="billing-sr-only">Search usage by project or action</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search usage" type="search" /></label></div>}
          {summary.status === "ready" && pages && <nav className="billing-usage-pages" aria-label="Usage history pages">{pages.previous && <Link href={usageHref(pages.previous)}>Previous month</Link>}{summary.history.newer > 0 && <Link href={usageHref(summary.history.periodKey)}>Latest activity</Link>}{summary.history.olderCursor && <Link href={usageHref(summary.history.periodKey, summary.history.olderCursor)}>Older activity</Link>}{pages.next && <Link href={usageHref(pages.next)}>Next month</Link>}</nav>}
          {entries.length > 0 ? <div className="billing-table-wrap"><table><caption className="billing-sr-only">Credit activity with project, category, status and credit amounts</caption><thead><tr><th>Project / action</th><th>Mode / category</th><th>Status</th><th>Funding</th><th>Credits</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><strong>{entry.workspaceId && entry.artifactId ? <Link href={`/studio?tab=projects&workspace=${entry.workspaceId}&artifact=${entry.artifactId}`}>{entry.project}</Link> : entry.project}</strong><span>{entry.action}</span>{entry.operationId && <small>Request {entry.operationId.slice(0,8)} · whole request: {format(entry.operationCharged ?? null)} charged, {format(entry.operationReserved ?? null)} reserved (all steps)</small>}<time dateTime={entry.occurredAt}>{entry.occurredAt.slice(0, 10)}</time></td><td>{entry.mode ?? (entry.category === "Research" ? "Research" : entry.category === "Account" ? "Account" : "Not recorded")}<span>{entry.category}</span></td><td>{entry.status}</td><td>{entry.funding ? <><span>Plan allowance: {format(entry.funding.plan)}</span><span>Paid credits: {format(entry.funding.paid)}</span><span>Trial / other: {format(entry.funding.other)}</span><small>{entry.status === "Reserved" ? "Reserved from these lots" : "Charged to these lots"}</small></> : entry.status === "Released" ? "Nothing charged" : "Not recorded"}</td><td>{format(entry.credits)}</td></tr>)}</tbody></table></div> : <div className="billing-empty"><span aria-hidden="true"><ReceiptText size={23} strokeWidth={1.6} /></span><h3>{summary.status === "unavailable" ? unlimitedCredits ? "Usage history is not available yet" : "Usage history is unavailable right now" : noRecordedActivity ? `No credit activity in ${summary.period}` : "No matching activity"}</h3><p>{summary.status === "unavailable" ? unlimitedCredits ? "Your unlimited allowance is active. Reserved and used amounts are unavailable." : "Itemized credit activity could not be loaded. Your balance above is unaffected; please try again later." : noRecordedActivity ? unlimitedCredits ? "Work under the administrator allowance holds and charges no credits, so it is not listed here." : "Credit holds and charges for this month will appear here once you start creating." : "Try another category or search term."}</p></div>}
        </div>
      </section>
          {subscriptionHistory && <BillingSubscriptions items={subscriptions} />}
          <BillingConfirmations records={purchaseRecords} />
        </section>}
      </> : <>
      <section id="credits" className="billing-credit-section" aria-labelledby="credits-heading">
        <div className="billing-section-heading"><div><h2 id="credits-heading">Your credits, at a glance.</h2><p>{unlimitedCredits ? "Your administrator allowance has no credit limit. Recorded usage is shown when available." : trialCredits ? `Available and reserved, always separate. Start free with ${trialCredits} trial credits; plans add monthly credits.` : "Available and reserved, always separate. Creation plans add monthly credits."}</p></div><span className="billing-soft-tag">{unlimitedCredits ? "Administrator allowance" : credits ? "Account balance" : "Checking balance"}</span></div>
        <div className="billing-overview">
          <div className="billing-balance"><div className="billing-card-heading"><span><Wallet size={17} /> {unlimitedCredits ? "Administrator allowance" : "Available credits"}</span></div><CreditBalance variant="hero" onLoad={setCredits} /><div className="billing-balance-bottom"><span>{unlimitedCredits || credits?.unlimited ? "No subscription required" : credits?.nextExpiry ? creditExpiryLabel(credits.nextExpiry) : "Your current account balance"}</span>{unlimitedCredits ? <Link href="/studio">Open studio</Link> : isMember ? <a href="#topups" className="billing-balance-topup">View credit packs <ArrowUpRight size={12} aria-hidden="true" /></a> : <a href="#plans" className="billing-balance-topup">See plans <ArrowUpRight size={12} aria-hidden="true" /></a>}</div></div>
          <div className="billing-metrics"><div><span className="billing-metric-icon"><Layers3 size={18} /></span><div><span>Reserved</span><strong>{credits ? format(String(credits.reserved)) : format(summary.reserved)}</strong><p>Set aside for work in progress</p></div></div><div><span className="billing-metric-icon"><Sparkles size={18} /></span><div><span>Used {summary.period ? `· ${summary.period}` : "this period"}</span><strong>{format(summary.used)}</strong><p>Finalised credit usage</p></div></div></div>
        </div>
      </section>
        <section id="activity" className="billing-activity" aria-labelledby="activity-heading">
        <div className="billing-section-heading"><div><h2 id="activity-heading">Usage history</h2><p>See the project and action behind each charge.{summary.status === "ready" && coverage && <> <span className="billing-usage-coverage">{coverage.text}. {USAGE_EXCLUDED}.</span></>}</p></div>{summary.status === "ready" && <button disabled={entries.length === 0} onClick={downloadUsage}>Download usage (JSON)</button>}</div>
        {downloadError && <p className="billing-checkout-error" role="alert">{downloadError}</p>}
        <div className="billing-ledger">
          {summary.status === "ready" && <div className="billing-ledger-tools"><div className="billing-filters" aria-label="Filter credit activity">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="billing-search"><Search size={16} /><span className="billing-sr-only">Search usage by project or action</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search usage" type="search" /></label></div>}
          {summary.status === "ready" && pages && <nav className="billing-usage-pages" aria-label="Usage history pages">{pages.previous && <Link href={usageHref(pages.previous)}>Previous month</Link>}{summary.history.newer > 0 && <Link href={usageHref(summary.history.periodKey)}>Latest activity</Link>}{summary.history.olderCursor && <Link href={usageHref(summary.history.periodKey, summary.history.olderCursor)}>Older activity</Link>}{pages.next && <Link href={usageHref(pages.next)}>Next month</Link>}</nav>}
          {entries.length > 0 ? <div className="billing-table-wrap"><table><caption className="billing-sr-only">Credit activity with project, category, status and credit amounts</caption><thead><tr><th>Project / action</th><th>Mode / category</th><th>Status</th><th>Funding</th><th>Credits</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><strong>{entry.workspaceId && entry.artifactId ? <Link href={`/studio?tab=projects&workspace=${entry.workspaceId}&artifact=${entry.artifactId}`}>{entry.project}</Link> : entry.project}</strong><span>{entry.action}</span>{entry.operationId && <small>Request {entry.operationId.slice(0,8)} · whole request: {format(entry.operationCharged ?? null)} charged, {format(entry.operationReserved ?? null)} reserved (all steps)</small>}<time dateTime={entry.occurredAt}>{entry.occurredAt.slice(0, 10)}</time></td><td>{entry.mode ?? (entry.category === "Research" ? "Research" : entry.category === "Account" ? "Account" : "Not recorded")}<span>{entry.category}</span></td><td>{entry.status}</td><td>{entry.funding ? <><span>Plan allowance: {format(entry.funding.plan)}</span><span>Paid credits: {format(entry.funding.paid)}</span><span>Trial / other: {format(entry.funding.other)}</span><small>{entry.status === "Reserved" ? "Reserved from these lots" : "Charged to these lots"}</small></> : entry.status === "Released" ? "Nothing charged" : "Not recorded"}</td><td>{format(entry.credits)}</td></tr>)}</tbody></table></div> : <div className="billing-empty"><span aria-hidden="true"><ReceiptText size={23} strokeWidth={1.6} /></span><h3>{summary.status === "unavailable" ? unlimitedCredits ? "Usage history is not available yet" : "Usage history is unavailable right now" : noRecordedActivity ? `No credit activity in ${summary.period}` : "No matching activity"}</h3><p>{summary.status === "unavailable" ? unlimitedCredits ? "Your unlimited allowance is active. Reserved and used amounts are unavailable." : "Itemized credit activity could not be loaded. Your balance above is unaffected; please try again later." : noRecordedActivity ? unlimitedCredits ? "Work under the administrator allowance holds and charges no credits, so it is not listed here." : "Credit holds and charges for this month will appear here once you start creating." : "Try another category or search term."}</p></div>}
        </div>
      </section>
        {memberAccount}
        {plans}
        {questions}
        {costTable}
      </>}
      <footer id="support" className="billing-footer"><span>© 2026 Makeborne</span><Link href="/billing/terms">Subscription, credit and refund terms</Link><LegalLinks /><Link href="/withdraw">Withdraw</Link><Link href="/help">Help</Link><span>Billing support: <a href="mailto:admin@makeborne.com">admin@makeborne.com</a></span></footer>
    </main>
  </div>;
}
