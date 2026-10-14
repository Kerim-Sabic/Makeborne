"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, CircleHelp, ArrowUpRight } from "lucide-react";
import { z } from "zod";
import { CreditTopupStatusSchema, type CreditTopupStatus } from "@/lib/billing/topup-status-contract";
import { CREDITS_CHANGED_EVENT } from "./credit-balance";

const POLL_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 20;
const MAX_WAIT_MS = 60000;
const OrderIdSchema = z.uuid();
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

type ReturnState = { status: "checking" | "pending" | "waiting" | "error" | "signed-out" | "not-found" }
  | { status: "delivered" | "under_review" | "refunded"; order: CreditTopupStatus };

/** A query string identifies a purchase; only the authenticated status response confirms it. */
export default function BillingTopupReturn({ orderId }: { orderId: string }) {
  const observedOrders = useRef(new Map<string, CreditTopupStatus["state"]>());
  const parsed = OrderIdSchema.safeParse(orderId);
  if (!parsed.success) return <ReturnNotice status="not-found" title="Credit-pack order unavailable" description="This return link is incomplete or invalid. Use the link from your checkout, or contact support if you need help." />;
  // Remount on order changes so an old response can never become a new order's status.
  const canonicalId = parsed.data.toLowerCase();
  return <OrderReturn key={canonicalId} orderId={canonicalId} observedOrders={observedOrders} />;
}

