"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Coins, LoaderCircle, Plus } from "lucide-react";
import { CREDIT_TOPUP_PACKS, formatCreditTopupPrice, type CreditTopupAvailability } from "@/lib/billing/topups-catalog";
import { topupNavigationUrl } from "@/lib/billing/checkout-navigation";
import { CREATION_PLANS, TAX_NOTE, type PlanId } from "@/lib/billing/plans";
import { WITHDRAWAL_CONSENT_VERSION, PACK_WITHDRAWAL_CONSENT_TEXT } from "@/lib/legal/versions";

const money = formatCreditTopupPrice;
/** Plan against plan-plus-pack, computed from both catalogues: topping up every month costs more than the next plan. */
const COMPARE_PACK = CREDIT_TOPUP_PACKS.find(pack => pack.id === "boost_300") ?? CREDIT_TOPUP_PACKS[0];
const UPGRADE_ROWS = CREATION_PLANS.slice(0, -1).map((plan, index) => ({ plan, next: CREATION_PLANS[index + 1] }));

export default function BillingTopups({ currentTier = null }: { currentTier?: PlanId | null }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(CREDIT_TOPUP_PACKS[0].id);
  const [availability, setAvailability] = useState<CreditTopupAvailability | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consented, setConsented] = useState(false);
  const opening = useRef(false);
  const request = useRef<{ packId: string; requestId: string } | null>(null);
  const pack = CREDIT_TOPUP_PACKS.find(item => item.id === selectedId) ?? CREDIT_TOPUP_PACKS[0];
  const isPreview = !availability?.available;

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/billing/topups", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Availability could not be loaded.");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("available" in data) || typeof data.available !== "boolean"
          || !("authenticated" in data) || typeof data.authenticated !== "boolean"
          || !("eligible" in data) || typeof data.eligible !== "boolean"
          || !("reason" in data) || !(data.reason === null || typeof data.reason === "string")) throw new Error("Invalid availability.");
        if (!controller.signal.aborted) setAvailability(data as CreditTopupAvailability);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [retry]);

  async function continueToCheckout() {
    if (opening.current || !availability?.available) return;
    if (!consented) { setError("Please read and tick the immediate-start request before continuing."); return; }
    if (!availability.authenticated) {
      router.push(`/login?next=${encodeURIComponent("/billing#topups")}`);
      return;
    }
    if (!availability.eligible) {
      router.push("/billing?required=membership#plans");
      return;
    }
    opening.current = true;
    setBusy(true);
    setError("");
    try {
      // Reuse this request after an uncertain response. A retry is not a new purchase.
      if (!request.current || request.current.packId !== pack.id) request.current = { packId: pack.id, requestId: crypto.randomUUID() };
      const response = await fetch("/api/billing/topups", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request.current, withdrawalConsent: WITHDRAWAL_CONSENT_VERSION }),
      });
      if (response.status === 401) { router.push(`/login?next=${encodeURIComponent("/billing#topups")}`); return; }
      if (response.status === 402) { router.push("/billing?required=membership#plans"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data?.error?.message === "string" ? data.error.message : "Checkout could not be opened. Please try again.");
      window.location.assign(topupNavigationUrl(data?.url, window.location.origin));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout could not be opened. Please try again.");
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }

  return <section id="topups" className="billing-topups" aria-labelledby="topups-heading">
    <div className="billing-topups-heading">
      <span className="billing-addon-icon" aria-hidden="true"><Coins size={21} strokeWidth={1.5} /></span>
      <div><span className="billing-eyebrow">ONE-TIME CREDIT PACKS</span><h2 id="topups-heading">More credits. Same plan.</h2><p>A little extra for the project you want to finish.</p></div>
      {isPreview && <span className="billing-coming-soon">Coming soon</span>}
    </div>
    <div className="billing-topups-body">
      <div className="billing-pack-selection">
        <fieldset className="billing-packs" disabled={busy}>
          <legend>Choose your credit pack</legend>
          <div className="billing-pack-options">{CREDIT_TOPUP_PACKS.map(item => <label className="billing-pack" key={item.id}>
            <input type="radio" name="credit-pack" value={item.id} checked={pack.id === item.id} onChange={() => { setSelectedId(item.id); setError(""); }} />
            <span className="billing-pack-surface">
              <span className="billing-pack-check" aria-hidden="true">{pack.id === item.id ? <Check size={11} strokeWidth={2.5} /> : <Plus size={11} />}</span>
              <strong>{item.credits.toLocaleString("en-US")}</strong><span>credits</span><span className="billing-pack-label">{item.label}</span>
              <span className="billing-pack-cost">{money(item.priceCents)}</span>
            </span>
          </label>)}</div>
        </fieldset>
        <p className="billing-pack-caption">{isPreview ? "Preview pack prices. Final pack price, expiry and refund terms are shown before you buy." : "Pack price, expiry and refund terms are shown before you buy."} USD. {TAX_NOTE.short}</p>
        <div className="billing-upgrade-compare"><p>Topping up every month? A bigger plan costs less.</p><table><caption className="billing-sr-only">A plan plus a {COMPARE_PACK.credits.toLocaleString("en-US")}-credit pack against the next plan</caption><tbody>{UPGRADE_ROWS.map(({ plan, next }) => <tr key={plan.id}><td>{plan.name} + {COMPARE_PACK.credits.toLocaleString("en-US")}-credit pack: {money(plan.monthlyCents + COMPARE_PACK.priceCents)} for {(plan.monthlyCredits + COMPARE_PACK.credits).toLocaleString("en-US")} credits</td><td>{next.name}: {money(next.monthlyCents)} for {next.monthlyCredits.toLocaleString("en-US")}</td></tr>)}</tbody></table><a href={`mailto:admin@makeborne.com?subject=${encodeURIComponent(`Plan change: ${CREATION_PLANS.find(plan => plan.id === currentTier)?.name ?? "my plan"} to a bigger plan`)}`}>Ask to switch plans</a></div>
        <div className="billing-topup-benefits"><span><Check size={13} aria-hidden="true" />Keep your subscription</span><span><Check size={13} aria-hidden="true" />No automatic refill</span></div>
      </div>
      <div className="billing-topup-summary">
        <span className="billing-topup-total-label">One-time total</span>
        <div className="billing-topup-total" aria-live="polite" aria-atomic="true"><strong>{money(pack.priceCents)}</strong><span>for {pack.credits.toLocaleString("en-US")} extra credits</span></div>
        {availability?.available && <label className="billing-consent"><input type="checkbox" checked={consented} onChange={event => setConsented(event.target.checked)} disabled={busy} /><span>{PACK_WITHDRAWAL_CONSENT_TEXT} <a href="/terms">Terms</a> · <a href="/withdraw">Withdrawal information</a></span></label>}
        <button className="billing-topup-button" type="button" disabled={busy || !availability?.available} onClick={() => void continueToCheckout()} aria-describedby="topup-availability">
          {busy ? <><LoaderCircle size={15} className="billing-loading" />Continuing…</> : availability?.available ? <>Continue with {pack.credits.toLocaleString("en-US")} credits<ArrowUpRight size={14} /></> : <>Credit packs coming soon</>}
        </button>
        <p id="topup-availability" className="billing-topup-availability" role="status">{loadError ? "Availability could not be loaded." : availability === null ? "Checking availability…" : availability.available ? "Requires an active creation membership. Secure checkout with Whop." : "Purchases open when credit delivery is ready. An active creation membership will be required."}</p>
        {loadError && <button className="billing-retry" type="button" onClick={() => { setLoadError(false); setAvailability(null); setRetry(value => value + 1); }}>Try again</button>}
        {error && <p className="billing-checkout-error" role="alert">{error}</p>}
      </div>
    </div>
  </section>;
}
