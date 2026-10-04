"use client";
import { useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/brand-mark";
import { ArrowRight, Check, LockKeyhole, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { accountError } from "@/lib/supabase/auth-flow";

export default function UpdatePasswordForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmation) { setMessage("The passwords do not match."); return; }
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) throw error;
      setPassword(""); setConfirmation(""); setSaved(true);
    } catch (error) { setMessage(accountError(error)); }
    finally { setBusy(false); }
  }
  return <main className="login-page auth-refined">
    <header className="auth-header"><Link className="wordmark" href="/" aria-label="Makeborne home"><BrandMark size={28} />Makeborne</Link><Link href="/" className="auth-back">Back to home<ArrowRight size={14} /></Link></header>
    <div className="auth-center"><section className="login-card auth-verification-card" aria-labelledby="password-heading">
      <div className={`auth-mail-icon${saved ? " is-complete" : ""}`} aria-hidden="true">{saved ? <Check size={28} /> : <LockKeyhole size={27} />}</div>
      <div className="auth-heading"><span className="auth-step-label">{saved ? "ALL SET" : "YOUR ACCOUNT"}</span><h1 id="password-heading">{saved ? "Password updated" : "A fresh start"}</h1><p>{saved ? "Your new password is ready to use." : "Choose a new password with at least 12 characters."}</p></div>
      {saved ? <Link className="button primary" href={next}>Continue<ArrowRight size={16} /></Link> : <>
        <form onSubmit={submit}>
          <div className="auth-field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" placeholder="At least 12 characters" required minLength={12} maxLength={128} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></div>
          <div className="auth-field"><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" placeholder="Enter your new password again" required minLength={12} maxLength={128} disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div>
          <button className="button primary" disabled={busy} type="submit">{busy ? <><LoaderCircle className="auth-spinner" size={16} />Saving…</> : <>Update password<ArrowRight size={16} /></>}</button>
        </form>
      </>}
      {message && <p className="account-message is-error" role="alert">{message}</p>}
      <div className="auth-mode-switch"><Link href="/login">Back to sign in</Link></div>
    </section></div>
    <footer className="auth-footer"><span>© 2026 Makeborne</span><span>Websites. Books. Presentations.</span></footer>
  </main>;
}
