# Release candidate rc-20261019 — evidence record

**Candidate:** branch `release/rc-20261019` (local, not pushed), code frozen at
`a6e70c6f577aa5bf7654e72cd8d85b9977bd247e`. LF release archive (`git -c core.autocrlf=false archive a6e70c6`)
sha256 `a9612e107dfb20e96ce54bee401feebc3b415e904cdb0981817f958c21c06f37`.
**Written:** 2026-10-19 by the release-engineer session. No merge, push, production change or paid AI call was made.

## Verdict

* **Release of `a6e70c6` to production with the commercial capabilities still off: ready, with named capabilities disabled.**
  Disabled and to stay disabled: AI generation (all provider scopes), creation checkout and credit packs, plan switching,
  trusted website publishing and website enquiries, AI images, email automation, GitHub sign-in, paperback print export.
  What this release changes for people who can use production today: legacy saved books/decks/sites render as saved,
  builder state is reported honestly, finish-time compile with honest "unverified" reporting, first-party error tracking,
  phone-first editor, contrast and layout-shift fixes, accurate help/metadata copy.
* **The intended commercial launch scope: not ready.** It needs owner decisions, credentials or spend that this
  qualification could not substitute: L03 generation (allowance + daily budget), L04 trusted publishing (sandbox compute,
  production controller), L05 payments (sandbox access, signed end-to-end delivery, renewal), L06 plan switching, L07
  scheduled reconciliation, L08 images, N3 saved-work access during provider outages or after lapse, plus quality items
  Q01, Q03, Q04. See `FINDINGS.md`.

This verdict rests on observed customer outcomes below, not on test counts.

## Baseline established (2026-10-19)

