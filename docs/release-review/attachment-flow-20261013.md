# Attachment flow qualification — 2026-10-13

Status: locally implemented and qualified with mocked APIs/providers. No staging or production change, no paid provider call, no commit/push/merge. This report does not claim a completed cloud or paid-model end-to-end run.

## Concrete defects corrected

- Home attachments survived the anonymous draft claim and project handoff in IndexedDB, but the live builder did not read the resulting project collection. Website/book/presentation auto-start and planning requests therefore silently omitted the files.
- Live source selection used transient base64 state. Sending cleared it before failures; later edits, approved-plan builds, automatic continuations and manual continuations omitted original sources. Async file reads could finish after submission or a scope change.
- Unknown file MIME types defaulted to text. Text sources were silently truncated at 200,000 characters. Client, server and home limits disagreed; the former large inline limits also exceeded the deployment transport limit.

The live builder now loads the account/workspace/artifact source collection, waits for storage before automatic start, and validates every selected file without filtering or truncation. Invalid selections preserve the files and the original brief and show an actionable message. Live additions use the existing local source store; source read/import callbacks are fenced to the mounted scope.

Each new build retains an immutable local reference set before network submission. Automatic continuation sends that same validated byte snapshot. Manual continuation restores the original set by server-observed operation identity, including after reload or after the current selection was removed. A new user request intentionally uses the current selection. Approved-plan Build is explicitly described as using the currently listed source files, with a reminder to review changes since planning.

The root's coordinated operation-server change binds a protected hash of the original normalized attachment array and refuses changed-source continuation before admission. Raw attachments and their protected context are not added to public operation status. This agent did not edit operation-server or SQL.

## Supported source and transport contract

- PNG, JPEG, WebP, GIF, PDF, UTF-8 TXT and Markdown; up to five files and 3,000,000 raw bytes **combined**. The same maximum applies to an individual file. Text is limited to 200,000 characters per file, with an explicit refusal above the limit.
- Canonical base64 is required on the server. Image/PDF signatures must match their declared type; text must be valid UTF-8 without binary control bytes. Signature checking is not a complete file decoder or a guarantee of provider acceptance.
- Build, continuation, review and planner requests have a 4,400,000-byte serialized UTF-8 guard before fetch. Both server routes use the same bounded JSON cap. Base64 expansion, multibyte prompts and approved/previous-plan content count toward that cap.
- These inline bounds leave headroom under the deployment platform's 4.5 MB function request limit. Larger local files remain stored under the existing generic 10-file/25-MB-per-file/100-MB rules, but cannot be sent inline. Supporting larger AI sources requires a separately qualified private direct-upload transport; this package does not provide it.
- Local immutable request references are limited to the most recent eight build requests per account, expire after 24 hours, and are pruned on request snapshot access. Eviction removes only otherwise-unreferenced blobs; current project selections survive. Expired/missing originals stop continuation before additional allowance authorization and direct the user to a new request with their sources attached.
- Snapshots are account and project scoped. The cleanup helper is tested for account/project cleanup, but the application currently exposes no account/project deletion workflow to wire it into. Sign-out is not deletion and retains the original same-device files.

## Verification performed

All commands ran locally without real database, authentication-provider or model calls.

1. `node src/lib/builder/check-attachments.cjs` — **8 groups pass**: exact supported bytes/provider blocks; unknown binary MIME, fake types and malformed UTF-8; no text truncation; count/per-file/aggregate bounds; serialized base64/multibyte/plan/review overhead; canonical encoding and empty files; actual website/book/deck/planner model-message assembly; actual build/plan route refusal before auth/holds/providers for invalid and oversized sources, and valid-source passage to a deliberately refusing auth boundary.
2. `node scripts/check-attachment-flow.cjs` — **13 mounted-browser groups pass**: actual anonymous IndexedDB save/claim/project-copy handoff into mounted website/book/presentation auto-start; plan-to-build; changed plan source selection with explicit disclosure; oversized refusal preserving files; exact automatic continuation; reload/manual continuation after removal of the current selection and then a fresh request using that empty selection; unsupported file refusal; failed API response and retry; account switch during preparation; account switch during file import; bounded retention/expiry/cross-account refusal and cleanup preserving current project files.
3. `node scripts/check-live-builder-flow.cjs` — **4 existing mounted groups pass**: cumulative continuation chain, capped allowance, review continuation and retained-result recovery.
4. `node scripts/check-plan-client-integrity.cjs` — **14 existing mounted groups pass**, including account/artifact switches, request/save ordering, conflict handling and paid-plan stream recovery.
5. Scoped ESLint — zero errors or warnings across the listed runtime/test files. `npx tsc --noEmit --incremental false` — pass.

The browser fixture mounts the real LiveBuilder and uses the real IndexedDB attachment handoff and source code. Authentication transitions are exercised through the real local claim function with fixture identities; the full home screen/OAuth flow and real cloud project creation are not traversed here. Builder HTTP responses are mocked. Model-message checks stop at an intercepted provider-call boundary and prove source propagation, not model comprehension or output fidelity. PDF/image signature fixtures do not constitute full provider-format qualification.

## Files in this package

- `src/lib/builder/attachments.ts` — new shared validation, source preparation, model blocks and transport serialization.
- `src/lib/attachments.ts` — bounded immutable request-reference retention/binding/read/cleanup; generic storage limits preserved.
- `src/components/live-builder.tsx` — load/preserve/show/send sources; exact continuation snapshots; scope guards; explicit plan-build selection disclosure.
- `src/components/file-attachments.tsx` — optional source disclosure and mutation lifetime fencing.
- `src/components/use-builder-operation.ts` — narrow exposure of the existing scoped action key for lost-response/reload binding.
- `src/components/use-plan-mode.ts` — shared serialized transport guard only within the existing planner implementation.
- `src/app/api/build/route.ts` and `src/app/api/build/plan/route.ts` — shared attachment schema/normalization and bounded transport only.
- `src/lib/builder/check-attachments.cjs` and `scripts/check-attachment-flow.cjs` — new qualification harnesses.
- `scripts/check-live-builder-flow.cjs` — fixture CSS import support for the reused source attachment UI.
- This report.

All edits preserve the pre-existing uncommitted shared work. Studio, document renderers/prompts, publication code, migrations and builder operation semantics were left to their coordinated owners.
