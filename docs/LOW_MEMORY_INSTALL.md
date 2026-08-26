# AMT first installation on the existing Podman VPS

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
