"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CreditCard, LogOut, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function StudioAccount({ initialEmail, enabled, variant = "studio" }: { initialEmail?: string | null; enabled?: boolean; variant?: "studio" | "home" | "home-mobile" }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(initialEmail ?? null);
  const [checking, setChecking] = useState(initialEmail === undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const abort = new AbortController();
    void (async () => {
      try {
        let available = enabled;
        if (available === undefined) {
          const response = await fetch("/api/capabilities", { cache: "no-store", signal: abort.signal });
          if (!response.ok) throw new Error("unavailable");
          const capabilities = await response.json();
          available = capabilities.cloudWorkspace?.available === true;
        }
        if (!active || !available) return;
        const client = createClient();
        let authChanged = false;
        const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
          authChanged = true;
          if (active) { setEmail(session?.user.is_anonymous ? null : session?.user.email ?? null); setChecking(false); }
        });
        unsubscribe = () => listener.subscription.unsubscribe();
        const { data } = await client.auth.getUser();
        if (active && !authChanged) setEmail(data.user?.is_anonymous ? null : data.user?.email ?? null);
      } catch {
        if (active) setError("Could not refresh your account. Please try again shortly.");
      } finally { if (active) setChecking(false); }
    })();
    return () => { active = false; abort.abort(); unsubscribe?.(); };
  }, [enabled]);
  async function signOut() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      setEmail(null);
      router.refresh();
    } catch { setError("Could not sign out. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className={`studio-account${variant !== "studio" ? ` mk-account mk-account-${variant}` : ""}`}>
    {checking ? <span className="studio-account-link" role="status">Checking account…</span> : email ?
      <details className="studio-account-menu" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary className="studio-account-link"><UserRound size={15} /> Account <ChevronDown size={13} /></summary>
        <div className="studio-account-popover"><span>Signed in as</span><strong>{email}</strong><Link href="/billing"><CreditCard size={14} /> Plans &amp; credits</Link><button type="button" disabled={busy} onClick={() => void signOut()}><LogOut size={14} />{busy ? "Signing out…" : "Sign out"}</button></div>
      </details> : <Link className="studio-account-link" href="/login">{variant === "studio" && <UserRound size={15} />}{variant === "studio" ? "Sign in" : "Log in"}</Link>}
    {error && <span className="studio-account-error" role="status">{error}</span>}
  </div>;
}
