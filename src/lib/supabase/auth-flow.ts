/** Fixed destinations prevent untrusted email links becoming open redirects. */
export function authDestination(next: string | null): string {
  return next === "/auth/update-password" ? next : "/studio/cloud";
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
