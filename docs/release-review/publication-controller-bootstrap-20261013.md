# Publication controller bootstrap — 2026-10-13

Local package complete; live activation remains disabled. No remote database connection, provider call, cloud write, credential creation, deployment, or paid compute was performed.

## Delivered

`infra/publication-controller` is a standalone, locked Node 24 bundle and container build. It imports the current trusted worker, artwork resolver, fenced private broker downloader, private R2 store, and durable controller composition. No runtime installation or Supabase administrator credential is used. Configuration accepts only the pinned staging project, exact protected broker origin family, private staging output bucket, approved compiler/renderer image mapping, verified database TLS, and a dedicated restricted SQL login.

Startup attests actual TLS, session role/membership and grants, then migration 58 checks exact worker RPC signatures and privileges and returns actual namespace/QA workspace before adapters or work discovery are constructed. Shutdown aborts work with a bounded cleanup/pool grace and a final exit deadline. Idle database errors settle as failure. Logs permit only bounded fixed fields.

The standalone entry is `entry.mjs`; its imported application TypeScript is bundled explicitly. Root Next TypeScript configuration was not weakened.

## Evidence

- Eight focused offline groups passed on the host and actual Linux Node 24 with network disabled.
- Actual bundled native Sharp codec self-check passed in that Linux image.
- Six disposable SQL attestation groups passed, including an executable same-name overload rejection and actual restricted login catalog query. The disposable database uses plaintext locally; this is not live TLS qualification.
- Root TypeScript check and scoped lint passed.
- Entry SHA256: `2ff7b6ed8351e75ced7e1bb78cd971c8e98a5dd0eb2688eb10b388b35355fd30`.
- Bundle SHA256: `d8f8a9fa441da63dfa25aa99ec54d017c09b3de9d6a88e4a90128a9c473ea2e4` (1,422,302 bytes; 221 inputs).
- Local image: `sha256:d245111dd50ead5d685f9ad235dfdb66f40b8d6b739e059d04ef87f6b42ef635`.
- Frozen migration 58 SHA256: `67b2e1d46bdace0364b3446fa1627796fd6d242941b2c29467859c574b94c0e6`.

Machine evidence is in `publication-controller-bootstrap-20261013.json` and `publication-worker-attestation-20261013.json`. Migration presence alone is never accepted as runtime health.

## Remaining activation inputs

Actual qualified compiler/renderer images and evidence, private staging bucket and scoped token, dedicated SQL login, verified staging CA/connectivity, owner-configured staging QA workspace, deployed private broker and matching HMAC/protection secrets, explicitly scoped Vercel token and compute allowance, and an approved supervised host. Live create uncertainty, expiry, networking, and resource enforcement still require qualification. The package README contains the operator configuration contract.

## SDK session correction

Review of installed SDK 3.7.0 found Sandbox workload convenience methods implicitly resume a stopped session. The executor now captures the initial Session, validates its running state, identity, timeout and exact expiry equivalence, and passes only that Session to every workload read/write/command. Named get with resume false and Sandbox stop remain cleanup controls. This preserves the immutable journal session and prevents work from silently moving to an unrecorded session.

Nineteen executor groups passed with every mock Sandbox workload helper forbidden. Three additional checks use the actual installed SDK classes and an in-memory API client: the convenience-method resume behavior is reproduced for all three methods, direct Session operations propagate the original stopped-session response without resuming, and the executor stops the original session after a real SDK Session write fails. These checks and the eight startup groups passed on Linux Node 24 with networking disabled. Executor SHA256: `1f1aa7a36258369fa0fabe03cd0e6df0e60a53ede103ea49fbd86255dee2d1fc`. No schema or fresh Auth stack was changed by this correction.
