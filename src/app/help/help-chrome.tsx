import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import styles from "./page.module.css";

/** Header and footer shared by the help center pages. */
export function HelpHeader() {
  return <header className={styles.header}>
    <Link href="/" className={styles.brand} aria-label="Makeborne home"><BrandMark size={28} /><span>Makeborne</span></Link>
    <nav aria-label="Main navigation"><Link href="/#templates">Styles</Link><Link href="/billing">Pricing</Link><Link href="/help">Help center</Link><Link href="/login" className={styles.signIn}>Log in <ArrowUpRight size={14} aria-hidden="true" /></Link></nav>
  </header>;
}

export function HelpFooter() {
  return <footer className={styles.footer}><span>© 2026 Makeborne</span>
    <nav aria-label="Footer navigation"><Link href="/">Home</Link><Link href="/help">Help center</Link><Link href="/billing">Pricing</Link><Link href="/billing/terms">Subscriptions &amp; refunds</Link><Link href="/privacy">Privacy</Link></nav>
  </footer>;
}

/** JSON-LD, escaped so page text can never close the script element. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
