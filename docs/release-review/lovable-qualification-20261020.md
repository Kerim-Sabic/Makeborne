# Lovable implementation qualification — 20 October 2026

**Production unchanged. Qualification is incomplete; this is not release approval.**

## Owner decisions implemented

- New automatic top-up setup being disabled cannot hide existing authorizations or prevent revocation. Creating/replacing consent still requires the setup flag. Consent is hashed from the stored offer shown to the customer. Automatic charging remains unimplemented and off.
- An unreadable home attachment stops generation and tailored-question calls. Keep the prompt and explain the problem. Retry, replace or explicitly leave out the file before sending. Leaving out does not delete the stored file or automatically submit the prompt.

## Evidence and scope

Private logs, local fixture screenshots and the new budget ledger are in the primary checkout's ignored `work/lovable-qualification-20261020/` directory. Historical research evidence was not modified. The new $5 testing allowance has **$0 spent, $0 reserved**. No Lovable requests were sent; the 18 queued layout instructions remain paused.

| Handoff item | Result so far | Remaining gate |
|---|---|---|
| 0: original branches | Independently passed 150/150 fixes and 142/142 billing harnesses, typecheck, full lint, webpack builds, original mounted checks and Worker checks | Five documented service/interactive/tariff skips are not passes |
| C3: usage history | 58 SQL suites passed, three documented skips, zero failures in separate disposable copies of the clean 94-migration base plus billing migrations. A new SQL suite calls actual withholding/restoration helpers and verifies history, wallet reconciliation and duplicate handling. Real signed-in local app at 1440/375 passes 120-row pagination, JSON coverage and charged sum = used | Large-ledger benchmark; staging confirmation. Month navigation across two populated months cannot be proven with only October available; month-boundary logic remains offline-tested |
| M05: title search | Local full-chain SQL: 5,000 artifacts, 151 matches over four pages, no duplicates, caller RLS, literal wildcard input and anonymous denial. Four pages: 784.98 ms in the final local run | Real route 404/409 checks, staging advisors and cloud performance |
| C2: asset cache | Local Worker implementation and all Worker checks pass. New workerd check covers 19 requests: republish, GET/HEAD/304, offline, JavaScript disable, retired files, changed digest and upstream outage | Cloud staging deployment, real publication and load observation |
| C4: fonts | Separate runtime image rebuilt. All 17 opt-in portability groups pass: eight actual font files/eight faces, current and historical source, exported archive/runtime byte parity, tamper refusal | Cloud serverless PDF/font inspection; native Windows/macOS PowerPoint checks |
| C1: Stop | Not implemented in this checkpoint | Durable cancellation, provider gating/abort, measured settlement, SQL/race/mounted tests and bounded staging qualification |
| M04/M09: real model behavior | No paid calls; source readiness and submission contracts are tested locally | Actual title/source-use samples with independent fixtures and advance ledger reservations |
| C5: consent safety | Implemented on billing branch; offline and 9 mounted checks pass; full updated branch passes 142/142, typecheck, lint and build | Integration/staging before release; charging stays off |
| C6: stale fixture | All 13 attachment-flow scenarios pass after request-specific completion waits replaced stale exact message counts | None locally |
| Final edited fixes candidate | 151/151 harnesses, full lint, typecheck and webpack build pass | Re-run after subsequent implementation changes; no frozen final candidate yet |

## Additional defect found

Supabase's default privileges directly granted `service_role` execution of title search, despite the authenticated-only contract. Additive forward repair `20261020144714_artifact_title_search_acl.sql` narrows this function only; its predecessor remains unchanged. The SQL regression explicitly checks the service-role denial. Applied only on the local rc API stack and disposable rehearsal copies, with a local backup first.

## Cache decision

Only fingerprinted script/style/font paths use edge byte caching. Mutable files use `public, max-age=0, must-revalidate` and a SHA-256 ETag. Cache keys include namespace, origin, slug and digest and ignore old v1 keys. Every request still executes the existing authoritative file RPC **before** consulting the cache, so edge hits do not bypass hosting eligibility, current manifest or JavaScript consent. This adds no second database query and claims no database-load reduction.

