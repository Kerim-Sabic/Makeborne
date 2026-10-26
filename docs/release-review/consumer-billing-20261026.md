# Consumer checkout and credit packs — 26 October 2026

**Not a launch approval. Sales remain closed.** Branch `qualification/consumer-billing-20261026`, based on full-version staging `9afc160`, with legal branch `c6de1f2`/`16437ab` merged at `46bf79d`. No main merge, push or application deployment in this work so far. No paid AI calls, new cloud compute, real purchases or new subscriptions. Explicitly authorized, limited production configuration/database changes are listed below; do not describe this as “production untouched.”

## Owner decisions, including the superseding tax instruction

- Six launch subscriptions, no trial or introductory discount. Open only at launch GO.
- Three manual credit packs; keep purchase flags and catalogue rows disabled until actual sandbox qualification and GO.
- **Seller-managed tax:** owner explicitly chose “we will do the tax” and then approved Whop's three legal opt-out acknowledgements. Saved production **Tax collection = I handle tax myself**, independently reloaded and verified. Whop says it will neither calculate, collect **nor display** tax in this mode. This supersedes the original managed-tax proposal.
- Owner separately approved disabling local-currency conversion on the nine production offers, preserving their USD prices, cadence and closed state.
- November renewal probes `mem_IApANyZ1n9M6vg` and `mem_DaA63WSyDtf4Sr` are excluded from writes. Their plans/payment methods have not been changed.

## 1. Production plan and product IDs

All below were read back using the app's pinned `Api-Version-Date: 2025-01-01`. Subscriptions: USD, renewal, initial fee 0, 30/365 days, no trial, no strike-through price. All hidden and out of stock. The only subsequent offer mutation was the approved `adaptive_pricing_enabled: false`; a field comparison verified price, currency, cadence, trial, visibility, stock and product/company bindings unchanged.

| Tier | Monthly, 30 days | Yearly, 365 days |
|---|---|---|
| Create | $20 — `plan_ZP50769xuOJp1` | $192 — `plan_XSD4xNiNgwxuH` |
| Studio | $49 — `plan_L8g7nPoOyQXRX` | $470.40 — `plan_jXC1Ihy89I2V0` |
| Scale | $99 — `plan_AJDmGRXPbkgV9` | $950.40 — `plan_uAni1CxtnkD8j` |

Old plans remain closed: $29 `plan_qs8XNbKQsowC6`, $79 `plan_arwSDewCa8Dvi`, $199 `plan_Wf2CTdqqUwufk`. Closing checkout does not cancel historical memberships or erase their entitlement mappings.

Existing production pack products were reused and renamed; no duplicate production products were created. All USD, one-time, renewal 0, no trial, hidden, out of stock, local-currency conversion off:

| Pack / catalogue ID | Credits | Price | Product | Plan |
|---|---:|---:|---|---|
| A little extra / `boost_100` | 100 | $12 | `prod_7xDzBCK4jwOTS` | `plan_uQfsnWwX9aAxK` |
| Keep creating / `boost_300` | 300 | $32 | `prod_vwhPhE853RCP4` | `plan_GwpfABcqYL52H` |
| Room for more / `boost_1000` | 1,000 | $95 | `prod_NLeAq0BPPB6xw` | `plan_kad4BfTsKyfHn` |

Production catalogue `credit-packs-preview-2026-10-05` already had the correct quantities/prices. Its three rows are now bound to these exact IDs and merchant `biz_CV9cZg1zFX3h7f`, **still `enabled=false`**. Before-image saved; exact-target transaction rehearsed with rollback, compared to the before-image, applied, and independently read back. No customer balances, subscription rows or activation flags changed. The public availability function must still return no purchasable packs while disabled; do not claim a production three-pack availability PASS yet.

## 2. Whop's role and outstanding provider questions

