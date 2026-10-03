# Account setup and verification

Reviewed 2026-10-03. Email/password signup, confirmation, sign-in, resend, recovery and password update now use the actual Supabase SDK. They are intentionally unavailable until cloud configuration and verified migrations are enabled. There is no simulated account system or working-provider badge.

## Current external dependency

At review time this workspace had no `.env.local`, Supabase environment credentials or callable Supabase connector. Global Supabase CLI was unavailable; the coordinator's local Docker startup also failed. No cloud project was created, no terms accepted, no plan purchased and no mail sent by this implementation task. Type checks and local contract checks are not a live signup test.

An owner must connect an existing authorized development Supabase project, or create one themselves, and place its URL and **publishable** key in a private `.env.local` (never paste secrets into chat or commit them). This application currently accepts `sb_publishable_` keys. Do not put service-role or secret keys in `NEXT_PUBLIC_*` variables.

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
MAKEBORNE_CLOUD_ENABLED=true
MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED=true
```

Set the last flag only after applying and verifying this repository's migrations/RLS against the selected project. Restart the development server after changing environment configuration. Production environment variables must be configured independently on the host. The first cloud visit uses the existing workspace membership/bootstrap flow; authentication alone does not prove tenant permissions.

## Dashboard settings

1. Keep email authentication and **email confirmation** enabled. Match the project's password policy to the UI's minimum of 12 characters; enable available abuse protection and provider rate limits.
2. Set Auth → URL Configuration → Site URL to the exact deployed origin, or `http://localhost:3000` for this development project.
3. Add exact redirect URLs for each approved origin: `/auth/callback`, `/auth/callback?next=/auth/update-password`, `/auth/confirm` and `/auth/update-password`. Verify query matching in that project's configuration. Production should use precise destinations instead of broad wildcard redirects. Do not approve arbitrary preview domains.
4. Configure custom SMTP before opening signup to customers. Supabase's default SMTP currently accepts only organization team-member recipient addresses, has a two-messages-per-hour limit and no delivery SLA. SMTP credentials belong only in the Supabase dashboard, not the app's client configuration. Configure and verify the sending domain with the chosen provider; this task does not purchase delivery services.

## Confirmation templates

For one environment per project, use these minimal links inside the dashboard email templates. `SiteURL` must match the environment. No token is logged or forwarded to the studio URL.

Confirm signup:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">Confirm your email</a>
```

Reset password:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">Reset your password</a>
```

`/auth/confirm` accepts only `email` and `recovery`; recovery always goes to the password-update screen, email confirmation to the cloud studio. Other OTP flows, invitations and email changes are not implemented here. Default PKCE email links also have `/auth/callback` support; their browser-held verifier requires the originating browser. The token-hash template allows the receiving browser to establish a verified session without that verifier. Do not mix a production Site URL with a development template. Email scanners can consume single-use links; expired/used links return a safe recovery instruction rather than claiming success. A scanner-resistant confirmation interaction is future work.

## Actual flows and boundaries

- Signup waits for email confirmation unless the provider returns a real session. Existing-address behavior remains generic to reduce account enumeration.
- Login uses `signInWithPassword`. No decorative Google/Apple buttons are rendered without configured providers.
- Recovery uses `resetPasswordForEmail`; its response does not disclose whether an account exists. Successful requests and resends have a 60-second UI cooldown, which is advisory; Supabase enforces actual limits.
- `/auth/update-password` requires a server-verified user. Updating calls `updateUser({password})`; session expiry or reauthentication policies can still reject the request. The server page supports a verified logged-in account as well as a recovery session; it does not claim proof that every session arrived through recovery.
- The SSR proxy refreshes verified claims and preserves its response cookies. Protected operations independently use a verified user and membership/RLS checks. Public/local pages remain available during an auth-provider outage.
- Callback targets are fixed to `/studio/cloud` and `/auth/update-password`, with private no-store responses and no-referrer redirects. Provider errors and tokens are not placed in user-facing error messages. Cookie-setting auth responses must never be publicly cached.
- Local projects stay on the device until explicitly imported. Signup does not automatically synchronize them.

## Release evidence still required

Use an owner-controlled test address. Verify delivery, signup → confirmation → verified cloud workspace, logout, correct and incorrect passwords, duplicate signup behavior, resend limits, recovery → new password → login, expired/used tokens, a callback with an external `next`, session expiration, and access denied across two independently owned tenants. Confirm server cookies in real browser sessions and verify actual migration/RLS behavior. Test keyboard navigation and mobile layout. Record the selected project/environment and results without tokens or passwords.

Source/type checks completed for the implemented auth files; **live identity, delivery and tenant-storage verification remain blocked on project configuration**. Do not advertise working online accounts before those checks succeed.

## Focused UX research

The useful pattern in Claude and ChatGPT's official help is clear account identity, a small set of real sign-in methods, and an obvious route for expired links or forgotten access. Makeborne uses explicit sign-in/create-account states, a recovery action, visible email instructions and friendly errors. It does not inherit subscriptions, identities or provider capabilities from those products.

Primary sources reviewed 2026-10-03:

- [Supabase SSR client setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [Password authentication and PKCE recovery](https://supabase.com/docs/guides/auth/passwords)
- [Next.js user management and token-hash confirmation](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs)
- [Redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls)
- [SMTP requirements and default restrictions](https://supabase.com/docs/guides/auth/auth-smtp)
- [Claude account login](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)
- [ChatGPT login troubleshooting](https://help.openai.com/en/articles/7426629-why-cant-i-log-in-to-chatgpt)
