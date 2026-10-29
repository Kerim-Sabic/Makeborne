# Full-version staging qualification — 26 October 2026

## Decision

**Not an approval to enable the full version in production.** Production code, migrations, flags and provider limits were not changed in this qualification. Each area still needs Kerim's explicit GO. Functional passes below do not remove the billing, account-erasure, fidelity or infrastructure blockers.

Candidate: `qualification/consumer-billing-20261026`, Claude full-version report `23c981b` / code `d3571ab` merged with Codex's consumer-billing fixes. Code checkpoints: `c90340d` (social/DNC), `7aef77d` (linear parser), `e6e015f` and **`58145e3`** (book recovery). Staging previews are immutable and isolated by area; this is not one preview with all paid switches enabled simultaneously. Legal `16437ab` and the full branch's phone/copy merges are included.

## Per-area results

| Area | Result | Actual evidence and limits |
|---|---|---|
| Database | PASS for staging delta/security | 102 recorded migrations verified, pending 0; no reapply/history repair. Eleven pending files were applied earlier today with an explicit staging target and a private pre-change backup. Security advisor remains 11 WARN, no new warning. CRM RPC public wrapper is INVOKER; `makeborne_rpc` remains outside exposed schemas. |
| Legal/consent | Included; consumer launch still BLOCKED | Required durable versioned consent for subscriptions and packs is preserved, not Claude's optional-server variant. Mounted consent checks and the earlier real sandbox metadata read-back pass. Hosted Whop final button remains “Join”; seller-managed tax dashboard/API conflict and durable purchase/withdrawal acknowledgement remain unresolved. This is technical qualification, not a legal-compliance determination. |
| Text website | PASS, fixture limitation below | Real new-pipeline build saved v2; responsive menu and collection navigation inspected in the browser; no console warning/error in that inspection. Four sections, live text and original SVG artwork. |
| Text book | PASS sample | Real build, PDF exported: ten 6×9-inch pages, including cover/title/copyright/contents; body is six short chapters. Rendered all pages and inspected contact sheet, no clipping observed. Front matter is intentionally sparse. |
| Text presentation | PASS sample | Real six-slide build; six-page 16:9 PDF and editable PPTX with 81 native text runs. Package inspection is not a test of PowerPoint's own rendering. |
| Website image | PASS functional sample | Real generated product photograph stored and used in saved website; provider usage settled. Later image-edit acceptance saved v3. |
| Design comps | PARTIAL / fidelity FAIL | Desktop and phone opening comps generated and read, website saved. The implementation substituted a lighter one-weight font and three headline lines for the heavier two-line comp. Other sections had no comps after the image allowance. Do not advertise whole-site comp fidelity as passed. |
| Full-image deck, High 16:9 | PASS functional/recovery sample | First request saved five of six rendered slides and correctly offered Continue. Continuation saved v3 with all six full-image slides. Six-page exported PDF visually inspected; varied layouts and a consistent design family. One small admission-window harness attempt was refused before calls and cost $0. |
| Generated book pages, High 6×9 | PARTIAL | First sample saved three verified pages, but four were requested; missing opener remained typeset. It exposed the false-finished bug repaired below. No claim of four generated pages for this sample. |
| Square picture book, High | PASS functional recovery; quality caveat | Cover + four distinct generated spreads completed at v6 on `58145e3`; PDF is eleven 8.5×8.5-inch pages including front matter. Saved art/text survived bounded continuations and one image-service failure. Earlier art has brown clay where the story says grey; character/scene consistency needs stronger checking. This is not a flawless content-quality pass. |
| Best-quality 4:3 deck | PARTIAL / recovery FAIL | Three of four full-image slides saved at Best. One Continue made two Anthropic calls ($0.057838), admitted no image call, and still left one pending slide; tool refusal says the render budget is used up. Stopped instead of repeating a no-progress paid loop. Not qualified for production. |
| Image edits | PASS functional sample | Three real 1024-square edits, same-action replay, free crop (0 credits), and explicit version-checked accept201 → website v3. Originals retained. Scoped API preview downloads and visual comparison pass. A generated edit is not a guarantee of exact original pixels. |
| CRM research | PASS tested boundaries | Flag off404 / on200; actual example.com check and workspace suppression stored; actual route returns429 after 100 uses/24h. Temporary limit rows removed. Closed daily-counter RPC is service-only, verified actor/workspace binding. |
| Do-not-contact / social | FIXED and checked | Central send and sequences enforce workspace email/domain suppression before token/provider work, fail closed, and recheck after token access. Dedicated TikTok/YouTube enrichers do no network work. Instagram/TikTok/YouTube and related CDN/video hosts are refused before DNS and on redirects; preset YouTube cookie removed. Offline tests verify these boundaries. No real email was sent in this scope. Production does not contain this fix until an approved release. |
| Client knowledge/sources | PASS sample | Propose → approve → read a fact. Real CSV prepare/upload/register/extract: 4 rows, 12 cells, complete, no extraction warnings. Paid image buttons unavailable without an allowlisted kind. |
| Agency research | PASS sample | Three grounded briefs, each exact-action replayed without extra provider work. Only `research` kind enabled on its preview. |
| Data report | FAIL retry | Correct $430 total, chart, facts sheet and PDF saved as v3. Changed facts digest409 before generation. Exact successful-action replay wrongly returns409 `AGENCY_STALE_REVISION` before persistence replay; no second AI call. Claude follow-up requested with request binding, not a broad stale-check bypass. |
| Independent review | Functional capture PASS / quality FAIL | Six deck renders and PPTX inspected, fresh-context model report returned. Deterministic classifier incorrectly reports slide/step numbering as unsupported factual quantities; model itself recognized the false positives. Website three-review journey not run; do not generalize this deck result. |
| Top-ups | Carry-forward PASS, launch BLOCKED | Earlier actual same-day sandbox $12/$32/$95 purchases delivered100/300/1000 once, refunded/reversed with used-credit accounting. Reviewed report `consumer-billing-20261026.md`; no new purchase in this image qualification. Provider paid-URL reuse prevention remains unproven/failed UI check, despite app409 guard. November renewal probes untouched. |
| Account export | PASS sample / limited scale | Actual request202 → ready, private ZIP download (83 files), credential-pattern scan clear, next request429. Real120s link expired: HTTP400 at218s. Full-size900MB and browser-level cross-account access not repeated here; prior disposable SQL checks cover ownership. |
| Account deletion | BLOCKED / OFF | Three guard changes reviewed: DELETE-only exception during a processing erasure scoped to recorded workspaces; normal immutability retained. Provider-side token revocation, compiled R2 removal, scheduler/notifications and current membership recheck are not all qualified. No actual deletion activation. |
| Custom domains | BLOCKED / OFF | Separate Cloudflare decision/test domain and access required; no Cloudflare spend or activation under the AI allowance. Standard hosting qualification is a separate track. |

