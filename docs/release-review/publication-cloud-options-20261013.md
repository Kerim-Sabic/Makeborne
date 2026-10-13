# Trusted publication cloud execution and staging options

Review date: 13 October 2026. Scope: isolated publication compilation and rendering, durable supervision, private retention, and an isolated staging route package. No cloud deployments, provisioning, credential creation, account mutations or paid API calls were performed. Application and cloud configuration were read only. The three storage files listed below were changed and checked locally at the parent task's request.

Vercel Sandbox is the smallest remote executor adaptation for the existing Node orchestration. Cloudflare Containers is viable but needs more orchestration and memory work. Neither service is qualified for this application yet. Prepare the adapters and durable supervisor locally; keep trusted publication disabled until the exact cloud execution and recovery path passes staging. The existing model-call budget does not authorize hosting purchases or unbounded compute.

## Completed R2 correction and evidence

The publication compiler writes its final receipt at `publication-v1/<workspace UUID>/<preparation UUID>/<receipt hash>/receipt.json`. Both R2 adapters previously rejected that key because their shared validator accepted only the compiled-output namespace.

Changed files:

- `src/lib/projects/private-output-object.ts`: added only the exact publication receipt grammar, with lowercase UUIDs, a 64-character lowercase hexadecimal hash and the literal final filename `receipt.json`. Existing compiled-object grammar and traversal rejection remain.
- `src/lib/projects/check-r2-output-store.cjs`: actual publication compiler fixture using local workerd/R2, immutable receipt readback, rejected malformed publication paths before binding calls, and receipt persistence after restart.
- `src/lib/projects/check-r2-s3-output-store.cjs`: the same publication compiler path through independently verified signed HTTP into actual local workerd/R2, with rejection before transport and restart recovery.

Results: `node src/lib/projects/check-r2-output-store.cjs` passed 9 groups; `node src/lib/projects/check-r2-s3-output-store.cjs` passed 9 groups. Focused ESLint on those three files and `git diff --check` passed. The compiler and renderer used by these storage fixtures are synthetic; the publication orchestration, serialized receipt, R2 persistence and conditional-write paths are real. These checks do not qualify live R2, a cloud executor or fresh design quality. Node emitted the existing module-type inference warning for hosting policy JavaScript.

## Existing execution contract

`src/lib/projects/publication-worker.ts` already keeps its control RPC outside `PublicationCompilerDependencies`. It loads fenced saved source and original artwork, compiles and retains output, captures each declared route, then asks SQL to complete. SQL promotion remains a separate explicit customer action.

The five-minute SQL lease allows at most three attempts and expires the preparation after 24 hours. The worker caps execution at 290 seconds or the remaining lease minus five seconds. The local compiler uses one CPU, 512 MiB memory, 64 PIDs, a read-only root, 192 MiB tmpfs, no network, an unprivileged user, dropped capabilities and a separate watchdog. The browser controller has manifest-only routing and isolated-world DOM capture, but the local browser process is not a production OS isolation boundary.

Production gaps remain concrete: no publication candidate selector or delivery supervisor, no dedicated restricted publication role, no cloud executor adapter, and no qualified cloud renderer image. Migration 54 currently grants publication RPCs to `service_role`; the existing generation queue roles do not cover publication. A TypeScript RPC allowlist is not a replacement for database grants.

## Vercel implementation candidate

Use a dedicated trusted Node supervisor with the existing `runPublicationPreparation`, `publicationArtworkResolver` and `createR2S3OutputStore`. Retain database, R2 and Vercel control credentials only in this supervisor. The sandbox receives only bounded workload bytes or retained public build bytes.

