# Publishing failure follow-up — 20 October 2026

Owner authorization: continue isolated billing/publishing qualification under the same $5 cap. Production unchanged. No new production credentials, routes, settings, deployments, merges or AI calls.

## Evidence by level

| Boundary | Result | Evidence level |
| --- | --- | --- |
| Lost sandbox create reply, then first discovery failure | One real staging VM was accepted; injected reply loss and lookup failure left `cleanup_unconfirmed`. A separate process used the actual reconciler with `resume:false`, confirmed stopped, and found exactly one session and no second create. | Actual cloud provider; journal persisted in a private file for this standalone probe. This does not alone prove database-journal integration. |
| Durable journal recovery, stale execution/cleanup fences, deleted owners/preparations, admission races, attempts and retention | Ten journal groups pass against the actual SQL chain, including concurrent claims, bounded compiler/renderer admission, old-fence refusal, unresolved cleanup blocking new creation, and cleanup surviving cascades. | Isolated real PostgreSQL with synthetic provider records. |
| Promotion/save/revocation races | Five groups pass: one preparation and lease, one promotion/replay, changed source refuses stale promotion, session revocation blocks promotion. | Actual concurrent PostgreSQL connections. |
| Worker security/attestation and admission | Exact role/RPC/schema grants and six attestation groups pass; injected excess access, overloads and disabled RLS refuse startup, then restore. Admission quota race accepts one of two contenders at the final slot. | Actual dedicated local login and SQL. No local TLS/cloud-role qualification is inferred. |
| Preparation/promotion failure boundaries | All four publication SQL suites pass, including bounded retry exhaustion and preservation of the previous live output. | Isolated SQL. |
| Storage access denied | Actual staging R2 GET with deliberately invalid synthetic credentials returns 401; the actual store raises unavailable, never treats it as a missing object, and sends no retry. | Actual cloud HTTP + actual store; no object was written or real credential revoked. |
| Storage network outage/caller abort | Network exception becomes unavailable; an already-aborted caller makes no request. | Injected network failure + actual storage implementation. A provider-wide R2 outage was not caused. |
| SDK/executor orchestration | 20 adapter groups and nine worker groups pass, covering write/command failure, journal latency, abort, cleanup identity, expired sessions, lost completion and fenced failures. | Offline SDK/database doubles, explicitly separate from cloud proof. |

The earlier real Linux-supervisor restart during rendering, fenced retry, retained-preview approval, public desktop/mobile output and form-to-CRM check remain the integrated staging evidence. No production activation is implied by combining these levels.

## Remote checks

Before this report-only checkpoint, PRs 9, 10 and 11 have passing GitHub verification and Vercel preview deployments. Qualification app candidate `5bad737` and billing predecessor `6aa2dc1` are the checked heads. Billing follow-up `9e86be5` adds only test/operator/documentation changes; its new remote results must be recorded separately. Drafts remain unmerged.

## Budget and cleanup

The new cloud probe reserved $0.25 before any provider create: maximum one VM, one CPU, 75 seconds, private registry retention limited to the test. Its full bound remains counted. Combined ledger: $1.767315 measured AI + $0.348756 uncertain AI bound + $1.00 conservative cloud bounds = **$3.116071 / $5**. This is not an invoice or a new allowance.

The one new VM was independently confirmed stopped with exactly one session. Its temporary registry repository was deleted and private Docker authentication removed. The temporary local databases `publication_faults_20261020` and `billing_job_20261020` were dropped; synthetic journal/worker roles were cleaned by their test harnesses. The historical tracked admission report accidentally received harness output; it was copied into private new evidence and restored to its original contents. Existing golden QA publication stays unchanged at revision 3. The production controller remains off; no recurring host was newly purchased.

Private evidence: `ambiguous-cloud.json`, `storage-denial.json`, `publication-faults.json`, `fault-publication-sandbox-journal-20261013.json`, `fault-publication-worker-attestation-20261013.json`, `fault-publication-admission-20261013.json`, and the publication SQL/adapter/worker logs in the primary checkout's ignored qualification directory. Do not publish credentials, raw provider payloads or private account inventories.

## Remaining release gates

- Fresh provider-signed checkout/refund/renewal delivery on the exact candidate is separate from read-only observations and locally signed replay. The direct-provider failed-cycle probe has no application checkout binding. A later weekly renewal cannot be inferred from a historical trial-ending charge.
- The combined publishing runbook still requires operator review of evidence levels, long-lived production controller authentication and final production activation approval. The new standalone cloud cleanup probe is not a substitute for every fault in the full hosted application/controller/database chain.
- No OpenAI image key; native Windows/macOS Office review remains pending. Keep unqualified features off.

Rollback: these follow-up changes are tests/operator documentation only. Keep production flags off and do not revert fenced cleanup, restore raw browser-output publishing or erase unresolved journals to make a queue appear healthy. Coordinate next steps through AGENT_HANDOFF; only Kerim can approve production changes.
