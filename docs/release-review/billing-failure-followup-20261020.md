# Billing failure qualification — 20 October 2026

Production unchanged. Automatic charging stays off. This extends the existing $5 qualification allowance; it does not authorize a release or a new allowance.

## Results

- Nine isolated SQL suites pass: billing lifecycle and concurrency, expiry and concurrent credit lots, annual allocations and concurrency, rollover, usage history and real payment-history withholding/restoration.
- Six additional isolated SQL suites pass: automatic top-up consent/state, wallet and wallet concurrency, subscription payment refunds, top-up fulfillment and top-up status. Fixtures are synthetic; these are real SQL effects, not provider transactions.
- New `check-usage-history-scale.sql` passes with 100,000 reservations and 100,000 historical settlement rows. Each of two adjacent UTC months contains 5,000 caller-owned entries: ten pages, no duplicates, 10,000 charged credits matching the complete-month total. Another account's 90,000 rows stay excluded. Total pagination time: 450.72 ms and 442.64 ms locally. An empty month and the microsecond UTC boundary pass. This is synthetic history/performance evidence, not 100,000 actual provider calls or production latency. Separate tests cover real reserve/settle/withhold/restore.
- Actual reconciliation job plus actual disposable SQL passes: missed-history issues, evidence catch-up, rollover expiry, no duplicate idle grants, overlapping job refusal, and healthy job status. Whop is mocked in that test.
- Fresh read-only sandbox scan completed: eight memberships and ten payments. The expired existing key was refreshed to 21 October 00:00 UTC, preserving its existing 13 permissions, API version and IP configuration. No production credentials changed. The candidate's actual payment normalizer accepted all ten fresh payment responses, including paid cycle, failed cycle and refunded subscription/pack responses.
- Actual webhook route, local signatures, live sandbox reads and actual isolated SQL pass: invalid signature 400 before provider access; missing account binding 503; retry after a fixture binding is installed 200; duplicate retry 200 with one receipt; already-refunded subscription grants zero. A failed-cycle probe created directly at Whop has no app checkout reference and correctly returns 503. Its initial harness assumption that every probe had an app checkout was corrected; application code was not weakened.
- Typecheck, full lint and 142/142 offline harnesses pass. Previously queued remote GitHub and Vercel preview checks for PRs 9, 10 and 11 all passed. New test/operator-only checkpoint checks must be reported separately after pushing.

## Operator fix

The tracked SQL runner could match zero files or return success while its JSON listed failed suites. It now refuses a zero-match filter before any database work and returns a nonzero exit for failed suites. Both were exercised: a nonexistent filter is rejected, and one deliberately failing SQL fixture records its failure and exits 1. The disposable test fixture and generated negative-test reports were removed.

## Limits and remaining sales gate

The webhook replay was signed locally with the existing sandbox test secret. It is not a newly delivered Whop-signed webhook, a new checkout, or a production purchase. Old trial-completion cycle payments are not proof of the later scheduled weekly renewal. Full and partial refunds, disputes, replacement handling, top-up recovery and monthly annual allocations have current synthetic SQL/offline evidence; do not relabel those as fresh provider lifecycle tests. The unbound direct-checkout probe cannot establish application credit delivery. Plan switching remains outside this package and automatic charging remains off.

Native Office, OpenAI images and production activation remain separate gates. No new paid AI calls were made in this continuation. Combined conservative ledger accounting is $3.116071 of $5, retaining uncertain usage/cloud bounds; it is not an invoice. The extra cloud publishing VM is stopped, its private registry repository deleted, and private Docker authentication removed. The recurring controller host was not newly purchased or activated.

Private evidence is in the primary checkout's ignored `work/lovable-qualification-20261020` directory: `billing-continuation-sql.log`, `billing-failure-sql.log`, `sql-suites-usage_history_scale.json`, `billing-job-check.log`, `live-payment-normalization.json`, `webhook-provider-sql.json`, `runner-failure.json` and remote check snapshots. Do not commit raw provider responses, credentials, signed requests or account inventories.

Coordinate further work through `docs/AGENT_HANDOFF.md`. Revert the test/operator commit to roll back these changes; it changes no runtime billing policy or schema. Kerim's explicit approval remains required for production changes.
