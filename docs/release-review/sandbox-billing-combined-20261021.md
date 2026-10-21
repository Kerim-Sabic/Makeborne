# Sandbox payments and combined Claude candidate — 21 October 2026

## Boundary and candidate

The owner explicitly approved accepting sandbox checkout terms, one $29 monthly subscription and two separate $12 packs with fake Visa 4242, followed by refunds/cancellation. No real money was used. No production settings, data, credentials, Worker, deployment, main push or sales activation were changed.

Local branch: `qualification/launch-services-20261021`. Merge commit: `19c40b866f6e3f755be90743df4df81091179e1e`, normal merge of Codex `54449ae` and Claude `9c2a933`; final source checkpoint `082ba12` adds only the publish-test readiness ordering described below. Claude's latest source and outputs were preserved. Coordination was written into the actual handoff in each checkout; an acknowledgment is not assumed. The earlier qualification notes were temporarily stashed by exact filename, restored, and the documentation-only conflict resolved by preserving both sides. The stash is retained as a backup. Reports remain local.

Production was independently read back at 12:31 UTC: `makeborne.com` still points to READY `dpl_ENjea1fLgLqR54bVLUcvMHXjfUfr`, source/main `70a1d91`. All existing production switches remain off.

## Actual payment results

Tests used the existing protected staging preview and its separate Supabase project, never production. The billing, credits and API source directories and migration chain are identical between that preview's `58bc0f7` source and the combined candidate. This does not qualify unrelated changes in the combined app or its new publishing image.

| Check | Result |
| --- | --- |
| $29 monthly checkout, fake 4242 | Paid in sandbox; exact stored checkout/account binding verified |
| Membership credit allocation | Exactly one grant of 300 credits to the ordinary test account |
| Authenticated purchase-status return | `active`, destination `/studio`, before refund |
| Duplicate subscription request | 409; no second subscription created |
| First $12 pack | Paid; exactly 100 credits delivered through original provider-signed notification |
| Second distinct $12 pack | Separate checkout/payment; exactly 100 credits; reconciliation discovered the paid order while its payment notification was delayed |
| Total before refunds | Exactly 500 credits, one membership, two funded packs |
| Reopening the actual funded pack request | 409; no repeat payment link returned |
| Partial first-pack refund | $6 refunded; pack held and all 100 unspent pack credits withheld |
| Remaining first-pack refund | Further $6; pack reversed, with no second credit subtraction |
| Second-pack refund | Full $12; pack reversed and 100 credits removed |
| Subscription refund/cancel | Full $29; 300 credits revoked; membership canceled immediately, no future renewal |
| Final ledger | Six rows, net zero; both paid packs reversed |
| Signed duplicate delivery | Same authentic deactivation event repeated twice; both 200, no added ledger rows |
| Bad signature | 400 |
| Reconciliation | Actual billing and top-up jobs succeeded; health 200, overdue false, zero open issues |
| Phone billing | 375px view, no horizontal page overflow |

Fifteen authentic callbacks reached staging and all returned 200. Signatures and raw payloads were forwarded unchanged; no locally minted provider events were substituted. Original payloads, database snapshots and request receipts are private evidence, not repository files.

### Configuration and harness findings

1. The $12 sandbox plan had adaptive pricing enabled. The application correctly refused it with `CREDIT_PACK_PRICE_UNVERIFIED`. Only that sandbox plan was restricted to USD, read back as `adaptive_pricing_enabled=false`, then checkout passed. The guard was not weakened. Production plans were not edited.
2. The initial subscription checkout displayed a provider price-refresh notice. Its price remained $29 monthly; submitting again produced one paid charge. The two pack purchases each produced one paid charge.
3. The first pack-preparation attempt had already created a durable order before the price guard refused. Retrying with a fresh browser request resumed that original order. A test initially tried to replay the newer request rather than the original stored request; it therefore prepared a third, unpaid checkout and failed its expected-409 assertion. Correcting the harness to use the immutable stored request produced 409. This was a test-identity error, not a duplicate paid pack. The additional checkout was never submitted.
4. The temporary test helper initially used the wrong API date header and then lacked webhook-management permission for listing hooks. Neither was an application failure; provider read helpers were corrected to the application's pinned `Api-Version-Date`, and the existing webhook was managed through its dashboard without expanding the key.

## Remaining billing gaps — do not declare launch clearance

