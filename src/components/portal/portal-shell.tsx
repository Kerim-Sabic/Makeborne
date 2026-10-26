"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import BrandMark from "../brand-mark";
import { createClient } from "@/lib/supabase/client";
import type { PortalBrand } from "@/lib/portal/contracts";
import { brandStyle } from "./portal-api";

/** Agency-branded frame for every portal page, with a small Makeborne credit. */
export default function PortalShell({ brand, email, children, back }: { brand?: PortalBrand | null; email?: string | null; children: ReactNode; back?: { href: string; label: string } }) {
  const router = useRouter();
  return <div className="portal" style={brandStyle(brand)}>
    <header className="portal-top">
      <div className="portal-top-inner">
        <Link href="/portal" className="portal-agency">
          {/* eslint-disable-next-line @next/next/no-img-element -- agency logo stored as a data: URL */}
          {brand?.logo ? <img src={brand.logo} alt="" /> : <span className="portal-agency-mark" aria-hidden="true">{(brand?.name ?? "Client portal").slice(0, 1)}</span>}
          <span>{brand?.name ?? "Client portal"}</span>
        </Link>
        {email && <div className="portal-account">
          <span title={email}>{email}</span>
          <button type="button" onClick={async () => { await createClient().auth.signOut(); router.replace("/portal/login"); router.refresh(); }}><LogOut size={15} /> Sign out</button>
        </div>}
      </div>
    </header>
    <main className="portal-main">
      {back && <Link href={back.href} className="portal-back">← {back.label}</Link>}
      {children}
    </main>
    <footer className="portal-foot"><a href="https://makeborne.com" target="_blank" rel="noreferrer noopener"><BrandMark size={14} /> Powered by Makeborne</a> <Link href="/terms">Terms</Link> <Link href="/privacy">Privacy</Link></footer>
  </div>;
}
