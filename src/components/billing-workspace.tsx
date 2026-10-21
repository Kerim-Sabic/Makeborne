"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CircleHelp, Layers3, ReceiptText, Search, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import BrandMark from "./brand-mark";
import BillingPlans from "./billing-plans";
import BillingTopupReturn from "./billing-topup-return";
import BillingAutotopup from "./billing-autotopup";
import BillingControls from "./billing-controls";
import BillingSubscriptions from "./billing-subscriptions";
import type { SubscriptionSummary } from "@/lib/billing/subscription-summary";
import CreditBalance, { creditExpiryLabel, type CreditBalanceData } from "./credit-balance";
import { formatBillingCredits } from "./billing-amount";
import BillingCreditCosts from "./billing-credit-costs";
import type { BuilderEstimates } from "@/lib/builder/credit-estimate";
import { readBillingView, filterBillingEntries, billingStatement, usageCoverage, USAGE_EXCLUDED, type BillingViewModel } from "@/lib/billing/view";
import { adjacentUsagePeriods } from "@/lib/billing/usage-history";
export type { BillingEntry, BillingViewModel } from "@/lib/billing/view";

const categories = ["All activity", "Creation", "Media", "Hosting", "Research", "Account"] as const;
const usageHref = (period: string, before?: string) => `/billing?usage=${period}${before ? `&usageBefore=${encodeURIComponent(before)}` : ""}#activity`;

