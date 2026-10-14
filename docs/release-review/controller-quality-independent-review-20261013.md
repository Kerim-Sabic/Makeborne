# Independent controller and quality-launcher review — 2026-10-13

## Bounded conclusion

No remaining concrete P1/P2 was found in the reviewed controller startup/shutdown or local qualification budget contracts after the owner fixes below. This is readiness for local integration, not permission to activate cloud publication or spend on the quality package.

The paid qualification remains blocked on a fresh candidate auth stack: the existing local auth database does not contain the current `ai_operations` / `ai_operation_runs` contract. The launcher now reports this and refuses live startup before writes. Root owns the new stack, reservation, actual API/export smoke checks and any paid execution. A later switch to the new local ports requires a narrow source recheck. No provider request, cloud credential provisioning, deployment or real budget mutation was performed by this reviewer.

## Findings corrected by owners

1. **Controller startup failure:** `runService` assigned `stoppedCleanup` inside a synchronously executed Promise constructor before its `let` declaration. The declaration now precedes the Promise; successful startup ordering and cancellation tests exercise the path.
2. **Uncertain shutdown could retain a live process:** the executable cleared its hard-stop timer after a bounded service/pool timeout, although ignored SDK work could still own sockets. The service now fails on pool close timeout/error, and the entrypoint schedules final process exit after bounded cleanup. The 26-second outer shutdown deadline remains while shutdown is active. An internal idle-pool error is explicitly a failure after cleanup; a requested parent abort remains a normal stop.
3. **False shutdown evidence:** the quality launcher previously swallowed failed limit-disable updates and unconditionally reported `limitsDisabled: true`. It now reads back the guard and all provider scopes. Failed readback records unknown status and exits unsuccessfully; false state or historical-ledger changes also fail.
4. **Unexpected SQL overload could pass startup attestation:** migration58 initially excluded extra executable functions by function name. A granted overload with an allowed name could escape that check. It now collects exact required public/private function OIDs and rejects every executable function outside that set. The migration owner reports a real same-name-overload refusal regression.

Additional scoped improvements followed the review: explicit proxy/TLS environment rejection in the controller; narrowed application source copy instead of the entire `infra` tree; empty-provider environments for local rendering/browser children; owned Windows process-tree termination; and refusal when historical provider calls remain open, since ordinary admission can otherwise expire those old rows. These are implementation controls, not evidence of live provider isolation.

## Controller contract reviewed

- Required Node24, explicit dependency pins and lockfile, bundled current TypeScript worker/resolver/downloader/output store. The bundle metadata excludes Supabase administrator and Next.js dependencies; native `sharp`, `pg`, and the SDK remain explicit runtime dependencies.
- Exact staging Supabase project/host, database/user grammar, fixed project/team and output bucket; no connection URL or ambient pg/SDK credentials. PostgreSQL uses supplied CA, hostname verification and `rejectUnauthorized: true`.
- Actual login catalog/TLS checks and restricted namespace RPC run in a transaction before the SDK transport, source broker, output store or discovery loop are constructed. Runtime policy is read from SQL; environment strings alone do not establish staging authority.
- All provider, broker, R2 and SQL credentials remain in trusted host closures. Source workload receives the existing bounded workload protocol only. Events retain allowed identifiers/codes and discard arbitrary exception text/configuration.
- Parent abort, late pool acquisition, hung work, hung pool close and internal database faults are bounded. Persistent sandbox lifecycle/cleanup continues to be the existing SQL journal's responsibility; process termination is not proof a remote VM stopped.

## Quality budget and identity contract reviewed

- Three explicit new actions: book 2,700,000 microUSD, deck 2,700,000 microUSD, deck edit 600,000 microUSD; total 6,000,000 microUSD. The launcher requires root's matching package reservation and rejects reuse of state/guard/output directories.
- The local-only SQL trigger admits only the exact fixture actor, current armed action/step, persisted operation/run input hash, workspace/artifact/version, effort/rate/cap, Anthropic provider and exact model. It denies unrelated local consumers even while shared provider limits are enabled.
- Admission serializes on the package row and sums package-linked charged amounts, falling back to full bounds for unresolved usage across all dates. Turning an action off does not delete its exposure; settlement can still complete while new admission is closed.
- Admission also requires the controller connection, fresh heartbeat, original UTC date and sufficient time before the fixed deadline. The launcher deadline is before UTC rollover. Crashes leave the guard in place; missing heartbeat/controller closes admission. A restarted/new package cannot silently reuse the guard.
- The old provider ledger is never reset. Startup requires no old open calls, saves a baseline, checks it again before enabling, and compares retained historical records after the run. The test harness compares the original database's ledger and all limits before/after its disposable tests.
- Requests contain the current initial-operation envelope and explicit schema-default fields for the canonical hash. Every case uses fresh IDs/evidence; no automatic continuation/retry or extra-credit approval is performed. Generated output, partial/error events and ledger evidence are preserved for root inspection.
- The copied app uses a separate output directory, explicit copied-source inventory, no repository dotenv files, and a narrow environment. The active paid server alone receives the approved Anthropic credential. Generated-document rendering uses a provider-empty environment and blocked browser networking. Images remain unqualified.

