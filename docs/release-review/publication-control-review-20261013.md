# Independent publication control/recovery review — 2026-10-13

No concrete P1/P2 defect found in the reviewed control, supervisor, worker orchestration and additive worker-authority boundary. This is a bounded independent review, not production qualification.

## Reviewed behavior

- `publication-control.mjs` restricts calls to six fixed parameterized SQL functions. Each call starts a transaction, selects the restricted role locally, applies statement/lock timeouts, and commits before returning. Ambiguous transactions and cancellation destroy the checked-out connection; a connection acquired after cancellation is also destroyed. No raw SQL, caller-selected function or additional parameter is admitted.
- `publication-supervisor.mjs` validates bounded candidate IDs, executes sequentially, always pauses between discovery batches, and applies bounded backoff when control fails. Its event reporting excludes raw database errors, source and credentials. A broken telemetry callback does not abandon a lease.
- `publication-worker.ts` validates claim/version identity, resolves assets under the fence, refreshes authority before provisioning the executor, and passes only fenced lease context to the executor factory. Control RPC/pool objects are not forwarded to it. Errors attempt a bounded independent failure report. Lost completion responses cannot overwrite a ready/promoted output because the database failure function checks the running state, worker and fence.
- `20261013190000_publication_worker_authority.sql` adds a NOLOGIN/NOINHERIT restricted role and six explicit wrappers with fixed search paths. The guard checks PostgreSQL's actual selected role, not a JWT/custom role claim. Candidate maintenance is bounded and excludes active/terminal work; retries and revoked authority cannot permanently starve eligible queued work. Existing service-side promotion authority remains separate.

## Evidence

1. `node src/lib/projects/check-publication-supervisor.cjs`: **10 groups pass**, covering allowlist/arguments, local-role transaction order, failed/ambiguous connection destruction, cancellation while queued/running, sequential dispatch, sanitized failures, bounded backoff, duplicate/oversized discovery refusal, contention/restart and aborted startup.
2. `node scripts/check-trusted-publication-worker.cjs`: **9 groups pass**, covering missing/expired/mismatched claims, version identity, revoked fence, success order, bounded failure reporting, unknown completion, aborted startup, restricted executor-factory context and provisioning failure. These tests use SQL/compiler/output doubles.
3. `node scripts/check-publication-control-driver.mjs makeborne_publication_20261013034802`: **7 real-driver groups pass** on the coordinated disposable database. Evidence is in `publication-control-driver-20261013.json`, including exact input hashes and timestamps. PostgreSQL driver `pg` 8.23.1 ran on existing local Node 24.21.0 image `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`; no image was pulled.

The real-driver groups confirm dedicated login/parameterized candidate calls, transaction-local role and timeout reset, refusal of a login without worker membership, extra-argument refusal, cancellation with an actual max-one connection pool, running-query cancellation within one second, connection destruction after an injected response loss following a real COMMIT, and cancellation at the actual BEGIN acknowledgement without dispatching a later query. Running-query cancellation injects `pg_sleep` at the allowlisted statement boundary; the application module remains unchanged.

The SQL migration owner granted exclusive brief fixture use after its own authority harness cleaned up. The probe created only two temporary credential-free LOGIN roles, removed both in cleanup, and used an ephemeral container sharing the fixture's network namespace without publishing a port. Its only mounts were read-only runtime code and dependencies. The evidence confirms unchanged reviewed inputs and successful cleanup. After root coordination and confirmation that the SQL owner had completed its handoff, only `makeborne_publication_20261013034802` was stopped and retained; Docker inspection confirmed `exited`. Other rehearsal containers were not changed.

## Limits

- No staging/production request, provider call, credential provisioning or migration change was performed by this review. No reviewed runtime module was edited.
- Local fixture connections deliberately used loopback without TLS. Production certificate verification, restricted hosted login provisioning, supervision/restart infrastructure and remote VM lifecycle still need their separate qualification.
- The committed-response-loss probe exercises driver recovery after a real read-only candidate transaction; durable preparation replay and ready-output preservation are covered by the coordinated SQL harness, not claimed as a complete real-driver compile/publish run here.
- Executor cancellation remains an explicit dependency contract. The reviewed worker supplies a bounded abort signal; this review does not prove cancellation behavior of an unqualified external executor.

Only the isolated driver probe script, its JSON evidence and this review report were added by this review.

## Independent remote-adapter follow-up

Read-only implementation review covered all five `infra/project-runtime/vercel-publication-*.mjs` modules and the locally extracted, pinned `@vercel/sandbox` 3.7.0 distribution. Its implementation confirms Node readable file streams, detached command/status waits without log collection, `get({name,resume:false})`, and stop without automatic resume. Credentials remain in the host transport closure. Command paths, output paths and environments are selected by the adapter, while untrusted output paths, byte counts and hashes are checked before returning compiler files. Compile input is captured before asynchronous work. Creation, work, file reads and cleanup have independent bounded signals and a lease cutoff.

The initial review found a cleanup response-validation defect: normal unknown-create discovery did not check the returned sandbox name, and cleanup treated any resolved stop response as terminal. The pinned SDK accepts generic session statuses, including `running` and `stopping`, in that response. This could close the durable recovery record without confirmed termination. The adapter owner fixed this: all cleanup paths now check the name and current session identity, require the returned session ID to match, and accept only `stopped`, `failed` or `aborted`. Wrong identities and nonterminal responses remain `cleanup_unconfirmed`.

Independent rerun of `node infra/project-runtime/vercel-publication-check.mjs` passed **18/18 groups**, including wrong-name refusal without issuing stop and nonterminal stop responses during normal/restart cleanup. No further concrete P1/P2 finding was identified in this bounded review. The reviewed modules were not edited by this reviewer. SHA-256 at handback:

| File | SHA-256 |
|---|---|
| vercel-publication-executor.mjs | 524cbf1f0a09a93a2972bf67c13dca3d862ee91cde665f082d18a6c55da73a76 |
| vercel-publication-protocol.mjs | 2616b217b3533789df76d9d8395493bdf8c1e4355fa0143e1efcac7446320596 |
| vercel-publication-render-entry.mjs | c1c5fbb7028a10ee1fa7ec7c0958f9b0876ec4cb78fa759ff15c508186dbcfbf |
| vercel-publication-render-watchdog.mjs | c8856af373fd7a03bd8e4bf0bf7ca7a67dcde13fe62105d9560e75874c90a49e |
| vercel-publication-check.mjs | 41cdd9fe0ca951d533339598266bcc66d6a56cbd2a9e73955d6df363b0bde2dc |

This review made **zero provider calls**. Live execution remains unqualified and disabled: immutable compiler/renderer image preparation, the actual default VM user/filesystem, Chromium OS sandbox and denied egress, remote resource bounds, source/font parity, the durable journal deployment, and provider cancellation/absolute expiry after unknown or delayed creation still require evidence. An API abort cannot prove that the provider did not create a VM; unresolved journal records must remain available for reconciliation. The owner report `vercel-publication-adapter-20261013.md` records these integration prerequisites in detail.
