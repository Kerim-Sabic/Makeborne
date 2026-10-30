/** Terms, DPA and legal notice share the accepted legal version. Privacy disclosures have
 * their own revision so an analytics disclosure never changes recorded checkout consent. */
export { WITHDRAWAL_CONSENT_VERSION } from "../billing/plans";

export const LEGAL_VERSION = "2026-10-26";
export const LEGAL_UPDATED = "26 October 2026";
export const PRIVACY_VERSION = "2026-10-30";
export const PRIVACY_UPDATED = "30 October 2026";
export const LEGAL_CONTACT = "admin@makeborne.com";

/** The legal pages, in footer order. `file` is the source in docs/legal. */
export const LEGAL_DOCUMENTS = [
  { path: "/terms", file: "terms.md", label: "Terms", title: "Terms of Service", description: "The terms for using Makeborne, including acceptable use, your content, AI output, liability and consumer withdrawal." },
  { path: "/privacy", file: "privacy.md", label: "Privacy", title: "Privacy Policy", description: "How ZORBY&CO d.o.o. handles personal data in Makeborne: purposes, legal bases, retention, recipients, transfers and your rights." },
  { path: "/dpa", file: "dpa.md", label: "DPA", title: "Data Processing Agreement", description: "The data processing agreement for personal data customers store in Makeborne, with sub-processors and security measures." },
  { path: "/imprint", file: "imprint.md", label: "Legal notice", title: "Legal notice", description: "Company details, registered address and contact points for Makeborne." },
] as const;

/** Shown beside sign-up. Links: Terms and Privacy Policy. */
export const SIGNUP_TERMS_LINE = { before: "By creating an account you agree to the ", terms: "Terms", middle: " and acknowledge the ", privacy: "Privacy Policy", after: "." } as const;

/** The unticked box on the plan step before the redirect to Whop (EU/UK immediate-performance request
 * and acknowledgement, Consumer Rights Directive Art. 14(3) and 16(a)). Changing it needs a new
 * WITHDRAWAL_CONSENT_VERSION in src/lib/billing/plans.ts. */
export const WITHDRAWAL_CONSENT_TEXT = "I want my plan to start immediately. I understand that if I withdraw within 14 days, I’ll pay for the credits I’ve used, and that I lose my right to withdraw once the service has been fully provided.";
export const PACK_WITHDRAWAL_CONSENT_TEXT = "I want my credit pack to be available immediately. I understand that if I withdraw within 14 days, I’ll pay for the credits I’ve used, and that I lose my right to withdraw once the service has been fully provided.";