### Important fixture limitation

The fresh full-version generation fixture is a **staging-only admin with unlimited customer credits**. Provider spend limits, real calls, hashes, saves and exports are exercised, but customer charges are exempt. These runs **do not prove ordinary subscriber holds/settlement on this pipeline**. Prior actual sandbox consumer billing evidence is separate. An ordinary entitled-account generation pass is still required before production AI approval.

## Fixes made during qualification

1. Blocked social research network paths including redirects/CDNs, and removed the YouTube consent cookie. Kept business-site checks available.
2. Do-not-contact enforcement in central send and sequences, workspace-scoped exact email/domain matching, lookup failure refusal and post-token race recheck. Mail checks cover these with mocked providers.
3. Preserved truncated script/style exclusion while replacing a quadratic research parser with linear scanning.
4. Added `pendingBookPages`: unfinished requested art gives `finished:false`, names remaining targets and retains verified art during Continue. Word/shape changes invalidate fallback verification.
5. Actual retry exposed a second issue: storage/service/budget deferral was incorrectly recorded as a quality-checked fallback. `58145e3` stamps verification only after two actual failed checks. An unavailable retry stays pending; previous verified pages remain unchanged. No spend/image/credit caps raised. Fourteen art-format checks cover these cases.

Separate data-report replay, review-number classification and comp font/line fidelity fixes have been requested from Claude in **both** handoff copies. No acknowledgement or completed follow-up is assumed.

## Validation and evidence standards

