"use client";
import Link from "next/link";
import BrandMark from "./brand-mark";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Capability = { cloudWorkspace: { available: boolean; reason?: string } };
export default function AccountForm() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [verification, setVerification] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/capabilities", { signal: abort.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((c: Capability) => {
        setEnabled(c.cloudWorkspace?.available === true);
        setReason(
          c.cloudWorkspace?.reason || "Cloud services are not enabled.",
        );
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setEnabled(false);
          setReason(
            "We could not verify cloud availability. Please try again later.",
          );
        }
      });
    if (new URLSearchParams(window.location.search).has("error"))
      queueMicrotask(() =>
        setMessage(
          "This confirmation link could not be verified. Sign in again or request another confirmation.",
        ),
      );
    return () => abort.abort();
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!enabled) return;
    setBusy(true);
    setMessage("");
    try {
      const client = createClient();
      if (mode === "signup") {
        const { data, error } = await client.auth.signUp({
          email,
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
          setMessage(
            "Check your email for a confirmation link if this address is eligible. Your local projects have not been uploaded.",
          );
        }
      } else {
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push("/studio/cloud");
        router.refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Account access could not complete. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    if (!enabled || busy) return;
    setBusy(true);
    try {
      const { error } = await createClient().auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setMessage(
        "A new confirmation link was requested. Check your inbox if the address is eligible.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Confirmation request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <Link className="wordmark" href="/">
        <BrandMark />
        Makeborne
      </Link>
      <div className="login-card">
        <span className="eyebrow">YOUR CLOUD STUDIO</span>
        <h1>
          A place for
          <br />
          <em>your next idea.</em>
        </h1>
        {enabled === null ? (
          <p>Checking account availability…</p>
        ) : !enabled ? (
          <>
            <div className="inline-info">
              <LockKeyhole size={20} />
              <p>{reason}</p>
            </div>
            <p>
              Cloud accounts remain unavailable until the server is configured
              and its migrations are verified. Your local studio is ready to
              use.
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
            <h2>One more step.</h2>
            <p>
              Use the confirmation link sent to <strong>{email}</strong>.
              Account creation does not move your device’s projects into the
              cloud.
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
            <div className="filter-tabs account-tabs">
              <button
                className={mode === "login" ? "active" : ""}
                onClick={() => setMode("login")}
              >
                Sign in
              </button>
              <button
                className={mode === "signup" ? "active" : ""}
                onClick={() => setMode("signup")}
              >
                Create account
              </button>
            </div>
            <form onSubmit={submit}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  minLength={mode === "signup" ? 12 : 1}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={128}
                />
              </label>
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
                    : "Sign in"}
                <ArrowRight size={16} />
              </button>
            </form>
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
