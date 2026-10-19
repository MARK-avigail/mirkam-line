#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
[[ $(id -u) == 0 ]] || exit 1
# Compile and run offline input checks before stopping any service.
bash deploy/build-voice-elements.sh
app_before=$(docker inspect --format '{{.Id}}' mirkam-line)
bridge_before=$(docker inspect --format '{{.Id}}' mirkam-voice-elements)
stamp="$(date +%s)-$$"
previous_bridge="mirkam-voice-elements-before-$stamp"
touched=0
saved=0
rollback() {
 result=$?
 trap - EXIT
 if [[ $result != 0 && $touched == 1 ]]; then
  # Preserve failed containers. Restore the original application ID so that the
  # old bridge's shared network namespace matches the application again.
  if [[ $saved == 1 ]]; then
   current_bridge=$(docker inspect --format '{{.Id}}' mirkam-voice-elements 2>/dev/null || true)
   if [[ -n "$current_bridge" && "$current_bridge" != "$bridge_before" ]]; then
    docker stop --time 15 mirkam-voice-elements >/dev/null 2>&1 || true
    docker rename mirkam-voice-elements "mirkam-voice-elements-failed-$stamp" || true
   fi
  fi
  current_app=$(docker inspect --format '{{.Id}}' mirkam-line 2>/dev/null || true)
  if [[ "$current_app" != "$app_before" ]]; then
   if [[ -n "$current_app" ]]; then
    docker stop --time 15 mirkam-line >/dev/null 2>&1 || true
    docker rename mirkam-line "mirkam-line-failed-$stamp" || true
   fi
   docker rename "$app_before" mirkam-line || true
  fi
  docker start mirkam-line >/dev/null 2>&1 || true
  if [[ $saved == 1 ]]; then docker rename "$previous_bridge" mirkam-voice-elements || true; fi
  docker start mirkam-voice-elements >/dev/null 2>&1 || true
  echo 'VOICE_RELEASE_FAILED: attempted to restore previous application and bridge; inspect registration. Data and private settings were not rolled back.' >&2
 fi
 exit "$result"
}
trap rollback EXIT
# Run after ending live calls. Recreate the bridge in the new app namespace.
touched=1
docker stop --time 30 mirkam-voice-elements >/dev/null
docker rename mirkam-voice-elements "$previous_bridge"
saved=1
bash deploy/apply-management-release.sh
bash deploy/start-voice-elements.sh
# Registration is asynchronous. Treat a failed/exited bridge as a failed release.
for attempt in {1..75}; do
 logs=$(docker logs --tail 15 mirkam-voice-elements 2>&1)
 if [[ "$logs" == *BRIDGE_START_FAILED* ]]; then exit 1; fi
 if [[ "$logs" == *VOICE_REGISTERED* ]]; then
  trap - EXIT
  printf '%s\n' "$logs"
  echo 'VOICE_RELEASE_REGISTERED: provider registration only; verify a real call.'
  exit 0
 fi
 [[ $(docker inspect --format '{{.State.Running}}' mirkam-voice-elements) == true ]] || exit 1
 sleep 1
done
echo 'VOICE_REGISTRATION_NOT_CONFIRMED: restoring previous release.' >&2
exit 1
