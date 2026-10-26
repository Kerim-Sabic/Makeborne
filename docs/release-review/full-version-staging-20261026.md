# Full version for the owner-approved staging test, 26 October 2026

Branch `claude/full-version-staging`, worktree `.claude/worktrees/full-staging`. **Not pushed. Not deployed.** Nothing in this work touched staging, production, Whop, Cloudflare, mail or any AI provider, and no secret was read or used. Its `node_modules` is a **junction** to `.claude/worktrees/full-launch/node_modules` (`package.json` and `package-lock.json` are unchanged from 4974b9c), so never `--force` remove either worktree.

Owner approval this targets (handoff, 26 Oct): "approved full version staging test", quoted beforehand as about **$10 Anthropic + $3 OpenAI** for staging qualification of the full candidate. It does not cover cloud/VM, deployment or Cloudflare spend, and it does not authorise production. Each area still needs the owner's GO before it goes live.

## 1. Head and what is in it

Head: see the commit that adds this file (`git log -1 claude/full-version-staging`). The code head it describes is **`7a86eb6`**. The SQL evidence was taken at f901a59; nothing after it touches `supabase/` or `.env.example` (verified with `git diff --name-only`), so it still holds.

Base: `claude/full-launch-candidate` **4974b9c** (Codex 5f655a7 + the full launch candidate 1062170 + the 3-engine browser fixes).

| # | Merge commit | Merged | SHA | Notes |
|---|---|---|---|---|
| a | a4e4e55 | `release/minimum-launch-20261025` | **0877345** (runtime 59e5d32) | Codex's repurchase guard, migration 20261026013451, qualification records. Conflicts only in `.gitattributes` and `AGENT_HANDOFF.md` (both additive, both sides kept). Codex's `checkout/route.ts`, `creation-plans.tsx` guard logic and the migration are byte-identical to 0877345. |
| b | 6b5e778 | `claude/journey-polish` | **224f8e9** (round 2; the candidate had up to 2df6fc8) | See section 2. |
| c | fcadbb6, b7d7b59 | `claude/launch-site-sweep` | **2124f66**, then the final head **8611e25** | 59ae59b when the task was written; 2124f66 when merged; 8611e25 when its agent finished. 2124f66 → 8611e25 is two report-only commits. |
| d | 0e583a1 | `claude/account-data-rights` | **94c9e57** | Clean merge. Flags off. |
| e | eda90a7 | `claude/launch-security-fixes` | **e6b1311** | Report only. |
| f | ed6f470 | `claude/feature-flag-hardening` | **6811cb7** (from 1062170) | Security S2, S3, S4 (`MAKEBORNE_AGENCY_TASK_KINDS`), S9 (migration 20261026120000), S12 (migration 20261026120100). Clean merge. |
| g | f901a59 | integration fix (mine) | — | Account-rights erase + research counters, LF pins. Section 3.3. |
| h | 14979cf | test fix (mine) | — | `check-library-rename-browser` follows library-redesign's card menu (Open, then Rename; reviewers see Open only). Journey's check expected its own menu. |
| i | 3f81eb4, 9afc160 | this report, the SQL evidence JSON and `scripts/rehearse-full-version-chain.mjs` | — | |
| j | 1002761 | `feature/docs-quality` | **84208ff** | New since the candidate: b38bfc6, 4b71fa5, c939276, cf51b4f, 58a1d1f, 56596fc, 629f55a, 84208ff. Measured 2.5 image cells (×1.5 bound), image quality and slide/page shape controls, generated book pages, reference-pattern prompts, deck fixes. Section 2. |
| k | 3f0d90d | `feature/image-led-sites` | **315e227** (exactly; its agent is still committing "website quality v2", which comes as one more small merge) | New since 9976ac7: 24e8138, 7807c71, b14078f, 463c916, 315e227. Clean merge. |
| l | 062e834 | eval fix (mine) | — | `scripts/eval/direct-run.mjs` and `doc-run.mjs` set `MAKEBORNE_DESIGN_COMPS=on` / `MAKEBORNE_DECK_FULL_IMAGE=on` in their own process; image-led's `check-direct-run-comps.cjs` failed without it. |
| m | 2536f83 | `claude/legal-pages` | **16437ab** (from 0877345) | `/terms`, `/privacy`, `/dpa`, `/imprint`, `/withdraw` from `docs/legal/*.md`; footer links; sign-up clickwrap; checkout withdrawal-consent checkbox. Clean merge. **The checkout change is Codex-owned and flagged for review** (section 1, below). |
| n | 7a86eb6 | test fix (mine) | — | `check-presenter-keys-browser`'s `render-book` mock exports `bookTrim` (docs-quality's `document-preview.tsx` imports it). |
| o | (this commit) | report update | — | |

