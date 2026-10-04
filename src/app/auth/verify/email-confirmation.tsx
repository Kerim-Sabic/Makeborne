"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, LockKeyhole, MailCheck, LoaderCircle } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import { authDestination } from "@/lib/supabase/auth-flow";

export default function EmailConfirmation({ tokenHash, type, next }: { tokenHash: string; type: "email" | "recovery" | null; next: string }) {
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState<string | null>(null);
  const [error, setError] = useState(tokenHash && type ? "" : "This confirmation link is incomplete. Request a fresh email to continue.");

  async function confirm() {
    if (busy || !tokenHash || !type) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_hash: tokenHash, type, next }),
      });
      const result: { next?: string; error?: string } = await response.json();
      if (!response.ok || !result.next) throw new Error(result.error || "We couldn’t confirm this email. Please try again.");
      // Remove the one-time token from browser history after it has been consumed.
      window.history.replaceState(null, "", "/auth/verify");
      setComplete(authDestination(result.next));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "We couldn’t connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page auth-refined">
    <header className="auth-header"><Link className="wordmark" href="/" aria-label="Makeborne home"><BrandMark size={28} />Makeborne</Link><Link href="/" className="auth-back">Back to home<ArrowRight size={14} /></Link></header>
    <div className="auth-center">
      <section className="login-card auth-verification-card" aria-labelledby="verification-heading">
        <div className={`auth-mail-icon${complete ? " is-complete" : ""}`} aria-hidden="true">{complete ? <Check size={28} /> : type === "recovery" ? <LockKeyhole size={27} /> : <MailCheck size={28} />}</div>
        <div className="auth-heading">
          <span className="auth-step-label">{complete ? "ALL SET" : "ONE LAST STEP"}</span>
          <h1 id="verification-heading">{complete ? type === "recovery" ? "You’re verified" : "Email confirmed" : type === "recovery" ? "Let’s get you back in" : "Your ideas are waiting"}</h1>
          <p>{complete ? type === "recovery" ? "You can now choose a new password." : "Your account is ready. Continue where you left off." : type === "recovery" ? "Confirm this request to choose a new password." : "Confirm your email to finish creating your Makeborne account."}</p>
        </div>
        {complete ? <Link className="button primary" href={complete}>Continue<ArrowRight size={16} /></Link> : tokenHash && type && <button className="button primary" disabled={busy} onClick={confirm}>{busy ? <><LoaderCircle className="auth-spinner" size={17} />Confirming…</> : <>{type === "recovery" ? "Continue to password reset" : "Confirm my email"}<ArrowRight size={16} /></>}</button>}
        {error && <p className="account-message is-error" role="alert">{error}</p>}
        {!complete && <div className="auth-mode-switch"><Link href={`/login?next=${encodeURIComponent(next)}`}>{error ? "Sign in or request a new link" : "Back to sign in"}</Link></div>}
        <p className="auth-verification-footnote">{complete ? "Your projects, all in one place." : "Only continue if you requested this email."}</p>
      </section>
    </div>
    <footer className="auth-footer"><span>© 2026 Makeborne</span><span>Websites. Books. Presentations.</span></footer>
  </main>;
}
