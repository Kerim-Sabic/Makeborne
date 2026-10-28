import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/brand-mark";
import LegalLinks from "@/components/legal/legal-links";

// Next.js adds noindex to not-found responses; the title says what happened instead of the home title.
export const metadata: Metadata = { title: "Page not found" };

// The root not-found boundary's stylesheets are preloaded on every page, and pages that never render it then log
// "preloaded but not used" warnings. So this page imports no CSS module: it uses globals.css (.app-error, .button)
// and these few inline styles, matching the help center's header and footer.
const page = { minHeight: "calc(100vh / var(--ui-zoom, 1))", overflowX: "clip", background: "#fdfcfe", color: "#28262f", display: "flex", flexDirection: "column" } as const;
const bar = { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "14px 24px", width: "100%", maxWidth: 1180, margin: "0 auto", padding: "24px clamp(20px, 5vw, 40px)" } as const;
const nav = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 22px", fontSize: 13, color: "#676270" } as const;

/** Branded 404 for unknown addresses and notFound() calls (unknown guides, invalid portal invites). */
export default function NotFound() {
  return <div style={page}>
    <header style={{ ...bar, borderBottom: "1px solid #eeecf2" }}>
      <Link href="/" aria-label="Makeborne home" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 20, letterSpacing: "-0.7px", fontWeight: 550 }}><BrandMark size={28} /><span>Makeborne</span></Link>
      <nav aria-label="Main navigation" style={nav}><Link href="/billing">Pricing</Link><Link href="/help">Help center</Link><Link href="/login">Log in</Link></nav>
    </header>
    <main className="app-error" style={{ flex: 1 }}>
      <h1>We couldn’t find that page.</h1>
      <p>The link may be old or mistyped. Your saved work is safe.</p>
      <div className="app-error-actions">
        <Link className="button primary" href="/">Go to the home page</Link>
        <Link className="button secondary" href="/help">Visit the help center</Link>
      </div>
    </main>
    <footer style={{ ...bar, borderTop: "1px solid #eeecf2", fontSize: 13, color: "#676270" }}><span>© 2026 Makeborne</span>
      <nav aria-label="Footer navigation" style={nav}><Link href="/">Home</Link><Link href="/help">Help center</Link><Link href="/billing">Pricing</Link><Link href="/billing/terms">Subscriptions &amp; refunds</Link><LegalLinks /></nav>
    </footer>
  </div>;
}
