/** Plan choices that may ride through sign-up to /billing (kept in step with CREATION_PLANS; this file imports nothing). */
const BILLING_TIERS = ["create", "studio", "scale"];
const BILLING_INTERVALS = ["monthly", "yearly"];

/** Rebuild only supported local destinations; never forward an arbitrary URL. */
export function authDestination(next: string | null): string {
  if (next === "/auth/update-password") return next;
  if (!next || next.length > 2400 || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/studio";
  const url = new URL(next, "https://makeborne.invalid");
  if (url.origin !== "https://makeborne.invalid") return "/studio";
  const safe = new URLSearchParams();
  if (url.pathname === "/auth/update-password") {
    const after = url.searchParams.get("next");
    // One recovery nesting level; never allow another auth route inside it.
    if (after && /^\/(studio|chat|billing|admin)([/?#]|$)/.test(after)) {
      safe.set("next", authDestination(after));
      return `/auth/update-password?${safe}`;
    }
    return "/studio";
  }
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
  if (["/studio/cloud", "/chat", "/admin"].includes(url.pathname)) return url.pathname;
  // Client portal: home, one site (UUID) or an invite (43-character token). No query is kept.
  if (url.pathname === "/portal"
    || /^\/portal\/sites\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname)
    || /^\/portal\/join\/[A-Za-z0-9_-]{43}$/.test(url.pathname)) return url.pathname;
  if (url.pathname === "/billing") {
    // One nesting level only: billing may return to a creation route, never itself.
    const after = url.searchParams.get("next");
    if (after && (after.startsWith("/studio") || after.startsWith("/chat"))) safe.set("next", authDestination(after));
    if (url.searchParams.get("required") === "membership") safe.set("required", "membership");
    // A plan picked before sign-up: both values or neither, each from a fixed list.
    const plan = url.searchParams.get("plan"), interval = url.searchParams.get("interval");
    if (plan && interval && BILLING_TIERS.includes(plan) && BILLING_INTERVALS.includes(interval)) { safe.set("plan", plan); safe.set("interval", interval); }
    const hash = ["#plans", "#support", "#credits", "#activity", "#topups"].includes(url.hash) ? url.hash : "";
    return `/billing${safe.size ? `?${safe}` : ""}${hash}`;
  }
  return "/studio";
}

/** The plan a /billing return link carries, after the same allow-list; null for every other destination. */
export function billingPlanSelection(next: string | null): { tier: string; interval: string } | null {
  const destination = authDestination(next);
  if (!destination.startsWith("/billing?")) return null;
  const query = new URL(destination, "https://makeborne.invalid").searchParams;
  const tier = query.get("plan"), interval = query.get("interval");
  return tier && interval ? { tier, interval } : null;
}

export function passwordRecoveryDestination(next: string | null): string {
  const destination = authDestination(next);
  return `/auth/update-password?next=${encodeURIComponent(destination.startsWith("/auth/") ? "/studio" : destination)}`;
}

export function accountError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : "";
  if (code === "invalid_credentials") return "The email or password does not match. Try again or reset your password.";
  if (code === "email_not_confirmed") return "Confirm your email before signing in. You can request another confirmation below.";
  if (["over_request_rate_limit", "over_email_send_rate_limit"].includes(code)) return "Too many requests. Wait a little before trying again.";
  if (["weak_password", "same_password"].includes(code)) return "Choose a new password with at least 12 characters.";
  if (code === "email_address_invalid") return "Enter a valid email address.";
  if (code === "email_address_not_authorized") return "We couldn’t send the email right now. Please try again later.";
  if (["otp_expired", "otp_disabled"].includes(code)) return "That code has expired or has already been used. Request a new email and try its latest code.";
  if (["provider_disabled", "validation_failed"].includes(code)) return "This sign-in option is temporarily unavailable. Please use your email instead.";
  return "We could not complete this request. Please try again shortly.";
}

/** Email templates retain the original callback without accepting external destinations. */
export function emailAuthDestination(redirectTo: string | null, origin: string): string {
  if (!redirectTo || redirectTo.length > 3200) return "/studio";
  try {
    const callback = new URL(redirectTo, origin);
    if (callback.origin !== origin || callback.pathname !== "/auth/callback") return "/studio";
    return authDestination(callback.searchParams.get("next"));
  } catch {
    return "/studio";
  }
}
