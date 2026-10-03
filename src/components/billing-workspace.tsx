"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CircleHelp, CreditCard, Layers3, LockKeyhole, ReceiptText, Search, Sparkles, Wallet } from "lucide-react";
import BrandMark from "./brand-mark";
import BillingPlans from "./billing-plans";
import { formatBillingCredits } from "./billing-amount";

import { readBillingView, filterBillingEntries, billingStatement, type BillingViewModel } from "@/lib/billing/view";
export type { BillingEntry, BillingViewModel } from "@/lib/billing/view";

const categories = ["All activity", "Creation", "Media", "Hosting", "Research"] as const;


export default function BillingWorkspace({ summary: input }: { summary: BillingViewModel }) {
  const summary = readBillingView(input);
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

  return <div className="billing-shell">
    <header className="billing-top"><Link href="/studio?tab=projects" className="billing-brand"><BrandMark size={27} /><span>makeborne</span></Link><Link className="billing-back" href="/studio?tab=projects"><ArrowLeft size={15} /> Back to studio</Link></header>
    <main className="billing-main">
      <div className="billing-heading"><div><span className="billing-eyebrow">YOUR WORKSPACE</span><h1>Make more. Stay in control.</h1><p>Your plan, credits, and every bit of usage. In one place.</p></div><span className="billing-preview"><span /> {summary.status === "ready" ? "Account usage" : "Billing preview"}</span></div>
      <div className="billing-section-nav"><a href="#credits">Overview</a><a href="#plans">Plans</a><a href="#activity">Usage history</a></div>
      <section id="credits" className="billing-overview" aria-label="Credit overview">
        <div className="billing-balance"><div className="billing-card-heading"><span><Wallet size={17} /> Credit balance</span><span className="billing-soft-tag">{summary.status === "ready" ? "Usage connected" : "Not connected"}</span></div><div className="billing-balance-number" aria-label={summary.available === null ? "Available credits unavailable" : `${summary.available} credits available`}>{format(summary.available)}<span>available credits</span></div><p>See what is available before you start your next creation.</p><div className="billing-balance-bottom"><span><LockKeyhole size={14} /> Purchases are not enabled</span><button disabled aria-describedby="billing-availability">Add credits <ArrowUpRight size={14} /></button></div></div>
        <div className="billing-metrics"><div><span className="billing-metric-icon"><Layers3 size={18} /></span><div><span>Reserved</span><strong>{format(summary.reserved)}</strong><p>Set aside for work in progress</p></div></div><div><span className="billing-metric-icon"><Sparkles size={18} /></span><div><span>Used {summary.period ? `· ${summary.period}` : "this period"}</span><strong>{format(summary.used)}</strong><p>Settled usage for this period</p></div></div></div>
      </section>
      <p id="billing-availability" className="billing-availability"><CircleHelp size={16} /> {summary.status === "ready" ? "Your account usage is available. Credit purchases and subscription changes are not enabled yet." : "Billing is not connected yet. Balances and usage are unavailable, and no purchase can be made from this page."}</p>
      <BillingPlans />
      <section id="activity" className="billing-activity"><div className="billing-section-heading"><div><h2>Every credit, accounted for.</h2><p>Track the project and action behind each charge.</p></div><button disabled={summary.status !== "ready" || entries.length === 0} onClick={downloadUsage}>Download usage (JSON)</button></div>{downloadError && <p role="alert">{downloadError}</p>}<div className="billing-ledger"><div className="billing-ledger-tools"><div className="billing-filters" aria-label="Filter credit activity">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="billing-search"><Search size={16} /><span className="billing-sr-only">Search usage by project or action</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search usage" type="search" /></label></div><div className="billing-table-wrap"><table><caption className="billing-sr-only">Credit activity with project, category, status and credit amounts</caption><thead><tr><th>Project / action</th><th>Category</th><th>Status</th><th>Credits</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><strong>{entry.project}</strong><span>{entry.action}</span><time dateTime={entry.occurredAt}>{entry.occurredAt.slice(0, 10)}</time></td><td>{entry.category}</td><td>{entry.status}</td><td>{format(entry.credits)}</td></tr>)}</tbody></table></div>{entries.length === 0 && <div className="billing-empty"><span><ReceiptText size={24} /></span><h3>{summary.status === "unavailable" ? "Your usage history will live here" : "No matching activity"}</h3><p>{summary.status === "unavailable" ? "Once billing is connected, this view will show recorded credit activity. There are no account records available to display yet." : "Try another category or search term."}</p></div>}</div></section>
      <section className="billing-details" aria-label="Billing details"><div><CreditCard size={21} /><div><h3>Payment details & invoices</h3><p>Manage your subscription, payment method, and receipts when billing is available.</p></div><button disabled aria-describedby="billing-availability">Manage billing <ArrowUpRight size={14} /></button></div><details><summary>How will credit usage work?</summary><p>The intended flow shows an estimate before generation, reserves credits while work runs, then records the final charge or release. This page will distinguish those states so a reservation is never mistaken for a completed charge. Rates and refund rules will be published before paid generation opens.</p></details><details><summary>What affects the credit estimate?</summary><p>Output length, artwork, media processing, and hosting can affect the estimate. You will see the expected credits before starting paid work.</p></details><details><summary>Are website hosting and media included?</summary><p>Hosting and media have separate usage categories here. Their allowances and rates are not finalised, and these services are not available for purchase yet.</p></details></section>
      <footer className="billing-footer">More clarity. More room to create.<Link href="/studio?tab=projects">Return to your projects <ArrowUpRight size={14} /></Link></footer>
    </main>
  </div>;
}
