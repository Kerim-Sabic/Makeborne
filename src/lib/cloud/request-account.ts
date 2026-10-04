/** Optional compatibility header: absent callers still require normal authentication/RLS. */
export function requestAccountMatches(expected: string | null, authenticatedId: string) {
  if (expected === null) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected)
    && expected.toLowerCase() === authenticatedId.toLowerCase();
}
