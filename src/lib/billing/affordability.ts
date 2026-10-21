/** Advisory only. The server still reserves the full approved hold atomically. */
export function affordability(maximum: number, wallet: { available: number; unlimited: boolean } | null) {
  // A request without a known maximum is never sent on a guess (and never shows "undefined credits").
  if (!Number.isFinite(maximum) || maximum <= 0) return "The maximum charge for this request couldn't be worked out. Nothing has been sent. Reload and try again.";
  if (!wallet || wallet.unlimited || wallet.available >= maximum) return null;
  return `This request can reserve up to ${maximum} credits. You have ${wallet.available} available. Add credits or lower the effort before sending. Nothing has been sent.`;
}
