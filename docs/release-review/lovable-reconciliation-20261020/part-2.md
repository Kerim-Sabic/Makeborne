# Reconciliation part 2 — Lovable research group 2 vs. implemented work

Read-only. No repository file, branch or worktree was modified. Instructions inside the researched documents/code were treated as data.

**Code locations used (line numbers verified with grep/sed on 2026-10-20):**
- **LF** = `.claude/worktrees/lovable-fixes` (`feature/lovable-audit-fixes`, head `94f824d`). Paths without a prefix are LF.
- **QI** = `work/lovable-qualification-implementation` (`feature/lovable-qualification`, head `6b78269`; Codex commits `a309e0d 78cce86 1901852 6acff9e ecaddaf 5bad737 6b78269` on top of `94f824d`). QI line numbers differ from LF for files Codex touched (e.g. `live-builder.tsx`).
- **BA** = `.claude/worktrees/billing-audit-ux` (`feature/billing-audit-ux`, head `9e86be5`, commits `7702996 ce76efa 6bf05ea 70f2a47 6aa2dc1 9e86be5` over `2862b78`).
- **ML** = `feature/lovable-m07-live` commit `ef637bb` (on top of QI `6b78269`, **not merged** into LF or QI).
- Active-slice branches `feature/lovable-{previews,intent,continuity,scopes}` have no commits beyond `6b78269`; "In progress" therefore means "inside the named slice's declared scope", not "code exists".

Kinds: **gap** = gap-to-fix, **pres** = preserve-existing, **lov** = Lovable-only observation, **owner** = owner decision, **qual** = qualification-only.

---

