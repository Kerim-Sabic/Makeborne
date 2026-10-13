/** Browser defense in depth after the server verifies the purchase binding.
 * Sandbox navigation is confined to the isolated local test app. Deployed
 * origins never accept sandbox checkout destinations, including previews. */
export function topupNavigationUrl(value: unknown, appOrigin: string): string {
  const invalid = () => new Error("The checkout link could not be verified.");
  if (typeof value !== "string") throw invalid();
  let url: URL;
  let app: URL;
  try { url = new URL(value); app = new URL(appOrigin); }
  catch { throw invalid(); }
  const local = ["http:", "https:"].includes(app.protocol)
    && ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)
    && !app.username && !app.password;
  const allowed = url.origin === "https://whop.com"
    || (local && url.origin === "https://sandbox.whop.com");
  if (!allowed || url.username || url.password
    || !/^\/checkout\/ch_[A-Za-z0-9]+\/?$/.test(url.pathname)) throw invalid();
  return url.href;
}
