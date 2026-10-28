/**
 * The texts of the purchase confirmation (Consumer Rights Directive Art. 8(7), a durable medium) and
 * of the withdrawal acknowledgement (Art. 11a). Pure: the database stores exactly what these return,
 * and refuses a confirmation that does not quote the payment reference and the accepted request.
 * The withdrawal wording follows docs/legal/terms.md section 6; change both together.
 */
export const SELLER_LINE = "ZORBY&CO d.o.o., Vilsonovo šetalište 10, 71000 Sarajevo, Bosnia and Herzegovina";
export const SUPPORT_EMAIL = "admin@makeborne.com";
export const STATUTORY_RIGHTS_LINE = "Nothing in this email or in our terms limits the rights you have by law as a consumer.";
export const WITHDRAWAL_STATEMENT_START = "I hereby give notice that I withdraw from my contract for the supply of the following service:";

export type ConsentSnapshot = { version: string; termsVersion: string; text: string; acceptedAt: string };
export type PurchaseFacts = {
  kind: "plan" | "pack";
  /** "Studio" for a plan, "Credit pack" for a pack. */
  name: string;
  interval: "monthly" | "yearly" | null;
  credits: number;
  amountCents: number;
  currency: string;
  paidAt: string;
  paymentId: string;
  consent: ConsentSnapshot | null;
  legalVersion: string;
  billingTermsVersion: string;
  site?: string;
};

export function money(cents: number, currency: string) {
  const code = currency.toUpperCase();
  const amount = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return code === "USD" ? `US$${amount}` : `${amount} ${code}`;
}

