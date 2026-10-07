#!/usr/bin/env bash
# Team Profile end-to-end run. Now just the isolated stack (scripts/run-e2e.sh)
# restricted to the team-profile projects; kept so existing habits and docs work.
exec "$(dirname "$0")/run-e2e.sh" --project=team-profile --workers=1 "$@"
