/**
 * Fresh-session rule for account deletion. The access token's `amr` claim lists how and
 * when this session was authenticated (seconds since the epoch); refreshing a session
 * keeps those times, so only a real sign-in within the window counts.
 */
export function lastAuthenticatedAt(claims: unknown): number | null {
  const amr = (claims as { amr?: unknown } | null)?.amr;
  if (!Array.isArray(amr)) return null;
  const times = amr.flatMap(entry => {
    const timestamp = (entry as { timestamp?: unknown } | null)?.timestamp;
    return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 ? [timestamp] : [];
  });
  return times.length ? Math.max(...times) : null;
}

export function recentlyAuthenticated(claims: unknown, maxAgeSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)) {
  const at = lastAuthenticatedAt(claims);
  // A little clock skew is tolerated; a sign-in from the future is not trusted.
  return at !== null && at <= nowSeconds + 60 && nowSeconds - at <= maxAgeSeconds;
}
