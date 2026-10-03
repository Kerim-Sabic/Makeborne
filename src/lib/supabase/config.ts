export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !key.startsWith("sb_publishable_")) return null;
  try {
    const endpoint = new URL(url);
    if (endpoint.username || endpoint.password) return null;
    if (
      endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
      )
    )
      return null;
  } catch {
    return null;
  }
  return { url, key };
}

export function requireSupabaseConfig() {
  const config = getSupabaseConfig();
  if (!config)
    throw new Error(
      "Cloud workspace is not configured. Set the Supabase URL and publishable key to enable account access.",
    );
  return config;
}
