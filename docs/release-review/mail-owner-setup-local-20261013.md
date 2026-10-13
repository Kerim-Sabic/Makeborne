# Owner setup: local review and corrections

Reviewed 2026-10-13. Production, cloud settings, deployment and source control remain held. No paid provider calls or real emails were sent in this package.

## Completed

- Rehearsed the complete62-migration upgrade against the saved production-schema baseline in disposable local containers. Original email240000 and lead250000 migrations remain byte-identical. All migrations were applied in these rehearsal databases only.
- Added correction260000 for private token definers with service-only invoker wrappers, token RLS/no direct table grants, composite workspace/enrollment references, flat tag arrays and missing authenticated lead-column update grants. Existing coherent data stayed unchanged; invalid existing bindings/tags abort the migration atomically.
- Fixed competing OAuth connections overwriting mailbox ownership: unique insertion arbitrates first ownership; reconnect updates are filtered by the authenticated owner and never rewrite user_id. Tokens are saved only after returned ownership matches. Failure redirects use fixed safe messages.
- Pinned public research sockets to checked DNS answers and revalidated redirects; private and IPv6-transition bypasses are refused, with bounded bodies.
- Provider-accepted email followed by receipt/history persistence failure now reports uncertain delivery, preserves identifiers when possible and warns against resending.
- Failed or incomplete reply sync blocks follow-ups for affected accounts. Duplicate reply observations recover interrupted stops/history idempotently. Older threads are checked without the previous30-day cutoff.
- Refund/terms page now has public canonical metadata and sitemap membership; preview metadata remains noindex. Privacy now describes separately connected mailboxes, lead research and selected AI processing, using admin@makeborne.com for contact.
- Corrected owner setup guidance: portraits are complete, both global/Anthropic gates are required, encryption needs stable backed-up environment-specific keys, and removing Gmail's read scope alone is not a supported send-only flow.

## Verification

- Root independently reran20 offline mail groups and11 callback groups. Providers, DNS/native transport and persistence failures are simulated; no live mailbox or provider calls.
- Full suite107/107 passed. Five live/environment harnesses explicitly skipped. Build/TypeScript passed and changed-file lint was clean.
- Root checked built terms HTML canonical/index metadata and preview noindex behavior.
- Database rehearsal:131 full SQL PASS groups plus4 intermediate mail checks; full upgrade, four injected faults (credit lots/email/lead/correction) and two interruption points recover to fingerprint74de18e2f74a5f086956fe27e87ee3c5. All91 consumed inputs unchanged; no migration-list drift.
- All five owned rehearsal containers removed. Main local and cloud databases untouched. `mail-engine-local.cjs` was not rerun because it hardcodes the protected shared55435 stack; do not count its older evidence as current provider integration qualification.

Evidence: `candidate-rehearsal.json`, `candidate-rehearsal-cleanup-20261013-123825.json`, preserved historical59 report, and `work/mail-owner-setup-{checks,build,lint}.log`.

## Remaining setup and release limits

- Anthropic daily cap is awaiting the owner's amount. Global and Anthropic activation remain off. Total API test-budget ledger unchanged in this package; current new-round recorded usage is$0.661076.
- Gmail/Outlook OAuth apps, environment-only encryption/secrets, live connect/send/reply checks and a reviewed schedule still need the authorized staging setup. No production settings or keys were created here.
- Current Gmail flow requires send+read scopes. A public server app that stores restricted-scope data needs the applicable Google verification/security review; Testing mail tokens normally expire after seven days. See [scope classification](https://developers.google.com/workspace/gmail/api/auth/scopes) and [token expiry](https://developers.google.com/identity/protocols/oauth2/). A send-only release requires a separate capability-aware implementation.
- Reply scanning is bounded at200 sent-message rows and60 unique threads/account/tick. Incomplete checks safely pause automatic follow-ups; this package does not implement progress pagination for busy mailboxes. Do not advertise unrestricted automation throughput.
- Search-console verification remains account setup; metadata and sitemap changes do not guarantee ranking, citation or rich-result display.
- Billing lifecycle/switching/credit-pack gates, image-model live qualification and remote publication qualification remain separate release blockers. The previous local-only cloud decision still applies.

## Rollout order

During an approved release, apply the full reviewed migration chain including240000,250000 and260000 before activating these features. Verify owner/editor lead writes and mailbox isolation on the candidate first. Configure separate staging secrets and validate the live flow there before production activation. Never use the production-linked CLI without an explicit reviewed target.

App rollback may leave these additive schema objects in place; removing260000 would remove the ownership/tenant protections and is not an automatic recovery action. Stop mail automation if compatibility is uncertain and retain messages, claims and encrypted tokens for review. A status marked uncertain requires a Sent-folder/provider check rather than resending.
