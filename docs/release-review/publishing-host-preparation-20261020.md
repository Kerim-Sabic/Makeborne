# Publishing controller host — 20 October 2026

Status: **host prepared and reboot tested; publishing is not yet cloud-qualified or activated**.

## What changed

Created the owner-approved DigitalOcean host `makeborne-publication-control-01`, Droplet 610683000, London, Ubuntu 24.04. Regular Basic 1 GiB / 1 vCPU / 25 GiB at $6/month before tax. No backups, volumes, database, paid monitoring or other add-ons. This is an ongoing host cost, not a free trial; the account's separate inference signup credit is not counted toward it.

Dedicated previously approved SSH key only. Password and keyboard-interactive SSH authentication disabled; root uses keys. Default-deny inbound firewall permits SSH on IPv4/IPv6. No public app/controller port. Docker and firewall start automatically; 1 GiB swap protects this small controller host from avoidable memory exhaustion. Generated website code/dependencies must never run directly on this host.

Transferred the already locally qualified controller image by immutable ID `sha256:c1e0e6fbd0a07513700ee5e15d74b2bfbc4de21c6f6ccea3e6060404f95cf45d`. Actual non-root, read-only, no-network, dropped-capability, bounded-memory self-check passed on the cloud host with Node 24 and pinned SDK 3.7.0. Installed the reviewed systemd template; systemd-analyze verify passed. Separate 0700 staging and production configuration directories exist.

## Reboot and connectivity evidence

Host boot ID changed from `0cd2f5fe-5fbf-4b63-afc5-8ad0f286de56` to `14d1127c-f05e-4a9b-ab3a-8f5084a3ff3f`. After reboot, Docker and firewall were active, the dedicated IPv6 Docker network persisted, and the controller self-check passed again. Before reboot, a connection from that Docker network to the exact staging database host/port succeeded.

This is **host reboot evidence**, not controller job recovery. Both makeborne-publication@staging and @production remain disabled/inactive. No production credentials, bucket, rollout grant or runtime switches were installed/enabled.

## Staging access refresh

Owner approved 24-hour staging-only replacements on 20 October. Created a new limited staging login with sole membership makeborne_publication_worker, no inheritance/superuser/create-role/create-database/replication/RLS bypass, connection limit 2, and verified staging namespace/QA identity over verified TLS. Expiry is recorded privately in UTC. No production role changed.

Created the approved 24-hour Object Read & Write R2 token scoped only to makeborne-publication-staging. Private credentials were transferred only to the new host’s restricted staging configuration. From that host, actual restricted-login TLS and worker attestation passed; private R2 PUT/GET and conditional overwrite rejection passed, and the synthetic test object was deleted. The transport probe ran as a trusted root test reader; the controller runtime self-check separately ran as its default non-root user. Do not report compiler/renderer cloud qualification from these transport checks. No paid Sandbox VM or AI calls have been made in this continuation. The new staging test allowance remains the previously approved $2 total, not a fresh allowance per retry.

## Remaining gates

1. Staging database/R2 transport proof is complete; retain its bounded credential expiry and cleanup receipt.
2. Prepare scoped Vercel runtime access and current broker protection without copying a broad personal token onto the host. A direct read initially returned 403; routine official CLI authentication refreshed successfully, and a fresh read confirms makeborne.com remains on dpl_BSTNcBDmzcEHDWSvoTV1pPpjq6cW. Deployment/compute API access is not now blocked, but unattended host credential scope and refresh still need qualification.
3. Freeze the exact publishing candidate, rehearse its staging migration/profile and deploy only staging. Requalify current advisors/broker identities.
4. Start only the staged supervisor and run the approved cloud builds/recovery/network-isolation/preview-hosted equivalence tests, tracking the $2 ceiling and confirming cleanup.
5. Prepare a complete production activation/rollback packet. Wait for Kerim's separate go before any production change.

Source references: https://docs.digitalocean.com/products/droplets/how-to/connect-with-ssh/ ; https://vercel.com/docs/sandbox . Private command/host receipts under work/trusted-publication/staging-refresh-20261020/. No credentials belong in this report or the public repo.

## Host permission correction

Corrected the supervisor runbook: a root-owned 0700 bind-mount leaf prevents the image’s non-root node user from reading runtime configuration. Keep outer directories 0700 and environment/credential files 0600 root-only; the mounted non-secret config leaf is root:1000 0750 and its non-secret config files 0640. An actual non-root container can read a harmless config probe while R_OK on the operator credential JSON is denied. The first probe mistakenly used F_OK (existence), so its apparent failure was a test error; the corrected read-permission probe passes. No secret contents were printed or exposed. Production service/configuration remains off.
