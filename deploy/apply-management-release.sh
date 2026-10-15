#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/mirkam-line
[[ $(id -u) == 0 ]] || { echo 'Run on the VPS as root.'; exit 1; }
private=/opt/mirkam-private
[[ -f "$private/runtime.env" && -f "$private/mirkam-data/mirkam.sqlite" ]]
[[ $(docker inspect --format '{{.State.Running}}' mirkam-line) == true ]]
release=$(git rev-parse --short HEAD)
image="mirkam-line:release-$release"
docker build -f deploy/management.Dockerfile -t "$image" .
backup=$(mktemp -d /root/mirkam-before-release.XXXXXXXX)
chmod 700 "$backup"
previous="mirkam-line-before-$(date +%s)"
stopped=0
renamed=0
rollback() {
  result=$?
  if [[ $result != 0 && $stopped == 1 ]]; then
    if [[ $renamed == 1 ]]; then
      docker rm -f mirkam-line >/dev/null 2>&1 || true
      docker rename "$previous" mirkam-line || true
    fi
    docker start mirkam-line >/dev/null || true
    echo 'Update failed. Attempted to restart previous container; inspect its health. Backup:' "$backup"
  fi
  exit "$result"
}
trap rollback EXIT
docker stop --time 30 mirkam-line >/dev/null
stopped=1
python3 - "$private" "$backup" <<'PY'
from pathlib import Path
import shutil, sqlite3, sys
source, target = map(Path, sys.argv[1:])
shutil.copytree(source / 'mirkam-data', target / 'mirkam-data')
shutil.copy2(source / 'runtime.env', target / 'runtime.env')
with sqlite3.connect(f"file:{target}/mirkam-data/mirkam.sqlite?mode=ro", uri=True) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
PY
docker rename mirkam-line "$previous"
renamed=1
docker run -d --name mirkam-line --restart unless-stopped \
 --env-file "$private/runtime.env" \
 -v "$private/mirkam-data:/data" -p 127.0.0.1:3000:3000 "$image" >/dev/null
python3 - <<'PY'
import time, urllib.request, json
for attempt in range(20):
    try:
        with urllib.request.urlopen('http://127.0.0.1:3000/health', timeout=2) as response:
            assert response.status == 200 and json.load(response).get('ok') is True
        print('Local service health OK')
        break
    except Exception:
        if attempt == 19:
            raise
        time.sleep(1)
PY
trap - EXIT
printf 'Release %s installed. Previous container: %s. Private backup: %s\n' "$release" "$previous" "$backup"
echo 'Now check HTTPS and sign in using the existing management account.'