No old-revision grace period was added. A retired bundle returns 404; making older code public after revocation requires a separate retention policy. No network check can revoke bytes a visitor already downloaded or retained in their browser.

## Test corrections and limitations

- The older attachment fixture counted every completed assistant message; receipts introduced extra completed messages. Waits now target this request's saved output and verify the actual request attachments. Unsupported/oversized cases require explicit exclusion under the owner's new policy.
- An older namespace test deliberately expected stale image bytes. It now requires authoritative bytes, including same-namespace poisoned cache entries. The first candidate run failed this assertion (149/150); after correcting it, the full rerun passed 151/151.
- The real billing test initially used an invalid grant fixture, then selected both the usage and cost tables. Fixed those fixture mistakes, reran successfully and removed the disposable account. No product failure is inferred from those fixture failures.
- SQL restore emits six pre-existing `already exists` ownership/grant warnings in the dump runner; passing suites do not establish a hosted security-advisor comparison. The runner's process exit alone is insufficient: its JSON failure array was inspected and is empty.

## Branches and next release order

## Continuation: Stop, real AI and cloud evidence

Qualification on 20 October continued under the same $5 allowance. Production remains unchanged.

- **C1 implemented:** durable actor-bound Stop RPC and same-origin DELETE route; operation and active-run cancellation markers; a provider gate refuses all subsequent calls immediately; a bounded server poll aborts the active stream. Website, document and planning streams settle through the same atomic finalization. Confirmed usage is charged once, unused held credits return, and valid partial work is offered for explicit recovery without another charge. Browser disconnect alone still preserves paid work.
- **C1 evidence:** 30 operation integration groups, five mounted HTTP/SSE browser cases (before initial operation event, double Stop, reload, lost reply, late old event), five SQL groups, and actual separate-connection races pass. Eight concurrent Stops plus eight finalizations produced one charge and no saved version. Stop-first prevents a racing save; completion-first preserves the existing result. A real Opus stream was stopped: 2 confirmed customer credits, zero saved versions and zero remaining hold. Its final provider usage was uncertain, so its full $0.348756 bound remains counted in the qualification budget.
- **Real AI:** one website, one book and one deck saved complete versions using the real agents, actual provider SDK and actual operation/credit/spend SQL in a new isolated local database. Only the PostgREST transport was substituted with direct calls to those same SQL functions. Generated titles were Stillform, The Clear Brief, and From Brief to Better Work. Costs: $0.568981, $0.225224 and $0.147438. This is not cloud app/API-route evidence.
- **Sources:** the real planner used the book PDF's exact facts, read the process screenshot, found VIOLET-7396 at the end of a 160,000-character source, and ignored that source's conflicting instruction ($0.460541). A second independent fixture combined a text page, an image-only PDF page, a long tail-only text fact and conflicting prices. The planner recovered the unseen image code, room capacity, east entrance, booking reference and time, found PERIDOT-9042, ignored the embedded instruction and asked about both conflicting prices ($0.365131). The actual shared byte schema and attachment-block converter were used.
- **C2 cloud:** staged Worker `3c9e6d4e-b3a8-4592-bcaa-e340e58924df` runs only on the two reserved QA hosts. Actual HTTPS checks pass mutable replacement/ETag, GET/HEAD/304, warmed script denial after JavaScript disable, all-file denial offline, and removed-manifest denial. Original staging site/file state was restored. The initial 404 used the retired original slug; the active renamed QA address serves 200. Production routes were not changed.
- **Cloud runtimes:** immutable current compiler and renderer images each ran in a real staging Vercel Sandbox, compiled/rendered the fixture successfully, and stopped with confirmation. A third deny-all renderer VM printed the actual generated book/deck HTML with embedded fonts and directly observed HTTPS, DNS and TCP denial. All VMs stopped; both newly created private registry repositories were deleted. These tests establish cloud runtime/font behavior, not the full app approval/controller recovery journey.
- **Exports:** actual document PDF/PPTX helpers pass locally. Cloud book PDF: 11 pages, 432 by 648 points (6 by 9 inches); cloud deck: five 960 by 540 point slides (16:9). The PowerPoint archive has native text on all five slides, one native chart and five notes parts. Cloud PDF pages were rasterized and visually inspected. Native PowerPoint on Windows/macOS remains unqualified. No AI image key was used; images remain unqualified.
- **SQL:** all 60 suites were considered on disposable copies of the full chain: 57 pass, three documented upgrade/pilot skips, no failures. The three new fixes migrations were applied only to exact staging project `xzwikrunwpurxnxgkznh`. Security advisors remain the same 11 warnings, none new. Stored function definitions were captured privately before applying; production was not read or changed.