**Not merged:** the next `feature/image-led-sites` head (website quality v2, still in progress). GitHub two-way sync (`qualification/github-continuous-20261025`), model-routing and model-orchestrator are also not in this branch.

### Changes to Codex-owned paths, all UI/copy

`git diff 0877345 HEAD` over billing, checkout, webhooks, publication/hosting, controller, customer-sites, GitHub and mail shows **no logic change to a guard**. What differs:

- `creation-plans.tsx`: one string. When every plan is closed it now says "Plans aren't open yet, so … can't be bought right now. Nothing was charged." instead of "Pick another plan below" (the journey audit's ask). The offer check, repurchase handling and navigation policy are Codex's.
- `mail-center.tsx`: the header names Outlook and follow-up sequences only when they are actually available (site sweep, "no Outlook promises").
- `mail/modal.tsx`: journey 36ea5ce focus trap (was already in the candidate).
- `billing.css`, `billing/return/return.css`: `--ui-zoom` sizing (only with `MAKEBORNE_UI_SCALE=on`), darker contrast colours, 16 px search field on phones.
- `hosting/version-facts.ts`: editor-quality's preview fact (already in the candidate).
- `check-plans.cjs`, `check-publish-report.cjs`, `check-responsive-images.cjs`: test additions.
- **legal-pages (needs Codex's review):** `api/billing/checkout/route.ts` accepts an optional `withdrawalConsent` string and, when it equals `WITHDRAWAL_CONSENT_VERSION` (`plans.ts`), adds `makeborne_withdrawal_consent` to the Whop checkout metadata. Optional on the server; `creation-plans.tsx` requires the unticked box before any redirect for signed-in buyers with offers. The repurchase guard, offer allowlist and navigation policy are unchanged. **Please check one thing:** a checkout resumed from a request stored before this deploy now carries extra metadata. If your resume path compares the stored request body, decide whether that difference matters.

## 2. Conflicts and how they were resolved

| Merge | File | Resolution |
|---|---|---|
| a | `.gitattributes`, `docs/AGENT_HANDOFF.md` | Both sides kept (LF pin lines; handoff entries). |
| b | `src/components/account-projects.tsx`, `api/.../artifacts/card-meta/route.ts`, `scripts/check-library-previews-browser.cjs` | **Kept library-redesign's versions** (the candidate's). They already carry rename, the live address and the grid; journey's copies are the same feature on the old list. As journey's agent asked: "Merging feature/library-redesign later: take its account-projects.tsx." |
| b | `src/app/project-rename.css` (new in journey) | **Dropped.** Its rules are identical to the ones in `library-preview.css`. The editor's rename dialog (`project-rename-dialog.tsx`) now imports `library-preview.css`, so **one copy** of the rename CSS remains. |
| b | `src/components/cloud-studio.tsx` | Both sides: the candidate's visual-edit session, skip links and `chat-hidden` layout, plus journey's editor rename (state, `renameProject`, header `rename` prop, dialog). |
| b | `src/components/leads/lead-finder.tsx` | Union of imports (`ReactNode` + `Upload`). |
| c | `account-clients.css`, `expert-chat.css`, `global-command-palette.css`, `help/page.module.css` | Both sides: the candidate's `--ui-zoom` sizing with the sweep's **higher-contrast** colours. |
| c | `onboarding/checklist.ts`, `onboarding/getting-started.tsx` | Journey round 2's AI-paused paths with the sweep's copy ("Gmail" only, no creator search). `check-help.cjs` and `check-onboarding.cjs` both pass on the result. |
| c | `onboarding/check-onboarding.cjs` | Journey round 2's checks kept. |
| d, e, f, k, m | — | No conflicts. |
| j | `api/build/route.ts` | GET returns **both** `features.documentImages` (boolean: images can be made now; the candidate's rule) and docs-quality's top-level `documentImages` (credits per image for each quality and shape). |
| j | `builder/docs-agent.ts` | Full-image slides still need `MAKEBORNE_DECK_FULL_IMAGE=on` (`artEnabled`), as the candidate report asked. docs-quality's generated book pages, native canvases and plate canvases kept. The system prompt keeps its cache marker. |
| j | `builder/docs-run.ts` | New decks stay `"live"` unless the flag is on; docs-quality's shape, quality, page numbers and `bookArt` kept. |
| j | `cloud-studio.tsx`, `live-builder.tsx` | Both: `features` and `imageOffers`/`projectBrief` are passed; the attach button keeps the ingestion accept list and gains the image controls. |
| j | `check-availability.cjs` | Both sides' assertions. |
| j (integration) | `live-builder.tsx`, `creation-home.tsx`, `document-image-controls.tsx` | The image quality and shape controls show **only when `features.documentImages` is true**, the same rule the candidate uses for image questions, so nobody is offered "Image quality" while images can't be made. `check-art-formats.cjs` turns `MAKEBORNE_DECK_FULL_IMAGE` on for its deck runs, as `check-slide-art.cjs` does. |
| j, k | `src/lib/ai/prices.ts`, `check-image-cells.cjs` | No conflict. c939276 and 7807c71 have the **same patch-id**, and `MEASURED_IMAGE_OUTPUT_TOKENS` is identical on 84208ff, 315e227 and the head: one entry per model with low 2, medium 3, high 10 and xhigh 9 cells, so there are no duplicates. `MEASURED_HEADROOM = 1.5`. |
| m | footers | Legal links (`LegalLinks`: Terms, Privacy, DPA, Legal notice) render in every public footer: home, help (and so the branded 404, which uses `HelpFooter`), billing (plus Withdraw), billing terms, the auth pages, account settings, studio and portal. The sweep's contrast values are untouched; the legal pages' own colours are #2c2833, #5d5766 and #6b6574 on white (all ≥ 4.5:1). |

## 3. Migrations

### 3.1 New against live main de7e657, in timestamp order (12)

| # | Migration | From | Staging today | Note |
|---|---|---|---|---|
| 1 | 20261022100000_brief_enhancement_actions | creation-quality | not applied | **sorts before applied 20261025200000** |
| 2 | 20261023130000_project_source_uploads | agency stage 2 | not applied | **before applied**; widens `project-assets` MIME list for docx/xlsx/csv/json even with the flag off (routes still refuse) |
| 3 | 20261023200000_agency_operation_contract | agency stage 1 | not applied | **before applied** |
| 4 | 20261023210000_client_knowledge | agency stage 3 | not applied | **before applied** |
| 5 | 20261024010000_client_research | agency stage 4 | not applied | **before applied** |
| 6 | 20261024020000_data_report_files | agency stage 7 | not applied | **before applied** |
| 7 | 20261025200000_paying_workspace_publication | Codex | **applied** 25 Oct | — |
| 8 | 20261025300000_crm_research | crm-research | not applied | **sorts before applied 20261026013451** |
| 9 | 20261026013451_prevent_unsupported_creation_repurchase | Codex | **applied** 26 Oct | — |
| 10 | 20261026100000_account_data_rights | account-data-rights (+ f901a59) | not applied | **sorts before applied 20261026110734 / 20261026111931** (GitHub, see below) |
| 11 | 20261026120000_crm_server_writes | hardening S9 | not applied | after every known applied version |
| 12 | 20261026120100_research_daily_limits | hardening S12 | not applied | after every known applied version |

**For Codex's apply:**

- **8 of the 10 unapplied migrations sort before a version staging already records.** A plain `supabase db push` refuses them; it needs `--include-all`, or your `apply-staging-migrations.mjs` path. Never a bare push.
- **Staging records migrations this branch does not have.** Your GitHub qualification (runtime 84bc61e, docs 297957c) applied its migrations to staging: 20261026015749, 20261026110734 and, per your final handback, 20261026111931; I assume 20261022193315, 20261023191334 and 20261025100000 too. Please confirm from `schema_migrations`. They are not in this branch, so the CLI will also report remote versions missing locally. Use the apply script; do not `migration repair` them away. The app code on this branch does not use those GitHub tables (additive, unused). 11 and 12 still sort after 20261026111931.
- `.gitattributes` now pins LF for 2–6, 8, 10, 11 and 12 (1, 7 and 9 were already pinned). Blobs were already LF; `git ls-files --eol` shows `i/lf w/lf` for all twelve.

### 3.2 Fresh disposable chain: results

Harness: `scripts/rehearse-full-version-chain.mjs` (added here). Same bootstrap as `scripts/rehearse-candidate.mjs`: fresh `public.ecr.aws/supabase/postgres:17.11.0.002`, `--network=none` (inspected: `NetworkMode=none`), platform schema, production schema dump, production's 20 recorded versions, the populated fixture, the legacy pause, then migrations, then **every** `supabase/check-*.sql` (each its own psql session; fixtures roll back, and the schema fingerprint is identical before and after the checks). Containers removed afterwards (`docker ps -a` shows none). Evidence: `docs/release-review/full-version-staging-sql-20261026.json`.

| Scenario | Order | Migrations applied | Checks OK | Dropped public functions | anon-executable SECURITY DEFINER in public |
|---|---|---|---|---|---|
| base: Codex 0877345 | timestamp | 90/90 | 64/77 | 0 | 3 |
| **full: this branch** | timestamp | **100/100** | **71/85** (453 PASS lines) | 0 | 3 (unchanged) |
| **staging order** | live main chain + 20261025200000 + 20261026013451 + the 6 GitHub migrations (from 297957c) first, then this branch's other 10 in timestamp order (= `--include-all`) | **106/106** | **71/85**, identical to full | 0 | 3 |

Requested suites, base / full / staging order (all PASS, counts are PASS lines):

| Suite | base | full | staging |
|---|---|---|---|
| `check-plan-payment-refunds` (12 refund groups) | 12 | 12 | 12 |
| `check-billing-lifecycle` | 6 | 6 | 6 |
| `check-plan-credit-allocations` | 13 | 13 | 13 |
| `check-checkout-recovery` | 2 | 2 | 2 |
| `check-creation-repurchase` (Codex's guard) | 5 | 5 | 5 |
| `check-paying-workspace-publication` (publication groups) | 17 | 17 | 17 |
| `check-account-data-rights` | — | **7** | **7** |
| `check-crm-research` (hardening's updated file) | — | 7 | 7 |
| also: `check-topup-fulfillment` 9, `check-topup-status` 3, `check-custom-domains` 7, `check-publication-controller-boundary` 2, `check-agency-operations` 10, `check-client-research` 6, `check-client-knowledge` 12, `check-brief-enhancements` 7, `check-research-daily-limits` 3 | | | |

**Failures: 13 on base, 14 on full and staging, 0 regressions.** All 13 base failures repeat identically and are environmental: the five `*-concurrency` suites need dblink to a named isolated stack (`supabase_db_makeborne-local`) or a password; `crm-concurrency` refuses a non-empty database; `crm-mail-upgrade` and `mail-granted-scopes-upgrade` need their placeholder substitution at a specific point in the chain; `browser-acl` (`rls_auto_enable` search_path in the platform dump); `local-pilot-lock`; `scope-matrix` (bucket fixture); the two `usage-history*-scale` suites (disposable-name guard). The 14th, new on full only because the file is new, is `check-agency-operations-concurrency` (needs `-v allow_fixture_commit` and dblink to an isolated stack). Run that one on the isolated stack if you want race evidence.

### 3.3 One integration defect found and fixed (f901a59)

- **`check-account-data-rights.sql` failed 4/7 on the production-equivalent chain**, at the erase step: `hosted_sites_artifact_id_version_number_fkey` "is still referenced". It fails the same way on **94c9e57 alone**; it passed 7/7 on the account-rights agent's `supabase start` stack. Cause: `hosted_sites` has a NO ACTION key to `artifact_versions` next to its cascade from `artifacts`, so deleting a workspace with a published site works or fails depending on RI trigger order (trigger OIDs). A dump-restored database (like this chain, and possibly a restored production) fails. **Fix:** the erase deletes the account's `hosted_sites` before its workspaces. Same end state; the sites' dependants cascade from them.
- **Hardening's new `makeborne_private.research_daily_uses`** (S12) holds the actor id with no foreign key, so a deleted account's rows would stay forever. `check-account-rights.cjs` caught it ("unmapped tables"). **Fix:** data-map entry (not exported, deleted) and an erase by actor/workspace, guarded with `to_regclass` because 20261026120100 sorts after 20261026100000. The SQL check now asserts the deleted account's rows go and another account's stay.
- 20261026100000 is not applied on staging or production, so it is edited in place. Only the account-rights agent's local `makeborne-journey-audit` stack has the old body.

## 4. Local check results (final tree)

All local, offline, providers mocked, no secrets.

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS |
| `eslint .` | PASS: 0 errors, 1 pre-existing warning (`scripts/check-preview-assets-browser.cjs:72` `catImage`) |
| `npm test` (run-checks) | **224/224**, the same 5 explicit skips (running server / interactive fixture / time-boxed tariff). Includes docs-quality's `check-art-formats` 11, `check-slide-art` 22, `check-document-image-controls` 5, image-led's `check-comp-prompt` 6, `check-image-vision` 16, `check-image-cells`, and legal-pages' `check-legal-pages` 10. |
| Eval offline check | `scripts/eval/check-direct-run-comps.cjs` PASS (medium and high are offered concept, comps and images) after 062e834 |
| `node scripts/prepare-builder-runtime.mjs` then `next build --webpack` | PASS (Next.js 16.4.3, 68 static pages including the five legal pages) |
| Chromium: `run-browser-checks.mjs --engines chromium` | **53/53** after fixes (now includes `check-legal-consent-browser`: clickwrap, footer links, unticked checkout consent gating the buy button, consent version sent, 390 and 1440). First run on this head 51/53: `check-presenter-keys-browser` (mock missing `bookTrim`, fixed in 7a86eb6, 9/9) and `check-launch-pages-browser`, which needs a running server: against `next start -p 3048` of this build with a placeholder unreachable Supabase URL, 22/22. `check-chat-history-browser` needs the gitignored local `work/` folder. |
| Legal pages, by hand | `/terms`, `/privacy`, `/dpa`, `/imprint`, `/withdraw` answer 200; at 390 and 1440 each has one h1, no sideways scroll and a footer link to /terms |
| Chromium, by hand (earlier head 14979cf) | `check-builder-client.mjs` 8 groups PASS; `check-help-overflow.cjs` PASS |
| **WebKit, phone-relevant** (36 checks that exercise 320-414 px or touch) | **36/36**, adding `check-legal-consent-browser` and `check-presenter-keys-browser` to the earlier 34. Engine-limited notes only (PASS*): editor-header Tab out of the popover, library Tab to card links, site verifier (Chromium-only). |
| SQL full chain | Section 3.2 |
| Not run | Firefox (141/141 on 4974b9c before these merges), real-stack `check-account-rights-local-stack.cjs` (needs the journey-audit stack), Lighthouse/eval, anything on staging |

## 5. Feature flags

Every flag below is off by default. Unless noted, only the exact value `on` enables it (`true` and `1` stay off). Pre-existing gates still apply on top of every flag: the database provider limits (`global`, `anthropic`, `openai`; production today all disabled at 0), `creation_enabled`, `MAKEBORNE_IMAGE_MODELS`, the publication allowlist.

| Flag | Default | Turning it on starts | Paid calls? |
|---|---|---|---|
| `MAKEBORNE_UI_SCALE` | off | Large-screen `--ui-zoom` above 1700 px on every page (read at render; static pages at build). | No |
| `MAKEBORNE_BRIEF_ENHANCER` | off | POST enhance (durable actions, migration 1). | **Anthropic**, per enhance, after a credit hold |
| `MAKEBORNE_DESIGN_COMPS` | off | Comp-first design comps before a build, at the measured native cells (desktop 2560x1440 High, phone 1152x2496 High). Photographs now wait for the comps (315e227). | **OpenAI images** (text-capable 2.5 model) + Anthropic |
| `MAKEBORNE_DECK_FULL_IMAGE` | off | Full-image slides and the deck style question; new decks are editable text (`live`) while off. | **OpenAI images** |
| `MAKEBORNE_CONTRAST_GATE` | **on** (`off` disables) | Rendered-contrast finish gate in builds. | No new provider (local headless render) |
| image gate: `OPENAI_API_KEY` + `MAKEBORNE_IMAGE_MODELS` (or `MAKEBORNE_IMAGE_MODEL`) + `openai` provider limit > 0 | unset / 0 | Image-led websites, book images, image questions **and the image quality and shape controls** (`features.documentImages`). **Not a flag, new from docs-quality:** with a text-capable 2.5 model (sunburst or flare) in the list, new books get **generated pages** (cover and chapter openers, or picture-book spreads, with their words), checked by the page gate and typeset if they fail twice. Choose the model list accordingly. | **OpenAI images** + Anthropic vision checks |
| `MAKEBORNE_SOURCE_INGESTION_ENABLED` (exactly `true`) | false | Word/Excel/CSV sources for builds. | Indirect: more input tokens in the build |
| `MAKEBORNE_AGENCY_TASKS` | off | Master switch for paid agency work. **Alone it starts nothing** since S4. | No (needs a kind) |
| `MAKEBORNE_AGENCY_TASK_KINDS` (comma list: `research`, `data_report`, `image_edit`, `independent_review`) | empty | Each listed kind makes paid model calls at once (all four are already qualified). List them one at a time. | **Yes, per kind** |
| `MAKEBORNE_CLIENT_KNOWLEDGE` | off | Approved client knowledge (migration 4). | No |
| `MAKEBORNE_CLIENT_RESEARCH` | off | "Understand this client" panel (migration 5). The assisted brief needs `research` in the kinds. Daily limit 30/person (S12). | **Anthropic** with `research` listed; page fetches otherwise |
| `MAKEBORNE_DATA_REPORTS` | off | Data reports (migration 6). The written summary needs `data_report` in the kinds. | **Anthropic** with `data_report` listed |
| `MAKEBORNE_IMAGE_EDITING` + `MAKEBORNE_IMAGE_EDIT_MODELS` | off / empty | Resize/crop/accept are free; generated edits need `image_edit` in the kinds and provider capacity (S3). | **OpenAI** edits + small Anthropic step |
| `MAKEBORNE_INDEPENDENT_REVIEW` | off | Independent review; the model reviewer needs `independent_review` in the kinds. | **Anthropic** |
| `MAKEBORNE_CROSS_PROVIDER_REVIEW` | off | Cross-provider reviewer (not qualified). Keep off. | OpenAI |
| `MAKEBORNE_CRM_RESEARCH` | off | CRM research and lead research panels; routes 404 while off (migration 8). Website checks are server-only (S9), 100/person/day (S12). | **No model calls**; fetches public pages |
| `MAKEBORNE_ACCOUNT_EXPORT` | off | Settings › Your data › Prepare my data (ZIP in the private `account-exports` bucket, 120 s signed link, 72 h retention, one a day). | No |
| `MAKEBORNE_ACCOUNT_DELETION` | off | Scheduled deletion with 7-day grace; the job runs from `/api/cron/account-rights` (**not in `vercel.json`**; schedule it to test). | No (it bans the sign-in, unpublishes, detaches custom domains via Cloudflare if configured) |
| `WHOP_TOPUPS_ENABLED` + `MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED` + `MAKEBORNE_TOPUP_CHECKOUT_QUALIFIED` (all exactly `true`) | false | Credit-pack checkout. `MAKEBORNE_TOPUP_RECONCILE_ENABLED=true` for its cron. | Whop payments (sandbox on staging) |
| custom domains: `CLOUDFLARE_SAAS_ZONE_ID`, `CLOUDFLARE_SAAS_API_TOKEN`, `MAKEBORNE_CUSTOM_DOMAIN_TARGET` | unset | Connect-a-domain in Publish. All three valid or the feature reports not configured. | Cloudflare for SaaS (owner decision) |

Unchanged and still off: `MAKEBORNE_MAIL_AUTOMATION_ENABLED`, `MAKEBORNE_MICROSOFT_MAIL_MODE`, `MAKEBORNE_AUTOTOPUP_SETUP_ENABLED`, the GitHub continuous flags (not in this branch).

**Ships ON without a flag (UI only, no spend):** library grid and rename, editor-quality UI, journey rounds 1 and 2 (welcome without a workspace, AI-paused paths, content-only Preview, local-time expiry, Create/Plan names), the site sweep (pricing indexable, honest copy, 16 px phone fields, contrast, branded 404, CRM phone layout), hardening S2 (linear-time HTML scanners), the legal pages, footer links, sign-up clickwrap and the checkout withdrawal-consent box (legal-pages). Read-only `GET /api/assistants` (no hold, no provider call).

**Active whenever AI opens on this build:** the design rounds, image-led prompt rules, docs pipeline changes (reference-pattern prompts, native image canvases, generated book pages with a text-capable model) and the contrast gate. **The staging generation qualification must be redone on this build** before AI opens on it; Codex's 0.96 USD run was on 5f655a7's pipeline.

## 6. Staging environment per area

Set on the **Preview (staging) environment only**. Values marked "owner" are decisions, not things to invent.

| Area | Env / database |
|---|---|
| Baseline (all areas) | Everything the 0877345 staging already has. Database: apply section 3.1's 10 unapplied migrations with the apply script. Provider limits for the test day via `makeborne_private.set_live_provider_limit` (DB owner): `global` and `anthropic` enabled at **10 000 000 µ$** ($10), `openai` enabled at **3 000 000 µ$** ($3) only for the image steps, then back to disabled/0. Note the approval in each call's note. |
| Images (websites, books, decks) | `OPENAI_API_KEY` (staging key), `MAKEBORNE_IMAGE_MODELS=gpt-image-2.5-sunburst,gpt-image-2.5-flare` (the measured, text-capable models in `src/lib/ai/prices.ts`; gpt-image-1 is never routed). Comps, full-image slides and generated book pages need one of these. `openai` limit > 0. **The daily image limit is the `openai` provider limit**: for staging $3; for production the owner chooses it. Optional per feature: `MAKEBORNE_DESIGN_COMPS=on`, `MAKEBORNE_DECK_FULL_IMAGE=on` (owner preferred live-text image-led slides on 22 Oct; test only if asked). |
| CRM research | `MAKEBORNE_CRM_RESEARCH=on`. Optional `MAKEBORNE_OVERPASS_URL`, `MAKEBORNE_NOMINATIM_URL` for lead discovery. Before production: do-not-contact enforced in the mail send path (Codex), and the purge scheduled. |
| Agency (allowlisted kinds) | `MAKEBORNE_AGENCY_TASKS=on` and `MAKEBORNE_AGENCY_TASK_KINDS` with **one kind at a time** (`research`, then `data_report`, then `independent_review`, then `image_edit`). Plus the area flag: `MAKEBORNE_CLIENT_RESEARCH=on`, `MAKEBORNE_DATA_REPORTS=on`, `MAKEBORNE_INDEPENDENT_REVIEW=on`, `MAKEBORNE_IMAGE_EDITING=on` + `MAKEBORNE_IMAGE_EDIT_MODELS=gpt-image-2.5-sunburst` (the measured edit model). `MAKEBORNE_CLIENT_KNOWLEDGE=on` and `MAKEBORNE_SOURCE_INGESTION_ENABLED=true` are free. Keep `MAKEBORNE_CROSS_PROVIDER_REVIEW` off. |
| Top-ups | Owner creates the three Whop **sandbox** one-time plans: boost_100 = $12, boost_300 = $32, boost_1000 = $95 (catalog `credit-packs-preview-2026-10-05`), USD, adaptive pricing **disabled** and read back. Codex inserts/enables the three `makeborne_private.topup_catalog` rows with those plan ids for the sandbox merchant. Then `WHOP_TOPUPS_ENABLED=true`, `MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED=true`, `MAKEBORNE_TOPUP_CHECKOUT_QUALIFIED=true` (staging only; it is Codex's qualification decision), `MAKEBORNE_TOPUP_RECONCILE_ENABLED=true` for the cron. Uses the existing sandbox webhook (re-enable temporarily, as before). |
| Custom domains | Owner decision on Cloudflare for SaaS first. Then `CLOUDFLARE_SAAS_ZONE_ID` (32 hex), `CLOUDFLARE_SAAS_API_TOKEN` (custom-hostnames edit on that zone only), `MAKEBORNE_CUSTOM_DOMAIN_TARGET` (our fallback origin, e.g. a `customers.` hostname with 3+ labels). A test domain the owner controls. Cloudflare spend is outside the $13 approval. |
| Account rights | `MAKEBORNE_ACCOUNT_EXPORT=on` first; `MAKEBORNE_ACCOUNT_DELETION=on` only after Codex's review of section "Codex, please review" in `account-data-rights-20261026.md`. The private `account-exports` bucket is created by migration 10. Schedule `/api/cron/account-rights` with the existing `CRON_SECRET` only for the test (no recurring schedule). `WHOP_MANAGE_URL` is still a placeholder. |
| UI scale | `MAKEBORNE_UI_SCALE=on` on a second preview, or test before and after; a static page picks it up at build. |

## 7. Staging test plan, cheapest first

Spend cap for everything below: **$10 Anthropic + $3 OpenAI**, enforced by the provider limits in section 6, not by these estimates. Estimates are from measured local runs: `quality-v14-20261026.md` (images at the native High cells, on docs-quality 84208ff and image-led 315e227, which this head contains), agency-qualification-20261024, image-edit, and Codex's 26 Oct staging build. **Images now render at native sizes for High and Best, so each image costs more than the earlier 1024-px cells.** Observed cost (with the bound each call reserves first): High 16:9 slide or desktop comp about $0.055 (bound $0.12); 6x9 page about $0.064 (bound $0.13); square page or 1:1 slide about $0.10 (bound $0.19); phone comp about $0.04 (bound $0.09). Best (xhigh) is about 1.8x High (16:9 about $0.10, bound $0.19). Stop an area at its row's budget; if a row runs over, stop and report.

| # | Area | Steps | Expected cost | Running total (A / O) |
|---|---|---|---|---|
| 0 | Deploy + DB | Deploy this head to the staging preview; apply the 10 migrations with the apply script; advisors: expect 0 new WARN (the chain shows 3 anon-executable definers before and after). | $0 AI (build/VM spend is outside this approval) | 0 / 0 |
| 1 | Flags-off smoke | Every flag off: `/`, `/billing`, `/billing/terms` indexable (no `noindex`), sign-up on an iPhone (no zoom), welcome without a workspace, library rename, editor Preview of a content-only project, 404 page, Settings shows the support-email route for data requests. Phone 375/390 and desktop 1440. | $0 | 0 / 0 |
| 2 | Account rights | Export on: prepare, download within 120 s, check ZIP scoping; second request the same day refused. Deletion (after Codex's review): a fresh fictional account with one published site, schedule, cancel, schedule, force `scheduled_for` into the past on staging DB, run the cron once, verify sites offline, sign-in banned, data gone, retained rows pseudonymized. | $0 | 0 / 0 |
| 3 | CRM research | `MAKEBORNE_CRM_RESEARCH=on`: website check on a fictional client with a real public site, the 100/day limit answer (lower it in SQL only on staging), "Find more like this" hidden while look-alike search is off, phone layout. | $0 (no model calls) | 0 / 0 |
| 4 | Free agency stages | `MAKEBORNE_CLIENT_KNOWLEDGE=on`, `MAKEBORNE_SOURCE_INGESTION_ENABLED=true`, image resize/crop/accept with `MAKEBORNE_IMAGE_EDITING=on` and no kinds listed: paid buttons must say unavailable. | $0 | 0 / 0 |
| 5 | Top-ups | Sandbox purchase of boost_100 (fake card 4242, action-time terms approval), credits once, duplicate refused, full refund reverses. | $0 AI; sandbox money only | 0 / 0 |
| 6 | Generation re-qualification (text) | `anthropic` limit $10: one Medium website build on a fresh paying test account, then one book and one deck without images. | ~$1.0 site + ~$0.8 book + ~$0.6 deck ≈ **$2.4** | 2.4 / 0 |
| 7 | Brief enhancer | `MAKEBORNE_BRIEF_ENHANCER=on`: 2 enhances, one stopped mid-way (credits 0). | ≈ **$0.3** | 2.7 / 0 |
| 8 | Agency, one kind at a time | `research` ×3 briefs (~$0.09 each), `data_report` ×3 (~$0.035), `independent_review` ×3 on a site (~$0.06). | ≈ **$0.6** (bound ≤ $1.5) | 3.3 / 0 |
| 9 | Images in websites | `openai` limit $3, `MAKEBORNE_IMAGE_MODELS` set: 2 image-led website builds, the second with `MAKEBORNE_DESIGN_COMPS=on` (desktop and phone comps). Measured in v14: $1.5-1.9 A and $0.15-0.16 O per site with comps. | ≈ **$3.4** A + **$0.3** O | 6.7 / 0.3 |
| 10 | Images in books and decks | Quality and shape controls visible. 1 deck 16:9 High with `MAKEBORNE_DECK_FULL_IMAGE=on` (v14 Alba, 6 slides: $0.41 O / $0.38 A); 1 book 6x9 High with generated pages (v14 Mushrooms: $0.27 O / $0.39 A); 1 square picture book High (v14 Ollie: $0.15 O / $0.16 A). | ≈ **$1.0** A + **$0.9** O | 7.7 / 1.2 |
| 11 | Image edit | `image_edit` listed: 3 generated edits (~$0.02 each) + instruction steps. | ≈ **$0.1** A + **$0.1** O | 7.8 / 1.3 |
| 12 | Best quality (optional) | One 4:3 deck at Best (xhigh, 2048x1536), to see the higher bound reserve and settle. v14 Helio at High was $0.42-0.52 O / $0.37-0.42 A; Best is about 1.8x the image part. | ≈ **$0.4** A + **$0.8** O | 8.2 / 2.1 |
| 13 | Custom domains | Only after the owner's Cloudflare decision: connect, verify, serve, disconnect. | $0 AI; Cloudflare outside approval | 8.2 / 2.1 |
| 14 | Legal and checkout consent | `/terms`, `/privacy`, `/dpa`, `/imprint`, `/withdraw`; sign-up clickwrap; on a sandbox checkout the unticked withdrawal box blocks the redirect, and the Whop checkout metadata carries `makeborne_withdrawal_consent` (read it back; do it with row 5's purchase). | $0 AI; sandbox only | 8.2 / 2.1 |
| — | Reserve | Retries, regenerations, one uncertain Stop row counted at its bound. | ≈ $1.8 A / $0.9 O | ≤ 10 / ≤ 3 |

After the test: every flag back off, provider limits back to disabled/0, sandbox webhook disabled, temporary bypass revoked, test accounts banned, R2 test objects removed, the same cleanup list as Codex's 26 Oct handback.

## 8. Known gaps

- **One more `feature/image-led-sites` merge is coming** (website quality v2, still being committed). This head has 315e227 exactly.
- **Generated book pages have no flag of their own** (docs-quality): they run when a text-capable 2.5 model is in `MAKEBORNE_IMAGE_MODELS` and images are open. If the owner wants them switchable like full-image slides, that is a small follow-up.
- **Legal pages:** the checkout consent change is Codex-owned and needs review (section 1). The documents' notes and decisions are in `docs/legal/REVIEW-NOTES.md` and `DECISIONS.md`; they still need the owner's company details and a lawyer's read.
- **Website quality (v14):** comps are thin (two per site, not four), the built display type is less bold than the references, and comps can invent small facts (the build follows the brief).
- **Not run here:** real staging, real providers, real Whop/Cloudflare, scheduled crons, Firefox (only Chromium plus a WebKit phone pass; Firefox passed 141/141 on 4974b9c before these merges).
- **GitHub two-way sync is not in this branch**, but its migrations are on staging (section 3.1).
- **Do-not-contact is not enforced in the mail send path** (journey audit). Required before `MAKEBORNE_CRM_RESEARCH` goes to production.
- **S1 (live on main):** `src/lib/mail/research.ts` quadratic regexes. Codex-owned; S2 fixed the same class only in the new research code.
- **Account rights (Codex review list in its report):** Whop membership status is read as stored; provider-side mail/GitHub token revocation not implemented; compiled R2 publication output not removed; no emails on scheduling/completion; released addresses get no tombstone; `check-asset-storage.cjs` signed-link exception needs your acceptance; the cron is not scheduled.
- **No per-user daily AI caps** except S12's research limits; one user can use the whole provider limit (accepted limitation B12).
- `check-advisor-handoff`'s old `.lb-limit` note and the other cross-browser items were resolved on 4974b9c; see `full-launch-browser-matrix-20261026.md`.
- The editor's version facts still say "Newer saved changes aren't live yet" after a rename alone (true for the site title; journey note).
