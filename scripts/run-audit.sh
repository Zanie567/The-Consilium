#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "${AUDIT_BASE_URL:-}" ] || [ "${SKIP_BUILD:-0}" = 1 ]; then
  echo "✗ refusing an unattested existing server or build" >&2; exit 1
fi
# The sole launcher validates before SQL and owns preparation, app, artifacts and cleanup.
RUN_VITEST=1 exec bash scripts/run-e2e.sh "$@"