- **Missing initial webhook:** the webhook was disabled when the subscription was bought. Purchase-status stayed pending, and reconciliation initially processed no bound membership. Whop's replay window contained no new delivery for that disabled interval; a metadata update did not produce one either. A real period-end cancellation generated signed membership notifications, which then established the original binding and granted the already-paid allowance. Thus delayed authoritative notifications recover correctly, but automatic discovery of a fresh paid subscription whose initial notifications never arrive is **not proven and was not observed here**. Do not call that missed-initial-payment recovery a pass. Any recovery improvement must preserve exact checkout/merchant/plan/Whop-user binding and atomic duplicate protection, with its own tests.
- **Monthly renewal and failed renewal:** neither occurred in this run. A paid initial checkout, metadata update, cancellation, an old weekly probe, and local simulations are not a genuine monthly renewal. All purchased test subscriptions are now canceled as requested; no monthly probe is still waiting to renew.
- No real production purchase/refund or sales activation was performed. Public plan switching and automatic charging are not enabled by these tests.

## Claude changes combined

- Responsive stored-image copies, shared `srcset` rules, first-screen image priority and same-site preloads across preview/compiled/published output.
- Firefox/WebKit attachment persistence, focus/reload and preview handling, including the client-review draft fix.
- Further art-direction prompt changes: quiet/loud tone, light grounds, fact-led diagrams, crafted illustration and accent text.
- Codex's deck-cover image retention and ebook ordered-list gutter fixes remain intact.

These are real source changes, but design superiority is not established. Claude's own design report says the 75% blind-preference target was not met (combined estimate 45%). Its design runs had a separately recorded owner allowance; they are not new calls from this qualification's $50 ledger. Keep those independent measurements separate from app-route and cloud publishing evidence.

## Combined local verification

- 184/184 offline harnesses pass. Five explicitly skipped service/interactive checks are listed in the original log; they are not counted as service passes.
- Full ESLint and TypeScript checks pass; the repaired attachment fixture also passes focused lint.
- Production webpack build passes. Default Turbopack failed because this checkout's `node_modules` junction points outside its configured filesystem root; the original failure is retained, not relabeled as a successful Turbopack build.
- Controller checks and rebuilt controller bundle pass locally.
- No new migrations are introduced by the merge.
- The broad initial browser matrix passed 83/87 cells: three failures were the attachment fixture's obsolete two-argument `onBuild` mock; the real PlanCard supplies the required credit maximum. The fixture now imports the actual effort ceiling and all three engines pass. One WebKit history navigation timed out under concurrent load; two subsequent isolated runs pass unchanged. Do not erase the first failure or claim its cause is established.
- A second complete parallel matrix passed 86/87 cells: the prior history check passed, but WebKit timed out waiting for the Copy link confirmation. Three instrumented isolated publishing runs subsequently passed 8/8 scenarios each; there is no proven application root cause from these receipts. The test now waits for the already-required published report and refreshed live header before clicking in the panel whose preview iframe was removed, preserving every existing assertion with no artificial sleep or increased timeout. This final publishing test passes Chromium/Firefox/WebKit (3/3).
- Across complete runs and explicit focused reruns, all 87 check/engine cells have passing coverage. **Do not describe this as one clean final 87/87 sweep**: the intermittent history/copy timeouts and their original logs are retained. PDF page geometry remains a Chromium-only measurement, explicitly skipped in Firefox/WebKit. Mounted checks use routed fictional APIs, not paid provider calls or a live cloud database.

## Cleanup and budget

The webhook was returned to Disabled and read back. The dedicated relay and Cloudflare tunnel were stopped; port 3066 has no listener. No key permissions were expanded. The test account is disabled and sessions revoked; zero-credit ledger/refund audit is deliberately retained. The extra unpaid test checkout remains unsubmitted. Existing staging billing settings match their saved baseline. The sandbox $12 plan's stricter USD-only configuration is retained.

No new paid AI calls, cloud VMs, deployments or subscriptions were created in this continuation. The existing aggregate cloud reservation covered the bounded billing requests: 15 signed callbacks, below its 50-callback limit, plus checkout/reconciliation reads. Conservative completed bounds remain accounted rather than being treated as an invoice or released silently:

- Original $5 ledger: $4.956772 accounted.
- Separate $50 Claude API ledger: $1.926543 measured.
- Additional $1 staging ledger: $1.00 accounted/reserved, unchanged.

No further cloud deployment or VM is authorized from the closed reservation. Claude changed the immutable publishing runtime and policy identity; earlier `54449ae` cloud receipts do not qualify `19c40b8` automatically. The combined runtime still needs a separately reserved exact-candidate staging qualification before production preparation can be completed.

Evidence: private folder `work/launch-services-qualification-20261021`, notably `billing-final-checks.json`, `billing-purchased-state.private.json`, `billing-partial-held-state.private.json`, `billing-final-ledger.private.json`, `billing-signed-callback-summary.json`, `billing-cleanup.json`, browser logs, build/lint/typecheck/controller logs and the refund screenshot. The earlier AI/publishing evidence is described in `launch-services-qualification-20261021.md`.
