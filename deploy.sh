#!/usr/bin/env bash
# AMT-only deployment entrypoint. Never run with shell tracing enabled.
set +x
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo 'Python 3 is required; no server packages were changed.' >&2; exit 1; }
exec python3 "$SCRIPT_DIR/scripts/deployment/manage.py" "$@"
