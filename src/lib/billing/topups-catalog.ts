/** Proposed one-time prices. This client-safe catalog never grants credits. */
export const CREDIT_TOPUP_CATALOG_VERSION = "credit-packs-preview-2026-10-05";
export const CREDIT_TOPUP_CURRENCY = "usd" as const;
export const CREDIT_TOPUP_PACKS = [
  { id: "boost_100", label: "A little extra", credits: 100, priceCents: 1200 },
  { id: "boost_300", label: "Keep creating", credits: 300, priceCents: 3200 },
  { id: "boost_1000", label: "Room for more", credits: 1000, priceCents: 9500 },
] as const;

export type CreditTopupPack = typeof CREDIT_TOPUP_PACKS[number];
export type CreditTopupPackId = CreditTopupPack["id"];

export function creditTopupPack(id: string): CreditTopupPack | undefined {
  return CREDIT_TOPUP_PACKS.find(pack => pack.id === id);
}

export function formatCreditTopupPrice(priceCents: number): string {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new Error("Invalid credit pack price.");
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: priceCents % 100 === 0 ? 0 : 2 }).format(priceCents / 100);
}

export type CreditTopupAvailability = {
  available: boolean;
  reason: string | null;
  authenticated: boolean;
  eligible: boolean;
};
