#!/usr/bin/env bash
# CI only: make apt fail over quickly when GitHub's Ubuntu package mirror stalls.
#
# `npx playwright install --with-deps` installs ~190 system packages with apt from
# azure.archive.ubuntu.com, the runners' only mirror. When that mirror stalls, apt waits out its
# long default timeout on each file before retrying. On 23 October 2026 the install step took 57
# and 55 minutes, which used up the 60-minute E2E jobs before any test ran (main at c2ff59f,
# PR #169). Short timeouts plus archive.ubuntu.com as a second mirror (apt's mirror+file method
# tries the next mirror when one fails) bound a stall to seconds. Safe to run more than once.
set -euo pipefail

sudo tee /etc/apt/apt.conf.d/99-ci-network >/dev/null <<'CONF'
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
Acquire::Retries "4";
CONF

SOURCES=/etc/apt/sources.list.d/ubuntu.sources
PRIMARY=http://azure.archive.ubuntu.com/ubuntu/
if [ -f "$SOURCES" ] && grep -q "$PRIMARY" "$SOURCES"; then
  printf '%s\n%s\n' "$PRIMARY" http://archive.ubuntu.com/ubuntu/ | sudo tee /etc/apt/ubuntu-mirrors.txt >/dev/null
  sudo sed -i "s|$PRIMARY|mirror+file:/etc/apt/ubuntu-mirrors.txt|" "$SOURCES"
  echo "apt: $PRIMARY with archive.ubuntu.com as fallback; 20 s network timeouts, 4 retries"
elif [ -f "$SOURCES" ] && grep -q 'mirror+file:/etc/apt/ubuntu-mirrors.txt' "$SOURCES"; then
  echo "apt: mirror fallback already configured"
else
  echo "apt: $SOURCES does not list $PRIMARY; network timeouts and retries only"
fi
