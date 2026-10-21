/** Advisory only. The server still reserves the full approved hold atomically. */
export function affordability(maximum: number, wallet: { available: number; unlimited: boolean } | null) {
  if (!wallet || wallet.unlimited || wallet.available >= maximum) return null;
  return `This request can reserve up to ${maximum} credits. You have ${wallet.available} available. Add credits or lower the effort before sending. Nothing has been sent.`;
}
