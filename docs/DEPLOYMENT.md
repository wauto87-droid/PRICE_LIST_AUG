# Isolated deployment to the existing VPS

For the current guided installer and smaller memory profile, follow
[LOW_MEMORY_INSTALL.md](LOW_MEMORY_INSTALL.md). Its Git-release workflow replaces
the legacy manual installation commands below; do not mix their environment files
or directory layouts.

Target host: `76.13.244.160`. Target directory: `/opt/shop-pricelist`. Compose project: `amt-pricelist`.

Read-only inspection on 2026-08-26 confirmed Podman 5.7.0 behind the `docker` command, Docker Compose 2.32.4-3, and active Caddy (Nginx inactive). Port 18180 was free, the target directory did not exist, and approximately 43 GB disk / 4.6 GB RAM were available. Eight unrelated containers were running. Preserve this engine and proxy; do not install replacements. Recheck capacity and ports immediately before deployment. Compose compatibility (health/dependency conditions, resource limits, logging, internal networking and volume ownership) must be verified on this Podman runtime before launch.

## Release gates

1. Rotate the previously shared root password using a trusted server console. Do not paste its replacement into chat or files.
2. Establish SSH-key access and verify the host fingerprint through a trusted channel. Keep a recovery console open while changing access. Do not disable password login until key access is verified.
3. Inspect the live server read-only before copying files. Run `bash scripts/preflight.sh` from the uploaded source staging location. Record existing container names/status, ports, networks, volumes, proxy configuration, free RAM and disk.
4. Confirm `/opt/shop-pricelist` is unused or belongs only to this project. Existing files must be inspected, not overwritten. Confirm at least about 4 GB of spare memory for the configured service limits plus enough build/disk headroom; otherwise tune limits after measuring rather than starving other apps.
5. Confirm the dedicated loopback port: try 18180, then the first free port from 18181–18199. Record the selected port in `.env`. A suggested port is not reserved; recheck immediately before startup.

## Install only this project

Transfer the source (including lockfile, icons, migrations, scripts), excluding `.env*` except `.env.example`, `.data`, `.git`, `node_modules`, `.next`, and test outputs. Keep filesystem ownership restricted. Do not reuse another project's secrets, volumes or database.

With Node/pnpm available in the staging environment, generate secrets with:

```sh
pnpm exec tsx scripts/init-env.ts
```

This creates `.env` exclusively, refusing overwrite. Alternatively generate independent long hex values with your password manager and fill `.env.example` privately. Hex passwords avoid URL-encoding ambiguity in the Compose connection URL. Set APP_PORT to the verified free port. Keep `APP_ORIGIN=http://localhost:18180` and `COOKIE_SECURE=false` only for localhost SSH-tunnel testing (adjust the local origin if your tunnel uses another port).

From `/opt/shop-pricelist`:

```sh
docker compose -p amt-pricelist config --quiet
docker compose -p amt-pricelist build
docker compose -p amt-pricelist up -d
docker compose -p amt-pricelist ps
curl --fail http://127.0.0.1:18180/amt_price_list/api/v1/health
```

Do not print `docker compose config` without `--quiet` in shared logs: it contains expanded secrets. The migration service runs before the app and worker start. The database has **no published host port**. AMT consumers connect through the project-owned `database_socket` volume, so runtime database access does not depend on container DNS. The socket is never mounted outside this Compose project. App access is bound to `127.0.0.1` only; no public firewall port is needed for testing. All persistent volumes and the internal network receive the `amt-pricelist` project prefix. The application never mounts the Docker socket.

If that loopback health check hangs on this Podman host even while the app
container is running, inspect the current app container IP and verify the same
endpoint on `http://<container-ip>:3000/amt_price_list/api/v1/health`. The
guided `set-public-url` flow now falls back to that private container IP when
generating the AMT proxy route.

Before and after startup, compare the recorded unrelated containers and application health checks. Do not use global Docker prune, stop-all, shared network modification, or `down -v`.

## Access before a domain exists

From the operator's computer, using verified key access:

```sh
ssh -N -L 18180:127.0.0.1:18180 root@76.13.244.160
```

Open `http://localhost:18180/amt_price_list`. Read the setup token privately from this project's `.env`, create the administrator and company details, then verify setup is closed. Create staff accounts with least privilege. Do not reuse the VPS root password for the application.

## HTTPS once the domain is supplied

Point the chosen subdomain at the VPS. The inspected server uses **Caddy**. Adapt `docker/Caddyfile.example` as a path-scoped snippet inside the existing site block, following the existing configuration's import structure. Inspect the active configuration path and version first. Validate the complete resulting configuration with `caddy validate --config <active-config-path>` before a safe reload through its existing service. Do not overwrite the main Caddyfile or unrelated host blocks. The Nginx example is provided only for other deployment environments.

Obtain a certificate for this new domain without altering unrelated certificates. Set `APP_ORIGIN=https://your-subdomain` and `COOKIE_SECURE=true`. Recreate only this project's app/worker/backup services to apply environment changes. Validate the proxy configuration before a reload. Never replace the main Nginx configuration.

Verify login/CSRF through HTTPS, secure cookies, headers, worker PDF, import limits, installability on Android/iPhone, standalone icons, offline behavior, and all unrelated applications. Public launch is blocked until these checks and an isolated restore drill pass.

## Monitoring

Use the project's health check, `docker compose -p amt-pricelist ps`, and service-scoped logs. Monitor disk utilization (uploads, databases, backups), queue age, failed imports/PDFs, daily backup completion and search p95 during OCR. App/worker log rotation is configured. VPS alarms and off-host backup storage require operator infrastructure; they are not silently configured on other services.