export default function BillingWorkspace({ summary: input, membershipRequired = false, refundedPeriod = null, autotopupSetup = false, accountPrivileges, trialCredits = null, signedIn = true, subscriptions = null, topupOrderId, costs = null }: { summary: BillingViewModel; /** Measured builder costs, in credits at the live rate. */ costs?: BuilderEstimates | null; membershipRequired?: boolean; /** Current billing period whose payment was refunded or charged back. */ refundedPeriod?: { periodEnd: string; reason: string } | null; /** Automatic top-up setup (qualification flag only; never charges). */ autotopupSetup?: boolean; accountPrivileges?: { isAdmin: boolean; unlimitedCredits: boolean }; /** Live free-tier trial size; null when the free tier is off. */ trialCredits?: number | null; /** Signed-out visitors see plans and a sign-in prompt instead of an empty balance. */ signedIn?: boolean; subscriptions?: SubscriptionSummary[] | null; topupOrderId?: string }) {
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

  return <div className="billing-shell">
    <header className="billing-top"><Link href="/" className="billing-brand" aria-label="Makeborne home"><BrandMark size={27} /><span>Makeborne</span></Link><div className="billing-top-actions">{accountPrivileges?.isAdmin && <Link className="billing-admin-link" href="/admin"><ShieldCheck size={15} aria-hidden="true" />Administrator</Link>}<Link className="billing-back" href="/"><ArrowLeft size={15} aria-hidden="true" /> Back to home</Link></div></header>
    <main className="billing-main">
      <div className="billing-heading"><div><span className="billing-eyebrow">MAKEBORNE MEMBERSHIPS</span><h1>Plans &amp; credits.</h1><p>Room for your ideas. Clarity on what you spend.</p></div></div>
      <nav className="billing-section-nav" aria-label="Billing sections"><a href="#credits">Your credits</a>{signedIn && <><a href="#activity">Usage</a><a href="#receipts">Subscription &amp; receipts</a></>}<a href="#plans">Plans</a>{!unlimitedCredits && <a href="#topups">Credit packs</a>}<a href="#costs">What building costs</a><a href="#billing-questions">Questions</a><a href="#support">Support us</a></nav>
      {topupOrderId !== undefined && <BillingTopupReturn orderId={topupOrderId} />}
      {unlimitedCredits ? <div className="billing-membership-note"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Unlimited credits · Administrator allowance</strong><p>No creation subscription or credit top-ups are required for this account.</p><Link className="billing-allowance-link" href="/studio">Open studio<ArrowUpRight size={13} aria-hidden="true" /></Link></div></div> : refundedPeriod ? <div className="billing-membership-note" role="status"><CircleHelp size={18} /><div><strong>{refundedPeriod.reason === "dispute_lost" ? "This billing period's payment was charged back." : "This billing period's payment was refunded."}</strong><p>Creation access for this billing period (until {new Date(refundedPeriod.periodEnd).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}, UTC) ended with it, and the period&rsquo;s unused credits were removed. Access returns with your next paid period. Questions: <a href="mailto:admin@makeborne.com">admin@makeborne.com</a>.</p></div></div> : membershipRequired && <div className="billing-membership-note" role="status"><CircleHelp size={18} /><div><strong>Creation access isn&rsquo;t available for this account yet.</strong><p>{trialCredits ? `Confirmed accounts start free with ${trialCredits} trial credits while the free tier is open. ` : "Creation needs a creation plan. "}Coffee support is optional and does not include app access.</p></div></div>}
      {signedIn ? <>
      <section id="credits" className="billing-credit-section" aria-labelledby="credits-heading">
        <div className="billing-section-heading"><div><h2 id="credits-heading">Your credits, at a glance.</h2><p>{unlimitedCredits ? "Your administrator allowance has no credit limit. Recorded usage is shown when available." : trialCredits ? `Available and reserved, always separate. Start free with ${trialCredits} trial credits; plans add monthly credits.` : "Available and reserved, always separate. Creation plans add monthly credits."}</p></div><span className="billing-soft-tag">{unlimitedCredits ? "Administrator allowance" : credits ? "Account balance" : "Checking balance"}</span></div>
        <div className="billing-overview">
          <div className="billing-balance"><div className="billing-card-heading"><span><Wallet size={17} /> {unlimitedCredits ? "Administrator allowance" : "Available credits"}</span></div><CreditBalance variant="hero" onLoad={setCredits} /><div className="billing-balance-bottom"><span>{unlimitedCredits || credits?.unlimited ? "No subscription required" : credits?.nextExpiry ? creditExpiryLabel(credits.nextExpiry) : "Your current account balance"}</span>{unlimitedCredits ? <Link href="/studio">Open studio</Link> : <a href="#topups" className="billing-balance-topup">View credit packs <ArrowUpRight size={12} aria-hidden="true" /></a>}</div></div>
          <div className="billing-metrics"><div><span className="billing-metric-icon"><Layers3 size={18} /></span><div><span>Reserved</span><strong>{credits ? format(String(credits.reserved)) : format(summary.reserved)}</strong><p>Set aside for work in progress</p></div></div><div><span className="billing-metric-icon"><Sparkles size={18} /></span><div><span>Used {summary.period ? `· ${summary.period}` : "this period"}</span><strong>{format(summary.used)}</strong><p>Finalised credit usage</p></div></div></div>
        </div>
      </section>
        <section id="activity" className="billing-activity" aria-labelledby="activity-heading">
        <div className="billing-section-heading"><div><h2 id="activity-heading">Usage history</h2><p>See the project and action behind each charge.{summary.status === "ready" && coverage && <> <span className="billing-usage-coverage">{coverage.text}. {USAGE_EXCLUDED}.</span></>}</p></div>{summary.status === "ready" && <button disabled={entries.length === 0} onClick={downloadUsage}>Download usage (JSON)</button>}</div>
        {downloadError && <p className="billing-checkout-error" role="alert">{downloadError}</p>}
        <div className="billing-ledger">
          {summary.status === "ready" && <div className="billing-ledger-tools"><div className="billing-filters" aria-label="Filter credit activity">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="billing-search"><Search size={16} /><span className="billing-sr-only">Search usage by project or action</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search usage" type="search" /></label></div>}
          {summary.status === "ready" && pages && <nav className="billing-usage-pages" aria-label="Usage history pages">{pages.previous && <Link href={usageHref(pages.previous)}>Previous month</Link>}{summary.history.newer > 0 && <Link href={usageHref(summary.history.periodKey)}>Latest activity</Link>}{summary.history.olderCursor && <Link href={usageHref(summary.history.periodKey, summary.history.olderCursor)}>Older activity</Link>}{pages.next && <Link href={usageHref(pages.next)}>Next month</Link>}</nav>}
          {entries.length > 0 ? <div className="billing-table-wrap"><table><caption className="billing-sr-only">Credit activity with project, category, status and credit amounts</caption><thead><tr><th>Project / action</th><th>Mode / category</th><th>Status</th><th>Funding</th><th>Credits</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><strong>{entry.workspaceId && entry.artifactId ? <Link href={`/studio?tab=projects&workspace=${entry.workspaceId}&artifact=${entry.artifactId}`}>{entry.project}</Link> : entry.project}</strong><span>{entry.action}</span>{entry.operationId && <small>Request {entry.operationId.slice(0,8)} · whole request: {format(entry.operationCharged ?? null)} charged, {format(entry.operationReserved ?? null)} reserved (all steps)</small>}<time dateTime={entry.occurredAt}>{entry.occurredAt.slice(0, 10)}</time></td><td>{entry.mode ?? (entry.category === "Research" ? "Research" : entry.category === "Account" ? "Account" : "Not recorded")}<span>{entry.category}</span></td><td>{entry.status}</td><td>{entry.funding ? <><span>Plan allowance: {format(entry.funding.plan)}</span><span>Paid credits: {format(entry.funding.paid)}</span><span>Trial / other: {format(entry.funding.other)}</span><small>{entry.status === "Reserved" ? "Reserved from these lots" : "Charged to these lots"}</small></> : entry.status === "Released" ? "Nothing charged" : "Not recorded"}</td><td>{format(entry.credits)}</td></tr>)}</tbody></table></div> : <div className="billing-empty"><span aria-hidden="true"><ReceiptText size={23} strokeWidth={1.6} /></span><h3>{summary.status === "unavailable" ? unlimitedCredits ? "Usage history is not available yet" : "Usage history is unavailable right now" : noRecordedActivity ? `No credit activity in ${summary.period}` : "No matching activity"}</h3><p>{summary.status === "unavailable" ? unlimitedCredits ? "Your unlimited allowance is active. Reserved and used amounts are unavailable." : "Itemized credit activity could not be loaded. Your balance above is unaffected; please try again later. Coffee support does not add or use credits." : noRecordedActivity ? unlimitedCredits ? "Work under the administrator allowance holds and charges no credits, so it is not listed here." : "Credit holds and charges for this month will appear here once you start creating." : "Try another category or search term."}</p></div>}
        </div>
      </section>
      <BillingSubscriptions items={subscriptions} />
      {!unlimitedCredits && <BillingControls />}
      {autotopupSetup && !unlimitedCredits && <BillingAutotopup />}
      </> : <section id="credits" className="billing-signin" aria-labelledby="credits-heading"><Wallet size={20} aria-hidden="true" /><div><h2 id="credits-heading">Your credits and usage</h2><p>Sign in to see your balance, what is reserved for work in progress, and every charge by project.</p></div><Link className="billing-signin-button" href="/login?next=%2Fbilling%23credits">Sign in<ArrowUpRight size={14} aria-hidden="true" /></Link></section>}
      <BillingPlans unlimitedCredits={unlimitedCredits} />
      <BillingCreditCosts estimates={costs} />
      <section className="billing-details" aria-labelledby="billing-questions"><h2 id="billing-questions">A few useful details.</h2>
        <details><summary>When can I buy a plan?</summary><p>Available checkout buttons reflect the current launch gates. If a plan is marked coming soon, it cannot be bought yet. Prices are in US dollars, before tax.</p></details>
        {unlimitedCredits && <details><summary>Do I need a creation subscription?</summary><p>No. This account has an unlimited administrator credit allowance, so no creation subscription or top-up is required. Generation depends on current service availability and safety limits. Buy us a coffee remains optional support.</p></details>}
        <details><summary>Does the coffee subscription include app access?</summary><p>{unlimitedCredits ? "No. The US$1 monthly subscription supports Makeborne’s development. Your administrator allowance is separate, and you do not need a support subscription to use it." : "No. The US$1 monthly subscription supports Makeborne’s development." + (trialCredits ? ` The studio starts free with ${trialCredits} trial credits; monthly credits come with a creation membership.` : " Monthly credits come with a creation membership.")}</p></details>
        {!unlimitedCredits && trialCredits && <details><summary>How does the free tier work?</summary><p>Confirm your email to start free with {trialCredits} one-time trial credits. Credits are held while work runs, and only what is used is charged. Creation plans add monthly credits.</p></details>}
        {!unlimitedCredits && <details><summary>Do credits expire?</summary><p>Unused plan credits carry over for two months after their month ends, so you never lose a busy month&rsquo;s leftovers straight away. The oldest credits are always used first, and the exact expiry time is shown with your balance (in your time zone). Trial credits do not expire. Credit packs keep the terms shown when you buy them. If a run fails or is cancelled, its unused credits go back with their original expiry.</p></details>}
        
        <details><summary>Can I buy more credits without upgrading?</summary><p>{unlimitedCredits ? "You do not need additional credits with this account’s unlimited administrator allowance. Credit packs are intended for accounts with a limited creation membership." : "Yes, that is what one-time credit packs are for. Keep your existing creation membership and choose extra credits when you need them. Manual packs do not recur or change your plan. Automatic top-up authorization, where available, is separate and always requires consent. Packs are currently a preview; checkout will open when credit delivery is ready. Final pricing, expiry and refund terms will be shown before purchase."}</p></details>
        <details><summary>How does credit usage work?</summary><p>Before you send a request, the builder shows its credit limit and, where we have measured it, the usual range. Credits are reserved while work runs; afterwards you get a receipt with the credits actually charged, the files changed and the checks that ran, and the unused part of the reservation is released. The limits and what is never charged are listed under What building costs.</p></details>
        <details><summary>What affects the credit estimate?</summary><p>Thinking effort, output length, artwork, and media processing can affect usage. One credit is not one page, slide, or image. The estimate will describe the work you are about to start.</p></details>
        <details><summary>Where do I manage my coffee subscription?</summary><p>Whop handles checkout and billing for Buy us a coffee. Use your Whop account or the link in your confirmation email to find your subscription and receipts.</p></details>
      </section>
      <footer className="billing-footer"><span>© 2026 Makeborne</span><Link href="/">Back to Makeborne <ArrowUpRight size={14} /></Link></footer>
    </main>
  </div>;
}
