"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import type { PortalInvite } from "@/lib/portal/contracts";
import PortalShell from "./portal-shell";
import PortalLogin from "./portal-login";
import { portalAccount, portalRequest } from "./portal-api";

/** Opening an invite link: show who invited whom, sign in with the invited email, accept. */
export default function PortalJoin({ token }: { token: string }) {
  const [invite, setInvite] = useState<PortalInvite | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    portalRequest<PortalInvite>(`/api/portal/invites/${encodeURIComponent(token)}`).then(setInvite, cause => setError(cause instanceof Error ? cause.message : "This invite couldn't be opened."));
    portalAccount(true).then(id => setSignedIn(Boolean(id)));
  }, [token]);

  const accept = useCallback(async () => {
    setBusy(true); setError("");
    try {
      await portalRequest(`/api/portal/invites/${encodeURIComponent(token)}/accept`, { method: "POST", body: {}, key: crypto.randomUUID() });
      window.location.replace("/portal");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The invite couldn't be accepted."); setBusy(false); }
  }, [token]);

  if (!invite) return <PortalShell><div className="portal-card portal-narrow">{error ? <p className="portal-error" role="alert">{error}</p> : <p className="portal-muted"><LoaderCircle size={16} className="portal-spin" /> Opening your invite…</p>}</div></PortalShell>;
  const closed = invite.status !== "open";
  return <PortalShell brand={invite.agency}>
    <div className="portal-card portal-narrow">
      <h1>{invite.agency.name} invited you to edit {invite.client.name}&apos;s website</h1>
      {closed ? <p className="portal-error" role="alert">{invite.status === "accepted" ? "This invite has already been used. Sign in to the portal instead." : invite.status === "expired" ? "This invite has expired. Ask your agency to send a new one." : "This invite was cancelled by your agency."}</p>
        : <>
          <p className="portal-muted">You&apos;ll be able to update things like your menu, prices, opening hours and news. {invite.agency.name} reviews every change before it goes live.</p>
          {signedIn ? <button type="button" className="portal-button" onClick={() => void accept()} disabled={busy}>{busy ? <LoaderCircle size={16} className="portal-spin" /> : <Check size={16} />} Accept and continue</button>
            : signedIn === false && <PortalLogin allowCreate emailHint={invite.maskedEmail} onSignedIn={() => { setSignedIn(true); void accept(); }} />}
        </>}
      {closed && invite.status === "accepted" && <a className="portal-button" href="/portal/login">Sign in</a>}
      {error && <p className="portal-error" role="alert">{error}</p>}
    </div>
  </PortalShell>;
}