Create one fresh compiler microVM per preparation/fence with a fixed reviewed image reference, `persistent: false`, `networkPolicy: "deny-all"`, no exposed ports, no mounts and a provider-enforced timeout shorter than the remaining lease. Explicit deny-all blocks DNS as well as Internet and Secure Compute access. Do not open egress for dependency installation: dependencies and fonts are already pinned in the runtime. [Vercel firewall](https://vercel.com/docs/sandbox/concepts/firewall)

Vercel custom images must be optimized `linux/amd64` images in VCR. Docker `ENTRYPOINT` and `CMD` are not executed; the adapter must explicitly start `/opt/makeborne/watchdog.mjs`. Pin the image by digest, and bind the returned build receipt to trusted deployment configuration. A local Docker image `.Id` is not automatically the registry manifest digest; record the exact qualified mapping. [Vercel images](https://vercel.com/docs/sandbox/concepts/images)

Transfer input with the SDK file API. Fetch only exact manifest paths with bounded streaming reads, then independently verify paths, byte lengths, hashes, source and toolchain identity. Never extract an untrusted output archive on the supervisor. Stop the compiler VM in `finally`, including on cancellation or invalid output.

Launch a separate fresh renderer VM from a reviewed image containing Chromium, Playwright and the existing controller/policy modules. Supply only retained build bytes, route and intended public origin. Preserve `chromiumSandbox: true`, blocked sockets and service workers, route interception, native isolated-world readiness/capture, and renderer identity checking. A fixed internal entrypoint can read one bounded input file and write one bounded result without exposing a public port. Cloud support for Chromium's OS sandbox must be demonstrated; removing that sandbox to make startup succeed is not an equivalent qualification.

The cloud VM allocation is a new resource profile. Vercel exposes vCPU allocation, associated memory and a whole-session timeout; it does not reproduce the local Docker PID, tmpfs and root filesystem flags through those creation options. Test the actual cloud boundary and record any accepted differences. Process cancellation alone is insufficient: provider timeout must terminate abandoned work after supervisor death. [Vercel SDK](https://vercel.com/docs/sandbox/sdk-reference)

For external Node hosting, Vercel requires team ID, project ID and an access token; a process hosted on Vercel can use managed OIDC. Local downloaded OIDC expires after 12 hours and is unsuitable for unattended service operation. No durable supervisor hosting entitlement or scoped credential has been established in this review. [Authentication](https://vercel.com/docs/sandbox/concepts/authentication)

At published `iad1` rates, CPU is $0.128 per active vCPU-hour and memory is $0.0212 per GB-hour. One vCPU includes 2 GB memory; disk is 64 GB. An illustrative sequential 290-second budget at full one-vCPU utilization costs about $0.0137 for CPU and memory, excluding orchestration, image/storage/transfer charges and minimum billing increments. Region and plan matter; this is not an account quote or an authorized budget. [Vercel pricing](https://vercel.com/docs/sandbox/pricing)

## Durable supervision that can be implemented locally

1. Add a bounded private SQL selector for queued and expired-lease publication IDs, plus a dedicated restricted publication-worker role. Polling the durable preparation table is the smallest queue mechanism; it must resume after process death and revisit expired leases. Existing fenced claim/complete functions remain authoritative. If a separate queue is introduced later, use transactional outbox delivery and at-least-once handling rather than enqueueing after an unrelated transaction.
2. Add `infra/publication-worker` bootstrap with concurrency one, fixed deployment configuration, graceful cancellation, sanitized logs and health reporting. Candidate discovery must avoid starvation by revoked/invalid preparations; those require bounded terminal reconciliation, not endless selection of the same failing row.
3. Add the Vercel compiler and renderer adapters with injected transport for local checks. Record preparation/fence/sandbox identity and expected expiry so a restart can clean up abandoned execution.
4. Budget the complete lease: 60 seconds of compilation plus twenty routes at the current default 15 seconds already exceeds the 290-second total before storage and startup. Enforce a remaining-time route policy and fail safely; never silently extend authority.
5. Qualify killed supervisor, unknown creation response, hung renderer, lost SQL completion response, duplicate delivery, failed R2 readback, revoked session, stale source and old-fence completion. Confirm provider expiry and cleanup independently of the controller process.
6. Keep conditional R2 writes and exact readback; write the publication marker only after route capture, then perform fenced SQL completion. VM snapshots are not retained publication authority. Garbage collection must preserve ready/promoted referenced objects.

## Cloudflare alternative

Current Cloudflare documentation describes container microVMs controlled by Workers/Durable Objects, with Durable Object scheduling in public beta. It now exposes direct `ctx.container.start` and `exec` examples. The installed Sandbox skills still describe stable/next package lines, so implementation must pin current published package/types and matching image APIs rather than combining examples from different generations. [Overview](https://developers.cloudflare.com/sandbox/), [Linux setup](https://developers.cloudflare.com/sandbox/get-started/)

Use separate compiler and renderer containers per preparation/fence, `enableInternet: false`, no outbound handlers and no bucket mounts. Keep all bindings and credentials outside. Current security documentation states that deployed sandbox processes have root capabilities and can switch back to root; a different Linux user is therefore not an independent boundary. Any required root-resistant inner resource or filesystem restriction needs demonstrated provider support. [Cloudflare sandbox security](https://developers.cloudflare.com/sandbox/concepts/security/)

The existing Node pipeline buffers source, artwork, serialized build input and retained files. A direct Worker port needs memory profiling and likely streaming changes because Workers provide 128 MB per isolate. It is therefore a larger change than the Node/Vercel adapter. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)

Containers require Workers Paid, starting at $5/month. Published additional usage is $0.000020 per active vCPU-second, $0.0000025 per provisioned GiB-second and $0.00000007 per provisioned disk GB-second. Workers, Durable Objects, logs and storage add their own usage. No plan upgrade or paid container run is authorized by this report. [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/)

## Two fixed staging hostnames on the existing domain

The current customer-sites Wrangler file declares identical staging and production wildcard/apex routes. A staging deploy from that configuration is not isolated. Private-preview's top-level configuration also uses production database/origins and cannot be reused as staging without an explicit separate package.

The minimum candidate uses `release-check.makeborne.site` and `release-check-renamed.makeborne.site`, with the existing staging database and application origin. The staging route list would be exactly:

```json
[
  { "pattern": "release-check.makeborne.site/*", "zone_name": "makeborne.site" },
  { "pattern": "release-check-renamed.makeborne.site/*", "zone_name": "makeborne.site" }
]
```

Keep `workers_dev: false`, `preview_urls: false`, `SITE_INDEXING_ENABLED: "false"` and `SITES_DOMAIN: "makeborne.site"`. Staging has no apex route and no wildcard host route. The production wildcard can remain the eventual default for other labels. These exact patterns still mathematically intersect that wildcard, but Cloudflare selects the most specific matching route. Exact host routes therefore take priority deterministically. Matching requires proxied DNS; verify existing DNS before assuming the two names resolve. Cloudflare recommends Custom Domains for Workers acting as the origin, but simply using Custom Domains does not override route precedence, so it is not a substitute for verifying this shared-zone route arrangement. [Routes and matching rules](https://developers.cloudflare.com/workers/configuration/routing/routes/)

Both names are first-level subdomains of `makeborne.site`. In a full-setup zone they fall within normal Universal SSL hostname coverage; `slug.staging.makeborne.site` does not. No new domain or Advanced Certificate Manager purchase is inherently needed for these two names. Actual proxied DNS, active certificate coverage and successful TLS handshakes remain prerequisites before enabling them. [Universal SSL limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)

Each fixed hostname is a separate browser origin, so publish and rename can be exercised with the current `{slug}.makeborne.site` address shape. Paths under one `workers.dev` hostname would share an origin and do not exercise the same isolation. The two QA hosts share a registrable domain with customer hosts; they must carry no application authentication credentials or parent-domain authentication cookies. The application remains on its distinct application origin.

Required application and SQL changes, to prepare separately:

- Introduce deployment address policy independently of syntactic label validity. Do not merely add these names to `RESERVED_SITE_SLUGS`: `validSiteLabel` also feeds `PublicationBindingSchema` and `siteSlugFromHost`, which would prevent staging compilation and serving.
- Production customer allocation must deny both QA labels in its server and SQL request/promotion/address-change boundaries. Browser validation is only a convenience. Staging must permit only the two fixed labels under a server-controlled staging database/deployment guard, with access restricted to the QA scope. No request flag or browser-selected environment may bypass reservation.
- Separate host parsing from allocation eligibility. The staging Worker must reject every host except the exact two names before cache access, RPC calls, form handling or redirects. The production Worker should reject the QA names as defense if the exact routes are absent. Unknown hosts must not fall back to the application, legacy redirects or another site's content.
- Enforce the same exact-label policy when preparing a publication, changing its address and formatting its displayed URL. Keep staging app public hosting configuration on `https://{slug}.makeborne.site/`; its verified-domain setting is an operator attestation after DNS/TLS checks, not proof by itself.
- Use one dedicated staging artifact for publish then rename. The existing address reservation mechanism retains old addresses for their artifact, so repeat checks should reuse/reset the isolated fixture deliberately. First inspect current ownership/reservations for both names; do not seize an existing customer address.

Before any staging deployment, capture the route inventory, proxied DNS and active certificate state; confirm both names are unused in the intended customer namespace. Qualify exact-host precedence, HTTPS, indexing headers, staging-only database access, ordinary-host rejection, renamed-address behavior and rollback. Removing the exact staging routes must not accidentally serve production content at reserved QA addresses. No route, DNS, certificate, app configuration or account change was made for this review.
