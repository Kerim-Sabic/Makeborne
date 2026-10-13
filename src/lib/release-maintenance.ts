/** A recovery build keeps current database contracts and stops new app work.
 * This is an additional ingress control, never a replacement for database gates.
 * It cannot affect a previously deployed bundle or stop an in-flight request.
 */
export function releaseMaintenanceResponse(request: Request, setting: string | undefined): Response | null {
  if (!setting || setting === "off") return null;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  if (!pathname.startsWith("/api/") && pathname !== "/api") return null;
  // Preserve signed payment ingestion; the route still verifies the signature.
  // Never acknowledge events here or bypass their entitlement reconciliation.
  if (request.method === "POST" && ["/api/billing/webhook", "/api/billing/whop-events"].includes(pathname)) return null;
  if (["GET", "HEAD"].includes(request.method) && pathname === "/api/auth/providers") return null;
  return Response.json({ error: { code: "RELEASE_MAINTENANCE", message: "Makeborne is briefly undergoing maintenance. Your saved work is safe. Please try again shortly." } }, {
    status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60", "X-Content-Type-Options": "nosniff" },
  });
}
