"use client";
import { useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/brand-mark";
import { createClient } from "@/lib/supabase/client";
import { accountError } from "@/lib/supabase/auth-flow";

export default function UpdatePasswordForm() {
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
  return <main className="login-page">
    <Link className="wordmark" href="/"><BrandMark />Makeborne</Link>
    <div className="login-card">
      <span className="eyebrow">YOUR ACCOUNT</span>
      <h1>{saved ? "Password updated." : "A fresh start."}</h1>
      {saved ? <><p>Your new password is ready to use.</p><Link className="button primary" href="/studio/cloud">Open your studio</Link></> : <>
        <p>Choose a new password with at least 12 characters.</p>
        <form onSubmit={submit}>
          <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>Confirm password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
          <button className="button primary" disabled={busy} type="submit">{busy ? "Saving…" : "Update password"}</button>
        </form>
      </>}
      {message && <p className="account-message" role="status">{message}</p>}
      <Link className="text-link" href="/login">Back to sign in</Link>
    </div>
  </main>;
}
