"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Badge = { showBadge: boolean; owned: boolean };

/** Settings: show or remove "Made with Makeborne" on the account's published websites. */
export default function SiteBadgeSetting() {
  const [badge, setBadge] = useState<Badge | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [needsPlan, setNeedsPlan] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/workspaces/branding", { cache: "no-store", signal: abort.signal });
        // Signed out or cloud unavailable: the setting doesn't apply on this device.
        if (!response.ok) return;
        const data = await response.json() as Badge;
        if (typeof data.showBadge === "boolean") setBadge(data);
      } catch { /* aborted or offline: leave the section hidden */ }
    })();
    return () => abort.abort();
  }, []);

  if (!badge?.owned) return null;

  async function change(showBadge: boolean) {
    setSaving(true); setMessage(""); setNeedsPlan(false);
    try {
      const response = await fetch("/api/workspaces/branding", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showBadge }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (data?.error?.code === "MEMBERSHIP_REQUIRED") setNeedsPlan(true);
        setMessage(data?.error?.message ?? "The setting couldn’t be saved. Try again.");
        return;
      }
      setBadge(data as Badge);
      setMessage(showBadge ? "The badge is back on your websites." : "Badge removed. Your live websites update right away.");
    } catch { setMessage("The setting couldn’t be saved. Check your connection and try again."); }
    finally { setSaving(false); }
  }

  return <section>
    <h2>Website badge</h2>
    <p>
      A small “Made with Makeborne” link at the bottom of your published websites.
      Paid plans can remove it; the change applies to every website you’ve published.
    </p>
    <button
      type="button"
      className={`toggle ${badge.showBadge ? "enabled" : ""}`}
      aria-pressed={badge.showBadge}
      disabled={saving}
      onClick={() => void change(!badge.showBadge)}
    >
      <span />
      {badge.showBadge ? "Badge shown" : "Badge hidden"}
    </button>
    {message && <p className="small-note" role="status">{message}{needsPlan && <> <Link className="text-link" href="/billing">See plans</Link></>}</p>}
  </section>;
}
