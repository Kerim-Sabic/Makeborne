/** Rebuild only supported local destinations; never forward an arbitrary URL. */
export function authDestination(next: string | null): string {
  if (next === "/auth/update-password") return next;
  if (next?.startsWith("/studio?") && next.length < 500) {
    const query = new URLSearchParams(next.slice(8));
    const workspace = query.get("workspace");
    const artifact = query.get("artifact");
    const accountClient = query.get("accountClient");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (query.get("tab") === "clients" && workspace && uuid.test(workspace) && (!accountClient || uuid.test(accountClient))) {
      const safe = new URLSearchParams({ tab: "clients", workspace });
      if (accountClient) safe.set("accountClient", accountClient);
      return `/studio?${safe.toString()}`;
    }
    if (query.get("tab") === "projects" && workspace && uuid.test(workspace) && (!artifact || uuid.test(artifact))) {
      const safe = new URLSearchParams({ tab: "projects", workspace });
      if (artifact) safe.set("artifact", artifact);
      return `/studio?${safe.toString()}`;
    }
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
