# Confirmation email qualification — 29 October 2026

**Provider delivery and database outbox: PASS. Production mail remains off.** This is not a real Whop checkout or an exact cloud-preview end-to-end qualification.

## Observed delivery

The owner approved a new sending-only key restricted to verified `makeborne.com`, private staging storage, and fictional test mail to `admin@makeborne.com`. The key was created through Resend and saved without displaying its value in diagnostics. Existing SMTP and production credentials were untouched.

Actual application composers, the actual HTTP mailer and actual confirmation/outbox code ran against the qualified staging-shaped PostgreSQL schema in a disposable container. Each RPC executed with `service_role`; the container's network mode was `none`. Only the host-side mailer contacted Resend. The ordinary test user and funded payment rows were fictional fixtures; no Whop payment, refund, account or November probe changed.

| Test | Result |
|---|---|
| Plan confirmation | Delivered; Create, US$20.00, monthly, 300 credits, immutable recorded consent and payment reference |
| Pack confirmation | Delivered; US$12.00, 100 credits, one-time purchase |
| Withdrawal acknowledgement | Delivered; server-generated reference and received time, no unresolved placeholders |
| Delivery after a credential failure | Delivered on fenced attempt 2; the real initial HTTP 401 remained pending with retry/backoff |
| Repeated fulfilment | No new confirmation, outbox row or provider request |
| Same provider idempotency key and content | Same Resend email ID; no duplicate message |
| Sender disabled | No claim and no send |
| Durable record versus sent content | All four stored subject/body hashes and provider IDs match the actual send results |

Six provider HTTP requests produced **four distinct emails**: four successful original/recovered sends, one idempotency replay, and one deliberately invalid-key refusal. All four distinct IDs subsequently showed **Delivered** in the authenticated Resend dashboard, addressed only to `admin@makeborne.com`. Delivered means the recipient server accepted them; an inbox-versus-spam placement test was not performed.

The visible sender was **Makeborne <admin@makeborne.com>**, with Reply-To **admin@makeborne.com**. The displayed plan body matched the saved consent, current price, included credits and renewal interval. This is a content/integrity check, not an independent legal opinion.

Evidence: `confirmation-emails-evidence-20261029.json`. Screenshots and raw execution records remain in ignored `work/launch-prep/`. A collector-only typo initially queried `provider_id` instead of `provider_message_id` after the eight sending/retry assertions had passed. The initial failed report was retained. Correcting that query and completing read-only verification proved all four sent rows; **no test emails were resent** to fix the report.

## Safety repair found during qualification

`/api/cron/transactional-mail` previously returned HTTP 200 for soft failures such as a refused send, failed confirmation record or skipped unknown paid plan. The failure was reproduced by executing the real route. The local candidate now returns HTTP 503 for those failures or a disabled sender, HTTP 200 for a healthy sweep, and HTTP 401 without doing any work for an unauthorized request. This does not undo payments or credit fulfilment.

`src/lib/billing/check-transactional-mail-cron.cjs` covers those cases, including a configuration that records confirmations while sending is off. This route repair is **local, not cloud-deployed**. No database migration was added.

Final candidate verification: **232/232 offline harnesses pass**, typecheck passes, full lint has zero errors and the one existing `catImage` warning, and `npm run build -- --webpack` succeeds including runtime preparation. The explicit real-email harness refuses to send without its recipient argument; its read-only verification mode was reused to check the saved bodies without sending again. Real-provider tests are never included in `npm test`.

## Staging preparation

The new key is stored as a sensitive **Preview-only** variable in **makeborne-release-staging / prj_c9h8fuyEmVAT8F3NHFMvzFR1BnLc**. Read-back verifies the type and environment target. `MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED=false` is explicitly stored there. No deployment was created and no existing staging outbox was drained. Production has no new key, variable, deployment or mail switch from this work.

Private local key location: `work/launch-prep/confirmation-resend.private.json` in the launch-preparation checkout. Never copy it into Git, chat, a public variable or production. Use a separately approved production sending credential at cutover.

## Prepared launch order

1. Owner upgrades the Makeborne Vercel team to Pro. No subscription was purchased by Codex.
2. Qualify the exact repaired cloud preview: a real signed sandbox purchase must reach confirmation creation, email delivery and the return/close-tab flows. Also exercise the protected retry route and withdrawal UI. These are not cleared by local fixtures.
3. Add the reviewed five-minute schedule below once Pro is active. Current `vercel.json` only schedules daily billing reconciliation. No scheduler was activated here.

   ```json
   { "path": "/api/cron/transactional-mail", "schedule": "*/5 * * * *" }
   ```

   Preserve existing cron entries. Require the configured 32+ character `CRON_SECRET`, prove an unauthorized call returns 401 and a healthy authorized sweep returns 200, and connect non-2xx alerts. Check private `transactional_mail` failed rows and oldest pending age during first-week operations; no historical dead-letter dashboard or delivery-event webhook was added here.

   Vercel's current documentation says Hobby only accepts daily crons; subdaily expressions fail deployment. Pro permits minute-level scheduling. Do not add this to a Hobby deployment and expect it to run. Source: https://vercel.com/docs/cron-jobs/usage-and-pricing . Resend retains idempotency keys for 24 hours; the qualified database repair stops automatic retries before that boundary. Source: https://resend.com/docs/dashboard/emails/idempotency-keys .
4. Before production activation: verified backup, the exact 16 pending migrations including mail fencing, repaired app deployment and a separate production sending key. Keep mail off while an old unfenced sender could run.
5. After the owner's final GO, set `MAKEBORNE_PURCHASE_CONFIRMATIONS_SINCE` to the actual activation instant, then enable transactional mail before opening the qualified Whop offers. Never use a stale countdown time to backfill old purchasers.
6. Owner performs the real-card test. Verify one confirmation and credit delivery, the refund/revoke path and logs, then the planned production watch. Keep unqualified features off.

Rollback: turn `MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED=false` and redeploy; retain durable outbox and receipt history. Keep the additive fencing migration. Preserve ambiguous deliveries for operator review rather than resetting their idempotency keys or sending after the retry horizon.

## Budget and remaining launch gates

No paid AI call, publishing VM, new deployment or subscription was used. Four delivered emails used the owner's existing Resend service. The disposable test container is stopped; fixtures are retained for read-only inspection. Existing shared Docker stacks remain available.

Still outstanding: Pro, exact cloud purchase-to-email testing, Whop tax/hosted-button/reused-link and direct-store account-binding issues, final publishing qualification, the production backup and final owner approval. This result clears the **real provider/outbox delivery** part of the mail gate, not the entire paid launch.
