#!/usr/bin/env bash
# One isolation/startup implementation for all live-server checks.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "${AUDIT_BASE_URL:-}" ]; then
  echo "✗ refusing an existing server: its database, storage and email cannot be attested" >&2
  exit 1
fi
# Validate BEFORE setup can mutate a database. Keep one resolved URL throughout.
AUDIT_EXPORTS="$(npx ts-node -P tsconfig.seed.json scripts/e2e-env.ts)" || { echo "✗ refusing: environment is not isolated" >&2; exit 1; }
eval "$AUDIT_EXPORTS"
if [ "${SKIP_DB_SETUP:-0}" != "1" ]; then
  USE_EXISTING_DB=1 npm run test:setup-db
fi
RUN_VITEST=1 bash scripts/run-e2e.sh "$@"
