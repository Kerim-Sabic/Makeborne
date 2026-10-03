# Local backend fixture verification

`supabase/check-local-fixtures.mjs` is a destructive-fixture runner restricted to the dedicated Makeborne development API at `http://127.0.0.1:55321`. It never resets a database, deletes existing users, or accepts a remote endpoint. Run only after the local stack and migrations are ready.

Provide `MAKEBORNE_LOCAL_STATUS_FILE` pointing to a private CLI status JSON outside the repository, and explicitly set `MAKEBORNE_VERIFY_LOCAL_FIXTURES=true`. Then run `node supabase/check-local-fixtures.mjs` from the repository. The status file must contain API_URL plus PUBLISHABLE_KEY and SECRET_KEY (legacy ANON_KEY and SERVICE_ROLE_KEY are also supported). Never commit that file or paste its contents into chat.

Each run creates four independent confirmed local accounts with random credentials and two workspaces/projects. Workspace and project creation use the same authenticated RPCs as the application. Privileged access is used only for account creation and controlled reviewer membership setup/revocation. Secrets remain in process memory and the child verifier's environment; they are not logged. HTTP requests refuse redirects and time out after 15 seconds.

Checks include:

- Owner and reviewer positive reads, anonymous denial, cross-workspace reads and writes.
- Reviewer mutation denial and protected owner identity.
- Concurrent idempotent artifact creation, conflicting key rejection.
- Concurrent revision conflict, lost-response replay, immutable snapshots and pointers.
- First-workspace setup race and duplicate-workspace prevention.
- Owner storage upload/download and assigned reviewer download.
- Cross-workspace storage download denial, reviewer upload denial, overwrite denial with original byte preservation.
- Revoked reviewer loses project and storage access with the existing session token.

Fixtures are intentionally retained in the dedicated local database with a unique run ID, allowing inspection of snapshots and audit effects. The script does not clean up immutable history through unsupported client deletes.

Passing this suite is evidence for these local database/API invariants only. It does not verify production configuration, browser signup/confirmation/recovery, cross-project asset references, export restoration, worker execution, model generation, payments or website hosting.

## Execution record

2026-10-03: live run `61e9bb57-044a-49cf-b4b9-73d2d1487f67` passed on the dedicated local stack. All 25 standalone isolation checks passed, followed by storage positive/negative controls and membership revocation checks. Four accounts authenticated independently. Syntax validation and the default refusal guard were also checked.

The first live storage positive control exposed an actual policy bug: unqualified `name` inside the workspace subquery bound to `workspaces.name`, rather than the object path. This denied legitimate uploads. Both policies now explicitly use `storage.foldername(objects.name)`. The fix preserves workspace membership, read/edit distinctions and the prohibition on overwrite. It was verified locally, then captured using scoped CLI schema pull as migration `20261003161607_storage_object_path_scope.sql`. All four migrations are recorded as applied locally. Local security advisors at warn/error level returned no issues. No remote database was modified.

Earlier failed fixture runs remain for inspection; the passing run ID above identifies the complete verification. No production acceptance claims follow from these checks.

## Local application connection

After the passing fixture run, a gitignored `.env.local` was configured with only the dedicated local API URL and publishable key, plus the two local cloud activation flags. No administrative, service-role, model-provider or payment credentials were added. Online `check-setup.mjs` successfully verified an independent local session and schema version. The existing development server picked up configuration: `/api/capabilities` reports the cloud workspace available and generation/payments/publishing unavailable; `/login` returns HTTP 200; the callback route is enabled and handles a missing code with its safe confirmation-error redirect. These HTTP checks do not establish successful browser signup, email confirmation, session cookie persistence or password recovery. Those flows remain to be exercised before production activation.

References: [Supabase admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).