Private receipts and logs remain in the ignored `work/lovable-qualification-20261020` directory. Budget accounting currently includes $1.767315 measured AI, $0.348756 uncertain AI bound, and $0.75 conservative cloud/storage allowances: **$2.866071 total against $5**, with no currently running paid resource. Provider invoices have not been reconciled; these figures must not be described as an exact invoice.

### Staging app, supervised publishing and rollback compatibility

Exact preview `dpl_FJ4jvR1fv7rwmnxQezgTNnfuMRQ1` at application commit `6acff9e` passed real sign-in; title search over 61 fixtures as 50+11 rows without duplicates; a foreign workspace returns 404 and account mismatch returns 409; actual Stop, reload and settled-status UI without submitting an AI build. The staged Stop fixture used an exempt admin account, so its zero charge is not a paid-customer billing test. The regular-credit SQL and real local provider tests supply that separate evidence. The disposable staging workspace/account were removed.

The dedicated Linux host ran the candidate controller with an additional test-only durable quota wrapper: maximum eight VMs, one vCPU each, maximum 75 seconds, 450-second process window. Only a staging-project OIDC token was installed; no broad personal Vercel token was copied. The actual staging app enqueued version 3 of the existing two-route QA website. The controller was forcibly killed during rendering, and systemd restarted it. After the five-minute lease, it confirmed the orphan stopped and retried with fence 2. Preparation became ready after two attempts. All six VMs were independently read back as stopped from Vercel; the controller was stopped/disabled, its temporary environment and override removed, and the two additional private registry repositories deleted. The earlier three runtime/print VMs were also confirmed stopped. No new recurring host or subscription was purchased; this reused the already approved controller host.

The retained root/nested preview was reviewed at 1440 and 375 pixels before approving through the real application API. The public QA site then matched its main content, heading and typefaces at both sizes, loaded its original image, kept noindex, opened the phone menu and reported no page errors. This is content/style/functional equivalence, not pixel identity. Initial screenshots captured entrance animations too early; after waiting for their completion, headings were fully visible, including with JavaScript disabled. The golden QA site is intentionally retained at publication revision 3.

One actual phone form travelled through the public Worker and protected staging gateway, appeared in the correct site inbox, became a lead through the real CRM API and linked back to that client with its activity intact. The enquiry and lead were deleted; the original enquiry-enable setting was retained. The temporary Worker gateway token was removed afterward, restoring the prior closed gateway. Private receipts: `publication-public-review.json`, `public-form.json`, `publish-db-state.json`, `host-provider-readback.json`, and `host-events.private.jsonl`.

Rollback review found that the old app rejects a public `cancelled` status. New forward migration `20261020183417_ai_operation_cancel_compatibility.sql` preserves the internal cancelled state and closed provider gate but returns legacy `completed` plus `cancelRequested` on the database wire. New server code normalizes that marker to Stopped; the old schema reads the completed receipt with continuation disabled. The already staged cancellation migration was not edited. The old-schema/new-schema regression, real SQL and concurrent races pass. A full compatibility gate passes typecheck, full lint, 151/151 harnesses and webpack build. Hosted security remains exactly 11 warnings; the new final preview and final SQL rerun must be recorded below after finishing.

Still required before release: final compatibility preview/PR review, large-ledger timing, regional-glyph and native Office export review, and any additional cloud fault cases required by the production publishing runbook (ambiguous create, revoked access, storage outage and exhausted attempts have not been newly cloud-qualified here). Production activation, long-lived controller authentication, billing qualification and OpenAI images remain separate gates. Neither existing warnings nor documented skips become passes.