export function utcTime(iso: string) {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const credits = (value: number) => value.toLocaleString("en-US");

/** "Makeborne Studio plan, billed monthly" or "Makeborne credit pack, 300 credits". */
export function serviceLabel(facts: Pick<PurchaseFacts, "kind" | "name" | "interval" | "credits">) {
  return facts.kind === "plan"
    ? `Makeborne ${facts.name} plan, billed ${facts.interval}`
    : `Makeborne credit pack, ${credits(facts.credits)} credits`;
}

export function composePurchaseConfirmation(facts: PurchaseFacts) {
  const site = (facts.site ?? "https://makeborne.com").replace(/\/$/, "");
  const label = serviceLabel(facts);
  const subject = facts.kind === "plan"
    ? `Your Makeborne purchase confirmation: ${facts.name} plan, ${facts.interval}`
    : `Your Makeborne purchase confirmation: credit pack, ${credits(facts.credits)} credits`;
  const bought = facts.kind === "plan"
    ? [`- ${facts.name} plan, billed ${facts.interval}: ${credits(facts.credits)} credits for each month of access${facts.interval === "yearly" ? ", released month by month" : ""}`,
       `- Renewal: it renews ${facts.interval} at the plan price until you cancel in your Whop account. Cancelling stops the next renewal; you keep access to the end of the period you paid for.`]
    : [`- Credit pack: ${credits(facts.credits)} credits, a one-time payment that does not renew`];
  const consent = facts.consent
    ? ["Your request to start immediately",
       `At checkout you ticked this request (version ${facts.consent.version}, on ${utcTime(facts.consent.acceptedAt)}):`,
       `"${facts.consent.text}"`,
       "",
       "Your right to withdraw",
       `If you are a consumer in the EU, the EEA or the UK, you can withdraw from this contract within 14 days of the day it was made, without giving a reason. Use the withdrawal page at ${site}/withdraw, email ${SUPPORT_EMAIL} with your Whop payment reference, or send the model form below. Sending your notice before the 14 days end is enough.`,
       "Because you asked us to start immediately, if you withdraw we refund the payment less an amount in proportion to what you used: the credits you used from it, as a share of all credits included in its paid term. If you used none, you get a full refund. You lose the right to withdraw once the service has been fully provided. We refund within 14 days of receiving your withdrawal, through Whop, to your original payment method."]
    : ["Your right to withdraw",
       `If you are a consumer in the EU, the EEA or the UK, you can withdraw from this contract within 14 days of the day it was made, without giving a reason, and get a full refund: no request to start immediately is on record for this purchase. Use the withdrawal page at ${site}/withdraw, email ${SUPPORT_EMAIL} with your Whop payment reference, or send the model form below. We refund within 14 days of receiving your withdrawal, through Whop, to your original payment method.`];
  const body = [
    "Hello,",
    "",
    "Thank you for your purchase. This email confirms your contract with Makeborne. Please keep it.",
    "",
    "What you bought",
    ...bought,
    `- Amount paid: ${money(facts.amountCents, facts.currency)}, as recorded by Whop`,
    `- Paid on: ${utcTime(facts.paidAt)}`,
    `- Whop payment reference: ${facts.paymentId}`,
    "",
    ...consent,
    "Separately, our own policy keeps any payment fully refundable while none of its credits are used, even after 14 days.",
    "",
    "Model withdrawal form (complete and return it only if you wish to withdraw)",
    `To ${SELLER_LINE}, ${SUPPORT_EMAIL}:`,
    `- ${WITHDRAWAL_STATEMENT_START} ${label}`,
    `- Ordered on ${day(facts.paidAt)} / Whop payment reference ${facts.paymentId}`,
    "- Name of consumer:",
    "- Email address of the Makeborne account:",
    "- Date:",
    "",
    "Terms that apply to this purchase",
    `- Terms of Service, version ${facts.legalVersion}: ${site}/terms`,
    `- Subscription, credit and refund terms, version ${facts.consent?.termsVersion ?? facts.billingTermsVersion}: ${site}/billing/terms`,
    "",
    STATUTORY_RIGHTS_LINE,
    "",
    `Seller: ${SELLER_LINE}. Email ${SUPPORT_EMAIL}. Legal notice: ${site}/imprint`,
    "Whop processes the payment and sends its own receipt.",
    "This is a service email about your purchase.",
  ].join("\n");
  return { subject, body };
}

export type WithdrawalFacts = { statement: string; paymentId: string | null; paymentReference: string | null; name: string | null; message: string | null; site?: string };

/** The acknowledgement template. The database fills {{reference}} and {{received}} with the
 * request's own reference and server time when it stores the notice. */
export function composeWithdrawalAcknowledgement(facts: WithdrawalFacts) {
  const site = (facts.site ?? "https://makeborne.com").replace(/\/$/, "");
  const payment = facts.paymentId ? `Whop payment reference: ${facts.paymentId}`
    : facts.paymentReference ? `Payment reference you gave: ${facts.paymentReference}` : "No payment reference was given; we will find the purchase from your account.";
  const body = [
    "Hello,",
    "",
    "We received your notice of withdrawal on {{received}}. Your reference is {{reference}}.",
    "",
    "Your notice",
    `"${facts.statement}"`,
    ...(facts.name ? [`Name: ${facts.name}`] : []),
    payment,
    ...(facts.message ? ["Your message:", facts.message] : []),
    "",
    "What happens next",
    "We check the payment and reply within 2 working days. For a withdrawal within 14 days of the purchase, we refund it within 14 days of receiving your notice, through Whop, to your original payment method: in full if you used none of its credits, otherwise less the share of its credits you used.",
    "To stop future renewals, also cancel your membership in your Whop account.",
    "",
    "This email confirms the date and content of your notice. It does not decide the refund by itself.",
    STATUTORY_RIGHTS_LINE,
    "",
    `${SELLER_LINE}. Email ${SUPPORT_EMAIL}. Withdrawal information: ${site}/withdraw`,
  ].join("\n");
  return { subject: "We received your withdrawal notice ({{reference}})", template: body };
}

/** The withdrawal statement for the chosen purchase (shown before confirming and stored as sent). */
export function withdrawalStatement(service: string) {
  const text = service.trim().replace(/\s+/g, " ").slice(0, 400);
  return `${WITHDRAWAL_STATEMENT_START} ${text || "Makeborne"}.`;
}
