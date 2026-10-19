#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
[[ $(id -u) == 0 ]] || { echo 'Run on the VPS as root.'; exit 1; }
private=/opt/mirkam-private/voice-elements
[[ -f "$private/bridge.env" && -f "$private/appsettings.json" ]] || { echo 'Private provider configuration is missing.'; exit 1; }
release=$(git rev-parse --short HEAD)
image="mirkam-voice-elements:$release"
docker image inspect "$image" >/dev/null
[[ $(docker inspect --format '{{.State.Running}}' mirkam-line) == true ]]
# Check the backend with the exact bridge credential without printing it.
python3 - "$private/bridge.env" <<'PY'
import sys,urllib.request,urllib.error
from pathlib import Path
values=dict(line.split('=',1) for line in Path(sys.argv[1]).read_text().splitlines() if '=' in line)
r=urllib.request.Request('http://127.0.0.1:3000/voice-elements/ready',data=b'{}',headers={'Authorization':'Bearer '+values['VOICE_ELEMENTS_BRIDGE_TOKEN'],'Content-Type':'application/json'})
try:
    with urllib.request.urlopen(r,timeout=5) as response:
        assert response.status==200
except Exception:
    sys.exit('BRIDGE_BACKEND_NOT_READY: deploy the application with the prepared private environment first')
PY
if docker container inspect mirkam-voice-elements >/dev/null 2>&1; then
 echo 'Bridge container already exists; inspect its state before replacing it.'
 exit 1
fi
# Share only the application's network namespace; no new public listening ports.
# No automatic restart loop until registration has been verified.
docker run -d --name mirkam-voice-elements --restart no \
 --network container:mirkam-line --read-only --cap-drop ALL \
 --security-opt no-new-privileges --pids-limit 128 --memory 512m --cpus 1 \
 --tmpfs /tmp:rw,nosuid,nodev,size=128m,mode=1777 --workdir /tmp \
 --env-file "$private/bridge.env" \
 --mount "type=bind,src=$private/appsettings.json,dst=/run/provider/appsettings.json,readonly" \
 "$image" >/dev/null
printf 'Bridge started; registration is not yet verified. Read its status with:\n'
printf 'docker logs --tail 15 mirkam-voice-elements\n'
