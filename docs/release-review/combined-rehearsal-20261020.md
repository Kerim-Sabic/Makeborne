# Combined application rehearsal — 20 October 2026

**Later follow-up:** the extra golden-site editor check found and fixed a preview/publication font/artwork mismatch. See [the current parity qualification and remaining gates](combined-preview-parity-20261020.md). The identities and results below remain the original rehearsal checkpoint.

## Decision

The combined candidate passes the staging journeys described below. **It is not yet cleared for the full paid launch.** Actual forthcoming Whop renewal delivery, live billing activation, production publishing authentication, AI images and native Office review remain separate gates. Production is unchanged; do not merge or activate from this report alone.

## Frozen identity

- Application/SQL commit: `abb1d08193c19d43b41f1c154bd3e4622f4a6f06`.
- Branch: `release/combined-rehearsal-20261020`.
- Inputs: qualification `6b7826968f667fd5095c587c5af31978426be01b` and billing `9e86be5fe73c0d29e5aa289b98d4cff7d48ecaf1`.
- Production/main observed unchanged: `d14bf303165806ab2544299c3e1b63f923a5c9ea`.
- Staging database: `xzwikrunwpurxnxgkznh`.
- Staging preview: https://makeborne-release-staging-l16vg9g37-kerimsabic-6594s-projects.vercel.app . Deployment `dpl_2fwGUp9DiXAyAa5yMFRhs2rXvEeo` is READY; only the staging QA alias changed.
- Inventory: 1,802 tracked files, 101 migrations, 63 environment names (names only). Private inventory records raw migration SHA-256 and Git blobs. Later report-only commits do not change this tested application identity.

## Gates and evidence levels

| Check | Result |
| --- | --- |
| Typecheck, full lint, webpack production build | Pass |
| Offline harnesses | 155/155 pass; opt-in/environment exclusions remain exclusions |
| Full combined database chain | 62/65 suites pass, zero failures, three explicit skips |
| Normal migration replay, injected failure/retry, terminated open transaction/retry | Same schema fingerprint in all three runs |
| Mounted Stop, top-up consent, attachment readiness/flow, publication recovery | 5 / 9 / 9 / 13 / 6 scenarios pass; API doubles are not provider evidence |
| Staging migration preflight and application | Only three pending billing migrations; existing settings unchanged |
| Staging security advisors | 11 warnings before and after; identical results, none new |
| Combined real staged app/API journey | Pass, zero browser page errors, zero provider-build submissions |
| Actual staged HTTP/SSE AI edit and settlement | Pass; one real provider call, saved revision 2, unrelated slides preserved |
| Real cloud compiler/controller/renderers and actual publish API | Pass; one compiler and two renderer sessions |
| Public QA website versus approved preview | Both routes at 1,440px and 375px; content/headings/fonts agree; no overflow, failed images or page errors |
| Phone enquiry → gateway → correct inbox → CRM lead/activity | Pass; disposable enquiry and client deleted |
| Exact combined webhook route + live sandbox reads + real isolated SQL | Pass for locally signed replays; not a new provider-signed delivery |
| Reconciliation job + real isolated SQL | Pass with mocked Whop; not a real renewal charge |

Database skips: `check-crm-mail-upgrade.sql`, `check-local-pilot-lock.sql`, `check-mail-granted-scopes-upgrade.sql`. Upgrade-specific fixtures and pilot-only settings are not supplied by this generic chain. They are not reported as passes.

Migration recovery fingerprint: `9487c5177a9d890ad93cbf55c3d7a3044c7fbea2a9dc0214b19c3a41c0cd1cde`. This compares reviewed functions/ACLs, columns, indexes, constraints, policies and billing settings; it is not a production restore drill.

## What the staged app actually did

1. A fresh disposable account signed in through the real staging login. It was confirmed administratively and admin-exempt; this does **not** prove verification-email delivery or a paying customer's purchase.
2. Real search returned 50 + 11 matching projects without duplicates. Foreign workspace access returned 404; mismatched account returned 409.
3. The real UI acknowledged Stop, preserved it after reload, and observed actual SQL settlement with no new generation submission. Synthetic operation state was used; previous separate real-provider Stop evidence remains distinct.
4. Website, book and presentation projects were created through the real app API from previously qualified real-AI content. Repeating the same request replayed the original result. Revision saves/replays succeeded and a stale write returned 409. This run did not pay to regenerate three products.
5. All three loaded in the 375px studio. The actual Vercel export routes downloaded an 11-page 432×648pt ebook PDF, a five-page 960×540pt deck PDF, and a PPTX with editable text on every slide, one native chart and five speaker-note parts.
6. A separate anonymous browser opened a review, commented and approved. Only that project's delivery stage moved to Delivered; client sales history stayed unchanged. Revocation produced the actual closed-link page.
7. The billing page loaded on phone. No checkout or automatic charge was submitted.
8. The actual supervised Linux controller built both website routes from this candidate, retained their preview and promoted the approved preparation through the real app API. The public QA site advanced from revision 3 to 4. Mobile menus and entrance animations worked.
9. A public phone form reached the correct staging site inbox and converted to the correct CRM client with its original activity. Temporary form-gateway access was removed after the test.
10. After the no-generation journey, one separately reserved real staged AI edit changed only slide 1’s requested heading and preserved the other four slides exactly. The actual HTTP/SSE route saved revision 2 and recorded one settled provider call ($0.096806; zero uncertain usage/overrun). The admin fixture was credit-exempt, not a customer-payment test. Staging global/Anthropic limits were temporarily bounded by the existing day spend plus $0.61 and restored exactly afterward; actual day spend was retained. The disposable user/workspace were removed. Published [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) was checked before the call; the configured model’s card still matched.

