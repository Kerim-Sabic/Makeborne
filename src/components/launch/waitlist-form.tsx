"use client";
import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { WAITLIST_CONSENT_VERSION, waitlistSourceFromSearch } from "@/lib/launch/waitlist-shared";

type State = { status: "idle" | "sending" | "done" | "error"; message: string };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Join the waitlist" on the launch screen. One field and one button; the answer is the same whether or not the
 * address was already on the list. A hidden honeypot field catches simple bots without bothering people.
 */
export default function WaitlistForm() {
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
      if (response.ok) { setState({ status: "done", message: "You're on the list. We'll email you at launch with your invite." }); return; }
      setState({ status: "error", message: response.status === 400 ? "Enter a valid email address." : response.status === 429 ? "Too many attempts from this connection. Try again in a few minutes." : "The waitlist isn't available right now. Try again shortly." });
    } catch {
      setState({ status: "error", message: "We couldn't reach Makeborne. Check your connection and try again." });
    }
  }

  if (state.status === "done") return <div className="mbl-waitlist is-done">
    <p className="mbl-waitlist-done" role="status"><span className="mbl-check" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 7.4l2.9 2.8 6.1-6.4" /></svg>
    </span>{state.message}</p>
  </div>;

  return <form className="mbl-waitlist" onSubmit={submit} noValidate aria-describedby={`${id}-consent`}>
    <div className="mbl-waitlist-row" data-state={state.status}>
      <label className="mbl-sr" htmlFor={`${id}-email`}>Email address</label>
      <input ref={input} id={`${id}-email`} name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} maxLength={254} required
        placeholder="you@studio.com" aria-invalid={state.status === "error" || undefined} aria-describedby={state.message ? `${id}-message` : undefined}
        onChange={() => { if (state.status === "error") setState({ status: "idle", message: "" }); }} />
      <button type="submit" disabled={state.status === "sending"}>{state.status === "sending" ? "Joining…" : "Join the waitlist"}<span aria-hidden="true" className="mbl-arrow">→</span></button>
    </div>
    {/* Honeypot: invisible to people and assistive technology; bots that fill every field are quietly ignored. */}
    <div className="mbl-hp" aria-hidden="true"><label htmlFor={`${id}-company`}>Company</label><input ref={honeypot} id={`${id}-company`} name="company" type="text" tabIndex={-1} autoComplete="off" /></div>
    <p id={`${id}-message`} className="mbl-waitlist-message" role="alert">{state.status === "error" ? state.message : ""}</p>
    <p id={`${id}-consent`} className="mbl-consent">We&rsquo;ll only use your email to send your launch invite and launch news. Unsubscribe any time. See our <Link href="/privacy">Privacy Policy</Link>.</p>
  </form>;
}