## Independently executed checks

1. `node infra/publication-controller/check.mjs` — **8 groups passed**. Injected transports exercise real composition ordering, cancellation/late acquisition, graceful abort, bounded hung work/pool, idle pool error, exact configuration and safe logging. This is not a live cloud connection or sandbox test.
2. `node scripts/check-fresh-quality.mjs` — **14 groups passed** after root explicitly authorized its disposable fixture. A uniquely named disposable database used minimal representative operation/provider tables and the actual trigger. Tests include exact action binding, roles, closed/crash/day/deadline denial, individual caps, concurrent last-slot admission, unknown previous-day exposure, settlement after closure, aggregate 6M limit and actual runtime preflight. The disposable database is dropped in `finally`. Original auth ledger and provider-limit equality assertions passed; output reported zero provider requests and zero actual-auth-database writes.
3. Separate common-helper probe — poisoned inherited Node/TLS/proxy/provider/SDK/SQL environment variables were excluded; explicit local credentials replaced ambient values; action caps summed to exactly 6M; canonical key ordering matched. No network/database access.
4. Focused ESLint — runtime and quality files passed. The controller test fixture initially had one `no-this-alias` finding; the owner corrected it and the independent rerun passed with zero errors/warnings. The entrypoint was subsequently renamed from `entry.ts` to `entry.mjs` with type annotations removed and the build entry updated; the narrow source delta was reviewed and the final eleven-file focused lint passed.

Owner evidence, not independently repeated here: migration58 real SQL five groups including overloaded-name rejection, and actual Node24 Linux bundle import/native-raster self-check with network disabled. Root owns the complete migration rehearsal and combined application checks.

## Practical limits

Cloud DNS, TLS pooler compatibility, credential scope, approved image evidence, provider OS/network limits, protected 20 MB artwork transfer and remote compute lifecycle still require explicitly approved qualification. The local guard tests use representative tables and cannot prove the paid request/export flow on a freshly migrated auth stack. Fresh generated book/deck/edit quality must be inspected by root after the separate authorized run; this report contains no visual-quality claim and no proof of real Office rendering. Model-price evidence and observed cost remain the existing price-card/metering contracts, not a fresh provider-pricing audit.

## Reviewed source SHA-256

### Final bounded follow-up: SDK session pin and fresh local endpoint

Independently reviewed the installed `@vercel/sandbox` 3.7.0 implementation. `Sandbox.writeFiles`, `readFile`, and `runCommand` call `withResume`, which can create a new session after a stopped/stopping/snapshotting response. The corrected executor captures `currentSession()` once, validates its running state, timeout and exact derived expiry, records that session ID, and passes that Session to all workload IO and commands. Session methods address their fixed session ID directly; detached `Command.wait` also uses its original ID. Cleanup uses `Sandbox.stop`, which does not resume. No remaining concrete P1/P2 found in this narrow correction.

Independent reruns: `node infra/project-runtime/vercel-publication-check.mjs` **19 groups passed**; `node infra/publication-controller/check-sdk-session.mjs` **3 groups passed**. The latter imports the installed SDK with an entirely in-memory API client, reproduces the convenience-method resume, proves the pinned Session refuses the same response without resuming, and exercises executor failure/cleanup on the same original session. These checks make zero network/provider calls. Owner-reported Linux Node24 bundle checks remain separate evidence.

The quality launcher now accepts only `work/fresh-quality-stack/status.json`, API `http://127.0.0.1:55465`, and PostgreSQL `127.0.0.1:55468/postgres` without URL query/hash. The new explicit synthetic route helper independently checks these same endpoints, requires all provider limits disabled, passes empty provider keys and disabled live-builder configuration to the copied app, removes local secret/publishable keys from browser/renderer environments, and checks ledger/limits equality in cleanup. It creates only local synthetic fixtures; it does not arm the paid guard or invoke generation. Its saved outputs explicitly distinguish synthetic fixture provenance from model output.

