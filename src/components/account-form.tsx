"use client";
import Link from "next/link";
import BrandMark from "./brand-mark";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole, Mail, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { accountError, authDestination } from "@/lib/supabase/auth-flow";

type Capability = { cloudWorkspace: { available: boolean; reason?: string } };
export default function AccountForm() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "signup" | "recovery">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [verification, setVerification] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  function returnDestination() {
    const safe = authDestination(new URLSearchParams(window.location.search).get("next"));
    return safe.startsWith("/studio") ? safe : "/studio";
  }
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/capabilities", { signal: abort.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((c: Capability) => {
        setEnabled(c.cloudWorkspace?.available === true);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setEnabled(false);
        }
      });
    const error = new URLSearchParams(window.location.search).get("error");
    if (error)
      queueMicrotask(() =>
        setMessage(
          error === "cloud-unavailable"
            ? "Account access is not available yet. You can return to your studio."
            : "This email link expired or could not be verified. Request a new link or sign in.",
        ),
      );
    return () => abort.abort();
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!enabled || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const client = createClient();
      const address = email.trim();
      if (mode === "recovery") {
        if (Date.now() < retryAt) {
          setMessage("Wait a minute before requesting another email.");
          return;
        }
        const { error } = await client.auth.resetPasswordForEmail(address, {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
        });
        if (error) throw error;
        setRetryAt(Date.now() + 60_000);
        setMessage("If an account uses this email, you will receive a link to reset its password. Check your inbox and spam folder.");
      } else if (mode === "signup") {
        const { data, error } = await client.auth.signUp({
          email: address,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnDestination())}`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.push(returnDestination());
          router.refresh();
        } else {
          setVerification(true);
          setEmail(address);
          setPassword("");
          setRetryAt(Date.now() + 60_000);
          setMessage(
            "Check your inbox and spam folder for a confirmation link if this address is eligible.",
          );
        }
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: address,
          password,
        });
        if (error) throw error;
        router.push(returnDestination());
        router.refresh();
      }
    } catch (error) {
      setMessage(accountError(error));
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    if (!enabled || busy) return;
    if (Date.now() < retryAt) {
      setMessage("Wait a minute before requesting another email.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await createClient().auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnDestination())}` },
      });
      if (error) throw error;
      setRetryAt(Date.now() + 60_000);
      setMessage(
        "A new confirmation link was requested. Check your inbox if the address is eligible.",
      );
    } catch (error) {
      setMessage(accountError(error));
    } finally {
      setBusy(false);
    }
  }
  function changeMode(next: typeof mode) {
    if (busy) return;
    setMode(next); setPassword(""); setMessage(""); setShowPassword(false);
  }
  return (
    <main className="login-page auth-refined">
      <header className="auth-header">
        <Link className="wordmark" href="/" aria-label="Makeborne home"><BrandMark size={28} /> Makeborne</Link>
        <Link href="/studio" className="auth-back">Back to studio <ArrowRight size={14} /></Link>
      </header>
      <div className="auth-center">
        <section className="login-card" aria-labelledby="account-heading">
          <div className="auth-heading">
            <h1 id="account-heading">{verification ? "Check your inbox" : mode === "signup" ? "Make room for your ideas" : mode === "recovery" ? "Reset your password" : "Welcome back"}</h1>
            <p>{verification ? "One more step, then you’re in." : mode === "signup" ? "Your next website, book or presentation starts here." : mode === "recovery" ? "We’ll help you get back to your projects." : "Pick up where your ideas left off."}</p>
          </div>
          {enabled === null ? <p role="status">Checking account availability…</p> : !enabled ? <>
            <div className="inline-info"><LockKeyhole size={20} /><p>Account access is temporarily unavailable.</p></div>
            <Link className="button primary" href="/studio">Open your device drafts <ArrowRight size={16} /></Link>
          </> : verification ? <>
            <div className="auth-mail-icon"><Mail size={26} /></div>
            <p>If <strong>{email}</strong> is eligible, you’ll receive a confirmation link. Check your inbox and spam folder.</p>
            <button className="button primary" disabled={busy} onClick={resend}>{busy ? "Requesting…" : "Resend confirmation"}</button>
            <button className="auth-switch" disabled={busy} onClick={() => { setVerification(false); changeMode("login"); }}>Back to sign in</button>
          </> : <>
            <form onSubmit={submit}>
              <div className="auth-field"><label htmlFor="account-email">Email address</label>
                <input id="account-email" type="email" placeholder="you@example.com" autoComplete="email" required disabled={busy} value={email} onChange={e => setEmail(e.target.value)} maxLength={254} />
              </div>
              {mode !== "recovery" && <div className="auth-field">
                <div className="auth-label-row"><label htmlFor="account-password">Password</label>{mode === "login" && <button type="button" disabled={busy} onClick={() => changeMode("recovery")}>Forgot password?</button>}</div>
                <div className="auth-password"><input id="account-password" type={showPassword ? "text" : "password"} placeholder={mode === "signup" ? "At least 12 characters" : "Enter your password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 1} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} maxLength={128} aria-describedby={mode === "signup" ? "password-guidance" : undefined} />
                  <button type="button" className="auth-eye" disabled={busy} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
                {mode === "signup" && <p id="password-guidance" className="auth-hint">Use at least 12 characters for a stronger password.</p>}
              </div>}
              <button className="button primary" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "recovery" ? "Send reset link" : "Sign in"}<ArrowRight size={16} /></button>
            </form>
            <div className="auth-mode-switch">{mode === "recovery" ? <button disabled={busy} onClick={() => changeMode("login")}><ArrowLeft size={14} /> Back to sign in</button> : <><span>{mode === "signup" ? "Already have an account?" : "New to Makeborne?"}</span><button disabled={busy} onClick={() => changeMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Sign in" : "Create an account"}</button></>}</div>
            {mode === "login" && <details className="auth-help"><summary>Waiting for a confirmation email?</summary><p>Enter your email above, then request a new link.</p><button className="text-link" disabled={busy || !email.trim()} onClick={resend}>Resend confirmation email</button></details>}
          </>}
          {message && <p className="account-message" role="status">{message}</p>}
        </section>
        <p className="auth-caption">A little space for your next big thing.</p>
      </div>
      <footer className="auth-footer"><span>© 2026 Makeborne</span><span>Websites. Books. Presentations.</span></footer>
    </main>
  );
}
