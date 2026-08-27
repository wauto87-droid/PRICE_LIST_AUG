#!/usr/bin/env bash
# AMT-only deployment entrypoint. Never run with shell tracing enabled.
set +x
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SELF_PATH="$SCRIPT_DIR/$(basename -- "${BASH_SOURCE[0]}")"

maybe_self_update() {
  command -v git >/dev/null || return 0
  git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  git -C "$SCRIPT_DIR" remote get-url origin >/dev/null 2>&1 || return 0

  if [[ -n "$(git -C "$SCRIPT_DIR" status --porcelain --untracked-files=normal)" ]]; then
    echo 'deploy.sh: source checkout is dirty; skipping automatic git pull.' >&2
    return 0
  fi

  local before after changed
  before="$(git -C "$SCRIPT_DIR" rev-parse HEAD)"
  git -C "$SCRIPT_DIR" pull --ff-only origin master
  after="$(git -C "$SCRIPT_DIR" rev-parse HEAD)"
  chmod 755 "$SELF_PATH" 2>/dev/null || true

  [[ "$before" != "$after" ]] || return 0
  changed="$(git -C "$SCRIPT_DIR" diff --name-only "$before" "$after" -- deploy.sh scripts/deployment/manage.py)"
  [[ -n "$changed" ]] || return 0

  echo 'deploy.sh: refreshed deployment entrypoint; restarting with latest code.' >&2
  exec "$SELF_PATH" "$@"
}

maybe_self_update "$@"
command -v python3 >/dev/null || { echo 'Python 3 is required; no server packages were changed.' >&2; exit 1; }
exec python3 "$SCRIPT_DIR/scripts/deployment/manage.py" "$@"