[Whop Buyer Terms](https://whop.com/buyer-terms/) describe Whop as merchant of record solely in its payment-processor capacity, with the seller identified on the receipt as supplier. Makeborne remains responsible for its product, consumer rights and its chosen tax arrangements. [Tax documentation](https://docs.whop.com/payments-and-billing/fees/taxes) describes the separate tax service; this release does not rely on it after the owner's opt-out.

**Observed configuration conflict:** the reloaded production dashboard says seller-managed tax, but all nine pinned-version plan reads still return `collect_tax:true`, `tax_type:inclusive`. Do not infer either a tax charge or its absence from this contradictory metadata. Owner approved sending the two technical questions to Whop support. Its support assistant confirmed the discrepancy, submitted internal feedback, and explicitly said no reply would return in that chat. This is not a human support resolution or a qualified payment quote.

**Final button:** both direct-plan and API-created sandbox checkout display **Join**, even with fake card 4242 selected. Dashboard styling exposes colors/fonts/borders but no final-charge label. Whop's support assistant could not confirm a label setting. Its suggestion about `metadata.custom_cta` is untested and may concern the product-page CTA; it is not a verified fix. Do not claim EU/UK payment-button qualification. No purchase was submitted through the UI-only preflight configuration `ch_uH4fxujpKIgclzZ`.

**Countries:** production Payment rules shows no custom Block/Review/Allow rules. Whop's own fraud, sanctions, payment-method and processor restrictions remain. No broad allow rule was added to bypass them. This is not proof that every non-sanctioned country/method is supported.

**Tax/accounting on our side:** consumer catalogue prices are gross, including applicable tax; `TAX_NOTE` and the unreleased legal Terms reflect seller-managed tax and separately disclose any buyer checkout/FX fees. This change does not implement or qualify a Makeborne tax engine, registrations, country/rate determination, invoicing or remittance. These must be covered by the owner's accounting process before the affected consumer markets open. Zero Whop `tax_amount` does not prove zero seller VAT liability.

## 3. Consent and code safeguards

Claude's legal branch supplied the unticked immediate-start checkbox and `/terms`, `/privacy`, `/dpa`, `/imprint`, `/withdraw`. Review found its API field was optional. Corrections in this branch:

- Require the current consent version before plan/pack checkout creation or any resumed link. Missing, stale, malformed or fabricated versions fail before a provider POST.
- Store the server-selected displayed text, billing terms version and server timestamp against the **actual** owned checkout/order request, including an older order resumed by a new browser UUID.
- New plan reservation and consent commit atomically. A failed consent write leaves no stranded pending checkout; existing duplicate/re-purchase trigger error codes remain intact.
- A private RLS table, service-only privileged implementations in unexposed `makeborne_rpc`, and public invoker wrappers. No browser table grants or new public definer.
- Account export includes only that account's consent records with deterministic pagination; existing export behavior is delegated unchanged. Auth-user erasure removes consent records, and existing legal holds still block erasure. Data-map decisions and tests were updated.
- Manual-pack checkbox has pack-specific language, is unticked, and appears only when checkout is available. Uncertain retry retains the same request ID.
- Plan availability now requires `adaptive_pricing_enabled:false`, like packs already did. A USD base catalogue is insufficient if the provider can charge another currency: missing-first-webhook recovery is only USD-qualified. Unknown/true conversion is refused before payment.

New CLI-generated migrations, not applied to production:

1. `20261026125554_billing_checkout_consent.sql`.
2. `20261026135550_crm_next_step_rpc_boundary.sql`: one-function forward repair needed by the full staging candidate. Moves Claude's existing authenticated next-step definer unchanged into `makeborne_rpc`, preserving its public invoker entry point, CAS checks and grants. Existing feature migrations are untouched. The CRM SQL check now asserts wrapper plus privileged implementation rather than requiring an exposed definer.

**Still missing for consumer qualification:** verified purchase confirmation on a durable medium with the agreement/consent/withdrawal information, and a proper `/withdraw` confirmation + automatic acknowledgement. The current mailto-only withdrawal page and consent database record are not substitutes for those journeys. Do not suppress statutory withdrawal/remedy rights with the ordinary full-unused-refund policy.

## 4. Sandbox catalogue and test boundaries

The staging database already has enabled, immutable bindings for the exact catalogue version:

| Pack | Existing sandbox plan used by staging |
|---|---|
| `boost_100` | `plan_bfmAY3ekgPP6G` |
| `boost_300` | `plan_KK8MUQf5eoFcD` |
| `boost_1000` | `plan_VHuNJDEzuJulP` |

Before discovering these frozen bindings, three separately named sandbox product fixtures were created. They are **unmapped, hidden and closed**; do not reinterpret historical orders by rebinding the frozen catalogue:

- `prod_z40piwrnC59Nk` / `plan_Ktp5nSCq6QGW9`.
- `prod_cVFPaaFd1uIH6` / `plan_0qzQWsGg9XmQB`.
- `prod_Ox1Ei4vhswnBK` / `plan_MtBtzRofYkIIS`.

USD-only behavior was also set on the six October 25 sandbox launch offers and three original pack plans. Provider read-back verified other fields unchanged; none is a November-probe plan. Sandbox tax collection has not yet been aligned to the owner's production manual-tax decision; the temporary Inclusive tax preference must be explicitly aligned or restored before final cleanup. No new pack purchase/refund lifecycle was run on this combined candidate yet.

Required actual journeys remain: all three quantities credited exactly once, duplicate attempts refused before a new charge, unused full refunds, used-credit refunds with held/reversed lots and consumed exposure, webhook-only delivery, delayed delivery recovery and cleanup. Existing mocked/SQL evidence is not relabelled as these real-service results. Refusing an app's already-resolved request does not by itself prove Whop refuses an externally reused payment URL; qualify that separately. Legitimate later purchases with new request IDs must remain possible.

The existing adapter deliberately refuses nonzero Whop tax/refund-tax amounts until pinned-version evidence proves allocation. No speculative subtraction or division by a taxed gross total was introduced. Credit quantity remains the frozen server catalogue quantity.

## 5. Cleanup and release controls

- $1 coffee plan `plan_B7Dgm9ZqM3V0M` closed at Whop (stock 0, unlimited false). Production `MAKEBORNE_SUPPORT_CHECKOUT_ENABLED=false` prepared in Vercel, **not deployed**. Environment metadata confirmed production-only placement; bulk API readback remained encrypted, so no claim that its plaintext was independently returned. The provider closure already prevents new coffee purchases. An unrelated older $95 “Support the development” offer remains untouched; do not confuse it with a credit pack.
- New production webhook `/api/billing/webhook` exists with membership/payment/refund/dispute subscriptions but is **disabled**. An older `/api/billing/whop-events` endpoint is active. Runtime key cannot GET webhook setup (403), which is consistent with least privilege. Exact pinned setup-date readback and activation/cutover still need the release setup authority and GO.
- Production key/webhook secret env entries target production only; sandbox key/secret are different. No secrets printed or committed.
- The temporary production **Update plans only** key used for the USD change had a scheduled expiry of 27 October 00:00 UTC and was deleted immediately after use, before that expiry. A same-value write probe returned 401; its private key value was removed from the local preparation file. A public variant GET returning 200 was inconclusive and was not accepted as credential-validity proof. Runtime keys were not replaced by this setup credential.
- Runtime sandbox/production key rotation remains due before **19 November**, coordinated with env cutover and read-back before old-key revocation. Do not break running services by revoking a runtime key before its replacement is deployed.
- Keep `WHOP_TOPUPS_ENABLED`, `MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED`, `MAKEBORNE_TOPUP_CHECKOUT_QUALIFIED` and catalogue activation subject to the actual qualification and final GO. Do not enable merely because mappings are prepared.

## 6. Evidence and remaining gates

Local: baseline 221/221 harnesses; combined consent/legal/account-rights suite 223/223 before the final USD guard, then focused billing/legal/account-rights 26/26 including that guard. Types and build passed; full lint had zero errors and the pre-existing unused `catImage` warning. Mounted real-component mocked HTTP tests pass for plan consent at 390/1440 and packs at 375/1440. They submit no payments.

Disposable migration rehearsal: complete original full chain and the actual staging ordering, including all six hash-verified already-applied GitHub migrations and the new consent migration. Consent SQL checks cover atomic rollback/commit, immutable text, owned-order binding, retries, export/erasure and grants. The latest actual-staging-order rehearsal applied 108 migrations: 73 of 87 SQL suites passed, including the forward-boundary test and original CRM behavioral test after correcting its old exposed-definer assertion. Generic full-chain harness has 14 known fixture/environment failures (named dblink stacks, upgrade placeholders, platform ACL/seed rows and scale guards); report them individually, not “all SQL passed.” No staging migration applied by this scope yet.

Private provider/evidence files are under ignored `outputs/consumer-billing-20261026/`; local check logs are under this worktree's ignored `work/qualification/`. No secret-bearing evidence belongs in the public repo.

Next: finish the exact-candidate checks and staging advisor comparison, prepare/deploy an isolated staging preview only within a verified included allowance, align sandbox tax, request action-time approval for the prepared fake checkouts' terms, run the actual pack journeys, finish confirmation/withdrawal and provider questions, then report for launch GO. Never open production as a workaround for an unqualified sandbox journey.

## Rollback of this preparation

Sales remain closed. If a prepared release needs to be withdrawn, keep plan stock 0, pack catalogue `enabled=false`, checkout/topup flags false and revert code through a normal reviewed PR. The additive consent/boundary migrations can stay; never drop agreement evidence as a routine rollback. Provider conversion settings can be restored from the saved before-image only with review of the currency-fulfillment implications. Seller-managed tax is an explicit owner decision; do not silently restore the paid managed-tax service. Disabled catalogue binding can be restored from its before-image only while still disabled and never used; once enabled/used, respect the immutable-binding trigger and use a new reviewed catalogue version if genuinely required.

## Update — staging database and exact local checks

All 11 pending candidate migrations applied atomically to staging `xzwikrunwpurxnxgkznh` after a verified private application-schema/data backup and rolled-back rehearsal. This supersedes the earlier “not applied to staging” notes. Existing migration ledger rows were untouched; mixed line endings were accepted only when an exact saved source matched the recorded hash and its normalized bytes matched the candidate. Security advisors remain 11 WARN, none new. API exposed schemas are `public,graphql_public`; `makeborne_rpc` is not exposed. Client count, wallets, billing settings and provider limits are unchanged. No production migration or deployment.

The exact local runner now reports **223/223 harnesses**; its time-boxed repair-qualification tariff harness remains explicitly skipped and is not newly qualified. Typecheck, lint (zero errors, one pre-existing warning) and production webpack build pass. Mounted plan and pack consent journeys pass on Chromium, Firefox and WebKit, phone and desktop. These are real components with mocked HTTP, not proof of a provider purchase. A scan of the changed files against known runtime credentials and private-key headers passed.

Whop support could not escalate these developer questions to a human. Its documentation confirms the metadata CTA is not a documented final-payment-button control. The official payment-quote API returned 403 because it requires `payment:charge`; the least-privilege runtime key was not expanded. No quote, payment or subscription resulted. A new Elements payment integration would require separately reviewed charging credentials, account/order binding, idempotency, webhook/recovery and payment-authentication qualification. The existing hosted checkout must not be relabelled indirectly or treated as qualified.
