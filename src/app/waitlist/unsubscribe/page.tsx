import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/brand-mark";
import styles from "../../help/page.module.css";

export const metadata: Metadata = { title: "Leave the launch waitlist", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, { title: string; body: string }> = {
  done: { title: "You're off the list.", body: "You won't get the launch invite or launch news. Changed your mind? Join again any time at makeborne.com." },
  invalid: { title: "This link didn't work.", body: "It may be incomplete. Use the unsubscribe link from your email again, or write to admin@makeborne.com and we'll remove you." },
  error: { title: "Something went wrong.", body: "Your request wasn't saved. Try the link again in a minute, or write to admin@makeborne.com and we'll remove you." },
};

/** Confirmation step for the waitlist unsubscribe link, so link scanners that open emails can't unsubscribe anyone. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const status = MESSAGES[one(params.status)];
  return <div className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}><BrandMark size={26} />Makeborne</Link></header>
    <main className={styles.main}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>LAUNCH WAITLIST</span>
        <h1>{status ? status.title : "Leave the launch waitlist?"}</h1>
        <p>{status ? status.body : "We'll stop sending you the launch invite and launch news."}</p>
        {!status && <form method="post" action="/api/waitlist/unsubscribe" style={{ marginTop: 24 }}>
          <input type="hidden" name="id" value={one(params.id)} />
          <input type="hidden" name="sig" value={one(params.sig)} />
          <button type="submit" className="button primary">Unsubscribe</button>
        </form>}
      </section>
    </main>
  </div>;
}
