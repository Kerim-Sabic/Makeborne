import Link from "next/link";
import { HelpFooter, HelpHeader } from "@/app/help/help-chrome";
import helpStyles from "@/app/help/page.module.css";
import styles from "@/components/legal/legal-document.module.css";
import { LEGAL_CONTACT, LEGAL_UPDATED } from "@/lib/legal/versions";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/withdraw", "Withdraw from a purchase", "How EU, EEA and UK consumers withdraw from a Makeborne purchase within 14 days, and what is refunded.");

const subject = "Withdrawal from contract";
const body = [
  "I hereby give notice that I withdraw from my contract for the supply of the following service: Makeborne plan (plan and interval): ",
  "Ordered on / Whop payment reference: ",
  "Name: ",
  "Email address of my Makeborne account: ",
  "Date: ",
].join("\n");
const mailto = `mailto:${LEGAL_CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Consumer withdrawal function (Consumer Rights Directive Art. 11a). Today it prepares an email; a
 * confirmation step with an automatic acknowledgement on a durable medium is a follow-up (docs/legal). */
export default function WithdrawPage() {
  return <div className={helpStyles.page}>
    <HelpHeader />
    <main className={helpStyles.main} id="main">
      <article className={styles.doc}>
        <h1>Withdraw from a purchase</h1>
        <p className={styles.meta}>Last updated {LEGAL_UPDATED}</p>
        <p>If you are a consumer in the EU, the EEA or the UK, you can withdraw from a Makeborne plan within 14 days of buying it, without giving a reason. Sending your notice before the 14 days end is enough.</p>
        <h2 id="what-you-get-back">What you get back</h2>
        <ul>
          <li>No credits used from that payment: a full refund.</li>
          <li>Some credits used: a refund less the share of that payment’s credits you used.</li>
          <li>We refund within 14 days through Whop, to the payment method you used.</li>
        </ul>
        <p>Outside the 14 days, any payment is still refundable in full while none of its credits are used. See the <Link href="/terms#6-consumers-your-right-to-withdraw">Terms</Link> and the <Link href="/billing/terms">Subscription, credit and refund terms</Link>.</p>
        <h2 id="withdraw-now">Withdraw now</h2>
        <p>The button opens an email to {LEGAL_CONTACT} with the withdrawal statement filled in. Add your plan and Whop payment reference, then send it from the email address of your account. We confirm by email.</p>
        <p><a className={styles.button} href={mailto}>Withdraw from contract here</a></p>
        <p>You can also write to ZORBY&amp;CO d.o.o., Vilsonovo šetalište 10, 71000 Sarajevo, Bosnia and Herzegovina, using the model form in the <Link href="/terms#6-consumers-your-right-to-withdraw">Terms</Link>. To stop future renewals, also cancel your membership in your Whop account.</p>
      </article>
    </main>
    <HelpFooter />
  </div>;
}
