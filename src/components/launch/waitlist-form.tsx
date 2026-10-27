"use client";
import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { WAITLIST_CONSENT_VERSION, waitlistSourceFromSearch } from "@/lib/launch/waitlist-shared";

type State = { status: "idle" | "sending" | "joined" | "done" | "error"; message: string };
const DONE = "You're on the list. We'll email you at launch with your invite.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Join the waitlist" on the launch screen. One field and one button; the answer is the same whether or not the
 * address was already on the list. A hidden honeypot field catches simple bots without bothering people.
 */
export default function WaitlistForm({ count = null }: { /** Real count, rounded down to tens; null hides the line. */ count?: number | null }) {
  const id = useId();
  const [state, setState] = useState<State>({ status: "idle", message: "" });
  const input = useRef<HTMLInputElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status === "sending") return;
    const email = input.current?.value.trim() ?? "";
    if (!EMAIL.test(email) || email.length > 254) { setState({ status: "error", message: "Enter a valid email address." }); input.current?.focus(); return; }
    setState({ status: "sending", message: "" });
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ email, company: honeypot.current?.value ?? "", source: waitlistSourceFromSearch(window.location.search), consent: WAITLIST_CONSENT_VERSION }),
      });
      if (response.ok) {
        // The button morphs into a check first, then the form gives way to the confirmation.
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        setState({ status: still ? "done" : "joined", message: DONE });
        if (!still) setTimeout(() => setState({ status: "done", message: DONE }), 900);
        return;
      }
      setState({ status: "error", message: response.status === 400 ? "Enter a valid email address." : response.status === 429 ? "Too many attempts from this connection. Try again in a few minutes." : "The waitlist isn't available right now. Try again shortly." });
    } catch {
      setState({ status: "error", message: "We couldn't reach Makeborne. Check your connection and try again." });
    }
  }

  return <form className="mbl-waitlist" data-state={state.status} onSubmit={submit} noValidate aria-describedby={`${id}-consent`}>
    {count !== null && <p className="mbl-proof"><span className="mbl-proof-mark" aria-hidden="true" />Join {count.toLocaleString("en-US")} others on the waitlist.</p>}
    {/* Same height as the field row, so confirming never moves the page. */}
    {state.status === "done" ? <p className="mbl-waitlist-done" role="status"><span className="mbl-check" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 7.4l2.9 2.8 6.1-6.4" /></svg>
    </span>{state.message}</p> : <div className="mbl-waitlist-row" data-state={state.status}>
      <label className="mbl-sr" htmlFor={`${id}-email`}>Email address</label>
      <input ref={input} id={`${id}-email`} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={254} required
        placeholder="you@studio.com" aria-invalid={state.status === "error" || undefined} aria-describedby={state.message ? `${id}-message` : undefined}
        onChange={() => { if (state.status === "error") setState({ status: "idle", message: "" }); }} />
      <button type="submit" disabled={state.status === "sending" || state.status === "joined"} data-state={state.status}>
        <span className="mbl-button-label">{state.status === "sending" ? "Joining…" : "Join the waitlist"}<span aria-hidden="true" className="mbl-arrow">→</span></span>
        <span className="mbl-button-check" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path className="mbl-check-path" d="M3 8.4l3.2 3.1L13 4.6" /></svg></span>
      </button>
    </div>}
    {/* Honeypot: invisible to people and assistive technology; bots that fill every field are quietly ignored. */}
    <div className="mbl-hp" aria-hidden="true"><label htmlFor={`${id}-company`}>Company</label><input ref={honeypot} id={`${id}-company`} name="company" type="text" tabIndex={-1} autoComplete="off" /></div>
    <p id={`${id}-message`} className="mbl-waitlist-message" role="alert">{state.status === "error" ? state.message : ""}</p>
    {state.status === "joined" && <p className="mbl-sr" role="status">{DONE}</p>}
    <p id={`${id}-consent`} className="mbl-consent">We&rsquo;ll only use your email to send your launch invite and launch news. Unsubscribe any time. See our <Link href="/privacy" prefetch={false}>Privacy Policy</Link>.</p>
  </form>;
}