After coordinating that the stack was available, independently reran `node scripts/check-fresh-quality.mjs`: **14 groups passed**, including original ledger/limits equality and disposable database cleanup; output reported zero provider requests and zero actual-auth-database writes. Independently ran `node scripts/check-fresh-quality-routes.mjs --dry-run`: exact new endpoints, zero writes/provider requests. The actual 9-check local route/export smoke was reported by its owner and root, not rerun by this reviewer. This clears the prior missing-operation-schema limitation for the owner's new local synthetic smoke; paid model output and live cloud qualification remain unproven here.

Final narrow source snapshot (supersedes earlier matching rows below):

| File | SHA-256 |
| --- | --- |
| `infra/project-runtime/vercel-publication-executor.mjs` | `1f1aa7a36258369fa0fabe03cd0e6df0e60a53ede103ea49fbd86255dee2d1fc` |
| `infra/project-runtime/vercel-publication-check.mjs` | `80b8f902d38a24d720189b2dd10b90f83303580e86918a3546320d269a34be58` |
| `infra/publication-controller/check-sdk-session.mjs` | `54362d6d36ef8ce09054635e49198b0f0f30d31b1a1764b0d0de7dfcda0f9e42` |
| `infra/publication-controller/package.json` | `8b04dd902dea7c5c2fb473b0ba4ef2453d9bd19978478ab6dc58b0a20e5ce891` |
| `scripts/fresh-quality-common.mjs` | `f11ae4208b6a7a0daa4c1271aa3789acf856f1c8968236fae73947f7e719e8b8` |
| `scripts/check-fresh-quality-routes.mjs` | `cb277f241d7062ca50aca7abaaff35a19de8de7a47ff1012ff852c3beb4a660a` |

### Earlier reviewed snapshot

| File | SHA-256 |
| --- | --- |
| `infra/publication-controller/config.mjs` | `882101519c2a712224bfd8b363b436a225f1e1b8b28059f11bfd751f4199bda7` |
| `infra/publication-controller/attestation.mjs` | `d0d4abbfc417208a18963b42e6eb3a9cec06da146f26832fe8fbd487fe88c688` |
| `infra/publication-controller/service.mjs` | `713574db86f3ab06bf161e8cdec9bea46952814f7febc1d4c02f050332d2960a` |
| `infra/publication-controller/entry.mjs` | `2ff7b6ed8351e75ced7e1bb78cd971c8e98a5dd0eb2688eb10b388b35355fd30` |
| `infra/publication-controller/build.mjs` | `64c06bf1d4670161911bc020bf4995922f63326f0f4494fcaf2a67f5a511ee50` |
| `infra/publication-controller/Dockerfile` | `c11d5cc5ee856a2673c9c33b97237add4f0cad42a3619aac69c77db3fbd12fbd` |
| `infra/publication-controller/package.json` | `905a887b7c64654574ef18a4fd195be204b4c8e245d519a100494c0f79f07ff7` |
| `infra/publication-controller/package-lock.json` | `5a52d8edc006e25b99df3f294229a0c2d17c5585147ceb8cf6cbb019a38e2d54` |
| `scripts/fresh-quality-common.mjs` | `050ef4cbabdf4bc25faeb09f1ad88cfe7dceb211b60216bf11b1cf63d31abe6f` |
| `scripts/fresh-quality-server.mjs` | `e13e3b11318ae1225e68879d095cdd62b3c4d31548885a0f46dd1b06ef85661f` |
| `scripts/fresh-quality-guard.sql` | `1039d8ce6d136df9326ea3f69b9c3eec48b09ee6114c97222162210decf9042d` |
| `scripts/qualify-fresh-products.mjs` | `32c57f858d10b47eb7fc00f5ea23ac38a6b1e94cfef156958b78ef971732611d` |
| `scripts/render-fresh-quality.cjs` | `3ae67b5ea7823cd7dd210bf67568e38cf606c249afec27ae73a9513f285a342a` |
| `scripts/check-fresh-quality.mjs` | `062fa6e150cfd9bd6dfc03d5c5882c95a9548f86c50f82b7ac736254ea91531f` |
| `supabase/migrations/20261013220000_publication_worker_attestation.sql` | `67b2e1d46bdace0364b3446fa1627796fd6d242941b2c29467859c574b94c0e6` |
