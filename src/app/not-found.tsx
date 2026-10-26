import type { Metadata } from "next";
import Link from "next/link";
import { HelpFooter, HelpHeader } from "./help/help-chrome";
import styles from "./help/page.module.css";

// Next.js adds noindex to not-found responses; the title says what happened instead of the home title.
export const metadata: Metadata = { title: "Page not found" };

/** Branded 404 for unknown addresses and notFound() calls (unknown guides, invalid portal invites). */
export default function NotFound() {
  return <div className={styles.page}>
    <HelpHeader />
    <main className={`${styles.main} app-error`}>
      <h1>We couldn’t find that page.</h1>
      <p>The link may be old or mistyped. Your saved work is safe.</p>
      <div className="app-error-actions">
        <Link className="button primary" href="/">Go to the home page</Link>
        <Link className="button secondary" href="/help">Visit the help center</Link>
      </div>
    </main>
    <HelpFooter />
  </div>;
}
