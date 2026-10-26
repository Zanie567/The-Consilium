#!/usr/bin/env bash
# CI only: make apt give up on a stalled download quickly and try another mirror.
#
# `npx playwright install --with-deps` installs ~190 system packages with apt. On 23 October 2026
# GitHub's Ubuntu mirror (azure.archive.ubuntu.com) stalled for one to five minutes per file and
# the install step took 57, 55 and 46 minutes, using up the E2E jobs' time limits before any test
# ran (main at c2ff59f, #169, #173). What this changes, in order of effect:
#
#   1. 20 s network timeouts and 4 retries (apt's defaults wait far longer on a stalled transfer).
#   2. archive.ubuntu.com as another mirror: added to the mirror list when apt already uses one
#      (mirror+file), or, when apt points straight at the azure mirror, by switching it to a list
#      of both. apt's mirror method moves to the next mirror when one fails.
#
# It prints the sources it found, so the job log shows the runner's configuration. Only the
# runner's apt configuration changes. Safe to run more than once.
set -euo pipefail

sudo tee /etc/apt/apt.conf.d/99-ci-network >/dev/null <<'CONF'
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
Acquire::Retries "4";
CONF
echo "apt: 20 s network timeouts, 4 retries"

FALLBACK=http://archive.ubuntu.com/ubuntu/
SOURCE_FILES=$(ls /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list 2>/dev/null || true)

# Mirror lists apt already uses: make sure each also names archive.ubuntu.com.
LISTS=$(grep -ho 'mirror+file:[^ ]*' $SOURCE_FILES 2>/dev/null | sed 's|^mirror+file:||' | sort -u || true)
for list in $LISTS; do
  if grep -q '://archive\.ubuntu\.com/' "$list" 2>/dev/null; then
    echo "apt: mirror list $list already names archive.ubuntu.com"
  else
    echo "$FALLBACK" | sudo tee -a "$list" >/dev/null
    echo "apt: added $FALLBACK to mirror list $list"
  fi
done

# Sources that name the azure mirror directly: switch them to a list of both mirrors.
PRIMARY=http://azure.archive.ubuntu.com/ubuntu/
for file in $SOURCE_FILES; do
  if grep -q "$PRIMARY" "$file"; then
    printf '%s\n%s\n' "$PRIMARY" "$FALLBACK" | sudo tee /etc/apt/ubuntu-mirrors.txt >/dev/null
    sudo sed -i "s|$PRIMARY|mirror+file:/etc/apt/ubuntu-mirrors.txt|" "$file"
    echo "apt: $file now uses $PRIMARY with $FALLBACK as fallback"
  fi
done

echo "apt sources in use:"
grep -hE '^(URIs:|deb )' $SOURCE_FILES 2>/dev/null | sed 's/^/  /' || true
for list in $(grep -ho 'mirror+file:[^ ]*' $SOURCE_FILES 2>/dev/null | sed 's|^mirror+file:||' | sort -u || true); do
  echo "  $list:"; sed 's/^/    /' "$list"
done
