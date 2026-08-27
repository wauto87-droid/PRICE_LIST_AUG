# AMT first installation on the existing Podman VPS

## Build-only host-network workaround

If the host can reach package registries but bridge-network containers cannot,
explicitly opt into host networking for image builds:

```sh
bash deploy.sh install --resume --build-network=host --dry-run
bash deploy.sh install --resume --build-network=host --verbose
```

`--build-network` accepts only `default` (the unchanged Podman build default) or
`host`. The host option applies exclusively to the three `podman build` commands,
including rebuilds of the saved installation commit. Build processes and package
installation scripts temporarily gain access to host-network services; use only
trusted source/dependencies. No application secrets are passed as build arguments.
Memory caps, log redaction, saved ports and credentials remain unchanged.

The option is not persisted: specify it again for future builds if needed. It
never changes runtime Compose networks, database isolation, firewall, host DNS or
staging services. This is a workaround, not a repair or root-cause diagnosis of
the bridge-network failure. A dry run does not exercise network connectivity.

## Recover the inspected failed installation

The inspected VPS journal has an older failed build but no candidate release,
database volume, AMT container, or migration checkpoint. After this commit is
pushed and the VPS checkout is clean, replace only that failed release pointer:

```sh
git pull --ff-only origin master
bash deploy.sh install --resume --replace-failed-release --ref origin/master --build-network=host --dry-run
bash deploy.sh install --resume --replace-failed-release --ref origin/master --build-network=host --verbose
```

This preserves the generated secrets, selected port, logs and cached layers. It
archives the former journal and is rejected if database/container/migration state
appears. External images are fully qualified; local AMT images use
`localhost/amt-pricelist-*`.

Before public activation, open the SSH tunnel printed by the installer and use
`http://localhost:<saved-port>/amt_price_list` to complete single-use setup
privately. Never reveal the setup token.

## Public URL and later domain changes

The app remains scoped to `/amt_price_list`; the hostname is a runtime setting.
On the inspected VPS, preview and then add only AMT's route:

```sh
bash deploy.sh set-public-url --url https://softwaresolver.online/amt_price_list --dry-run
bash deploy.sh set-public-url --url https://softwaresolver.online/amt_price_list --verbose
```

The command requires matching DNS, the inspected active Caddy path, a root-owned
non-writable Caddyfile with no imports, and no path conflict. It preserves `/`,
`/al-ameen*`, and `www`; validates before reload; verifies AMT and the existing
root response; and restores its environment/proxy edit on failure. Private
checkpoints are retained under `/opt/shop-pricelist/state/proxy/`.

For a later move, point the new HTTPS domain to this VPS and run the same two
commands with `https://new-domain/amt_price_list`. Only marker-owned AMT routing
is removed from the old host. Port, data and path remain unchanged; sign in again.
Structural Caddy changes/imports trigger refusal and manual review.

## Visible deployment progress and diagnostics

Numbered stages and redacted build output are shown by default. Add `-v`,
`--verbose`, or `--v` for command timings (command arguments remain hidden).
Silent commands report elapsed time every ten seconds. Machine-readable results,
credentials and binary backups are never streamed, even in verbose mode.

After the deployment directory is initialized/validated, each mutating run creates
a root-only log in `/opt/shop-pricelist/logs/` (directory 0700, files 0600).
Failures show their stage, exit code and log path. Dry runs create no log files.
Preflight failures before the directory is validated only appear in the terminal.
Build errors are visible; errors from sensitive operations remain withheld.
Review logs privately before sharing: redaction cannot identify arbitrary private
business data printed by third-party build tools.

To diagnose the existing failed install, update the **clean source checkout**:

```sh
cd /opt/amt-pricelist-source
git status --short
# Continue only when status output is empty:
git pull --ff-only origin master
bash deploy.sh install --resume --dry-run
bash deploy.sh install --resume --verbose
```

The new source installer provides diagnostics even when recovery rebuilds the
original pinned application commit. It does not replace the saved commit, port,
credentials or data. Do not delete recovery state or run a fresh installation.

This profile leaves staging and production applications running. Limits are caps,
not guaranteed consumption: database 512 MiB, web 768 MiB, worker 1024 MiB,
backup 256 MiB (2.5 GiB combined). Migrations have a separate 512 MiB cap.
Large OCR/PDF/import jobs still require measured validation; a killed job or build
is not a reason to stop unrelated applications automatically.

## Prerequisites and checks

Use a verified SSH key and separately rotate the previously shared root password.
Never put credentials in Git, command arguments or chat. Keep provider console
access available. Requirements: Python 3.12+, existing rootful Podman with cgroup
v2, Docker-compatible Podman endpoint, Compose, Git, curl, ss and systemd.
The installer does not replace/install engines or change proxy/firewall settings.

Installation/upgrade requires 3 GiB **available** RAM and 12 GiB free disk.
Status/stop do not require spare RAM; startup/restore checks require 512 MiB
available headroom. Builds run sequentially through native Podman, with a 2 GiB
memory cap and no additional build swap. A Dockerfile guard checks the effective
build cgroup cap before dependency installation. Unsupported/unbounded builds fail
closed. Runtime/build enforcement on the actual VPS still needs verification.

## First install

In the existing source checkout, check for local changes first:

```sh
cd /opt/amt-pricelist-source
git status --short
```

Only if that output is empty, update without replacing local changes:

```sh
git pull --ff-only origin master
bash deploy.sh install --dry-run
bash deploy.sh install
```

Answer `y` to the access question only when both conditions are true. An empty
answer is No. Dry run never builds, fetches, writes state or starts containers;
the effective cgroup guard runs during the real build, not dry run.

The first install selects an unused TCP/UDP/container-unreserved port from
18180–18199. It saves the port in `/opt/shop-pricelist/shared/.env` and rechecks
before startup. Updates and resumed installs retain that exact port. Conflicts
stop deployment; no listener is killed and no alternative port is silently chosen.

## Interrupted first install

After a build or migration failure, preserve all files and volumes. Correct the
reported cause (for example memory capacity), then:

```sh
bash deploy.sh install --resume --dry-run
bash deploy.sh install --resume
```

Recovery uses the original saved commit, credentials and port, and reuses the
built candidate when available. Migrations retain their normal transactional
retry behavior. It never drops the database, reverses migrations or resets users.
An existing directory without the new `state/install.json` journal requires
manual inspection; do not delete it to force installation. A completed install
must use `upgrade`, not `install --resume`.

## Verification and access

After success, use `bash deploy.sh status`, compare unrelated containers with the
pre-install inventory, and inspect `free -h` and `docker stats --no-stream` during
lookup, imports and PDF generation. Test database authentication, setup/login,
one quote and one PDF before relying on the service. Increase RAM if sustained
memory pressure or out-of-memory events occur.

Use the exact SSH tunnel command printed by the installer in Windows PowerShell.
For selected port 18180 this is:

```sh
ssh -N -L 18180:127.0.0.1:18180 root@76.13.244.160
```

Open http://localhost:18180. Stop only your local development server if it occupies
that local port. Read the setup token privately from the shared environment file;
never paste it into logs/chat. No public access is enabled without reviewed HTTPS.

For upgrades, update the clean source checkout as above, then run
`bash deploy.sh upgrade --dry-run` and `bash deploy.sh upgrade`. Secret rotation
remains optional, default No. Keep all recovery backups and previous releases.
