# Supervised host preparation

**Prepared, not installed or qualified.** The historical staging controller ran for a bounded test on the owner's Windows PC. Its launcher records a PID; it provides no service installation or reboot guarantee. Do not describe it as an existing cloud supervisor.

Use an always-on Linux host with Docker and systemd for the trusted Node controller only. Compilation and rendering remain in separate ephemeral Vercel sandboxes. Never install generated dependencies or execute website code on this host. No inbound controller port is needed.

## Layout and separation

- `/etc/makeborne-publication/staging/controller.env` and `config/`: staging credentials and schema-1 configuration.
- `/etc/makeborne-publication/production/controller.env` and `config/`: independent production credentials and schema-2 configuration.
- Each `config/` contains `controller.json`, `database-ca.pem`, `approved-images.json`, all read-only in the container.
- Root owns the outer profile directories (0700) and real environment files (0600). The bind-mounted config leaf must be root:1000 mode 0750, and non-secret controller.json / database-ca.pem / approved-images.json root:1000 mode 0640, so the image’s node user (UID/GID 1000) can read them. A root:root 0700 mounted leaf blocks that user. Keep any operator credential JSON root:root 0600 and outside the runtime config where practical; never make it group-readable. The outer 0700 parent prevents ordinary host users traversing the path. Only trusted operators may access Docker; there is no Docker socket mount inside the controller.
- Install the reviewed controller image by immutable digest before enabling a service. Pin and qualify compiler/renderer images under their corresponding Vercel project registry prefix. The controller rejects cross-profile image paths.
- Create/verify `makeborne-publication-control`, a dedicated Docker network with working direct IPv6 access to the pinned Supabase host. Configure host egress for the exact database, broker, R2 endpoint and required Vercel control APIs. Do not weaken TLS or fall back to another database if connectivity fails. Record actual firewall rules and observed connectivity on the selected host.

## Installation gate

1. Owner approval received on 19 October: $6/month DigitalOcean host before tax and $2 total new staging cloud/recovery tests and storage. Production activation and paid AI calls are excluded. The approved dedicated host has been provisioned and its runtime, reboot and staging-only transport checks are recorded in docs/release-review/publishing-host-preparation-20261020.md. Both controller instances remain stopped/disabled after qualification. These historical checks do not qualify a newly integrated bundle. No paid add-ons are approved.
2. Install Docker from its official distribution and review this unit with `systemd-analyze verify`. The host needs `/usr/bin/docker` and the named network. Record host identity, OS, supervisor version and image digest.
3. Install `makeborne-publication@.service` in `/etc/systemd/system/` and the private per-profile configuration. Check configuration with the same image, mounts and environment using `--check-config`, before database/provider access.
4. Test the dedicated SQL login over verified TLS, its sole worker membership and exact namespace/allowlist attestation. Verify bucket-scoped R2 credentials against only that namespace bucket. Confirm production secrets differ from staging without printing them.
5. Qualify `makeborne-publication@staging` first. Stop/restart and deliberately kill the controller during compilation; verify database journaling, orphan cleanup and fenced retry before any new VM. Reboot the host and observe a successful `startup_verified` event and queue recovery. A unit file alone does not prove either test.
6. Enable automatic boot start with `systemctl enable makeborne-publication@staging`. Systemd starts it after Docker/network and restarts unexpected exits. Five failures within five minutes stop repeated crashes; an external alert and operator response are required. Monitor queue age, failed preparations, unresolved resources and process health.
7. Prepare production files separately. Keep the production unit stopped/disabled and Makeborne's production publication/broker flags off until the final owner go and all cloud gates pass. Actual production startup must attest the production database and exact approved workspace set.

## Recovery

Stop discovery by stopping the exact service instance. The 40-second supervisor timeout exceeds the controller's 26-second outer cleanup deadline; the container stop timeout is 30 seconds. Restart reconciles durable sandbox intents before discovery. No host reboot, deadline or process disappearance is proof that remote sandboxes stopped.

Rollback disables new preparations/broker access and stops only the production unit. Retain the additive migration, output objects, preparation records and lifecycle journal; keep existing sites and unpublish controls. Never restore raw browser bundle promotion or mark unknown sandboxes stopped to unblock work.

## Approved host cost

A DigitalOcean Basic 1 GiB / 1 vCPU host is listed at **$6/month**, before applicable tax; remote Vercel Sandbox builds and R2 storage/operations are additional. This is a starting capacity proposal, not measured production sizing. The controller is sequential and its container has a 512 MiB limit; qualify memory/latency on the actual host. Reuse an existing suitable Linux host if the owner supplies one.

Source checked 19 October 2026: https://www.digitalocean.com/pricing/droplets . Do not treat an AI testing budget as permission to buy a recurring host.
