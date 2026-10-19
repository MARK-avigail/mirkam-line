#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
[[ $(id -u) == 0 ]] || exit 1
bash deploy/build-voice-elements.sh
# Run after ending the acceptance call. Recreate the bridge against the new app namespace.
docker stop --time 30 mirkam-voice-elements >/dev/null
docker rename mirkam-voice-elements "mirkam-voice-elements-before-$(date +%s)"
bash deploy/apply-management-release.sh
bash deploy/start-voice-elements.sh
sleep 3
docker logs --tail 15 mirkam-voice-elements