| Fact | Evidence |
| --- | --- |
| Production runs `f696b3a` (merge of PR #3, tree = `aecb0b6`), deployment `dpl_CBFzseN65RTZFm5KAviBEJyN6kRr`, 93 migrations | Vercel API read; audit `production-inventory.json` |
| Staging ran `aecb0b6` (`dpl_AWs16XNF…`) before this rehearsal; it now runs `a6e70c6` (`dpl_21och8PE…`) behind the QA alias | `staging/preview-status.json`, alias log (private) |
| `07ee171` (L01/L02) was on `feature/studio-parity-and-quality` only; `dedf6d1` (launch-core) on `feature/launch-core` / `origin/feature/launch-readiness` only. Neither on main; they conflicted in 4 files | `git merge-tree`; merge `32c374a` |
| `dedf6d1` also produced a Git preview on the **production** Vercel project, whose previews share production's Supabase URL | N9 in `FINDINGS.md` |
| Concurrent work: Q05/Q07 session (jolly-engelbart), CLS port session (gallant-mendeleev), uncommitted Phase 2 work (zen-dhawan). Their committed-ready patches were integrated with attribution; uncommitted Phase 2 work was not. | `docs/AGENT_HANDOFF.md`, commits `5aff12c`, `a6e70c6` |
| Evidence older than `a6e70c6` qualifies only code that is byte-identical: portal/review logic, billing/credits/cron, hosting/publication/infra, document renderer | `git diff --stat main a6e70c6 -- <dirs>` (empty, or CSS only for client review) |

## What the candidate contains (on top of production `f696b3a`)

| Commit | Content |
| --- | --- |
| `7b49667`…`dedf6d1` | launch-core: telemetry + migration `20261019090000_app_observability.sql`, compile at finish, client-ready check, admin compiler self-test, phone-first editor, credit estimate + receipt |
| `eda14f4`, `464b44e`, `07ee171` | docs, eval harness, L01 saved-format preview + L02 honest availability |
| `32c374a` | integration merge (keeps L02 capacity state and estimates) |
| `27bc94f` | N1: compile verdict passed/failed/unverified; unverified never reported as passed |
| `48f297c` | eval e2e accepts merged GET contract |
| `5aff12c` | Q05 residual contrast (Q05/Q07 session) |
| `d424815` | N2: no export promise where production refuses |
| `e57f032` | M01/D01: no instant-publishing or print-ready claims |
| `a6e70c6` | Q06 editor layout shift (CLS port session) |

## Gates on the frozen commit `a6e70c6`

| Gate | Result | Evidence |
| --- | --- | --- |
| TypeScript | pass | `gate-a6e70c6/typecheck.log` |
| ESLint (`--max-warnings 0`) | pass | `gate-a6e70c6/eslint.log` |
| Offline harnesses | 138/138 (5 standard skips) | `gate-a6e70c6/harnesses.log` |
| Production build (`next build --webpack`) | pass | `gate-a6e70c6/build.log` |
| SQL suites, fresh LF-applied 94-migration chain, rolled back | 55 pass, 3 skipped with reasons, 0 fail; base left clean | `sql-suites-lf-a6e70c6.json/.log`, runner `run-sql-suites.mjs` |
| Staging DB: only pending migration applied after backup; its suite on staging | pass (4 groups, no residue) | `staging/staging-apply.json`, `staging/staging-check-observability.json` |
| Staging deploy of `a6e70c6` | READY in 2 min 18 s | `staging/preview-status.json` |

## Customer journeys

| Journey | Local (disposable stack, candidate code) | Staging (real Vercel + Supabase, `a6e70c6`) |
| --- | --- | --- |
| 1. Open saved work, edit, save, recover | **Pass.** Legacy book v6 renders as saved outline while building is paused; edit → v7; unsaved edit + forced reload → draft offered → v8; server stopped mid-save → "Saving paused — review required", draft kept, no automatic retry → after restart restored → v9; versions 1–9 contiguous | **Pass.** Real login form; website v3, book v3, deck v2 open as saved types; paused copy; Send disabled; editor CLS 0–0.05 |
| 2. Website/ebook/deck outputs and exports | **Pass with limits.** 7 fixtures open as their saved type; golden site renders from source; 19/19 golden sites pass compile gate; book PDF 13 pp 6×9, deck PDF/PPTX (editable text, notes, native chart); legacy records export only as a draft in production (copy fixed) | **Pass with limits.** Export route on Vercel runtime: book PDF 6 pp, deck PDF 3 pp, PPTX 3 slides with notes; intended fonts in PDFs; PPTX uses Georgia/Segoe UI unembedded |
| 3. Publish, navigation/forms, address change | Not run (publication needs remote executor) | **Blocked** for the candidate (paid sandbox compute, no allowance). Existing QA site serves at renamed address, old address 404, CSP/noindex; form fails closed honestly (503 "Your enquiry was not confirmed…"). Hosting code identical to Oct 17 staging pass. |
| 4. Purchase/renew, credits, consumption, expiry | **Pass (simulated provider).** Observation + payment → 850 credits expiring 2027-01-15 10:38 UTC (period end + 2 months), shown on Plan & credits; hold 40 → settle 25 → 15 returned; replayed settle charges nothing; ledger = wallet. SQL: duplicates/out-of-order/renewal/annual/top-ups | **Blocked.** No sandbox access; checkout closed. No real provider transaction or signed delivery. |
| 5. Client review: invite, feedback, decision | **Pass.** Link created; anonymous client renders page, comments, requests changes; wrong token 404, cross-site 403; agency sees 3 open items, delivery "Changes requested" | **Pass.** Link → anonymous phone client comments → agency sees it → link turned off. Portal edit/approve logic unchanged since its Oct 17 production pass. |

Simulated vs real is kept explicit: local entitlements were recorded with service-role RPCs (no provider); local
"runs" were hold/settle calls without a model; staging used real infrastructure but no payment provider, no AI and no publish.

## Reproduce

From `.claude/worktrees/rc-20261019` (Windows, Docker, Node 22):

```bash
node_modules/.bin/supabase start --workdir work/rc-stack   # config: project makeborne-rc-20261019, ports 55480-55489
node docs/release-review/rc-20261019/run-sql-suites.mjs     # SQL qualification (disposable stack only)
node docs/release-review/rc-20261019/seed-fixtures.cjs      # fixtures from the golden run, simulated entitlement
node docs/release-review/rc-20261019/rc-server.mjs          # candidate on 127.0.0.1:3230, providers blank, builder paused
node docs/release-review/rc-20261019/compile-golden.cjs     # compile gate over saved golden sites
node docs/release-review/rc-20261019/export-fixtures.cjs && python -I docs/release-review/rc-20261019/inspect-exports.py
node docs/release-review/rc-20261019/repro/compile-timeout-at-finish.cjs   # N1 before/after
```

Staging scripts in `staging/` run from the LF archive directory and read operator files from the main checkout's
ignored `work/` folders; they never print credentials. `staging-apply.mjs` is dry-run unless `--apply`.

Files: `INVARIANTS.md` (rules and known conflicts), `FINDINGS.md` (all findings), `RELEASE_PROCEDURE.md` (approval steps).