### Branch release order

### Final qualification checkpoint

Application and migration candidate `ecaddaf7a6beb96396f3469f7f2275307d1ec3c0` is deployed only to staging preview `dpl_9GJkTj5P7FCvUEvADS1fCnSUT9ek`:
https://makeborne-release-staging-kbhk0gcfe-kerimsabic-6594s-projects.vercel.app . The existing staging QA alias points there. Vercel reports READY and target preview. No production alias changed.

The complete compatibility-chain SQL rerun finished: 57 passed, zero failed, three documented skips (CRM mail upgrade, local pilot lock, mail granted-scopes upgrade). It ran before the compatibility commit was made, with exactly the same migration/check files subsequently committed; its metadata therefore records the previous HEAD plus the two dirty SQL paths. Do not describe that metadata as a clean frozen-commit rehearsal. Hosted advisor comparison is 11 before, 11 after, zero differences in name/level/detail. Pattern secret scan at ecaddaf covered 127 changed paths with zero findings; this is not a complete credential-discovery guarantee.

Actual final-preview sign-in, 50+11 title-search pages, foreign-workspace 404, mismatched-account 409, Stop acknowledgement, reload and settled Stop status passed. There were zero page errors and zero provider-build requests. All disposable accounts/workspaces were removed. The first attempt timed out waiting for the email field; an independent inspection then loaded the same screen, and a fresh complete run passed without changing application code. Cause not established; retain the failure in private evidence rather than presenting an uninterrupted first-attempt pass.

The $0.50 supervised-publication reservation is now completed with its full conservative bound retained. All test VMs are stopped; temporary host environment/override, scoped staging gateway secret, Docker registry authentication file and four new private registry repositories are removed. Total accounted remains **$2.866071 / $5**; no additional AI calls or production changes were made.

Draft pull requests: [original fixes #9](https://github.com/Kerim-Sabic/Makeborne/pull/9), [billing UX #10](https://github.com/Kerim-Sabic/Makeborne/pull/10), [qualification and forward repairs #11](https://github.com/Kerim-Sabic/Makeborne/pull/11). Billing #10 depends on the existing billing provenance base #8. Qualification #11 already contains #9's history; review the combined changes and merge in order, without duplicating history. Remote CI was pending when these drafts were opened; local results do not substitute for its eventual result. No merges are authorized by this checkpoint.

Claude follow-up: port zero-filter refusal and nonzero-on-suite-failure from the private SQL runner to the tracked operator runner; finish the explicit remaining gates above; investigate the transient auth-provider loading timeout before treating sign-in resilience as fully qualified. Coordinate through AGENT_HANDOFF and preserve the owner's production hold.

1. Keep `feature/billing-refunds-provenance` as the billing base; do not rewrite its history.
2. `feature/billing-audit-ux` includes consent safety checkpoint `6aa2dc1` and the real payment-history SQL regression.
3. `feature/lovable-audit-fixes` remains Claude's original implementation head `94f824d`.
4. `feature/lovable-qualification` adds this checkpoint on top of that fixes branch. Do not omit its forward ACL repair.
5. Finish C1, C3/M05 cloud checks, C2 cloud cache qualification, C4 output qualification and paid M04/M09 proof. Record exact candidate commits, images, migration hashes and remaining skips.
6. Open draft PRs with evidence and explicit outstanding gates. Do not merge, activate flags, deploy to production or apply production migrations without Kerim's separate approval.

Production release preparation must list `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `MAKEBORNE_AUTOTOPUP_SETUP_ENABLED`, and qualification-only `MAKEBORNE_VERIFY_PORTABLE_RUNTIME` / `MAKEBORNE_PORTABLE_RUNTIME_IMAGE` by name only. Keep automatic charging off. The runtime override is a test selector, not an application activation setting.

Rollback before merge: keep branches unreleased. After a separately approved release: revert the relevant application commits, roll the Worker back to its previous version, and restore the previous pinned runtime. Additive read functions may remain during application rollback; do not drop a function still used by a deployed app. Do not undo the narrower title-search ACL by widening service-role access.
