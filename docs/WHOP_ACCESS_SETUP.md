# Whop payment and creation access

## Owner decision — 26 October 2026: seller-managed tax

Production Whop **Tax collection = I handle tax myself**, saved after the owner accepted Whop's three opt-out acknowledgements. Whop will not calculate, collect **or display** tax for Makeborne. This supersedes earlier recommendations to use Whop Collects and Remits. The Inclusive preference remains stored but does not provide a tax calculation in this mode. Consumer catalogue prices remain the owner-approved gross prices; `TAX_NOTE` includes applicable tax and separately discloses any checkout fee.

Makeborne/the seller must arrange tax registration, jurisdiction/rate determination, invoices, records and remittance before opening the affected consumer markets. No Makeborne tax engine has been implemented or qualified by this configuration change. Do not claim all worldwide tax compliance or infer a zero tax liability from `tax_amount: 0` in a Whop payment. Processor and sanctions restrictions still apply even without merchant country-block rules.

The credit-pack adapter currently rejects non-zero Whop tax/refund-tax amounts. That conservative guard remains in place until a real pinned-version fixture proves the allocation; seller-managed tax does not justify guessing or silently treating a gross payment as pre-tax revenue. Opening packs still requires the owner-approved staging journeys and separate production GO. Report: `docs/release-review/consumer-billing-20261026.md`.

## What works without payment API secrets

**Pricing page (24 Oct 2026).** The $1 coffee support card, its nav item and FAQs are no longer on `/billing`; the `SUPPORT` constant, this route and the terms paragraph stay. The route remains live from old links until `MAKEBORNE_SUPPORT_CHECKOUT_ENABLED=false` is set (recommended owner decision). Signed-out plan CTAs send visitors to `/login?mode=signup&next=/billing?plan=…&interval=…#plans`; `authDestination` keeps only `plan ∈ {create, studio, scale}` and `interval ∈ {monthly, yearly}`. Price wording beside every CTA comes from `TAX_NOTE` (`src/lib/billing/plans.ts`), which mentions tax **and** checkout fees until the owner confirms buyers pay no Whop fee.

**EU/UK prerequisites before consumer sales open** (enforced through Whop country settings and the release-checklist gate row, not by the page): Whop tax-inclusive consumer prices on and `TAX_NOTE` flipped to its tax-inclusive variant; `topup-fulfillment.ts` and the membership webhook verified with **taxed** payments (today a taxed total can differ from the catalogue amount the fulfilment path expects: a fulfilment gap); an EU "order with obligation to pay" final button in Whop; and Whop collecting the immediate-performance consent and withdrawal acknowledgement the terms require "separately at checkout". Without that consent EU/UK consumers keep a 14-day withdrawal right with a proportionate refund even after using credits.

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
| `WHOP_CREATION_CHECKOUT_PLAN_IDS` | Optional exact list for new checkout; retain historical access/credit mappings separately. Empty, duplicate, malformed or unknown IDs close checkout. Omit only where each tier/cadence has one access mapping. |
| `WHOP_WEBHOOK_SECRET` | Endpoint's literal `ws_...` signing secret |
| `SUPABASE_SECRET_KEY` | Server-only `sb_secret_...` key for authoritative billing records |
| `MAKEBORNE_BILLING_MIGRATIONS_VERIFIED` | Set true only after applying and verifying the billing migration |
| `WHOP_CREATION_ENABLED` | Keep false until creation features and paid lifecycle checks pass |

Current Whop docs list `checkout_configuration:create`, `checkout_configuration:basic:read`, `member:basic:read`, and `member:email:read` for checkout/membership APIs. Refund/dispute reconciliation also retrieves the original payment; the stable payment endpoint documents `payment:basic:read`, `payment:dispute:read`, and `payment:resolution_center_case:read`. Generic checkout creation also lists plan/product creation scopes because it supports inline plan creation; this app only uses an existing `plan_id`. Start with the narrower scopes and add others only if Whop confirms they are required. No product, plan, refund, payout, or membership mutations are performed by this app. Creation readiness requires a configured `ws_` webhook signing secret as well as the API/database credentials and activation flags.

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

**Repriced on 23 Oct 2026** (`docs/RELEASE_DECISIONS.md`):
- **New prices:** the code now expects Create $20, Studio $49 and Scale $99 a month. Yearly is $192, $470.40 and $950.40.
- **Old plans:** the three plans above keep their old renewal prices, so `verifiedCreationOffer` refuses them, because a plan's renewal price must equal `planPrice()`. Nobody can be charged an old price by mistake.
- **To open checkout:**
  1. The owner creates new hidden plans at the new prices in Whop.
  2. `CREATION_CATALOG` in `src/lib/billing/config.ts`, `WHOP_PLAN_CREDIT_MAP` and `WHOP_ACCESS_PLAN_IDS` are updated to their IDs.
  3. `makeborne_private.billing_access_plans` enables them.

## Authoritative checkout and membership binding

