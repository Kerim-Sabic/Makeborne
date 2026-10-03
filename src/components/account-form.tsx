"use client";
import Link from "next/link";
import BrandMark from "./brand-mark";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { accountError } from "@/lib/supabase/auth-flow";

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
            ? "Account access is not available yet. You can continue in the local studio."
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
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.push("/studio/cloud");
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
        router.push("/studio/cloud");
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
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
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
    <main className="login-page">
      <Link className="wordmark" href="/">
        <BrandMark />
        Makeborne
      </Link>
      <div className="login-card">
        <span className="eyebrow">YOUR CLOUD STUDIO</span>
        <h1>{verification ? "Check your inbox." : mode === "signup" ? "Create your studio." : mode === "recovery" ? "Reset your password." : "Welcome back."}</h1>
        {enabled === null ? (
          <p>Checking account availability…</p>
        ) : !enabled ? (
          <>
            <div className="inline-info">
              <LockKeyhole size={20} />
              <p>Account access is being prepared.</p>
            </div>
            <p>
              Your local studio is ready to use. Online accounts will be available once cloud setup is complete.
            </p>
            <Link className="button primary" href="/studio">
              Open local studio <ArrowRight size={16} />
            </Link>
          </>
        ) : verification ? (
          <>
            <div className="verification-icon">
              <Mail size={29} />
            </div>
            <p>
              If <strong>{email}</strong> is eligible, you will receive a confirmation link. Open it to finish setting up your studio.
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={resend}
            >
              {busy ? "Requesting…" : "Request another confirmation"}
            </button>
            <button
              className="text-link"
              disabled={busy}
              onClick={() => {
                setVerification(false);
                setMode("login");
                setPassword("");
              }}
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            {mode !== "recovery" && <div className="filter-tabs account-tabs">
              <button
                className={mode === "login" ? "active" : ""}
                disabled={busy}
                onClick={() => changeMode("login")}
              >
                Sign in
              </button>
              <button
                className={mode === "signup" ? "active" : ""}
                disabled={busy}
                onClick={() => changeMode("signup")}
              >
                Create account
              </button>
            </div>}
            {mode === "recovery" && <p>Enter your account email and we’ll send a reset link if it is eligible.</p>}
            <form onSubmit={submit}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  disabled={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                />
              </label>
              {mode !== "recovery" && <label>
                Password
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  minLength={mode === "signup" ? 12 : 1}
                  required
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={128}
                />
              </label>}
              {mode !== "recovery" && <button type="button" className="text-link" disabled={busy} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide password" : "Show password"}</button>}
              {mode === "signup" && (
                <p className="small-note">
                  Use at least 12 characters. Your device’s projects stay local
                  until you choose to import them.
                </p>
              )}
              <button className="button primary" disabled={busy} type="submit">
                {busy
                  ? "Please wait…"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "recovery" ? "Send reset link" : "Sign in"}
                <ArrowRight size={16} />
              </button>
            </form>
            <button className="text-link" disabled={busy} onClick={() => changeMode(mode === "recovery" ? "login" : "recovery")}>{mode === "recovery" ? "Back to sign in" : "Forgot your password?"}</button>
            {mode === "login" && <button className="text-link" disabled={busy || !email.trim()} onClick={resend}>Resend confirmation email</button>}
          </>
        )}
        {message && (
          <p className="account-message" role="status">
            {message}
          </p>
        )}
        <Link className="text-link" href="/studio">
          <ArrowLeft size={15} /> Keep working locally
        </Link>
      </div>
    </main>
  );
}