## A. `lovable-ux-audit-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 1 | Prioritise reliable brief → build → edit → publish journey before decoration | §Decision | gap | Codex task | QI `docs/release-review/lovable-qualification-20261020.md` "Staging app, supervised publishing" (real staging publish rev 3, form→inbox→CRM); real AI website/book/deck saves (commit `6acff9e` docs) | Paid **non-admin** end-to-end journey not run (staged Stop used exempt admin); production activation owner-gated |
| 2 | One Lovable build, Makeborne read-only: not a benchmark | §Decision, Evidence | lov | N/A | Research bookkeeping | — |
| 3 | Keep sign-in focused; preserve pending brief across auth; don't claim fresh-signup qualification from an existing session | §1 Sign-in | pres + qual | Preserved | `studio.tsx:260-297` (creation draft claim via `claimCreationDraft`, restores brief/mode/effort/files/style); `studio.tsx:1285` "Your draft is preserved"; F09 `f669393` | Fresh signup/email-verification/recovery not qualified; Codex flagged a transient auth-provider loading timeout as an open Claude follow-up (QI qualification doc, final checkpoint) |
| 4 | Distinguish New from Projects; returning users resume work, compact create | §1 Dashboard | gap | Fixed | `d88381a`: `studio.tsx:559-561,811,837`; `lib/projects/library-state.ts:63` | Gradient-only-around-creation not verified |
| 5 | Real artifact thumbnails + meaningful names = highest-value UX | §1 Project index | gap | In progress (M06) / names Fixed | Names: `5efe9c8` `lib/projects/project-title.ts:62-89`; cards still icon-only `account-projects.tsx:169-170` | Thumbnails = M06 |
| 6 | Don't imply all projects searched; add authorised server search with pagination | §1 Search | gap | Fixed | `853fac1`+`a148f84`: migration `20261020120000_artifact_title_search.sql:22,58-59`; scope note `account-projects.tsx:172`; QI ACL repair `1901852` `20261020144714_artifact_title_search_acl.sql` | Title-only (disclosed) |
| 7 | Active account/workspace and save destination identifiable without DB vocabulary | §1 Workspace identity | gap | NOT COVERED | Partial: "SAVED TO YOUR ACCOUNT" eyebrow `account-projects.tsx:149`; workspace picker only when >1 `:152` | Editor header shows no workspace/save destination; leave-dialog says "unsaved cloud draft" `cloud-studio.tsx:1577` |
| 8 | Don't copy every dashboard tool | §1 | lov | N/A | Guidance | — |
| 9 | Create acceptance: brief → saved project → editor with build running; paused/auth/billing explained; resume once; refresh/back/retry no duplicate project/charge | §2 Acceptance | gap | In progress (M08 "no duplicate charge") | Preserved basis: request id `studio.tsx:188,292`; consent guard `:177`; LoadingFrame states `:1284-1285` | No paid resume-once / no-duplicate qualification yet |
| 10 | Lovable's last fixes unverified → bind Makeborne validation to final source/hash | §2 weak | gap | Fixed | `fc1ce75` `lib/hosting/checked-version.ts:9-22`; consent bound to reviewed version `trusted-website-publish.tsx:168` | — |
| 11 | Generic "Required" form errors; green security summary; demo ≠ delivery | §2 weak | lov | N/A | Lovable observations (security language handled in #35) | — |
| 12 | Preview primary; one stable toolbar; phone one active view with way back to chat | §3 Main canvas | pres | Preserved | `cloud-studio.tsx:1613-1615` (Preview/Edit/History, title labels); responsive doc measured preview-first phone editor | Soft-keyboard/safe-area not qualified (#160) |
| 13 | Consistent Preview/Edit/Code/History; a book must not inherit website labels | §3 Views | gap | Fixed | F01 `9e1bb5d`: `cloud-studio.tsx:1614` `editor.label`; `lib/cloud/saved-preview.ts:1-20` formats | — |
| 14 | Every route reachable/identifiable; preserve route across viewport/mode switches | §3 Navigation | gap | In progress (M10) | Only the publish review has a page picker `trusted-website-publish.tsx:168`; editor preview has none | — |
| 15 | Element targeting: human text + page + stable locator; clear stale selection after version change | §3 Element targeting | gap | In progress (M08 exact edit target) | Base `live-preview.tsx:27,77,170` | — |
| 16 | Distinguish free direct edits vs paid AI; undo, save state, keyboard | §3 Direct edits | gap | In progress (M08 pending state/Undo) | `live-preview.tsx:170` undo exists | — |
| 17 | Legacy outline/static artifacts say exactly what they are | §3 Code | gap | Fixed | F01 `9e1bb5d` `lib/cloud/saved-preview.ts:1-20` | Real-app: no fixture renders the outline notice (report F01) |
| 18 | History: useful titles, visible current/live version, compare, restore as auditable new version, confirm unsaved first | §3 History | gap/pres | Fixed (live/current) + Preserved | ML `ef637bb` `cloud-studio.tsx` "Live"/"Current" badges, `use-live-version.ts`; LF `cloud-studio.tsx:1871` Compare, `:1877-1882` restore-as-new + dirty guard | ef637bb unmerged; "useful version titles" unchanged (changeSummary) |
| 19 | Create/Plan simple; advice must not masquerade as build; no mandatory wizard | §3 Modes | pres | Preserved | `studio.tsx:1334` (wizard step fixed at 1); optional questions `brief-questions-card.tsx:76` | — |
| 20 | Pin compact receipt: saved version, measured credits, validation, next action | §3 Completion | pres | Preserved | `live-builder.tsx:41-55` Receipt (Charged/Result version/checks) | — |
| 21 | Settings says "only on this device, does not sync" and also "new projects save to account" — launch trust issue | §4 | gap | NOT COVERED | Unchanged copy `studio.tsx:1004-1010` vs `:1080-1087` | Customer still reconciles the two |
| 22 | Settings IA: Account / Workspace / Project / Recovery | §4 | gap | NOT COVERED | Settings tab is one list `studio.tsx:991-1090` | — |
| 23 | Preserve recovery tools; no silent migration/erase of local content | §4 | pres | Preserved | `studio.tsx:1012-1057` (Download/Restore backup), `:1084` explicit import | — |
| 24 | Integration state actionable (Not connected / Connected / Needs reconnection / Setup unavailable) with one source of truth | §4 | gap | Fixed (mail) / Preserved (GitHub, domains) | Mail `de8fca0`,`fd62fae` `lib/mail/connected-message.ts`; GitHub `website-github.tsx:22`; domains `lib/hosting/custom-domains.ts:154` | No shared cross-integration state model |
| 25 | Knowledge → customer brief/brand panel (audience, tone, approved facts, assets, constraints) | §4 | gap | NOT COVERED | Brand kits exist `brand-kits.tsx:262-276`; no project brief/approved-facts panel | — |
| 26 | Label Git direction precisely (export/push ≠ two-way sync) | §4 | pres | Preserved | `website-github.tsx:11-12` + one-way copy strings | — |
| 27 | Expose only backend capabilities that exist; enquiries as narrow path | §4 | pres | Preserved | `lib/help/comparisons.ts:21,34`; `website-enquiries.tsx` | — |
| 28 | Publish flow: draft vs live; check the published version; URL & audience; promote exact prepared output; success only when served; Unpublish discoverable | §5 | pres | Preserved | `trusted-website-publish.tsx:168` (prepared version review, version-bound consent), "Take offline"; `fc1ce75` status re-read after unknown outcome | — |
| 29 | Offer **Copy link** with Open site after publish | §5 step 5 | gap | NOT COVERED | Only "Open live website" in `trusted-website-publish.tsx` | — |
| 30 | Standard slug hosting first; custom domains honest setup state | §5 | pres/gap | Fixed | F07 `83b15f7` `custom-domains.ts:154-176`; activation = C7 | — |
| 31 | Analytics: unpublished / no visitors / collection disabled / unavailable distinct | §5, UX15 | gap | Preserved | `website-analytics.tsx:45-49` | — |
| 32 | No unqualified "safe" badge; scope/timestamp/version | §5 | gap | Fixed | `2f0fc9c` `client-ready-check.tsx:32,42` "No issues found by these checks" | Makeborne has no security scanner; rest N/A |
| 33 | SEO per-route title/description, canonical, preview image, index state, sitemap, robots | §5 | gap | Fixed (F05/F06) + In progress (M17 canonical) | `669a57d` nested index; `lib/hosting/seo.ts:88-90` sitemap | Custom-host canonical = M17 |
| 34 | SEO/analytics checks use the **public hosted output** | UX15 | gap | NOT COVERED | `website-seo.tsx:67-88` reads saved source routes | — |
| 35 | Never promise rankings | §5 | gap | Fixed | `a851e8c` `seo.ts:158,167` | — |
| 36 | Lovable price/top-up/usage-limit observations | §6 | lov | N/A | Not Makeborne pricing | — |
| 37 | Keep cost table distinguishing ceilings from measured examples | §6 | pres | Preserved | `billing-credit-costs.tsx:7-17` | — |
| 38 | Put balance/expiry, renewal, recent receipts **above** explanatory content | §6 | gap | NOT COVERED | BA `billing-workspace.tsx:58` plan catalogue renders before balance `:60`; receipts (F08) at `:68-74` | Receipts now exist (F08) but order unchanged; renewal date not verified |
| 39 | Admin "Unlimited" is owner-only view | §6 | pres | Preserved | BA `billing-workspace.tsx:57` | — |
| 40 | Payment provenance, refund policy, safe auto-top-up; no quiet opt-in; packs separate | §6 | gap | Fixed + Codex task (C3/C5) | BA `7702996` `billing-autotopup.tsx:93-121`; `6aa2dc1` revoke independent of setup flag | Charging remains off |
| 41 | UX01 real create/edit/publish with one paid-eligible staging user | §7 | qual | Codex task | See #1 | Non-admin paid user not done |
| 42 | UX02 "Saved to account" vs "This device" labels; refresh/relogin recover without import | §7 | gap | NOT COVERED | No "This device" label anywhere in `src/components`; see #21 | — |
| 43 | UX03 edit after pass invalidates; failed compile never Ready | §7 | gap | Fixed | `fc1ce75` (fingerprinted SEO/client-ready, consent cleared on save) | — |
| 44 | UX04 no functional success for demo enquiry, disabled hosting, disconnected Gmail, pending payment | §7 | gap | Fixed | `de8fca0`; BA `7702996` (uncertain POST no longer "Nothing was changed") | — |
| 45 | UX05 billing receipts + explicit purchase consent | §7 | gap | Fixed + Codex task (C3) | BA `6bf05ea`,`ce76efa` usage history; `7702996` | Real-ledger staging = C3 |
| 46 | UX06 actual project previews | §7 | gap | In progress (M06) | — | — |
| 47 | UX07a brief-derived editable title; never overwrite chosen title; last-edited time | §7 | gap | Fixed | `5efe9c8` `project-title.ts:78-89`; `project-labels.ts:15-18` | Real paid build confirmation = Codex (titles observed in QI real AI run) |
| 48 | UX07b **client** and **draft/live** status on cards | §7 | gap | NOT COVERED | Card = icon/title/kind/"Version N · saved" `account-projects.tsx:169-170` | — |
| 49 | UX08 returning-user project-first view | §7 | gap | Fixed | `d88381a` | Phone (375) first-card position not recorded in commit/report |
| 50 | UX09 same toolbar locations; no website-only action on books/decks | §7 | gap | In progress (M10 route) / Fixed (F01 labels) | `cloud-studio.tsx:1613-1615` | — |
| 51 | UX10 selection chip page+element, valid versions only, clear/undo/keyboard | §7 | gap | In progress (M08) | — | — |
| 52 | UX11 factual stages/route names; no fake percentage | §7 | pres | Preserved | `live-builder.tsx:212-218` (status/file activity) | — |
| 53 | UX12 restrained motion, reduced-motion, visible focus | §7 | pres | Preserved | 35 `prefers-reduced-motion` rules in `src/app/*.css`; generator reveal gated `lib/builder/prompt.ts:33` | Not qualified |
| 54 | UX13 live vs draft divergence visible; Git states export/push accurately | §7 | gap | Fixed (part) | ML `ef637bb`; `website-github.tsx:11-12` | Only inside History/Publish |
| 55 | UX14 project/client association: filter by client and delivery status | §7 | gap | NOT COVERED | No client filter in `account-projects.tsx` | — |
| 56 | UX16 actionable error recovery; saved partial work; no duplicate charge | §7 | pres | Preserved + Codex task (C1) | `live-builder.tsx:507,605` retained draft; QI `6acff9e` | — |
| 57 | UX17 authorised server-side search, tenant isolation, stable pagination | §7 | gap | Fixed + Codex task | `853fac1`; QI `1901852` (5,000-artifact local run, staging 50+11, foreign 404, mismatch 409) | Large-workspace cloud perf open |
| 58 | UX18 favourites, folders, compact list view | §7 P2 | gap | NOT COVERED | Optional P2 | — |
| 59 | UX19 shared brand/knowledge, project overrides, owner-approved facts | §7 P2 | gap | NOT COVERED | Brand kits only | — |
| 60 | UX20 advanced backend/Git parity not in launch | §7 P2 | lov | N/A | Explicitly out of scope | — |
| 61 | Thumbnail contract (version-keyed, authorised delivery, kind-specific crops, stale marker, deterministic fallback, lazy/aspect, generate at save, purge on revoke) | §8 | gap | In progress (M06) | — | — |
| 62 | Visual proposal (radii, spacing, durations) | §8 | lov | N/A | Explicitly non-binding | — |
| 63 | Matched same-brief comparison after Makeborne generation authorised | §9.5 | owner | NOT COVERED | Codex ran single real AI builds, not a matched comparison | — |
| 64 | Five-person test kit sessions | §9.6, deep §9 | owner | NOT COVERED | Kit-only authorisation | — |
| 65 | Preserve paid-build vs advice vs approval semantics | §10 | pres | Preserved | Plan approval route `api/build/plan/route.ts:108`; expert-chat modes `expert-chat.tsx:164` | — |
| 66 | Qualify actual GitHub behaviour; no reverse sync claim | §10 | pres/qual | Preserved | `website-github.tsx` one-way copy | GitHub push not requalified this cycle |
| 67 | Makeborne DB ≠ customer-app backend | §10 | pres | Preserved | `comparisons.ts:21,34` | — |
| 68 | Templates optional inspiration, not forced | §10 | pres | Preserved | `style-design-instructions.ts:162` | — |
| 69 | Don't claim exclusivity of books/decks/CRM | §10 | pres | Preserved | `comparisons.ts` honest gap list | — |
| 70 | Vercel team on Hobby: commercial launch needs supported plan | §10 Infra | owner | NOT COVERED | Tracked as unresolved in `docs/HOSTING.md:9`, `docs/OWNER_SETUP_CHECKLIST.md:78`; not in C1–C7 | Owner decision pending |

## B. `lovable-deep-ux-review-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 71 | Don't rebuild existing click-to-edit/undo/version compare/autosave/source edit/prepared publish | §1 | pres | Preserved | `live-preview.tsx:170`; `cloud-studio.tsx:1871-1891`; `website-source-editor.tsx:112-113`; `trusted-website-publish.tsx:168` | — |
| 72 | Keep **three independent facts** visible (persistence / quality / distribution), not one Ready badge; announce accessibly | §2 | gap | NOT COVERED (as a unified display) | Parts exist: save label `cloud-studio.tsx:1589`; `checkedLabel` `checked-version.ts:15-18`; Live badge ML `ef637bb` (History only) | Header `cloud-studio.tsx:1585-1590` shows only version + save state |
| 73 | Return to work: card = preview, name, client, edited time, live/draft; cold-user test | §3 | gap | see #46–49, #64 | — | — |
| 74 | Preserve prompt/type/style/mode/files through login/payment; send once after consent | §3 Start | pres | Preserved | `studio.tsx:177-190, 260-316` (attachmentOwner `:293`, style `:299`) | — |
| 75 | Infer and start; only consequential questions; skippable | §3 Ambiguity | pres | Preserved + Fixed (F04) | `brief-questions-card.tsx:34-40,76` | — |
| 76 | Factual stages; timeout says saved/unfinished/what Continue charges | §3 Wait | pres | Preserved | `live-builder.tsx:212-218`; `lib/builder/operation-contract.ts:37` (additionalCredits + acknowledged) | — |
| 77 | Route picker for full-source sites; preserve route/scroll; deep-link failure; book chapter / deck slide nav | §3 Find page | gap/pres | In progress (M10) + Preserved (book/deck) | Book/deck jump menu `document-preview.tsx:143-151` | — |
| 78 | Precise edit with page/section/element context; clear when stale; free vs AI | §3 Precise edit | gap | In progress (M08) | — | — |
| 79 | History: **checked-version** marker | §3 Recover | gap | NOT COVERED | Only Live/Current badges (ML `ef637bb`) | — |
| 80 | Restoring content does not refund usage or undo payments/mail/data | §3 Recover, live-exp §3 | gap | In progress (M10 Restore semantics) | Current copy only mentions live site `cloud-studio.tsx:1877,1881` | Add no-refund/no-external-undo wording |
| 81 | Small authorised command registry (project search, Preview, Code, History, Publish, client, billing, help) reusing visible actions | §3 Discover | gap (P2) | NOT COVERED | Only client palette `account-clients.tsx:222` | — |
| 82 | Receipt next to the work; estimate vs hold vs final vs absorbed vs remaining | §3 Charge | pres | Preserved | `live-builder.tsx:47` "Being confirmed"; `expert-chat.tsx:190`; BA billing Reserved metric `billing-workspace.tsx:64` | — |
| 83 | Separate Client review / Client portal / Team access / Public website; explain who can see a link | §3 Share | gap | In progress (M17) | — | — |
| 84 | Preserve prepared-output review; primary status/address/action first | §3 Publish | pres | Preserved | `trusted-website-publish.tsx:168` | — |
| 85 | Project overview: preview, kind, last edit, delivery state, live/export, latest feedback, real forms/inbox, one next action; same identity across CRM/review/source/hosting | §3 Manage, §7 | gap | NOT COVERED | Separate panels only (`website-enquiries.tsx`, `website-analytics.tsx`) | — |
| 86 | Settings scope table with guards | §4 | gap | NOT COVERED | = #22 | — |
| 87 | Human labels; no "cloud studio"/internal vocabulary for customers | §4 | gap | NOT COVERED | `app/studio/cloud/page.tsx:3` title "Cloud studio" (linked from Settings `studio.tsx:1087`); `cloud-studio.tsx:1577` "cloud draft" | — |
| 88 | Billing answers in order: plan, usable credits/expiry, last job cost, what to buy, renewal | §4 | gap | NOT COVERED | = #38 | — |
| 89 | Compact internal design brief; styles optional; no generic default | §5 | pres | Preserved | `style-design-instructions.ts:162` | "Editable as project context" not present |
| 90 | Books/decks coherence; editable PPTX not bitmaps | §5 | pres | Preserved + Codex task (C4) | `documents/pptx.ts:42,145,174`; QI cloud deck: native text/chart/notes | Native Office review pending |
| 91 | Bind validation to final content hash | §6.1 | gap | Fixed | = #10 | — |
| 92 | Generated-site motion: reduced-motion everywhere; reveal visible without JS | §6.2 | gap | Preserved | `prompt.ts:33` (`html.js [data-reveal]`); QI staging JS-disabled heading check | Hover-transition reduced-motion not verified |
| 93 | Test intermediate widths; preview reflects canvas; fit/full-screen | §6.3 | gap | Preserved (full screen) | `live-preview.tsx:187-195` | Intermediate-width qualification not done |
| 94 | Scoped security wording | §6.4 | gap | Fixed | = #32 | — |
| 95 | Verify exact enquiry → inbox → client flow | §6.5 | qual | Codex task | QI qualification doc: phone form → Worker → gateway → inbox → CRM lead linked to client | Staging only |
| 96 | Larger touch targets on phones | §6.6 | qual | NOT COVERED | Book editor controls 35×36 (responsive doc); no target-size pass recorded | — |
| 97 | Explain external consequences before experiments; "draft" ≠ separate DB | §6.7 | lov | N/A | Makeborne has no draft branches; restore wording in #80 | — |
| 98 | Project header: name → client → saved state | §7 | gap | NOT COVERED | `cloud-studio.tsx:1585-1590` (no client) | — |
| 99 | Progressive disclosure (first-time vs returning) | §7 | gap | Fixed | `library-state.ts:63` | — |
| 100 | §8A state/recovery verification (interrupted save, refresh, failed build, stale selection, expired session, publish-after-edit; no auto paid retry) | §8 | qual | In progress (M08/M10) | F02/F09/fc1ce75 cover parts | — |
| 101 | §8D implement billing first; no automatic charges via redesign | §8 | pres | Preserved | Charging off (QI qualification doc) | — |
| 102 | §8E one lead → client brief → deliverables → approval → deployment → follow-up; no second project store | §8 | gap | Codex task (part) | QI form → CRM lead → client | Lead→brief→deliverable chain not qualified |
| 103 | §8F advanced parity after launch | §8 | lov | N/A | — | — |
| 104 | §9 a11y verification: keyboard, focus restoration, reduced motion, contrast, narrow widths, layout shift, authorised image delivery, real performance | §9 | qual | NOT COVERED | Integrated shell pass only (impl. report "Verification run") | — |
| 105 | Thumbnail alone insufficient; need identity/version/live/client/kind | Library follow-up | gap | In progress (M06) + NOT COVERED (#48) | — | — |
| 106 | Brief/description search optional; must not leak other agency briefs/hidden counts | Library | pres | Preserved | Title-only, disclosed `account-projects.tsx:172` | — |
| 107 | Bulk actions (if added): clear on scope change, server-authorise IDs, name target/count, card SR identity | Library | lov | N/A | No bulk actions | — |
| 108 | Clear search vs clear filters vs reset distinct | Library | lov | N/A | No combined reset control | — |
| 109 | Query/filter/order restored on back/reload (URL state) | Library contract | gap | NOT COVERED | `studio.tsx:146-147` React state only | — |
| 110 | Explicit loading/error/empty/no-match distinctions | Library contract | gap | Fixed | `0c26a6f` `account-projects.tsx:137-140,153-154`; `library-state.ts:23`; search notices `:164-167` | — |
| 111 | Preserve account-change reset, requestVersion guard, cancellation, device separation, pagination dedup | Library contract | pres | Preserved | `account-projects.tsx:60-64,73,104-110` | — |

## C. `lovable-interaction-quality-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 112 | Palette: group by scope; distinguish Navigate vs Start chat; disable target-less action; no hidden paid generation | §1 | gap | Fixed (client palette) / NOT COVERED (global, = #81) | `palette-search.ts:28` (no active item on empty); actions are navigation only `client-command-palette.tsx:9` | — |
| 113 | Shared save contract across editors (exact revision, dirty, pending, durable success, failure, reload, unsaved-navigation) | §2 | gap | In progress (M08 pending state) + Preserved | `cloud-studio.tsx:1282,1589`; `use-plan-mode.ts:15-25`; `api/build/plan/route.ts:108` | — |
| 114 | Settings no-match with Clear | §2 | lov | N/A | Makeborne settings has no search | — |
| 115 | Focus tests: order, menus arrows/Escape, focus returns, reach primary actions, sticky UI never obscures, status announced without moving focus | §3 | qual | NOT COVERED | Only drawer (`c02a4e6`) and skip link (`c5f51f6`) qualified | — |
| 116 | Separate tokens for app shell / artifact / exported document; motion for state only | §4 | gap | NOT COVERED | No such token split found/assigned | — |
| 117 | Recovery 1: preserve failed version, instruction, diff, sanitised diagnostics | §6 | gap | NOT COVERED | Render diagnostics only `live-builder.tsx:364-366` | — |
| 118 | Recovery 2: Saved / Builds / Published distinct; invalid never public as verified | §6 | pres | Preserved | Publish requires ready preparation `trusted-website-publish.tsx:168`; QI publication suites preserve previous live output | — |
| 119 | Recovery 3: Restore separate from Ask-AI repair; disclose repair cost | §6 | gap | In progress (M10) | — | — |
| 120 | Recovery 4: record operation id; reconnect instead of new run | §6 | pres | Preserved | QI `use-builder-operation.ts:6-19` | — |
| 121 | Recovery 5: after restore compare identifiers; show rendered version | §6 | gap | In progress (M10) | — | — |
| 122 | Recovery 6: preserve user edits on partial repair; conflict handling | §6 | pres | Preserved | `cloud-studio.tsx:1880-1882` conflict guard; `live-builder.tsx:507` | — |

## D. `lovable-keyboard-layout-context-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 123 | Tabs: roving tab stop + arrow keys | Keyboard table | gap | NOT COVERED | `cloud-studio.tsx:1613-1615` aria-pressed buttons (responsive doc: not inherently inaccessible) | Needs a11y decision |
| 124 | Returning to Preview must not reset route or discard unsaved work | Keyboard table | gap | In progress (M10) | — | — |
| 125 | Divider keyboard resize, named, orientation, bounds, hit region | Keyboard table | lov | N/A | No resizable chat/preview divider (`role="separator"` absent in `src/components`) | Applies if added |
| 126 | Discoverable layout shortcuts | Keyboard table | gap | NOT COVERED | Optional | — |
| 127 | Dismissal returns focus to launcher; no trap | Keyboard table | gap | Fixed (drawer, palette) | `studio.tsx:203-221`; palette focus restoration preserved | Other popups → #115 |
| 128 | Tool/element/file context visible and removable before submission | Tool context | gap | In progress (M08) / Fixed (files, M09) | `6eeea77` per-file readiness; QI `a309e0d` | — |
| 129 | Opening a tool must not start a billable request | Tool context | pres | Preserved | View switches only `setView` `cloud-studio.tsx:1613-1615`; suggestions only fill `studio.tsx:646-647` | — |
| 130 | Design translation (saturated colour for primary/active, shared primitives, one More, accessible icon names, preserve preview/library space) | Design translation | pres | Preserved | `workbench-more.tsx:8`; icon buttons carry `title` `cloud-studio.tsx:1613-1615` | — |
| 131 | Validate 375/800/desktop with screenshots + keyboard/touch tasks | Design translation | qual | Fixed (shell) | Impl. report: integrated pass 1440/800/375/320 | Editor breakpoints not covered (#159) |
| 132 | Physical device / soft keyboard / screen reader open | Narrow-screen | qual | NOT COVERED | — | — |
| 133 | Unsent composer draft: text/format/mode/effort, account-scoped, versioned, expiring; restore without dispatch/consent; no cross-account leak; discard; multi-tab; no File objects | Unsent composer | gap | Fixed | `f669393`: `lib/unsent-draft.ts:9-15,50-62,93`; `use-unsent-draft.ts:46-60,86-102,110`; `studio.tsx:167-172,617`; `creation-home.tsx:80-83` | Back-navigation and phone layout not listed in qualification |
| 134 | Distinguish Last activity / Source saved / Preview rendered / Published | Global search | gap | Fixed (saved-source label) + NOT COVERED (#48) | `project-labels.ts:1-18` | — |
| 135 | Extend existing client palette, don't duplicate; avoid competing Ctrl+K listeners | Client palette | pres | Preserved | `account-clients.tsx:222` | — |
| 136 | P2 pending search: stale row selectable → opens unrelated client | P2 | gap | Fixed | `b79789a` `lib/cloud/palette-search.ts:8-28`; `client-command-palette.tsx:35-38` | — |
| 137 | P2 failed search shown as "no matches" | P2 | gap | Fixed | `client-command-palette.tsx:84-86` (error + Retry) | — |
| 138 | Printable-character global shortcuts need off/remap | Keyboard | lov | N/A | No global single-character shortcut found; presenter keys F14 `lib/documents/presenter-keys.ts:14` | — |
| 139 | Skip link + one main per shell state; destination by context; library not skipped past; target focused | F12/M10 | gap | Fixed | `c5f51f6`,`2db34d4`,`d88381a`: `studio.tsx:667,776,793`; `lib/studio-skip-links.ts:9-16` | — |

## E. `lovable-responsive-comparison-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 140 | Full-screen tool on phone: move focus in, block covered screens, restore on exit, visible dismissal; test Back/Escape/resize | Phone Code focus | gap | NOT COVERED | Only the nav drawer is modal (`c02a4e6`) | — |
| 141 | Coherent pattern per breakpoint; preserve project/route/context | 800px | gap | In progress (M10) | — | — |
| 142 | Phone library: recent work, compact search, one New; new accounts welcoming | 375 library | gap | Fixed | `d88381a` | No 375px first-card measurement recorded |
| 143 | Preserve phone book editor (preview-first, compact labelled controls) | Phone book | pres | Preserved | `cloud-studio.tsx:1613-1615` | — |
| 144 | Preserve 800px More actions overflow with Download source | 800 | pres | Preserved | `workbench-more.tsx:8`; `website-source-download.tsx:47` | — |
| 145 | Next checks: editor breakpoints with active builder + soft keyboard; overlapping tools focus; route/slide/selection/unsent retention; reduced motion/long names/zoom/SR | Practical next checks | qual | NOT COVERED (2,3,5) / In progress (4, M10) | — | — |
| 146 | Preserve exact annual-total disclosure | Billing | pres | Preserved | `creation-plans.tsx:90` | — |
| 147 | Keep eligibility vs catalogue quote vs current/pending plan explicit | Billing | pres | Preserved | BA `billing-workspace.tsx:57`; "Opens at launch" `creation-plans.tsx` | — |
| 148 | Test ordinary agency/mobile billing per role before release | Billing | qual | Codex task (C3) | QI: signed-in /billing at 1440/375, 120-row pagination | Staging confirmation open |
| 149 | Reuse server-backed currency/cadence/availability/quote across cards, confirmation, checkout return, receipts; never imply yearly purchasable | Billing | gap | NOT COVERED | Not verified/assigned; checkout delivery is a separate gate (QI publishing follow-up) | — |
| 150 | Retain vertical phone cards | Billing | pres | Preserved | No layout change | — |
| 151 | Hard spend limits separate from UI estimates | Billing | pres | Preserved | `operation-contract.ts:37` (max 240, acknowledged) | — |
| 152 | F10 format filters overflow at 320px | 320 | gap | Fixed | `f3a9c36` `studio-refresh.css:451-462` | — |
| 153 | F11 drawer lets Tab move behind it | Drawer | gap | Fixed | `c02a4e6` `studio.tsx:193-222,721`; `lib/overlay-focus.ts:11-24` | — |
| 154 | Lovable 320 observations | 320 | lov | N/A | — | — |

## F. `lovable-live-experiments-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 155 | Cost reconciliation ledger | §1 | lov | N/A | Bookkeeping | — |
| 156 | Plan Save persists exact revision/hash; reload restores; Build consumes approved revision; edits invalidate; failed save never looks saved; network/concurrency/reload tests; plan cost separate | §2, native recheck | gap | In progress (M08) | Base `use-plan-mode.ts:15-25`, `api/build/plan/route.ts:30,108` | — |
| 157 | Show version viewed / latest saved / published separately | §3 | gap | Fixed | ML `ef637bb` badges; inspected snapshot note `cloud-studio.tsx:1877` | Unmerged branch |
| 158 | Progress from authoritative operation state; reconcile id/version on reconnect; never rerun paid generation | §3 | pres | Preserved + Codex task (C1) | QI `use-builder-operation.ts:6-19,130-139` | — |
| 159 | Warn restore cannot undo third-party transactions | §3 | gap | In progress (M10) | = #80 | — |
| 160 | Inline edit pending → applying → saved; direct-edit precision | §4 | gap | In progress (M08) | — | — |
| 161 | Exports: persistent structure, pagination, exact fonts, editable charts, revisions linked to page/slide versions, accessible exports; validate the file | §5 | gap | Codex task (C4) | QI: cloud book PDF 11 pp 6×9 in; deck 5 slides, native chart, notes | Native Office, revision linkage not verified |
| 162 | Generated mobile site demo honesty | §6 | lov | N/A | — | — |
| 163 | Label chat-generating paid actions explicitly or open a choice screen | §7 | pres | Preserved | `client-follow-up-draft.tsx:59` "Standard · 1 credit"; suggestions fill only `studio.tsx:646-647` | — |
| 164 | "Fix all" must not erase truthful demo labels | §7 | pres | Preserved | Client-ready is advisory, no auto-fix (`client-ready-check.tsx`) | — |
| 165 | Build receipt names exact checks, target version, result, warnings | Compile-only probe | pres | Preserved | `live-builder.tsx:47-53` | — |
| 166 | M13 export acceptance: bytes for exact version — page size/count, editable text, meaningful alt, authored notes, chart data, language/tags, image weight; edit in viewer; long-book TOC | Export handoff | qual | Codex task (C4) | QI partial (size/count/native text/chart/notes) | Alt meaningfulness, PDF lang/tags, image weight, long-book TOC, native PowerPoint open |
| 167 | Preserve export mechanisms (tagged PDF, outlines, chart descriptions, alt, notes, JPEG q88) | Export handoff | pres | Preserved | `documents/export-server.ts:57`; `server/export.ts:457`; `documents/pptx.ts:42,81,131,145,174` | — |
| 168 | Preserve brief-questions foundation; no new wizard; no default preselection | Briefing | pres | Preserved | `brief-questions-card.tsx:10-40,76` | — |
| 169 | F04 last-question Skip retains discarded answer | P2 | gap | Fixed | `833d4a3` `brief-questions-card.tsx:34-40` | — |
| 170 | F04 test matrix (selected/custom/untouched/deselected, backtrack, auto-advance, Enter, busy, double click; payload + composed brief) | Fix contract | qual | Fixed | `check-brief-questions.cjs` (8), `scripts/check-brief-skip-browser.cjs` (7) per report | — |
| 171 | Answering/skipping is not consent to new spend/service/publish; revalidate version & budget before resuming | Fix contract | gap | In progress (M08) | — | — |
| 172 | Evaluate 280 ms auto-advance (correction, keyboard, reduced motion) | Fix contract | gap | NOT COVERED | `brief-questions-card.tsx:31` unchanged | — |

## G. `lovable-workspace-chat-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 173 | Advisor specialty + capability statement; no false credentials | Contract 1 | pres | Preserved | `expert-chat.tsx:148`; `expert-persona-instructions.ts:76-87` | — |
| 174 | Default advice read-only; distinguish recommendation from edit/outreach/connect/charge | Contract 2 | pres | Preserved | Per-message credit receipt `expert-chat.tsx:121,190` | Not runtime-qualified |
| 175 | Named, removable, server-authorised context references | Contract 3 | gap | NOT COVERED | No context-reference UI in `expert-chat.tsx` | — |
| 176 | Structured recommended artifact + editable brief at end of discussion | Contract 4 | gap | NOT COVERED | — | — |
| 177 | "Use this brief" reviewable handoff (target, Build/Plan, effort, max charge); no silent dispatch; provenance; no duplicates; stale target | Contract 5–6 | gap | NOT COVERED | — | — |
| 178 | Free advice: stated allowance/rate limit, abuse controls, honest paid transition | Contract 7 | gap | NOT COVERED | Only per-message credits shown | — |
| 179 | Advisor acceptance tests | Acceptance | qual | NOT COVERED | — | — |

## H. `lovable-queue-followups-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 180 | Distinguish unsent / queued / delivered / awaiting approval / stopped / completed | Contract 1 | gap | Codex task (stopped) / N/A (queue) | QI `6acff9e` `live-builder.tsx:646-655` | — |
| 181 | Queue vs steering chosen deliberately; pending-item identity; recheck at dispatch; Repeat; edit failures | Contract 2,3,6,7 | lov | N/A | No queue/steering in Makeborne | Applies if added |
| 182 | Pause vs Stop semantics; Stop names saved/partial/usage; no rollback claim | Contract 4 | gap | Codex task (C1) | QI `live-builder.tsx:655` | — |
| 183 | Reconnect reloads authoritative operation by id; no duplicate paid work | Contract 5 | pres | Preserved + Codex task | QI `use-builder-operation.ts:6-19,130-139` | — |
| 184 | Preserve live-builder authorities (operation snapshots, attachment snapshots, continuation, retained preview/save, Check saved result & charge) | Existing source | pres | Preserved | `live-builder.tsx:47,507,605` | — |
| 185 | Allow **unsent text preparation** while an operation runs (dispatch still blocked), labelled draft, persisted per user/artifact | Existing source | gap | NOT COVERED | QI `live-builder.tsx:632` textarea `disabled={busy … operationRunning …}` | Optional |
| 186 | Resolve follow-up at dispatch: joined op X vs new request Y | Send now | lov | N/A | No follow-up during runs | — |
| 187 | Stop contract (distinct states; actor/op-bound idempotent; no new provider calls/auto-continuation after stopping; preserve committed version; ledger settlement, no double charge; reload truth; test matrix) | Active Stop | gap | Codex task (C1) | QI `6acff9e`,`ecaddaf`: `operation-server.ts:94-116`; migration `20261020174011_ai_operation_cancellation.sql:5-34`; `live-builder.tsx:646-649` | Paid-customer Stop on staging used exempt admin; "state which output is incomplete" not verified |
| 188 | Request-revision feature: separate fix-unsent / revise & regenerate / continue / recover / restore / resolve-uncertain | Historical editing | gap | In progress (M10) | Preserved base `live-builder.tsx:507,605`; `operation-contract.ts:5-6,37` | — |
| 189 | Repeat contract | Repeat | lov | N/A | Optional | — |
| 190 | Separate UI grouping, op identity, settlement idempotency, request metering keys | Active Send now | pres | Preserved | `operation-contract.ts:5-6` (actionKey/stepKey) | — |

## I. `lovable-drafts-code-comments-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 191 | Drafts (if added): stable id/base/preview/chat, exact summary, accept never publishes | Drafts | lov | N/A | No drafts feature | — |
| 192 | Bind rendered preview to source version/build id; show Saved N / Preview M / Live L | Code editing | gap | NOT COVERED (preview version) | Honest guidance `website-source-editor.tsx:113`; Live/Current ML `ef637bb` | Preview build's version not shown |
| 193 | Manual Save needs preview/build completion state | Code editing | pres | Preserved | `website-source-editor.tsx:113` says editing does not rebuild | — |
| 194 | Formatting separated in diffs; Discard safety | Code editing | lov | N/A | No formatter/discard action in `website-source-editor.tsx` | — |
| 195 | Later publish must prove exactly which version is hosted | Code editing | qual | Codex task | QI supervised publication revision 3 matched | Staging only |
| 196 | Feedback separate from builds; Resolve ≠ implemented/approved | Pinned feedback | pres | Preserved | `lib/client-review/contracts.ts:64`; `client-review-page.tsx:211` | — |
| 197 | Code search: filename vs content, counts, line nav, version, omissions, authorised scope (M12) | Code search | gap | NOT COVERED | `website-source-editor.tsx` filters path only | Optional M12 |
| 198 | File references in chat with project/version/path identity | Code search | lov | N/A | No file-reference feature | — |
| 199 | Preserve CodeMirror editor; parser pass ≠ build | Source nav | pres | Preserved | `website-source-editor.tsx:5,14,36,112-113` | — |
| 200 | Annotation record (optional) | Annotation | lov | N/A | Not present | — |
| 201 | Preserve live-preview selection/undo/onAsk | Annotation | pres | Preserved | `live-preview.tsx:27,77,170` | — |
| 202 | Escape in a popup closes only the popup | Keyboard scope | gap | Fixed (drawer) | `studio.tsx:203-206` (`defaultPrevented`) | Other popups → #115 |

## J. `lovable-draft-conflicts-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 203 | Preserve version-restore.ts guards (new version, type check, no outline over source, locked content) | Source comparison | pres | Preserved | `lib/cloud/version-restore.ts:3-12` | — |
| 204 | Preserve expectedVersion + idempotency on version save | Source comparison | pres | Preserved | `api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/versions/route.ts:35-41` | — |
| 205 | Preserve client-portal base-hash conflict rejection + explicit overwrite | Source comparison | pres | Preserved | `supabase/migrations/20261016090000_client_portal.sql:74,351`; portal change route `:14,41` | — |
| 206 | Don't let an LLM silently resolve conflicts; future drafts compare/approve | Contract | lov | N/A | No auto-resolver | — |

## K. `lovable-history-retrieval-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 207 | Preserve history UI (preview, compare, load earlier, restore as new, disabled when dirty/busy/uncertain/conflict/recovering, hidden for reviewers) | Comparison | pres | Preserved | `cloud-studio.tsx:1871-1891` (`role !== "reviewer"` `:1879`) | — |
| 208 | Named bookmarks / checkpoint metadata on immutable versions | Contract | gap | NOT COVERED | Optional enhancement | — |
| 209 | Version → originating operation/message navigation | Contract | gap | NOT COVERED | Optional | — |
| 210 | Show latest saved / inspected / checked / public separately | Contract | gap | Fixed (part) | ML `ef637bb`; `cloud-studio.tsx:1877` | Checked marker = #79 |
| 211 | Authorised, paginated history search | Contract | gap | NOT COVERED | Optional | — |

## L. `lovable-settings-interactions-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 212 | Leaving settings must preserve route/page/slide/selection/scroll | §1 | gap | In progress (M10) | — | — |
| 213 | Don't copy proprietary font; desktop compactness ≠ phone targets | §1 | lov | N/A | See #96 | — |
| 214 | Editable project name separate from public address | §2 General | pres | Preserved | Slug stored separately `trusted-website-publish.tsx:27,57` | Rename→slug independence not runtime-tested |
| 215 | One project usage total reconciled with receipts/wallet | §2 Activity | gap | Fixed + Codex task (C3) | BA `6bf05ea`; QI "charged sum = used" | — |
| 216 | Type describes capability; never website preset for a book | §2 Project role | pres | Preserved | `style-design-instructions.ts:151` | — |
| 217 | Background AI must state schedule/charge/cap/opt-out | §2 Monitoring, §Monitoring 4 | lov | N/A | No background AI | — |
| 218 | Label live dev preview vs verified/published | §2 Preview | pres | Preserved | `website-source-editor.tsx:113`; ML `ef637bb` | — |
| 219 | Group publishing controls by consequence; disclose data collection | §2 Publishing | pres | Preserved | `website-analytics.tsx:49` privacy copy; `SiteBadgeSetting` separate `studio.tsx:1078` | — |
| 220 | Sharing: reuse of shared assets/source; client approval ≠ remix | §2 Sharing | gap | In progress (M17 asset scopes) | — | — |
| 221 | Handoff/transfer: permissions, assets, domain responsibility, billing, reversibility, excluded client data (incl. portability chapter) | §2 Actions, Codex handoff | gap | NOT COVERED | — | — |
| 222 | Delete recovery policy consistent with implementation | §2 Danger | lov | N/A | No account-project delete UI found | — |
| 223 | Git: target repo, branch, latest pushed version; one-way wording | §2 Git | pres | Preserved | `website-github.tsx:7-12,28` | — |
| 224 | Domains: hosting independent of custom domain; pending DNS / ownership / certificate / active / failure / disconnected | §2 Domains | gap | Fixed | `custom-domains.ts:154-176` | Activation C7 |
| 225 | Client portal access narrower than agency editor | §3 People | pres | Preserved + In progress (M17) | `client_portal.sql:17-46` | — |
| 226 | Project edit vs workspace membership vs public-site access: no single "Share" message | §3 Why | gap | In progress (M17) | — | — |
| 227 | Reusable business facts/brand across formats; project precedence; uploaded instructions untrusted | §4 Knowledge | gap | NOT COVERED (facts) / Codex task (untrusted sources) | QI real planner ignored embedded instructions | Facts layer = #25/#59 |
| 228 | Skills ≠ personas | §4 Skills | pres | Preserved | `expert-persona-instructions.ts` | — |
| 229 | Brand kit flow (fonts/colours/logo/voice) + overrides | §4 Design systems | pres | Preserved | `brand-kits.tsx:262-276` | — |
| 230 | Templates / brand kits / art directions separate | §4 Other | pres | Preserved | `automatic-style.ts:5`, `brand/kit.ts:44-45`, `style-design-instructions.ts` | — |
| 231 | Catalogue vs authorisation vs configuration vs verified integration; Google sign-in ≠ Gmail sender | §5 | gap | Fixed (mail) + Codex task (C7 OAuth scopes) | `de8fca0` | — |
| 232 | Build secrets / MCP / trust centre / enterprise gates | §6 | lov | N/A | — | — |
| 233 | Prospective vs retroactive access changes explicit | §6 Privacy | gap | In progress (M17) | — | — |
| 234 | Long-running credit check-ins plus server budget enforcement | §7 Preferences | pres | Preserved | `operation-contract.ts:37` | — |
| 235 | Show exact permission scope; client approval can't grant cross-client edits/payments; budget ≠ permission | §7 Agent permissions | gap | In progress (M17) | — | — |
| 236 | Qualify fresh sign-in, recovery and revocation | §7 Security | qual | NOT COVERED | QI covered sign-in only (+ open auth-timeout follow-up) | — |
| 237 | Explain Assets: uploaded refs vs generated art vs source assets with usage/ownership/version | §8 | gap | NOT COVERED | Not verified/assigned | — |
| 238 | Context chips state what the next instruction uses; removable without deleting file | §8 | gap | Fixed (attachments) / In progress (M08) | `6eeea77`; QI `a309e0d` (leave out ≠ delete) | — |
| 239 | Setup-state taxonomy: plan gate vs operator-disabled vs disconnected vs failure; empty states with next step | §9.3–4 | gap | NOT COVERED (as a shared model) | Partial: analytics `website-analytics.tsx:47`, mail, domains | — |
| 240 | Audit trail for consequential changes | §9.6 | gap | NOT COVERED | Not verified | — |
| 241 | Backend Enable disclosure; customer-backend parity | Backend | lov | N/A | Out of scope `comparisons.ts:21` | — |
| 242 | Quality UI: quick/source/dependency/runtime/permission results separate with version/time/stale | Quality review, scans | gap | Fixed (applicable parts) | `fc1ce75` fingerprints/stale; `2f0fc9c` | No dependency scanner (N/A) |
| 243 | F06 word-count ranking claim | Two findings 1 | gap | Fixed | `a851e8c` `seo.ts:158` | — |
| 244 | F06 empty alt = decorative; checkers agree | Two findings 2 | gap | Fixed | `seo.ts:100-125,150` | — |
| 245 | Readiness copy: no SEO/AEO superiority; distinct outcomes | Quality review | gap | Fixed | `seo.ts:167` | — |
| 246 | Collaborator / review / portal / public separate with plain labels | Shared preview | gap | In progress (M17) | — | — |
| 247 | Show exact shared version and whether future saves change the link; approval binds version seen | Shared preview | pres | Preserved | `contracts.ts:95-97`; `client-review-page.tsx:105,211` | — |
| 248 | Bearer link ≠ identity; keep token/expiry/revocation; script-free review | Shared preview | pres | Preserved | `contracts.ts:97` (1–90 days); `review-snapshot` route | — |
| 249 | Handled/resolved outcome visible to agency and reviewer | Shared preview | pres | Preserved | `client-review-page.tsx:203-211` "Resolved" | — |
| 250 | Preserve scoped unsent review feedback or warn before discarding | Phone/unsent reply | gap | NOT COVERED | `client-review-page.tsx:23-29` stores identity only | — |
| 251 | Reopening a pin restores route or states missing/stale target | Cross-page pin | gap | In progress (M10 missing-page) / Preserved (anchors) | `contracts.ts:7-14` ref+version | — |
| 252 | Phone review + soft keyboard + revoked-link denial qualification | Acceptance additions | qual | NOT COVERED | — | — |
| 253 | Distinct labels for app health / site analytics / AI receipts | Monitoring 1 | pres | Preserved | Separate surfaces (`website-analytics.tsx`, receipts, `lib/telemetry`) | — |
| 254 | Display only enforced retention durations; prove with aged fixture | Monitoring 2 | gap | NOT COVERED | `app/privacy/page.tsx:13` promises visit salt "deleted after two days" — enforcement not verified | — |
| 255 | Don't promise universal secret removal | Monitoring 5 | gap | NOT COVERED | `lib/telemetry/scrub.ts:16` "no personal data or secrets" (pattern scrub only) | — |
| 256 | Library folders/upsell: real incremental entitlements; client-filtered library | Codex folders | gap | NOT COVERED | = #55 | — |
| 257 | Custom host canonical/og:url parity | Codex custom-domain (1) | gap | In progress (M17 canonical) | Known gap `docs/CUSTOM_DOMAINS.md:111` | — |
| 258 | SSL `validation_timed_out` shown as "Securing…" spinner | Codex custom-domain (2) | gap | Fixed | `custom-domains.ts:157,176` | — |
| 259 | F13 malformed anchor encoding crashes Client-ready | F13 | gap | Fixed | `2f0fc9c` `client-ready.ts:166-212`; `client-ready-check.tsx:28` | Real prepared HTML = C7 |
| 260 | Static contrast coverage: "no issues by these checks", not "Nothing to fix before sharing" | Scope truth | gap | Fixed | `client-ready-check.tsx:32,42`; guard `check-client-ready.cjs:311` | — |

## M. `lovable-skills-knowledge-context-20261020.md`

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| 261 | Keep style / brand kit / project context / workflow / persona / connector distinct | Why | pres | Preserved | Separate modules (#230) | — |
| 262 | Preserve automatic-style policy; no compulsory preset | Preserve 1 | pres | Preserved | `style-design-instructions.ts:8-13,162` | — |
| 263 | Preserve format-specific style rules; sample imagery ≠ brief | Preserve 2 | pres | Preserved | `style-design-instructions.ts:151` | — |
| 264 | Exact vs guide brand kit understandable in UI and edit requests | Preserve 3 | pres | Preserved | `brand-kits.tsx:266-271` | Edit-request side not verified |
| 265 | Preserve server-owned personas with evidence rules | Preserve 4 | pres | Preserved | `expert-persona-instructions.ts:76-87` | — |
| 266 | Playbooks augment, not replace, builder/document prompts | Preserve 5 | pres | Preserved | `lib/builder/prompt.ts` | — |
| 267 | Context-inspection summary (brief/brand/reference versions, unconfirmed facts) | Context model | gap | NOT COVERED | Optional | — |
| 268 | Acceptance cases (distinct direction without preset; same client across formats; style vs exact-brand conflict visible; quoted instruction stays evidence; imported workflow review; op context snapshot; no-workflow path; no bypass of spend/permissions/version/assets) | Acceptance | qual | NOT COVERED (most) / Codex task (quoted instruction) | QI real planner tests | — |
| 269 | General skill marketplace optional | Acceptance | lov | N/A | — | — |

---

## Missed items (every NOT COVERED row)

| Row(s) | Item | Suggested fix | Size |
|---|---|---|---|
| 7 | Save destination/workspace not visible in editor; "cloud draft" jargon | Add "Saved to <workspace>" next to version/save state in the editor header; replace "cloud draft" wording | S |
| 21, 42 | Settings contradiction device vs account; no "This device"/"Saved to account" labels | Rewrite Settings storage copy into "This browser (device drafts)" vs "Your account"; label device vs account cards | S |
| 22, 86 | Settings IA by scope | Split Settings into Account / Workspace / Project / Device recovery sections | M |
| 25, 59, 227 | Project brief/approved-facts layer | Project brief panel (audience, approved facts, constraints) reused across formats, with project precedence over workspace | M |
| 29 | No Copy link after publish | Add Copy link beside "Open live website" | S |
| 34 | SEO/analytics checks read source, not hosted output | Run metadata/robots/canonical checks against the hosted response (or label results "from saved source") | M |
| 38, 88 | Billing order | Move balance/expiry/renewal and recent usage above the plan catalogue for signed-in users | S |
| 48, 105, 134 | Cards lack client and draft/live status (UX07b) | Add client name and a Live / Unpublished changes / Private badge from publication status | M |
| 55, 256 | No client/delivery-status filter | Client filter + delivery-status filter in the library | M |
| 58 | Favourites/folders/list view (P2) | Defer; per-user persisted preferences | L |
| 63, 64 | Matched benchmark; five-person usability study | Owner to authorise; run kit | owner |
| 70 | Vercel Hobby plan for commercial launch | Owner decision before paid activation | owner |
| 72, 98 | Three-facts display; client in header | Editor header: name → client → Saved · Checked vN · Live vN | S/M |
| 79 | No checked-version marker in History | Add a "Checked" badge from checked-version scope | S |
| 81, 112 | No global command registry | Small Ctrl+K registry reusing visible actions (one listener) | M |
| 85 | No project overview (forms/inbox, feedback, hosting health, next action) | Overview panel reusing existing components | M |
| 87 | "Cloud studio" customer-visible title | Rename page title/link text | S |
| 96 | Phone touch-target qualification | Measure and enlarge editor icon targets on phones | S |
| 104, 115, 132, 145, 252 | A11y/focus/soft-keyboard/SR qualification beyond shell | Focus/a11y test pass across popups, history, publish, review on phone + desktop | M |
| 109 | Library query/filter not in URL | Put `q`/format in the URL and restore on back/reload | S |
| 116 | No shell/artifact/export token separation | Design-token audit | M |
| 117 | Failed-version diagnostics not preserved | Keep failed candidate + sanitized compiler output with the operation | M |
| 123 | Tabs pattern decision | Decide: keep aria-pressed buttons (documented) or adopt roving tablist | S |
| 126 | Layout shortcuts (optional) | Optional | S |
| 140 | Phone full-screen panels don't manage focus | Reuse overlay-focus for phone editor panels | M |
| 149 | Server-backed quote reuse across checkout/receipts | Verify/route all price displays through one server catalogue | M |
| 172 | 280 ms auto-advance | Respect reduced motion; allow correction; or remove timer | S |
| 175–179 | Advisor-to-build handoff contract | Context references, structured brief, "Use this brief" reviewable handoff, allowance display | M/L |
| 185 | Unsent text while a build runs | Allow typing a draft while busy; dispatch stays blocked | S/M |
| 192 | Preview's build version not shown | Show "Preview: version N" when it differs from saved | S |
| 197 | Code content search (M12, optional) | Bounded filename/content search with counts | M |
| 208, 209, 211 | Bookmarks, origin navigation, history search (optional) | Defer; metadata on immutable versions | M |
| 221 | Handoff/transfer contract | Define transfer of permissions/assets/domain/billing | M |
| 236 | Recovery/revocation sign-in qualification; auth-timeout follow-up | Dedicated qualification run | M |
| 237 | Assets panel semantics | Distinguish uploaded/generated/source assets with usage | M |
| 239 | Shared setup-state taxonomy | One status vocabulary for integrations | M |
| 240 | Audit trail for consequential changes | Confirm/extend activity log for publish/domain/permission changes | M |
| 250 | Unsent review feedback lost on close | Persist per link/thread/actor or warn before discarding | S |
| 254 | Privacy page "deleted after two days" unverified | Verify salt deletion job with an aged fixture or soften copy | S |
| 255 | Telemetry scrub comment overclaims | Reword to "pattern-scrubbed"; document fields | S |
| 267, 268 | Context-inspection UI; style-vs-brand conflict visibility; workflow acceptance cases | Optional; add visible conflict resolution first | M |

## Claimed fixes that look incomplete against the acceptance text

- **M04 / UX07** (report: "Fixed (local)"): titles and saved-time labels are present, but UX07 also requires **client when assigned** and **distinct draft/live status** on cards — missing (`account-projects.tsx:169-170`).
- **M07** (report: "Fixed part"; live marker on `ef637bb`): the Live/Current badges are only on the **unmerged** `feature/lovable-m07-live` branch, only in History, only for websites; there is **no checked-version marker** and nothing on library cards or the editor header (deep §2 three-facts model).
- **M03** (report: "Fixed"): measured at 1366×768/1440×900 only; the responsive doc's 375px library-first acceptance has no recorded measurement.
- **M05** (report: "Fixed"): server title search is done and ACL-repaired, but the library contract's "query/filter/order restoration on back/reload" was not done (React state, `studio.tsx:146-147`).
- **F09**: the fix contract asks to "qualify reload/back navigation/account switching … including phone layouts"; the report lists reload/two-tab/sign-out only.
- **C1 Stop** (Codex `6acff9e`/`ecaddaf`): implemented and race-tested, but staging Stop used an exempt admin (no paid-customer settlement on the hosted app), and "state which output is incomplete" was not verified in the UI.
- **UX01 / §2 acceptance**: Codex staging used admin/exempt or local accounts; a **paid-eligible ordinary user** end-to-end create → publish (and resume-once / no-duplicate-charge) is still open.
- **M13 / C4 exports**: page size/count, native text, chart and notes qualified in the cloud; meaningful image alt, PDF language/tag structure, image weight, long-book TOC/pagination and native PowerPoint editing remain open.
- **UX05 / billing**: receipts (F08) exist, but the audit's "balance/renewal/receipts above explanatory content" ordering is unchanged (plans render first, `billing-workspace.tsx:58-60`).
- **Restore wording** (`fc1ce75` "version restore says it saves a new version and does not change the live site"): it still does not say that restoring does not refund usage or undo mail/enquiries/payments (deep §3, live-exp §3). This falls inside M10's declared scope.
