/** Whole customer credits; same canonical unsigned magnitude as the job ledger. */
export function formatBillingCredits(value: string | null): string {
  if (value === null || !/^(0|[1-9][0-9]{0,18})$/.test(value)) return "—";
  const exact = BigInt(value);
  if (exact > BigInt("9223372036854775807")) return "—";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(exact);
}
