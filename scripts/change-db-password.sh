#!/usr/bin/env bash
set +x
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Generates a password privately. Password arguments are deliberately unsupported.
exec bash "$ROOT/deploy.sh" rotate-secrets "$@"
