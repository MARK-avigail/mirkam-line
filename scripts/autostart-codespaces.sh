#!/usr/bin/env bash
# Start the private development server when this Codespace starts.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .mirkam-runtime
# Lock is held only by this startup coordinator, never the background server.
exec 9>.mirkam-runtime/start.lock
flock -w 30 9
probe() {
  node --input-type=module -e '
    try {
      const r=await fetch("http://127.0.0.1:"+(process.env.PORT||3000)+"/health",{signal:AbortSignal.timeout(1200)});
      const v=await r.json();process.exit(r.ok&&v.service==="Mirkam Line"?0:2);
    } catch {process.exit(1)}
  '
}
if probe; then
  echo 'Mirkam Line is already running. Open port 3000.'
  exit 0
fi
nohup bash scripts/start-codespaces.sh 9>&- >.mirkam-runtime/server.log 2>&1 </dev/null &
server_pid=$!
printf '%s\n' "$server_pid" >.mirkam-runtime/server.pid
for attempt in {1..30}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo 'Startup failed. Review .mirkam-runtime/server.log locally.' >&2
    exit 1
  fi
  if probe; then
    echo 'Mirkam Line is running. Open the private port 3000 in Ports.'
    exit 0
  fi
  sleep 0.5
done
echo 'Startup has not been confirmed. Review .mirkam-runtime/server.log locally.' >&2
exit 1
