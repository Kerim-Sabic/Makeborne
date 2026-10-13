# Private publication source broker — 2026-10-13

## Scope and result

Implemented a bounded application-side asset broker and controller downloader. No credentials were created/read, no cloud requests or deployment changes were made, and the broker remains disabled unless explicitly configured. `.env.example` explicitly sets the broker flag false with empty origin and secret. This is local implementation evidence, not live storage, Vercel protection, or 20 MB deployment qualification.

The controller holds a dedicated broker HMAC secret, never a Supabase service key, Storage credential, or JWT signing secret. Each request names only preparation ID, worker ID, fence and asset ID. The app resolves the storage locator using the existing service-only fenced `makeborne_load_publication_preparation` RPC, reads the original, checks its exact length and SHA-256, then repeats the fenced lookup and compares identity before returning any bytes. The controller artwork resolver independently verifies the original hash, raster type, and final fenced asset identities.

## Contract and configuration

- `publicationSourceDownloader({secret, origin, protectionBypassSecret?, fetch?, now?})` returns the artwork resolver's download callback. Its fourth argument is `{preparationId, workerId, fence, assetId}`; the existing first locator argument is never transmitted.
- `POST /api/hosting/publication-assets` accepts at most 1,024 bytes of strict JSON with those four fields. Positive fence values are bounded to PostgreSQL bigint.
- HMAC-SHA256 binds protocol version, POST, configured origin, exact route, timestamp and raw body SHA-256. Signatures use constant-time comparison; timestamps allow ±30 seconds. Replay within this small window is a read-only request that must pass current SQL authority again. There is no replay database or independent asset entitlement.
- App configuration requires `MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED=true`, `MAKEBORNE_HOSTING_NAMESPACE=staging`, the exact existing staging Supabase URL, valid `MAKEBORNE_STAGING_QA_WORKSPACE_ID`, `MAKEBORNE_PUBLICATION_ASSET_BROKER_SECRET` containing 64 lowercase hex characters, and `MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN`.
- The origin has no default. It must be the staging project's team alias or the same project's nine-character deployment host under `kerimsabic-6594s-projects.vercel.app`, with HTTPS and no port, path, credentials, query or fragment. App and controller must pin the same operator-verified origin. A historical immutable deployment URL cannot automatically receive new code; alias ownership and routing remain activation prerequisites.
- Optional `protectionBypassSecret` is a controller-only credential supplied through `x-vercel-protection-bypass` to that pinned broker origin. It never enters a query string, body, cookie, Storage request or sandbox. HTTP redirects are rejected; an intercepted login/error response fails closed. No actual bypass secret was acquired or tested.
- Storage reads use only the fixed staging Supabase `project-assets` authenticated endpoint and an application-only `apikey` header. No caller-selected URL/path, user session, controller Storage key, or new SQL grant is used.

## Bounds and failure behavior

The downloader has a 25-second deadline; broker work has a 20-second deadline and the route a 30-second maximum duration. Fetch, authority calls and reader operations are abort-raced even if a mocked transport ignores the signal; late HTTP bodies are canceled. Both ends enforce exact byte counts while reading, reject compressed/unexpected responses, and redact provider errors. Source descriptors retain the existing 20,000,000-byte per-asset limit and the resolver's 40,000,000-byte aggregate limit.

The broker privately buffers at most the declared asset limit, checks hash and authority, then returns a `ReadableStream` in 65,536-byte chunks with no Content-Length and private/no-store/no-transform headers. Thus authority failures cannot leak a partial original response. Vercel's official guidance explicitly exempts streaming responses from the usual 4.5 MB response limit: [body-size guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions). This relies on the deployed route preserving actual streaming; a real protected 20 MB transfer must still be checked before activation. A stalled consumer remains subject to request cancellation and platform duration limits.

Deployment protection support follows [Vercel's header-based automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation). Supabase generated S3 access keys were rejected as controller credentials because they bypass RLS and grant broad storage access: [Supabase S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication). The current installed Supabase source and documented new API-key semantics informed the application-only `apikey` transport; actual hosted Storage authentication remains unqualified here.

## Verification

- `node src/lib/projects/check-publication-download.cjs`: 15 groups passed with mocked HTTP, Storage and SQL. Includes exact signed transport; origin/HMAC isolation; protected-preview header confinement; malformed/oversized bodies; stale timestamps and four-field tampering; replay after revocation; locator identity/traversal failures; post-read version/path/revocation; hash corruption; full 20 MB streamed response and 20 MB + 1 denial; Storage bounds/encoding/errors; stalled and late fetch cancellation; abort between headers and first read; route disabled/default/production guards and exact RPC arguments.
- `node src/lib/projects/check-publication-assets.cjs`: existing 14 groups passed with real PNG decoding and no provider calls.
- Focused ESLint on the six files below: passed, zero warnings/errors.
- `npx tsc --noEmit --pretty false`: passed after replacing a bigint literal to match the repository TypeScript target.

These checks exercise the actual helper and route source with mocked boundaries. They do not independently qualify Supabase's deployed RPC/Storage behavior, deployed origin ownership, network deadline enforcement in the platform, or Vercel protection/streaming. Root owns combined controller assembly and full-suite/build evidence. The independent reviewer reran all 15 broker and 14 artwork groups plus focused lint, reporting no additional concrete P1/P2; see `publication-artwork-independent-review-20261013.md`. No credential or application code was copied into source workloads.

## Source hashes at handback

| File | SHA-256 |
| --- | --- |
| `src/lib/projects/publication-download-contract.ts` | `2e45475f213cff82ccc0e23b64267720286b55e173908d0e15b5309eb05ae1ac` |
| `src/lib/projects/publication-download.ts` | `1b408b731cfe325eb13f89fdb11ca05e2eaa8855230c56141b3c2e04387c96ca` |
| `src/lib/projects/publication-asset-broker.ts` | `5aeb52dc811a602a18763d7c243d7cd795209ef176202decbd97db8533b51bb0` |
| `src/lib/projects/publication-assets.ts` | `96b921d5ea5805a19ba76817aca596b7d170088d11e457be4232f884c46da9e0` |
| `src/app/api/hosting/publication-assets/route.ts` | `9ce88671fcbf4786f137b430d2f9915a9a285967889c5d7af324aedbc58048af` |
| `src/lib/projects/check-publication-download.cjs` | `62cd79eae83f3d8d9dc86544b4661619dad3fc40945492379eb8c4b8052f2937` |
