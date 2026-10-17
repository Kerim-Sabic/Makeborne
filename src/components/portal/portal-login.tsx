"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { accountError } from "@/lib/supabase/auth-flow";
import { portalAccount } from "./portal-api";

/**
 * Email one-time code sign-in. `allowCreate` is only used when accepting an
 * invite (the account is created for the invited address); plain portal
 * sign-in never creates accounts.
 */
export default function PortalLogin({ allowCreate = false, emailHint, onSignedIn }: { allowCreate?: boolean; emailHint?: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const { error } = await createClient().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: allowCreate } });
      if (error) {
        if (!allowCreate && /signups not allowed|not found|user/i.test(error.message)) throw new Error("There's no client portal access for this email yet. Ask your agency to send you an invite.");
        throw error;
      }
      setSent(true); setMessage({ error: false, text: `We sent a one-time code to ${email.trim()}. Enter the code from your email below.` });
    } catch (error) { setMessage({ error: true, text: error instanceof Error && !("code" in error) ? error.message : accountError(error) }); }
    finally { setBusy(false); }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token: code.replace(/\s/g, ""), type: "email" });
      if (error) throw error;
      await portalAccount(true);
      onSignedIn();
    } catch (error) { setMessage({ error: true, text: accountError(error) }); setBusy(false); }
  }

  return <div className="portal-login">
    {!sent ? <form onSubmit={send}>
      <label htmlFor="portal-email">Your email</label>
      <input id="portal-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder={emailHint || "you@business.com"} />
      {emailHint && <p className="portal-muted">Use the address your invite was sent to ({emailHint}).</p>}
      <button type="submit" className="portal-button" disabled={busy || !email.trim()}>{busy ? <LoaderCircle size={16} className="portal-spin" /> : <Mail size={16} />} Email me a sign-in code</button>
    </form> : <form onSubmit={verify}>
      <label htmlFor="portal-code">Sign-in code</label>
      <input id="portal-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value)} placeholder="123456" maxLength={12} />
      <button type="submit" className="portal-button" disabled={busy || code.replace(/\s/g, "").length < 6}>{busy ? <LoaderCircle size={16} className="portal-spin" /> : <ArrowRight size={16} />} Sign in</button>
      <button type="button" className="portal-link" onClick={() => { setSent(false); setCode(""); setMessage(null); }}>Use a different email</button>
    </form>}
    {message && <p className={message.error ? "portal-error" : "portal-note"} role={message.error ? "alert" : "status"}>{message.text}</p>}
  </div>;
}