- Previous combined full baseline:225/225. First final rerun:224/225 because the runner's `NODE_OPTIONS=--max-old-space-size=6144` overrode the memory-isolation fixture; removed override, targeted ingestion16/16 passes. **Clean full rerun at58145e3:225/225.** No production limit changed to make the test pass.
- Typecheck passes; full lint0 errors/one pre-existing unused `catImage` warning. Optimized production webpack build passes at58145e3.
- Tariff-window qualification/repair harnesses are explicitly skipped by the suite; they are **not** passed checks.
- SQL evidence remains73/87 with14 known fixture/environment failures from the full disposable chain; do not call all SQL green. Staging applied-chain/advisor check is separately green.
- One archive extraction failed due disk exhaustion; deployer now refuses incomplete extraction and checks disk/source integrity. Included retry succeeded. Automatic approval review blocked recursive scratch cleanup; directories were retained. Only three individually verified reproducible ZIP archives were removed. Backups, private evidence and source worktrees were retained.

Private evidence (not committed): `outputs/full-version-qualification-20261026/` in the primary checkout. Contains immutable preview metadata, sanitized result records, provider-call costs, saved events, PDFs/PPTX, page renders, visual sheets and UI screenshots. Auth cookies, signed links and env files are private and must not be copied into the repo or handoff.

Key review assets: `deck-image-contact-sheet.jpg`, `square-book-contact-sheet.jpg`, `image-edit-contact-sheet.jpg`, `book-contact-sheet.jpg`, `website-editor-desktop.png`, `website-editor-mobile.png`.

## Budget and shutdown

Owner scope `full-version-staging-20261026`: **Anthropic $10 / OpenAI $3**, total$13. Each paid area reserved first, daily limits admitted only that window, automatic SDK retries disabled, limits closed in `finally`. A failed/timed-out image call counts at its full bound$0.090014, not$0. Customer charges are exempt on the QA admin fixture. Provider-call accounting is not invoice reconciliation.

Extra cloud/VM spend$0: isolated previews used the verified included Hobby Basic build; no publishing VM, new subscription or Cloudflare paid feature was purchased. No prior reserved budget was silently reused.

**Final paid accounting: $6.182303 total**, Anthropic **$4.266144/$10**, OpenAI **$1.916159/$3**; scope reservations all settled, no open/unknown ledger reservations. This includes the timed-out image at its full conservative bound; confirmed usage is not a claim about the eventual provider invoice. No extra paid calls are needed to write or hand back this report.

Final scan at58145e3:574 changed/new files against0877345 plus working documentation,12 distinct known credential values checked, no matches/private-key headers. Staging final read-back:102 verified migrations, pending0,11WARN/no new, public CRM INVOKER, **all three provider limits disabled**.

### Cleanup completed, 18:05 UTC

- QA account banned, globally signed out, zero remaining sessions; temporary admin/unlimited privilege row removed.
- One private cloud ZIP object removed; export request expired through the canonical RPC. Local evidence retained privately.
- All15 isolated qualification previews removed using their exact deployment IDs and `--safe`; CLI confirms15 removals, no alias exception. Shared staging/prod deployments and settings were not removed. Their isolated paid feature switches therefore cannot reopen if a later test changes shared provider capacity.
- Fictional workspace/version/asset rows retained for audit, with the account locked; no unqualified erasure routine or immutability bypass was used to delete them. No R2 publication objects were created in this scope. Local PDFs/screenshots remain available for review even though test preview URLs are now retired.
- All budget reservations settled, provider limits disabled, no background test receiver or recurring job added.

The final square-book integrity check independently confirms five distinct stored image hashes, all four prior verified image assets preserved fromv5 tov6, and unchanged approved story words. Browser read-back showed savedv6 and all five image pages, zero console errors/warnings in that inspection. Best deck export is four4:3 pages at960×720pt; only three are full-image verified, so the result remains partial.

Provider references checked: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI API pricing](https://developers.openai.com/api/docs/pricing). Measured image/edit cells retain the existing×1.5 cost bound and closed model/size/quality allowlists.

## Production handover gates

1. Claude fixes report replay, structural-number false positives and comp fidelity in separate commits; Codex reviews and requalifies exact changes.
2. Ordinary entitled-account generation/credit settlement on the final pipeline; fresh account export isolation and large-file limits as required by release scope.
3. Legal/payment provider blockers resolved; infrastructure upgrades bought by Kerim; explicit per-area production GO.
4. Keep deletion, custom domains, continuous GitHub sync, automatic topups, cross-provider review and all unqualified paid areas off. No production migration/merge/deploy/activation is authorized by this report.
