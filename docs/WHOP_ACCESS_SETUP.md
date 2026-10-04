# Whop payment and creation access

## What works without payment API secrets

`GET /api/billing/support-checkout` reports whether the verified coffee product is available and whether the visitor is signed in. `POST` requires a server-verified Supabase account, then returns the fixed public Whop product URL:

`https://whop.com/checkout/plan_B7Dgm9ZqM3V0M`

The product information page is `https://whop.com/makeborne-2/pay-a-coffee/`. The app uses the direct checkout copied from the official Whop dashboard and visually verified to show the $1/month subscription.

Business: `biz_CV9cZg1zFX3h7f`. Coffee plan: `plan_B7Dgm9ZqM3V0M`.

The $1/month contribution is support only. It never grants creation, advisor chat, credits, or publishing. No success URL, email match, or browser state is treated as payment proof. A public Whop product can also be reached outside the app; the app's checkout button itself requires sign-in.

## Current gate

Studio, cloud studio, and advisor chat require an account and verified creation membership. Anonymous visitors go to login. Signed-in visitors without access go to `/billing?required=membership&next=...`. Creation memberships remain closed by default. Existing development-only read-only `/admin` remains unchanged; there is no hidden paid-access bypass.

Cloud writes, generation, and exports check creation access on the server. Authorized cloud reads remain available to avoid making customer data inaccessible simply because a subscription expires. The database migration independently covers direct Data API / RPC writes and Storage write policies.

## Required server configuration

Never add a public prefix to these variables:

| Variable | Purpose |
| --- | --- |
| `WHOP_API_KEY` | Company-scoped API credential |
| `WHOP_COMPANY_ID` | `biz_CV9cZg1zFX3h7f` |
| `WHOP_ACCESS_PLAN_IDS` | Comma-separated creation plan IDs; coffee is rejected |
| `WHOP_WEBHOOK_SECRET` | Endpoint's literal `ws_...` signing secret |
| `SUPABASE_SECRET_KEY` | Server-only `sb_secret_...` key for authoritative billing records |
| `MAKEBORNE_BILLING_MIGRATIONS_VERIFIED` | Set true only after applying and verifying the billing migration |
| `WHOP_CREATION_ENABLED` | Keep false until creation features and paid lifecycle checks pass |

Current Whop docs list `checkout_configuration:create`, `checkout_configuration:basic:read`, `member:basic:read`, and `member:email:read` for the used APIs. Generic checkout creation also lists plan/product creation scopes because it supports inline plan creation; this app only uses an existing `plan_id`. Start with the narrower scopes and add others only if Whop confirms they are required. No product, plan, refund, payout, or membership mutations are performed by this app.

## Database migration and activation

Review/apply `supabase/migrations/20261004162455_whop_membership_access.sql` using the established migration workflow. It creates service-only billing tables with RLS, a private creation switch and plan allowlist, and write enforcement. It changes `makeborne_private.can_edit` to require a fresh paid membership, covering existing Storage policies. It adds triggers to application tables so direct RPC calls cannot bypass billing.

**Applying this migration immediately blocks all unpaid application writes.** It does not delete existing data. Anonymous access remains subject to existing grants/RLS. Authorized read policies remain unchanged. The default switch is false and the plan allowlist is empty, so no account is initially entitled.

Before launch, verify with separate authenticated users that direct REST writes, project/workspace RPCs, and Storage writes fail without membership. Also verify one account cannot read another account's billing or checkout records. Only the service role can write billing state.

Creation activation has three independent controls:

1. Set the database's `makeborne_private.billing_settings.creation_enabled` to true only after release requirements pass.
2. Insert only verified creation plan IDs into `makeborne_private.billing_access_plans` with `enabled=true`. The coffee plan has a database constraint forbidding it.
3. Configure the same IDs on the server and set the two verified/enabled environment flags. Merely adding an API key does not activate selling.

Keep all controls closed while AI generation and the promised creation plans are unavailable.

Verified hidden, out-of-stock creation catalog (4 October 2026): Create $29/month `plan_qs8XNbKQsowC6`; Studio $79/month `plan_arwSDewCa8Dvi`; Scale $199/month `plan_Wf2CTdqqUwufk`. The server catalog recognizes only these IDs, and activation still requires the separate environment/database controls. Product creation does not make these memberships available for sale.

## Authoritative checkout and membership binding

`POST /api/billing/checkout` accepts `{ planId, requestId, next? }`. It validates the signed-in account and plan allowlist, reserves a durable unique request, creates a Whop checkout configuration, and saves the provider checkout ID before returning its verified URL. A retry with the same request ID reuses the saved checkout; a conflicting or uncertain request fails closed.

`billing_checkouts` binds the Whop checkout ID to the verified Supabase user and original internal destination. Browser metadata or a supplied email cannot overwrite that binding. Callback URLs contain only an opaque request UUID.

`POST /api/billing/webhook` verifies the raw Standard Webhooks signature and its timestamp, checks the merchant, retrieves current membership state from Whop, and matches its checkout ID to the saved account binding. Membership and event receipt commit atomically. The coffee plan and any checkout not created by this server never grant access. Duplicate webhook events are ignored. Out-of-order status payloads do not grant stale access because current membership state is retrieved from Whop.

The app checks the membership live before page access or mutation, including the original Whop user and plan. Database writes require a short verification lease of at most five minutes and a current billing period. Expired, missing, transferred, trialing, or unverified memberships do not grant access. No browser-local entitlement is used.

`/billing/return?request=<UUID>` polls the owned checkout status for up to 30 seconds. Only server-verified membership opens the saved draft. Pending confirmation preserves the draft and offers a retry; it does not ask the customer to purchase again.

## Required lifecycle verification before opening creation sales

- Test signed Whop events against the configured endpoint; verify signature, wrong-merchant, stale-timestamp, duplicate, and modified-body rejection.
- Complete an approved sandbox purchase and confirm the account/checkout/Whop-user binding plus original draft return.
- Verify renewal, end-of-period cancellation, payment failure, expiry, refund/revocation, and membership transfer. The Whop membership status is authoritative; refund policy must revoke the membership when refunding access.
- Verify entitlement recovery after a delayed webhook. Unmatched external/manual purchases need a deliberate support process; email similarity must never silently grant access.
- Use Whop delivery retries for temporary failures. The current handler is synchronous; add a durable event queue before higher-volume launch if processing approaches Whop's five-second delivery timeout.
- A pending checkout whose provider response could not be saved stays closed and needs reconciliation; no automatic duplicate charge is created.

No real purchase or live entitlement lifecycle has been verified yet. No paid AI calls are enabled.

The billing migration was applied on 4 October 2026. A transaction using an existing authenticated account's claims confirmed that membership/write permission was false, direct task insertion raised `MB402`, and the project-creation RPC denied access. The transaction was rolled back. Database creation remains disabled with no active plan allowlist.

Official references: [checkout configuration](https://docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration), [membership retrieval](https://docs.whop.com/api-reference/memberships/retrieve-membership), [webhooks](https://docs.whop.com/developer/guides/webhooks), [current SDK signature helper](https://github.com/whopio/whopsdk-typescript/blob/main/src/helpers/verifyWebhook.ts).
