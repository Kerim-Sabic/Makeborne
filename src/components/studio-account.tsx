"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function StudioAccount() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/capabilities", { cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error("unavailable");
        const capabilities = await response.json();
        if (!active || !capabilities.cloudWorkspace?.available) return;
        const client = createClient();
        let authChanged = false;
        const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
          authChanged = true;
          if (active) { setEmail(session?.user.email ?? null); setChecking(false); }
        });
        unsubscribe = () => listener.subscription.unsubscribe();
        const { data } = await client.auth.getUser();
        if (active && !authChanged) setEmail(data.user?.email ?? null);
      } catch {
        if (active) setError("Account connection unavailable. Your device drafts are still here.");
      } finally { if (active) setChecking(false); }
    })();
    return () => { active = false; abort.abort(); unsubscribe?.(); };
  }, []);
  async function signOut() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      setEmail(null);
    } catch { setError("Could not sign out. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="studio-account">
    {checking ? <span className="studio-account-link" role="status">Checking account…</span> : email ?
      <details className="studio-account-menu"><summary className="studio-account-link"><UserRound size={15} /> Account <ChevronDown size={13} /></summary>
        <div className="studio-account-popover"><span>Signed in as</span><strong>{email}</strong><button type="button" disabled={busy} onClick={() => void signOut()}><LogOut size={14} />{busy ? "Signing out…" : "Sign out"}</button></div>
      </details> : <Link className="studio-account-link" href="/login"><UserRound size={15} /> Sign in</Link>}
    {error && <span className="studio-account-error" role="status">{error}</span>}
  </div>;
}
