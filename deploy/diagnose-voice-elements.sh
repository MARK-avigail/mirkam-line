#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
[[ $(id -u) == 0 ]] || { echo 'Run on the VPS as root.'; exit 1; }
state=$(docker inspect --format '{{.State.Status}}' mirkam-voice-elements)
[[ "$state" == exited ]] || { echo "Bridge state is $state; refusing to replace a potentially active bridge."; exit 1; }
bash deploy/build-voice-elements.sh
# Preserve the failed container for inspection; never stop an active call here.
state=$(docker inspect --format '{{.State.Status}}' mirkam-voice-elements)
[[ "$state" == exited ]] || { echo 'Bridge state changed; stopped without replacement.'; exit 1; }
docker rename mirkam-voice-elements "mirkam-voice-elements-failed-$(date +%s)"
bash deploy/start-voice-elements.sh
for attempt in {1..45}; do
 logs=$(docker logs --tail 30 mirkam-voice-elements 2>&1)
 if [[ "$logs" == *BRIDGE_START_FAILED* || "$logs" == *VOICE_REGISTERED* ]]; then
  printf '%s\n' "$logs"
  exit 0
 fi
 [[ $(docker inspect --format '{{.State.Running}}' mirkam-voice-elements) == true ]] || break
 sleep 1
done
docker logs --tail 30 mirkam-voice-elements
docker inspect --format 'BRIDGE_STATE={{.State.Status}} EXIT={{.State.ExitCode}} OOM={{.State.OOMKilled}}' mirkam-voice-elements
