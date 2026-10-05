"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CircleHelp, Layers3, ReceiptText, Search, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import BrandMark from "./brand-mark";
import BillingPlans from "./billing-plans";
import { formatBillingCredits } from "./billing-amount";
import { readBillingView, filterBillingEntries, billingStatement, type BillingViewModel } from "@/lib/billing/view";
export type { BillingEntry, BillingViewModel } from "@/lib/billing/view";

const categories = ["All activity", "Creation", "Media", "Hosting", "Research"] as const;

export default function BillingWorkspace({ summary: input, membershipRequired = false, accountPrivileges }: { summary: BillingViewModel; membershipRequired?: boolean; accountPrivileges?: { isAdmin: boolean; unlimitedCredits: boolean } }) {
  const summary = readBillingView(input);
  const unlimitedCredits = accountPrivileges?.unlimitedCredits === true;
  const [category, setCategory] = useState<(typeof categories)[number]>("All activity");
  const [query, setQuery] = useState("");
  const [downloadError, setDownloadError] = useState("");
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

  return <div className="billing-shell">
    <header className="billing-top"><Link href="/" className="billing-brand" aria-label="Makeborne home"><BrandMark size={27} /><span>Makeborne</span></Link><div className="billing-top-actions">{accountPrivileges?.isAdmin && <Link className="billing-admin-link" href="/admin"><ShieldCheck size={15} aria-hidden="true" />Administrator</Link>}<Link className="billing-back" href="/"><ArrowLeft size={15} aria-hidden="true" /> Back to home</Link></div></header>
    <main className="billing-main">
      <div className="billing-heading"><div><span className="billing-eyebrow">MAKEBORNE MEMBERSHIPS</span><h1>Plans &amp; credits.</h1><p>Room for your ideas. Clarity on what you spend.</p></div></div>
      <nav className="billing-section-nav" aria-label="Billing sections"><a href="#plans">Creation plans</a>{!unlimitedCredits && <a href="#topups">Add credits</a>}<a href="#credits">Credits &amp; usage</a><a href="#support">Pay a coffee</a></nav>
      {unlimitedCredits ? <div className="billing-membership-note"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Unlimited credits · Administrator allowance</strong><p>No creation subscription or credit top-ups are required for this account. Generation remains disabled while creation services are being prepared.</p><Link className="billing-allowance-link" href="/studio">Open studio<ArrowUpRight size={13} aria-hidden="true" /></Link></div></div> : membershipRequired && <div className="billing-membership-note" role="status"><CircleHelp size={18} /><div><strong>A creation membership is needed to open the studio.</strong><p>Memberships are not open yet. Coffee support is optional and does not include app access.</p></div></div>}
      <BillingPlans unlimitedCredits={unlimitedCredits} />
      <section id="credits" className="billing-credit-section" aria-labelledby="credits-heading">
        <div className="billing-section-heading"><div><h2 id="credits-heading">Your credits, at a glance.</h2><p>{unlimitedCredits ? "Your administrator allowance has no credit limit. Recorded usage is shown when available." : summary.status === "ready" ? "Available, reserved, and used. Always separate." : "Credit balances will appear here when creation memberships are active."}</p></div><span className="billing-soft-tag">{unlimitedCredits ? "Administrator allowance" : summary.status === "ready" ? "Account usage" : "Not active yet"}</span></div>
        <div className="billing-overview">
          <div className="billing-balance"><div className="billing-card-heading"><span><Wallet size={17} /> {unlimitedCredits ? "Administrator allowance" : "Available credits"}</span></div><div className="billing-balance-number" aria-label={unlimitedCredits ? "Unlimited credits" : summary.available === null ? "Available credits unavailable" : `${summary.available} credits available`}>{unlimitedCredits ? "Unlimited" : format(summary.available)}<span>credits</span></div><div className="billing-balance-bottom"><span>{unlimitedCredits ? "No subscription required" : summary.status === "ready" ? "Your current account balance" : "No active credit balance"}</span>{unlimitedCredits ? <span>Generation disabled</span> : <a href="#topups" className="billing-balance-topup">View credit packs <ArrowUpRight size={12} aria-hidden="true" /></a>}</div></div>
          <div className="billing-metrics"><div><span className="billing-metric-icon"><Layers3 size={18} /></span><div><span>Reserved</span><strong>{format(summary.reserved)}</strong><p>Set aside for work in progress</p></div></div><div><span className="billing-metric-icon"><Sparkles size={18} /></span><div><span>Used {summary.period ? `· ${summary.period}` : "this period"}</span><strong>{format(summary.used)}</strong><p>Finalised credit usage</p></div></div></div>
        </div>
      </section>
      <section id="activity" className="billing-activity" aria-labelledby="activity-heading">
        <div className="billing-section-heading"><div><h2 id="activity-heading">Usage history</h2><p>See the project and action behind each charge.</p></div>{summary.status === "ready" && <button disabled={entries.length === 0} onClick={downloadUsage}>Download usage (JSON)</button>}</div>
        {downloadError && <p className="billing-checkout-error" role="alert">{downloadError}</p>}
        <div className="billing-ledger">
          {summary.status === "ready" && <div className="billing-ledger-tools"><div className="billing-filters" aria-label="Filter credit activity">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="billing-search"><Search size={16} /><span className="billing-sr-only">Search usage by project or action</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search usage" type="search" /></label></div>}
          {entries.length > 0 ? <div className="billing-table-wrap"><table><caption className="billing-sr-only">Credit activity with project, category, status and credit amounts</caption><thead><tr><th>Project / action</th><th>Category</th><th>Status</th><th>Credits</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><strong>{entry.project}</strong><span>{entry.action}</span><time dateTime={entry.occurredAt}>{entry.occurredAt.slice(0, 10)}</time></td><td>{entry.category}</td><td>{entry.status}</td><td>{format(entry.credits)}</td></tr>)}</tbody></table></div> : <div className="billing-empty"><span aria-hidden="true"><ReceiptText size={23} strokeWidth={1.6} /></span><h3>{unlimitedCredits && summary.status === "unavailable" ? "Usage history is not available yet" : noRecordedActivity ? "No credit activity yet" : "No matching activity"}</h3><p>{summary.status === "unavailable" ? unlimitedCredits ? "Your unlimited allowance is active. Reserved and used amounts are unavailable; generation is still disabled." : "When creation memberships open, recorded credit activity will appear here. Coffee support does not add or use credits." : noRecordedActivity ? "Your recorded usage will appear here once you start creating." : "Try another category or search term."}</p></div>}
        </div>
      </section>
      <section className="billing-details" aria-labelledby="billing-questions"><h2 id="billing-questions">A few useful details.</h2>
        {unlimitedCredits && <details><summary>Do I need a creation subscription?</summary><p>No. This account has an unlimited administrator credit allowance, so no creation subscription or top-up is required. This allowance does not enable generation while creation services are disabled. Pay a coffee remains optional support.</p></details>}
        <details><summary>Does Pay a coffee include app access?</summary><p>{unlimitedCredits ? "No. The US$1 monthly subscription supports Makeborne’s development. Your administrator allowance is separate, and you do not need a support subscription to use it." : "No. The US$1 monthly subscription supports Makeborne’s development. Studio access, expert chat, and generation credits require a separate creation membership."}</p></details>
        <details><summary>When can I buy a creation membership?</summary><p>Checkout stays closed until launch. At launch, you can choose a monthly or yearly subscription. The founding offer takes 30% off the first billing term; automatic renewals use the standard price. Your access and credits begin with your launch purchase.</p></details>
        <details><summary>Can I buy more credits without upgrading?</summary><p>{unlimitedCredits ? "You do not need additional credits with this account’s unlimited administrator allowance. Credit packs are intended for accounts with a limited creation membership." : "Yes, that is what one-time credit packs are for. Keep your existing creation membership and choose extra credits when you need them. There is no recurring top-up or automatic plan change. Packs are currently a preview; checkout will open when credit delivery is ready. Final pricing, expiry and refund terms will be shown before purchase."}</p></details>
        <details><summary>How will credit usage work?</summary><p>You will see an estimate before paid generation. Credits will be reserved while work runs, then the final charge or release will be recorded. Reservations and completed charges will stay separate. Rates and refund rules will be published before paid generation opens.</p></details>
        <details><summary>What affects the credit estimate?</summary><p>Thinking effort, output length, artwork, and media processing can affect usage. One credit is not one page, slide, or image. The estimate will describe the work you are about to start.</p></details>
        <details><summary>Where do I manage my coffee subscription?</summary><p>Whop handles checkout and billing for Pay a coffee. Use your Whop account or the link in your confirmation email to find your subscription and receipts.</p></details>
      </section>
      <footer className="billing-footer"><span>© 2026 Makeborne</span><Link href="/">Back to Makeborne <ArrowUpRight size={14} /></Link></footer>
    </main>
  </div>;
}
