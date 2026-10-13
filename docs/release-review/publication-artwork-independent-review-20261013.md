# Private publication artwork — independent review

2026-10-13. Read-only runtime review; no provider calls, credentials, cloud mutations or deployment. No implementation files edited by this reviewer.

## Outcome

No additional concrete P1/P2 finding in the final reviewed package. Root identified the historical immutable-preview origin blocker during review; the owner replaced that default with a required operator-configured staging origin. Independently verified the final fix: the allowed team/project host pattern is bounded, one origin is captured by the downloader, HMAC includes that exact origin, and the broker requires an exact request URL match. Alias ownership and routing still require operator verification before activation; a hostname pattern alone is not live ownership evidence.

Reviewed authentication replay, body limits, redirects and fixed destinations, app/controller secret separation, active preparation/fence checks, cancellation, original-byte hash/type verification, source-error secrecy and staging-only configuration. Signed replays are intentionally read-only within the timestamp window and rerun current SQL authority checks. The broker authenticates before privileged access, checks authority before and after the bounded original read, and emits no source bytes until hash verification and the second authority check complete. The controller's final resolver verifies the still raster and rechecks authority again. Cancellation and remote errors do not expose source paths or credentials.

Optional Vercel protection bypass is captured in the controller closure and sent only as a header to the configured broker destination with redirects disabled. It is absent from the signed body, URL, Storage request and generated workload. The broad Supabase key stays on the app side; the controller has only its narrow broker credential and restricted SQL authority.

## Independently rerun

- `node src/lib/projects/check-publication-download.cjs`: **15/15 groups pass**. Includes cross-origin signature rejection, fixed-origin bypass secrecy, replay after revocation, malformed/oversized authentication body, source identity/hash corruption, exact 20,000,000-byte chunked response, limits, missing/truncated/oversized streams, header-to-body cancellation, late responses, and disabled/production configuration refusal.
- `node src/lib/projects/check-publication-assets.cjs`: **14/14 groups pass**. Includes real PNG decoding plus mocked scoped RPC/download, wrong identity/type, malformed raster rejection, source mutation and cancellation.
- Focused ESLint across contract/downloader/broker/route/resolver/new harness: **0 errors, 0 warnings**.

These are offline checks with mocked network/Storage. The 20 MB stream is a real local Web ReadableStream, not a deployed Vercel response. Vercel's [official body-size guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) documents the streaming-response exemption; its [function limits](https://vercel.com/docs/functions/limitations) still bound duration. Actual staging 20 MB transport, alias routing, deployment protection, live API-key-only Storage access, latency and credential bootstrap remain unqualified. The broker remains disabled without explicit matching staging configuration.

## Reviewed SHA-256

| File | SHA-256 |
|---|---|
| `src/lib/projects/publication-download-contract.ts` | `2e45475f213cff82ccc0e23b64267720286b55e173908d0e15b5309eb05ae1ac` |
| `src/lib/projects/publication-download.ts` | `1b408b731cfe325eb13f89fdb11ca05e2eaa8855230c56141b3c2e04387c96ca` |
| `src/lib/projects/publication-asset-broker.ts` | `5aeb52dc811a602a18763d7c243d7cd795209ef176202decbd97db8533b51bb0` |
| `src/app/api/hosting/publication-assets/route.ts` | `9ce88671fcbf4786f137b430d2f9915a9a285967889c5d7af324aedbc58048af` |
| `src/lib/projects/publication-assets.ts` | `96b921d5ea5805a19ba76817aca596b7d170088d11e457be4232f884c46da9e0` |
| `src/lib/projects/check-publication-download.cjs` | `62cd79eae83f3d8d9dc86544b4661619dad3fc40945492379eb8c4b8052f2937` |
