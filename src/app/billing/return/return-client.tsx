"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleCheck, Clock3 } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import { authDestination } from "@/lib/supabase/auth-flow";

/** The plan-checkout keys written by creation-plans.tsx; cleared once access is verified. */
const CHECKOUT_KEYS = { session: ["makeborne-creation-checkout-v1", "makeborne-creation-checkout-sent-v1"], local: ["makeborne-creation-checkout-v2"] };
/** True only when this tab's checkout record returns to a saved brief (draft= or claim=). */
function returnsToDraft() {
  try { const saved = JSON.parse(sessionStorage.getItem(CHECKOUT_KEYS.session[0]) ?? "null"); return typeof saved?.next === "string" && /[?&](draft|claim)=/.test(saved.next); } catch { return false; }
}
/**
 * Poll schedule. When the first webhook is missing, the status route's exact-checkout
 * recovery runs at most once a minute per checkout, so the page keeps checking for about
 * two minutes: 12 quick checks, then slower ones. A server error (5xx, network) is retried
 * inside that window; only a 4xx answer (wrong account, invalid link) stops it early.
 */
const RETURN_POLL = { quick: 12, quickMs: 2500, slow: 9, slowMs: 10_000 } as const;
const SUPPORT_EMAIL = "admin@makeborne.com";

export default function CheckoutReturn({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"checking" | "pending" | "active" | "error">("checking");
  const [message, setMessage] = useState("We’ll take you on once Whop confirms your creation membership.");
  useEffect(() => {
    const draft = returnsToDraft();
    // Storage is read after mount, so the server render and the first client render agree.
    if (attempt === 0) queueMicrotask(() => setMessage(draft ? "Your draft is saved. We’ll reopen it once Whop confirms your creation membership." : "We’ll open the studio once Whop confirms your creation membership."));
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let count = 0;
    let lastError = "";
    const total = RETURN_POLL.quick + RETURN_POLL.slow;
    function again() {
      count++;
      if (count === RETURN_POLL.quick) setMessage(`Still confirming with Whop. This can take a minute or two.${draft ? " Your draft is safe." : ""}`);
      if (count < total) { timer = setTimeout(check, count < RETURN_POLL.quick ? RETURN_POLL.quickMs : RETURN_POLL.slowMs); return; }
      setState("pending");
      // Honest end state: the payment may be confirmed later, or may need a manual check.
      setMessage(`${lastError || "Whop hasn’t confirmed this payment to us yet."}${draft ? " Your draft is safe." : ""} If you paid, don’t pay again: your plan opens as soon as the payment is confirmed. If this page still says this in a few minutes, email ${SUPPORT_EMAIL}.`);
    }
    async function check() {
      try {
        const response = await fetch(`/api/billing/checkout-status?request=${encodeURIComponent(requestId)}`, { cache: "no-store", signal: abort.signal });
        const result = await response.json().catch(() => null);
        if (response.status >= 400 && response.status < 500) {
          setState("error");
          setMessage(typeof result?.error?.message === "string" ? result.error.message : "We could not confirm your membership.");
          return;
        }
        if (response.ok && result?.status === "active" && typeof result.next === "string") {
          setState("active");
          try { CHECKOUT_KEYS.session.forEach(key => sessionStorage.removeItem(key)); CHECKOUT_KEYS.local.forEach(key => localStorage.removeItem(key)); } catch { /* Nothing stored. */ }
          router.replace(authDestination(result.next));
          return;
        }
        // Pending, or a temporary server error: keep checking within the window.
        lastError = !response.ok && typeof result?.error?.message === "string" ? result.error.message : "";
      } catch {
        if (abort.signal.aborted) return;
        lastError = "";
      }
      again();
    }
    void check();
    return () => { abort.abort(); if (timer) clearTimeout(timer); };
  }, [requestId, router, attempt]);
  return <main className="checkout-return"><Link href="/" className="checkout-return-brand"><BrandMark size={30} />Makeborne</Link><section aria-live="polite"><span className="checkout-return-icon">{state === "active" ? <CircleCheck size={27} /> : <Clock3 size={27} />}</span><h1>{state === "active" ? "You’re ready to create." : state === "checking" ? "Confirming your membership." : "Let’s confirm your access."}</h1><p>{message}</p>{state === "pending" && <button onClick={() => { setState("checking"); setAttempt(value => value + 1); }}>Check again <ArrowRight size={16} /></button>}<Link href="/billing">Back to plans & billing</Link></section></main>;
}
