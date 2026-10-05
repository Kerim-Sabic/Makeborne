"use client";
import Link from "next/link";
import BrandMark from "./brand-mark";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Mail, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { accountError, authDestination, passwordRecoveryDestination } from "@/lib/supabase/auth-flow";

type Mode = "login" | "signup" | "recovery";
type Notice = { text: string; error: boolean };
const PENDING_EMAIL_KEY = "makeborne.pending-email.v1";

function GoogleMark() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.23c1.89-1.74 2.99-4.3 2.99-7.36Z" /><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.41l-3.23-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.58-4.12H3.08v2.59A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.42 13.92a6.02 6.02 0 0 1 0-3.84V7.49H3.08a10 10 0 0 0 0 9.02l3.34-2.59Z" /><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.86-2.86A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.92 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z" /></svg>;
}

export default function AccountForm() {
  const router = useRouter();
  const emailInput = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [google, setGoogle] = useState(false);
  const [github, setGithub] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [verification, setVerification] = useState<"signup" | "recovery" | null>(null);
  const [verified, setVerified] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [retryIn, setRetryIn] = useState(0);

  function returnDestination() {
    return authDestination(new URLSearchParams(window.location.search).get("next"));
  }
  function redirectUrl(recovery = false) {
    const next = recovery ? passwordRecoveryDestination(returnDestination()) : returnDestination();
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  }
  function clearPendingEmail() {
    try { sessionStorage.removeItem(PENDING_EMAIL_KEY); } catch { /* Storage is optional. */ }
  }
  function beginCooldown(address: string, kind: "signup" | "recovery") {
    const until = Date.now() + 60_000;
    setRetryAt(until);
    setRetryIn(60);
    try { sessionStorage.setItem(PENDING_EMAIL_KEY, JSON.stringify({ email: address, kind, retryAt: until, expiresAt: Date.now() + 3_600_000 })); } catch { /* Storage is optional. */ }
  }
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/auth/providers", { signal: abort.signal, cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("Unavailable"); return response.json(); })
      .then((capability: { enabled: boolean; google: boolean; github: boolean }) => {
        setEnabled(capability.enabled === true);
        setGoogle(capability.google === true);
        setGithub(capability.github === true);
      })
      .catch(() => { if (!abort.signal.aborted) setEnabled(false); });
    queueMicrotask(() => {
      const query = new URLSearchParams(window.location.search);
      if (query.get("mode") === "signup") setMode("signup");
      const error = query.get("error");
      if (error) {
        setNotice({ error: true, text: error === "cloud-unavailable"
          ? "Account access is temporarily unavailable. Your saved brief is kept in this browser."
          : error === "oauth" ? "Sign-in wasn’t completed. Please try again or use your email."
          : "This email link expired or could not be verified. Request a new link or sign in." });
      } else {
        try {
          const raw = sessionStorage.getItem(PENDING_EMAIL_KEY);
          const pending = raw ? JSON.parse(raw) : null;
          if (pending && typeof pending.email === "string" && pending.email.length <= 254 &&
            (pending.kind === "signup" || pending.kind === "recovery") && pending.expiresAt > Date.now()) {
            setEmail(pending.email);
            setVerification(pending.kind);
            setRetryAt(pending.retryAt);
            setRetryIn(Math.max(0, Math.ceil((pending.retryAt - Date.now()) / 1000)));
          }
        } catch { /* A new browser can always request a fresh email. */ }
      }
    });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!retryAt) return;
    const tick = window.setInterval(() => setRetryIn(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(tick);
  }, [retryAt]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!enabled || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const client = createClient();
      const address = email.trim();
      if (mode === "recovery") {
        if (Date.now() < retryAt) {
          setNotice({ error: false, text: `You can request another email in ${retryIn} seconds.` });
          return;
        }
        const { error } = await client.auth.resetPasswordForEmail(address, { redirectTo: redirectUrl(true) });
        if (error) throw error;
        setEmail(address);
        setVerification("recovery");
        beginCooldown(address, "recovery");
      } else if (mode === "signup") {
        const { data, error } = await client.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: redirectUrl() },
        });
        if (error) throw error;
        setPassword("");
        if (data.session) {
          clearPendingEmail();
          router.push(returnDestination());
          router.refresh();
        } else {
          setVerification("signup");
          setEmail(address);
          beginCooldown(address, "signup");
        }
      } else {
        const { error } = await client.auth.signInWithPassword({ email: address, password });
        if (error) {
          if (error.code === "email_not_confirmed") {
            setVerification("signup");
            setEmail(address);
            setPassword("");
          }
          throw error;
        }
        clearPendingEmail();
        router.push(returnDestination());
        router.refresh();
      }
    } catch (error) {
      setNotice({ error: true, text: accountError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function resend(kind: "signup" | "recovery" = verification || "signup") {
    if (!enabled || busy || !email.trim() || Date.now() < retryAt) return;
    setBusy(true);
    setNotice(null);
    try {
      const client = createClient();
      const address = email.trim();
      const { error } = kind === "recovery"
        ? await client.auth.resetPasswordForEmail(address, { redirectTo: redirectUrl(true) })
        : await client.auth.resend({ type: "signup", email: address, options: { emailRedirectTo: redirectUrl() } });
      if (error) throw error;
      setVerification(kind);
      setEmail(address);
      setCode("");
      beginCooldown(address, kind);
      setNotice({ error: false, text: "A fresh email has been requested. Use the latest link or code in your inbox." });
    } catch (error) {
      setNotice({ error: true, text: accountError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!enabled || busy || !verification) return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await createClient().auth.verifyOtp({
        email: email.trim(),
        token: code.replace(/\s/g, ""),
        type: verification === "recovery" ? "recovery" : "email",
      });
      if (error) throw error;
      clearPendingEmail();
      setCode("");
      setVerified(true);
    } catch (error) {
      setNotice({ error: true, text: accountError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function signInWithProvider(provider: "google" | "github") {
    if (!enabled || !(provider === "google" ? google : github) || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${redirectUrl()}&provider=${provider}`, ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : { scopes: "user:email" }) },
      });
      if (error) throw error;
      clearPendingEmail();
    } catch (error) {
      setNotice({ error: true, text: accountError(error) });
      setBusy(false);
    }
  }

  function changeMode(next: Mode) {
    if (busy) return;
    clearPendingEmail();
    setMode(next);
    setVerification(null);
    setVerified(false);
    setPassword("");
    setCode("");
    setNotice(null);
    setShowPassword(false);
  }
  function changeEmail() {
    changeMode(verification === "recovery" ? "recovery" : "signup");
    window.setTimeout(() => emailInput.current?.focus(), 0);
  }

  return <main className="login-page auth-refined">
    <header className="auth-header">
      <Link className="wordmark" href="/" aria-label="Makeborne home"><BrandMark size={28} /> Makeborne</Link>
      <Link href="/" className="auth-back">Back to home <ArrowRight size={14} /></Link>
    </header>
    <div className="auth-center">
      <section className={`login-card${verification ? " auth-verification-card" : ""}`} aria-labelledby="account-heading">
        {verification && <div className={`auth-mail-icon${verified ? " is-complete" : ""}`} aria-hidden="true">{verified ? <Check size={28} /> : <Mail size={28} />}</div>}
        <div className="auth-heading">
          {verification && <span className="auth-step-label">{verified ? "ALL SET" : "CHECK YOUR EMAIL"}</span>}
          <h1 id="account-heading">{verified ? verification === "recovery" ? "You’re verified" : "Email confirmed" : verification ? "Check your inbox" : mode === "signup" ? "Make room for your ideas" : mode === "recovery" ? "Reset your password" : "Welcome back"}</h1>
          <p>{verified ? "You’re ready to continue." : verification ? verification === "recovery" ? "If an account uses this email, a reset link is on its way." : "Follow the confirmation link in your email to finish signing up." : mode === "signup" ? "Your next website, book or presentation starts here." : mode === "recovery" ? "We’ll help you get back to your projects." : "Pick up where your ideas left off."}</p>
        </div>
        {enabled === null ? <div className="auth-loading" role="status"><LoaderCircle className="auth-spinner" size={17} />Getting things ready…</div> : !enabled ? <>
          <div className="inline-info"><LockKeyhole size={20} /><p>Account access is temporarily unavailable.</p></div>
          <Link className="button primary" href="/">Back to home <ArrowRight size={16} /></Link>
        </> : verified ? <>
          <Link className="button primary" href={verification === "recovery" ? passwordRecoveryDestination(returnDestination()) : returnDestination()}>Continue<ArrowRight size={16} /></Link>
          <p className="auth-verification-footnote">Your projects, all in one place.</p>
        </> : verification ? <>
          <div className="auth-email-address"><Mail size={16} aria-hidden="true" /><strong>{email}</strong><button type="button" onClick={changeEmail} disabled={busy}>Change</button></div>
          <details className="auth-code-entry">
            <summary>Have a verification code?</summary>
            <form onSubmit={verifyCode}>
              <label htmlFor="account-code">Code from your email</label>
              <input id="account-code" className="auth-otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} disabled={busy} />
              <button className="button primary" disabled={busy || code.length < 6} type="submit">{busy ? <><LoaderCircle className="auth-spinner" size={16} />Verifying…</> : <>Verify email<ArrowRight size={16} /></>}</button>
            </form>
          </details>
          <div className="auth-resend-row"><span>Can’t find it?</span><button type="button" disabled={busy || retryIn > 0} onClick={() => void resend()}>{busy ? "Requesting…" : retryIn > 0 ? `Resend in ${retryIn}s` : "Resend email"}</button></div>
          <p className="auth-verification-footnote">Check your spam folder, too. Use the most recent email; each confirmation works once.</p>
          <div className="auth-mode-switch"><button disabled={busy} onClick={() => changeMode("login")}><ArrowLeft size={14} />Back to sign in</button></div>
        </> : <>
          {(google || github) && mode !== "recovery" && <><div className="auth-social-providers">{google && <button type="button" className="auth-google" disabled={busy} onClick={() => void signInWithProvider("google")}><GoogleMark />Continue with Google</button>}{github && <button type="button" className="auth-google" disabled={busy} onClick={() => void signInWithProvider("github")}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .1.98 2.29 3.28 1.39.1-.73.4-1.23.71-1.52-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.01-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.78 10.78 0 0 1 5.62 0c2.15-1.45 3.1-1.15 3.1-1.15.61 1.55.23 2.69.11 2.98.72.78 1.16 1.78 1.16 3.01 0 4.32-2.63 5.28-5.14 5.56.41.35.76 1.03.76 2.08v3.06c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z"/></svg>Continue with GitHub</button>}</div><div className="auth-divider"><span>or use your email</span></div></>}
          <form onSubmit={submit}>
            <div className="auth-field"><label htmlFor="account-email">Email address</label><input ref={emailInput} id="account-email" type="email" placeholder="you@example.com" autoComplete="email" required disabled={busy} value={email} onChange={event => setEmail(event.target.value)} maxLength={254} /></div>
            {mode !== "recovery" && <div className="auth-field">
              <div className="auth-label-row"><label htmlFor="account-password">Password</label>{mode === "login" && <button type="button" disabled={busy} onClick={() => changeMode("recovery")}>Forgot password?</button>}</div>
              <div className="auth-password"><input id="account-password" type={showPassword ? "text" : "password"} placeholder={mode === "signup" ? "At least 12 characters" : "Enter your password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 1} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} maxLength={128} aria-describedby={mode === "signup" ? "password-guidance" : undefined} />
                <button type="button" className="auth-eye" disabled={busy} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
              {mode === "signup" && <p id="password-guidance" className="auth-hint">Use at least 12 characters for a stronger password.</p>}
            </div>}
            <button className="button primary" disabled={busy || (mode === "recovery" && retryIn > 0)} type="submit">{busy ? <><LoaderCircle className="auth-spinner" size={16} />Please wait…</> : <>{mode === "signup" ? "Create account" : mode === "recovery" ? retryIn > 0 ? `Try again in ${retryIn}s` : "Send reset link" : "Sign in"}<ArrowRight size={16} /></>}</button>
          </form>
          <div className="auth-mode-switch">{mode === "recovery" ? <button disabled={busy} onClick={() => changeMode("login")}><ArrowLeft size={14} />Back to sign in</button> : <><span>{mode === "signup" ? "Already have an account?" : "New to Makeborne?"}</span><button disabled={busy} onClick={() => changeMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Sign in" : "Create an account"}</button></>}</div>
          {mode === "login" && <details className="auth-help"><summary>Waiting for a confirmation email?</summary><p>Enter your email above, then request a new link.</p><button type="button" className="text-link" disabled={busy || !email.trim() || retryIn > 0} onClick={() => void resend("signup")}>{retryIn > 0 ? `Resend in ${retryIn}s` : "Resend confirmation email"}</button></details>}
        </>}
        {notice && <p className={`account-message${notice.error ? " is-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      </section>
      {!verification && <p className="auth-caption">A little space for your next big thing.</p>}
    </div>
    <footer className="auth-footer"><span>© 2026 Makeborne</span><span>Websites. Books. Presentations.</span></footer>
  </main>;
}
