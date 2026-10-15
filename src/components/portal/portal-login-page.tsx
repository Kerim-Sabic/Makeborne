"use client";
import PortalShell from "./portal-shell";
import PortalLogin from "./portal-login";

export default function PortalLoginPage({ next }: { next: string }) {
  return <PortalShell>
    <div className="portal-card portal-narrow">
      <h1>Sign in to edit your website</h1>
      <p className="portal-muted">We&apos;ll email you a one-time code. No password needed.</p>
      <PortalLogin onSignedIn={() => window.location.replace(next)} />
    </div>
  </PortalShell>;
}