`POST /api/billing/checkout` accepts `{ planId, requestId, next? }`. It validates the signed-in account and plan allowlist, reserves a durable unique request, creates a Whop checkout configuration, and saves the provider checkout ID before returning its verified URL. A retry with the same request ID reuses the saved checkout; a conflicting or uncertain request fails closed.

`billing_checkouts` binds the Whop checkout ID to the verified Supabase user and original internal destination. Browser metadata or a supplied email cannot overwrite that binding. Callback URLs contain only an opaque request UUID.

`POST /api/billing/webhook` verifies the raw Standard Webhooks signature and its timestamp, checks the merchant, retrieves current membership state from Whop, and matches its checkout ID to the saved account binding. Membership and event receipt commit atomically. The coffee plan and any checkout not created by this server never grant access. Duplicate webhook events are ignored. Out-of-order status payloads do not grant stale access because current membership state is retrieved from Whop.

Payment events reconcile their linked membership. A successful payment without a membership is read again from Whop; if the link is still missing, the endpoint returns `503` so delivery can retry instead of silently dropping a paid event. An exhausted retry requires operator reconciliation, which is a remaining launch requirement. Refund and dispute events resolve the original payment through Whop and then retrieve the current membership. This refreshes access after provider-side revocation; it does not treat a partial refund as an instruction to cancel, create credit adjustments, or mutate the Whop subscription. Unknown event families cannot refresh an entitlement. Conflicting merchant IDs are rejected.

The app checks the membership live before page access or mutation, including the original Whop user and plan. Database writes require a short verification lease of at most five minutes and a current billing period. Expired, missing, transferred, trialing, or unverified memberships do not grant access. No browser-local entitlement is used.

`/billing/return?request=<UUID>` polls the owned checkout status for up to 30 seconds. Only a server-verified membership belonging to that exact checkout opens the saved draft; an unrelated active membership cannot mark a failed checkout successful. Pending confirmation preserves the draft and offers a retry; it does not ask the customer to purchase again. Checkout URLs must be absolute HTTPS links on `whop.com` naming a plan or checkout configuration, without embedded credentials.

## Remaining paid-launch work

The membership gate is an access foundation, not a completed subscription fulfillment service. Before opening the creation products:

- Implement transactional credit grants keyed to the verified paid billing period, with unique provider payment IDs, renewal handling, expiring balances, upgrade policy, and refund/chargeback adjustments. Existing job reservations and spending limits are not funded customer credits.
- Connect the authoritative credit ledger to billing history and generation settlement; reconcile ambiguous payment/provider outcomes without duplicate grants or charges.
- Wire the creation plan buttons to the verified checkout route and provide customer subscription management. The current cards deliberately remain previews.
- Verify the deployed provider API response contract and pin matching webhook/API versions. The adapter currently uses Whop's documented stable nested membership/payment objects; a switch to the native flattened API requires an explicit adapter update, not accepting unvalidated fields.
- Configure real server credentials, the signed webhook endpoint, a durable retry/reconciliation path, and observability. A provider timeout must never create an entitlement or prompt a duplicate purchase.

These are release requirements. Setting an environment flag cannot implement them.

## Required lifecycle verification before opening creation sales

- Test signed Whop events against the configured endpoint; verify signature, wrong-merchant, stale-timestamp, duplicate, and modified-body rejection.
- Subscribe to membership activation/update/deactivation events supported by the configured API version, payment success/failure, refund creation/update, and dispute creation/update. Validate actual delivered payloads against the adapter before enabling sales.
- Complete an approved sandbox purchase and confirm the account/checkout/Whop-user binding plus original draft return.
- Verify renewal, end-of-period cancellation, payment failure, expiry, refund/revocation, and membership transfer. The Whop membership status is authoritative; refund policy must revoke the membership when refunding access.
- Verify entitlement recovery after a delayed webhook. Unmatched external/manual purchases need a deliberate support process; email similarity must never silently grant access.
- Use Whop delivery retries for temporary failures. The current handler is synchronous; add a durable event queue before higher-volume launch if processing approaches Whop's five-second delivery timeout.
- A pending checkout whose provider response could not be saved stays closed and needs reconciliation; no automatic duplicate charge is created.

No real purchase or live entitlement lifecycle has been verified yet. No paid AI calls are enabled.

The billing migration was applied on 4 October 2026. A transaction using an existing authenticated account's claims confirmed that membership/write permission was false, direct task insertion raised `MB402`, and the project-creation RPC denied access. The transaction was rolled back. Database creation remains disabled with no active plan allowlist.

Official references: [checkout configuration](https://docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration), [membership retrieval](https://docs.whop.com/api-reference/memberships/retrieve-membership), [webhooks](https://docs.whop.com/developer/guides/webhooks), [current SDK signature helper](https://github.com/whopio/whopsdk-typescript/blob/main/src/helpers/verifyWebhook.ts).

Offline checks on 4 October 2026: `node src/lib/billing/check-access-foundation.cjs` exercises configuration gates, coffee/unknown-plan exclusion, signed/tampered/stale webhooks, expired and canceled membership states, exact checkout matching, refund/dispute payment resolution, and checkout URL restrictions. These fixtures make no live calls and do not substitute for the sandbox lifecycle checks above.
