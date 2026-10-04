"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleCheck, Clock3 } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import { authDestination } from "@/lib/supabase/auth-flow";

export default function CheckoutReturn({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"checking" | "pending" | "active" | "error">("checking");
  const [message, setMessage] = useState("Your draft is saved. We’ll reopen it once Whop confirms your creation membership.");
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let count = 0;
    async function check() {
      try {
        const response = await fetch(`/api/billing/checkout-status?request=${encodeURIComponent(requestId)}`, { cache: "no-store", signal: abort.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? "We could not confirm your membership yet.");
        if (result.status === "active" && typeof result.next === "string") {
          setState("active");
          router.replace(authDestination(result.next));
          return;
        }
        if (++count < 12) { timer = setTimeout(check, 2500); return; }
        setState("pending");
        setMessage("Whop has not confirmed access yet. Your draft is safe. Check again shortly; you don’t need to purchase again.");
      } catch (error) {
        if (abort.signal.aborted) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "We could not confirm your membership yet.");
      }
    }
    void check();
    return () => { abort.abort(); if (timer) clearTimeout(timer); };
  }, [requestId, router, attempt]);
  return <main className="checkout-return"><Link href="/" className="checkout-return-brand"><BrandMark size={30} />Makeborne</Link><section aria-live="polite"><span className="checkout-return-icon">{state === "active" ? <CircleCheck size={27} /> : <Clock3 size={27} />}</span><h1>{state === "active" ? "You’re ready to create." : state === "checking" ? "Confirming your membership." : "Let’s confirm your access."}</h1><p>{message}</p>{state !== "checking" && state !== "active" && <button onClick={() => { setState("checking"); setAttempt(value => value + 1); }}>Check again <ArrowRight size={16} /></button>}<Link href="/billing">Back to plans & billing</Link></section></main>;
}
