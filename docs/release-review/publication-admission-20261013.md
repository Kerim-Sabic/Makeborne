# Publication admission race review — 13 October 2026

## Conclusion

The proposed current-schema race was **falsified**. An actor cannot own two workspaces: the unconditional unique index `one_owned_workspace_per_user` covers `public.workspaces(owner_id)`. It is present in both `docs/release-review/production-schema.sql:2064` and migration `20261003124728_cloud_idempotent_mutations.sql:132`, and remains active after candidate migration 55.

Migration 54's `publication_authority` requires `workspace.owner_id = p_actor` and locks that workspace `FOR UPDATE` before the request count. Every valid request for an actor therefore serializes on that actor's unique workspace, including requests for different artifacts and different request IDs. The public invoker and granted private request function share that same implementation.

**No migration 56 was implemented or applied.** The newly created empty CLI file `20261013045537_publication_admission_serialization.sql` was removed only after checking its resolved absolute path and zero-byte size. Migrations 54 and 55, the ownership index, and deployed database behavior were not changed.

## Real disposable verification

Command: `node supabase/check-publication-admission.mjs makeborne_publication_20261013034802`.

All five groups passed at 2026-10-13 04:59:26 UTC:

1. A second owned workspace is refused by the actual unique index.
2. A valid session belonging to a different actor receives `42501: Owner required` when requesting work in the first actor's workspace.
3. Starting with 29 requests, concurrent distinct request IDs for two different artifacts in the same owned workspace produce **one acceptance, one `MB429`, final count 30**. One call uses the public bridge and the other the granted private function. A narrowly scoped disposable trigger pauses at INSERT, after the admission count, to expose any missing serialization without changing the implementation being checked.
4. The original request can still be replayed at the cap, returning its original preparation ID without inserting another row.
5. While the first actor is observed waiting on its existing workspace lock, an unrelated actor successfully admits a request; releasing the lock allows the waiting replay to finish.

Machine evidence: `docs/release-review/publication-admission-20261013.json`. Harness SHA-256: `1a38de3d2a62666f55a36849daeb30678ff421b35b0abe2b582a10b3bd4f22c5`.

Only the explicitly authorized disposable container/database was used. Synthetic data and the scoped delay trigger/function were removed in `finally`. No main local database, cloud database, provider request or paid service was touched. The regression is intentionally tied to the current one-owned-workspace invariant; if that invariant is deliberately removed in a future migration, actor-wide admission serialization must be reconsidered at the same time.
