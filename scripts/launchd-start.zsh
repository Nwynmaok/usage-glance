#!/bin/zsh
set -euo pipefail

# Resolve repo root from the directory this script lives in.
SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"

cd "$REPO_ROOT"

if [[ ! -f "dist/server/index.js" ]]; then
  echo "Run npm run build before starting the launchd service" >&2
  exit 1
fi

if [[ -z "${USAGE_GLANCE_NPM:-}" ]]; then
  echo "USAGE_GLANCE_NPM is not set. Reinstall the service via: npm run service:install" >&2
  exit 1
fi

exec "$USAGE_GLANCE_NPM" start