function OrderReturn({ orderId, observedOrders }: { orderId: string; observedOrders: RefObject<Map<string, CreditTopupStatus["state"]>> }) {
  const [state, setState] = useState<ReturnState>({ status: "checking" });
  const [checkVersion, setCheckVersion] = useState(0);

  useEffect(() => {
    let disposed = false;
    let expired = false;
    let attempts = 0;
    let nextPoll: ReturnType<typeof setTimeout> | undefined;
    let requestTimeout: ReturnType<typeof setTimeout> | undefined;
    let activeRequest: AbortController | undefined;
    const started = performance.now();
    const stopWaiting = () => {
      expired = true;
      clearTimeout(nextPoll);
      activeRequest?.abort();
      if (!disposed) setState({ status: "waiting" });
    };
    const deadline = setTimeout(stopWaiting, MAX_WAIT_MS);

    async function check() {
      if (disposed || expired) return;
      if (performance.now() - started >= MAX_WAIT_MS) {
        clearTimeout(deadline);
        stopWaiting();
        return;
      }
      attempts++;
      const controller = new AbortController();
      activeRequest = controller;
      requestTimeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`/api/billing/topups/${encodeURIComponent(orderId)}`, {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (disposed || expired || controller.signal.aborted) return;
        if (!response.ok) {
          clearTimeout(deadline);
          setState({ status: response.status === 401 ? "signed-out" : response.status === 404 ? "not-found" : "error" });
          return;
        }
        const parsed = CreditTopupStatusSchema.safeParse(await response.json());
        if (disposed || expired || controller.signal.aborted) return;
        if (performance.now() - started >= MAX_WAIT_MS) {
          clearTimeout(deadline);
          stopWaiting();
          return;
        }
        if (!parsed.success || parsed.data.orderId !== orderId) throw new Error("Invalid order status");
        const order = parsed.data;
        if (order.state !== "pending") {
          clearTimeout(deadline);
          setState({ status: order.state, order });
          if (observedOrders.current.get(orderId) !== order.state) {
            window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
          }
          observedOrders.current.set(orderId, order.state);
          return;
        }
        observedOrders.current.set(orderId, order.state);
        if (attempts >= MAX_ATTEMPTS || performance.now() - started >= MAX_WAIT_MS) {
          clearTimeout(deadline);
          setState({ status: "waiting" });
        } else {
          setState({ status: "pending" });
          // Schedule only after this request completes; there is never an overlapping poll.
          nextPoll = setTimeout(check, POLL_INTERVAL_MS);
        }
      } catch {
        if (!disposed && !expired) {
          clearTimeout(deadline);
          setState({ status: "error" });
        }
      } finally {
        clearTimeout(requestTimeout);
        activeRequest = undefined;
      }
    }
    void check();
    return () => {
      disposed = true;
      clearTimeout(deadline);
      clearTimeout(nextPoll);
      clearTimeout(requestTimeout);
      activeRequest?.abort();
    };
  }, [orderId, checkVersion, observedOrders]);

  const retry = () => {
    setState({ status: "checking" });
    setCheckVersion(value => value + 1);
  };
  const signInHref = `/login?next=${encodeURIComponent(`/billing?topup=${orderId}`)}`;
  switch (state.status) {
    case "delivered":
      return <ReturnNotice status={state.status} title="Your credits are ready" description={`${number.format(state.order.credits)} credits have been added to your account. Your balance is refreshing.`}><Link href="/studio">Start creating<ArrowUpRight size={14} aria-hidden="true" /></Link><a href="#credits">View your balance</a></ReturnNotice>;
    case "refunded":
      return <ReturnNotice status={state.status} title="This credit pack was refunded" description="A refund has been recorded for this order. Check your current balance below; this status does not confirm which credits remain available."><a href="#credits">View your balance</a><a href="mailto:admin@makeborne.com">Contact support</a></ReturnNotice>;
    case "under_review":
      return <ReturnNotice status={state.status} title="Your credit pack needs a review" description="We’re checking this order before confirming credits. Please avoid paying again for the same pack. You can check again or contact support."><button type="button" onClick={retry}>Check again</button><a href="mailto:admin@makeborne.com">Contact support</a></ReturnNotice>;
    case "signed-out":
      return <ReturnNotice status={state.status} title="Sign in to check your credit pack" description="Use the account you used at checkout. We’ll return you here to check the order."><Link href={signInHref}>Sign in<ArrowUpRight size={14} aria-hidden="true" /></Link><button type="button" onClick={retry}>Check again</button></ReturnNotice>;
    case "not-found":
      return <ReturnNotice status={state.status} title="Credit-pack order unavailable" description="We couldn’t find this order for your account. Check that you’re signed in with the account used at checkout."><Link href={signInHref}>Sign in to your account</Link><button type="button" onClick={retry}>Check again</button><a href="mailto:admin@makeborne.com">Contact support</a></ReturnNotice>;
    case "error":
      return <ReturnNotice status={state.status} title="We couldn’t check your credit pack" description="Confirmation is temporarily unavailable. Please check again before paying for the same pack."><button type="button" onClick={retry}>Check again</button><a href="mailto:admin@makeborne.com">Contact support</a></ReturnNotice>;
    case "waiting":
      return <ReturnNotice status={state.status} title="Still waiting for confirmation" description="Your credits haven’t been confirmed yet. Automatic checks have paused. Please avoid paying again for the same pack and check back shortly."><button type="button" onClick={retry}>Check again</button><a href="mailto:admin@makeborne.com">Contact support</a></ReturnNotice>;
    default:
      return <ReturnNotice status={state.status} title="Waiting for credit-pack confirmation" description="We’re checking your order. Credits appear once payment and delivery are confirmed. Please avoid paying again for the same pack."><button type="button" disabled>Checking…</button></ReturnNotice>;
  }
}

function ReturnNotice({ status, title, description, children }: { status: ReturnState["status"]; title: string; description: string; children?: React.ReactNode }) {
  const Icon = status === "delivered" ? CheckCircle2 : ["checking", "pending", "waiting"].includes(status) ? Clock3 : CircleHelp;
  return <section className={`billing-topup-return billing-topup-return-${status}`} aria-label="Credit-pack checkout status">
    <span className="billing-topup-return-icon"><Icon size={22} aria-hidden="true" /></span>
    <div className="billing-topup-return-body"><div role="status" aria-live="polite" aria-atomic="true"><span className="billing-topup-return-label">YOUR CREDIT PACK</span><h2>{title}</h2><p>{description}</p></div>{children && <div className="billing-topup-return-actions">{children}</div>}</div>
  </section>;
}
