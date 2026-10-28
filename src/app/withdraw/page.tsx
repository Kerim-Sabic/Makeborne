import Link from "next/link";
import { HelpFooter, HelpHeader } from "@/app/help/help-chrome";
import helpStyles from "@/app/help/page.module.css";
import styles from "@/components/legal/legal-document.module.css";
import WithdrawForm, { type WithdrawPaymentOption } from "@/components/legal/withdraw-form";
import { billingUser } from "@/lib/billing/access";
import { billingDatabase } from "@/lib/billing/database";
import { defaultPlanLabel } from "@/lib/billing/purchase-confirmations";
import { money } from "@/lib/legal/purchase-confirmation";
import { LEGAL_CONTACT, LEGAL_UPDATED } from "@/lib/legal/versions";
import { accountPurchaseRecords, paymentService } from "@/lib/legal/withdrawal";
import { transactionalMailEnabled } from "@/lib/mail/transactional";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/withdraw", "Withdraw from a purchase", "How EU, EEA and UK consumers withdraw from a Makeborne purchase within 14 days, and what is refunded.");
export const dynamic = "force-dynamic";

/** The signed-in account's purchases, newest first. Unavailable billing storage shows the plain form. */
async function paymentOptions(userId: string): Promise<WithdrawPaymentOption[]> {
  try {
    const db = billingDatabase();
    const records = await accountPurchaseRecords((name, args) => db.rpc(name, args), userId);
    return (records?.payments ?? []).slice(0, 20).map(payment => {
      const plan = payment.kind === "plan" && payment.planId ? defaultPlanLabel(payment.planId) : null;
      const what = payment.kind === "plan" ? plan ? `${plan.name} plan, ${plan.interval}` : "Plan" : `Credit pack, ${Number(payment.credits ?? 0).toLocaleString("en-US")} credits`;
      const date = new Date(payment.paidAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      return { paymentId: payment.paymentId, label: `${what} · ${money(payment.amountCents, payment.currency)} · ${date}`, service: paymentService(payment, defaultPlanLabel) };
    });
  } catch { return []; }
}

/** Consumer withdrawal function (Consumer Rights Directive Art. 11a): "Withdraw from contract here",
 * then "Confirm withdrawal". The notice is stored with server time and acknowledged on a durable medium. */
export default async function WithdrawPage() {
  const user = await billingUser().catch(() => null);
  const payments = user ? await paymentOptions(user.id) : [];
  return <div className={helpStyles.page}>
    <HelpHeader />
    <main className={helpStyles.main} id="main">
      <article className={styles.doc}>
        <h1>Withdraw from a purchase</h1>
        <p className={styles.meta}>Last updated {LEGAL_UPDATED}</p>
        <p>If you are a consumer in the EU, the EEA or the UK, you can withdraw from a Makeborne plan or credit pack within 14 days of buying it, without giving a reason. Sending your notice before the 14 days end is enough.</p>
        <h2 id="what-you-get-back">What you get back</h2>
        <ul>
          <li>No credits used from that payment: a full refund.</li>
          <li>Some credits used: a refund less the share of that payment’s credits you used.</li>
          <li>We refund within 14 days through Whop, to the payment method you used.</li>
        </ul>
        <p>Outside the 14 days, any payment is still refundable in full while none of its credits are used. See the <Link href="/terms#6-consumers-your-right-to-withdraw">Terms</Link> and the <Link href="/billing/terms">Subscription, credit and refund terms</Link>.</p>
        <h2 id="withdraw-now">Withdraw now</h2>
        <p>{user
          ? "Choose the purchase, check the notice, then confirm. We record the time we receive it and send you an acknowledgement by email."
          : <>Enter the email address of your Makeborne account and, if you have it, the Whop payment reference. Then confirm. We record the time we receive it. <Link href="/login?next=%2Fwithdraw">Sign in</Link> to pick the purchase from a list instead.</>}</p>
        <WithdrawForm signedIn={Boolean(user)} accountEmail={user?.email?.toLowerCase() ?? null} payments={payments} mailOn={transactionalMailEnabled()} />
        <p>You can also email {LEGAL_CONTACT} or write to ZORBY&amp;CO d.o.o., Vilsonovo šetalište 10, 71000 Sarajevo, Bosnia and Herzegovina, using the model form in the <Link href="/terms#6-consumers-your-right-to-withdraw">Terms</Link>. To stop future renewals, also cancel your membership in your Whop account.</p>
      </article>
    </main>
    <HelpFooter />
  </div>;
}
