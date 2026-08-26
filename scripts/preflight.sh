#!/usr/bin/env bash
# Read-only inspection. Run before deploying; this never stops or changes services.
set -euo pipefail
hostname
uname -a
df -h /opt
free -m
docker version --format '{{.Server.Version}}'
docker --version
docker compose version
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
docker network ls
docker volume ls
ss -ltnp
if command -v caddy >/dev/null; then caddy version; systemctl is-active caddy || true; fi
if command -v nginx >/dev/null; then nginx -t; fi
if [ -d /etc/nginx/sites-enabled ]; then ls -l /etc/nginx/sites-enabled; fi
for candidate in $(seq 18180 18199); do
  if ! ss -H -ltn "sport = :$candidate" | grep -q .; then
    printf 'Suggested loopback app port: %s\n' "$candidate"
    break
  fi
done
if [ -e /opt/shop-pricelist ]; then printf 'STOP: /opt/shop-pricelist already exists; inspect it before copying.\n'; fi