PDF pages were rendered and visually inspected. There is no observed clipping in these samples. The book is intentionally sparse in places, including a quote-only page; this sample and the deck do not establish image-generation quality, all fonts/languages or all business designs. Native PowerPoint/Keynote behavior remains unqualified.

## Findings and corrections

- Windows checkout converted two qualified LF migration files to CRLF. Strict staging checksum verification refused the mismatch before any change. Verified identical normalized SQL, restored exact qualified bytes and pinned all seven new files to their qualified formats. Existing staged SQL/history was not rewritten.
- Mounted publication recovery expected an exact message although the UI now appends its read-only reconciliation confirmation. Updated the test to assert both messages, preserved live address and exactly one POST. No runtime change.
- Combined browser test attempt 1 waited for network idle on a polling studio page. Changed it to wait for the actual saved-version UI. Attempt 2 requested a nonexistent review JSON endpoint after successfully revoking the link. Corrected the assertion to visit the actual closed-link page. Final complete run passed unchanged application code. These were test failures, not silently discarded successful runs.
- A private billing runner redirected output to the same file it writes, causing Windows EBUSY. Separate execution and evidence logs fixed the harness; the real job/SQL rerun passes.

## Whop: what is still outstanding

Read-only sandbox scan: eight memberships, ten payments, no new renewal yet. Local-signature route tests at this exact combined candidate prove bad-signature refusal before provider reads, missing-binding refusal, delayed-binding retry, duplicate receipt idempotency and no allowance from a refunded subscription. A historical direct-provider failed-cycle probe has no app checkout binding and correctly remains refused; do not invent one.

The weekly sandbox probe's next renewal is due **21 October 2026, 00:08:59 UTC**. A one-time follow-up is scheduled for 01:50 Europe/Warsaw (23:50 UTC on 20 October), before the renewal, to prepare access and the isolated receiver before observing the cycle. It must inspect actual provider evidence and distinguish provider-signed dispatch from local replay. Existing sandbox key expires at 00:00 UTC and needs a same-scope refresh. A fresh provider read also confirms that this active weekly probe has no app checkout reference, just like the failed-cycle probe. Its renewal cannot prove monthly/yearly catalogue eligibility or account-bound credit delivery. No new purchases, refunds or real charges were made here.

## Spending and cleanup

Same owner-authorized **$5 total**, never reset: conservative accounted/reserved **$3.812877**. This includes $1.864121 measured AI, $0.348756 uncertain stopped-call bound, and $1.60 cloud/function bounds retained. Remaining conservative room: **$1.187123**. The one new real cloud edit cost $0.096806; no other new paid AI calls were made in this combined rehearsal. These are conservative ledger bounds, not a provider invoice.

All three new cloud VMs were independently read back as stopped, with exactly one session each. Staging controller stopped/disabled; production controller remains inactive. Temporary host environment/override and temporary staging gateway token removed. Both new private registry repositories and temporary Docker authentication removed. Disposable app accounts/workspaces, review data, form enquiry and converted client are removed. Staging billing flags match their before snapshot. Public QA revision 4 is intentionally retained.

## Release path and rollback

1. Finish actual provider-signed, account-bound payment lifecycle/renewal evidence and review combined remote checks. Keep plan switching/contact-us behavior and automatic charging unchanged.
2. Resolve OpenAI image key/qualification, native Office checks, production controller credentials/runtime and any desired production email/OAuth validation. Newly confirmed test accounts do not substitute for public signup delivery.
3. Prepare an exact production migration list against a fresh read-only baseline, backup/restore path, flag/env differences, bounded provider limits and operator monitoring. Existing production approval is still held for this task.
4. Ask Kerim for the concrete production go. Until then: no main merge/push, production deployment, production migration/settings/DNS/Worker changes or checkout activation.

Before release rollback means leaving the branch unreleased. A staging alias rollback to the previous qualified preview and recovery to the combined preview was actually exercised: both app versions read the migrated database and retained public revision 4. This is a read/recovery check, not a full old-app mutation rehearsal. Staging recovery can restore its previous Worker; do not widen access or rewrite staged migration history. A later separately approved production release uses a normal revert and prior Worker/runtime, with additive schema retained unless a reviewed recovery requires otherwise.

Private evidence is under ignored `work/lovable-qualification-20261020`: frozen inventory, exact migration application, final gates, SQL suite results, recovery fingerprint, before/after advisors, staged app screenshots/exports, independent sandbox readback, public preview comparison, form receipt/cleanup audit and budget ledger. Never commit the credentials, review tokens, inbox addresses or raw private receipts. Shared coordination is recorded in `docs/AGENT_HANDOFF.md`; Claude acknowledgement is not assumed.
