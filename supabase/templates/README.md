# Makeborne account emails

Use `confirmation.html` for **Confirm signup**, with the subject **Confirm your Makeborne email**. Use `recovery.html` for **Reset password**, with the subject **Reset your Makeborne password**.

These are production HTML email templates. Copy their complete contents into Supabase Authentication → Email → Templates after deploying the matching application routes.

## How confirmation works

- The email button links to `/auth/confirm` with Supabase's `TokenHash`. It opens a Makeborne confirmation screen. A GET never consumes the token; the user explicitly confirms through a same-origin POST.
- This avoids accidental confirmation by email security scanners and does not need the original browser's PKCE verifier. The code in the email is a second option, accepted by the app's check-inbox screen.
- `RedirectTo` is URL encoded with Go template's built-in `urlquery` function. The application accepts only its own `/auth/callback` URL and then applies its existing destination allowlist. Saved prompt draft IDs survive the email step.
- Both password recovery paths lead to `/auth/update-password`. All creation membership checks remain in place after authentication.

## Required production settings

1. Set Supabase Site URL to the deployed Makeborne origin, currently `https://makeborne.vercel.app`.
2. Allow the production `/auth/callback` redirect and its query strings. Keep development origins separate. Do not allow arbitrary third-party origins.
3. Configure a verified sending domain and custom SMTP. The Supabase default email service restricts recipients; a styled template does not remove that restriction.
4. Disable click tracking for authentication emails so confirmation URLs are not rewritten.
5. Keep **Confirm email** enabled. Never bypass verification to work around delivery failures.
6. Google sign-in requires a Google OAuth Web client and secret in Supabase. Its authorized provider callback is `https://<project-ref>.supabase.co/auth/v1/callback`. Add the Makeborne origin in Google's authorized JavaScript origins and publish the consent screen as required by Google. The app shows its Google button only when Supabase's public settings reports that Google is enabled.

The emails use HTML tables, inline styles, a PNG brand mark, a solid-color button fallback, and a code fallback. Gradients and rounded corners are enhancements where the email client supports them.

Sources: [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google).
