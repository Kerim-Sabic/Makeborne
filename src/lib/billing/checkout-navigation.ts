/** Pack checkout keeps its existing local-only sandbox boundary. */
export function topupNavigationUrl(value: unknown, appOrigin: string): string {
  return navigationUrl(value, appOrigin, false);
}

/** Subscription qualification additionally permits only the named staging
 * project's immutable preview host. The server still verifies its database,
 * merchant, project and payment binding before returning this URL. */
export function creationNavigationUrl(value: unknown, appOrigin: string): string {
  return navigationUrl(value, appOrigin, true);
}

function navigationUrl(value: unknown, appOrigin: string, creation: boolean): string {
  const invalid = () => new Error("The checkout link could not be verified.");
  if (typeof value !== "string") throw invalid();
  let url: URL;
  let app: URL;
  try { url = new URL(value); app = new URL(appOrigin); }
  catch { throw invalid(); }
  const local = ["http:", "https:"].includes(app.protocol)
    && ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)
    && !app.username && !app.password;
  const staging = creation && app.protocol === "https:" && !app.port
    && !app.username && !app.password
    && /^makeborne-release-staging-[a-z0-9]{9}-kerimsabic-6594s-projects\.vercel\.app$/.test(app.hostname);
  const allowed = url.origin === "https://whop.com"
    || ((local || staging) && url.origin === "https://sandbox.whop.com");
  if (!allowed || url.username || url.password
    || !/^\/checkout\/ch_[A-Za-z0-9]+\/?$/.test(url.pathname)) throw invalid();
  return url.href;
}
