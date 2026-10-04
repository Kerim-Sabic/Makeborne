/** Rebuild only supported local destinations; never forward an arbitrary URL. */
export function authDestination(next: string | null): string {
  if (next === "/auth/update-password") return next;
  if (!next || next.length > 2400 || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/studio";
  const url = new URL(next, "https://makeborne.invalid");
  if (url.origin !== "https://makeborne.invalid") return "/studio";
  const safe = new URLSearchParams();
  if (url.pathname === "/billing/return") {
    const request = url.searchParams.get("request");
    return request && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request)
      ? `/billing/return?request=${request}` : "/billing";
  }
  if (url.pathname === "/studio") {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const key of ["workspace", "artifact", "accountClient", "project", "draft", "claim"]) {
      const value = url.searchParams.get(key);
      if (value && uuid.test(value)) safe.set(key, value);
    }
    const tab = url.searchParams.get("tab");
    if (tab && ["projects", "clients", "styles", "research", "settings"].includes(tab)) safe.set("tab", tab);
    const kind = url.searchParams.get("create");
    if (kind && ["website", "book", "presentation"].includes(kind)) safe.set("create", kind);
    if (url.searchParams.get("from") === "home") safe.set("from", "home");
    return `/studio${safe.size ? `?${safe}` : ""}`;
  }
  if (["/studio/cloud", "/chat"].includes(url.pathname)) return url.pathname;
  if (url.pathname === "/billing") {
    // One nesting level only: billing may return to a creation route, never itself.
    const after = url.searchParams.get("next");
    if (after && (after.startsWith("/studio") || after.startsWith("/chat"))) safe.set("next", authDestination(after));
    if (url.searchParams.get("required") === "membership") safe.set("required", "membership");
    const hash = ["#plans", "#support", "#credits", "#activity"].includes(url.hash) ? url.hash : "";
    return `/billing${safe.size ? `?${safe}` : ""}${hash}`;
  }
  return "/studio";
}

export function accountError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : "";
  if (code === "invalid_credentials") return "The email or password does not match. Try again or reset your password.";
  if (code === "email_not_confirmed") return "Confirm your email before signing in. You can request another confirmation below.";
  if (["over_request_rate_limit", "over_email_send_rate_limit"].includes(code)) return "Too many requests. Wait a little before trying again.";
  if (["weak_password", "same_password"].includes(code)) return "Choose a new password with at least 12 characters.";
  if (code === "email_address_invalid") return "Enter a valid email address.";
  if (code === "email_address_not_authorized") return "Email delivery is not ready for this address. Please contact the studio owner.";
  return "We could not complete this request. Please try again shortly.";
}
