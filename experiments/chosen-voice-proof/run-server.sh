#!/usr/bin/env bash
# Isolated one-shot experiment; never changes or restarts production containers.
set -euo pipefail
umask 077
base=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
test -f "$base/probe.py"
test "$(id -u)" = 0 || { echo 'Run on the existing server as root.'; exit 2; }
app_image=$(docker inspect --format '{{.Image}}' mirkam-line)
bridge_image=$(docker inspect --format '{{.Image}}' mirkam-voice-elements)
proof_dir=$(mktemp -d /root/mirkam-chosen-voice-proof.XXXXXXXX)
probe_name="mirkam-voice-proof-${proof_dir##*.}"
credentials="$proof_dir/provider.env"
cleanup() {
  docker rm -f "$probe_name" >/dev/null 2>&1 || true
  rm -f -- "$credentials"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cp -- "$base/probe.py" "$proof_dir/probe.py"
echo 'Preparing isolated voice check; production services remain running.'
# Reuse the installed application image, with no production data mounts.
timeout 120 docker run --rm --name "$probe_name" --user 0:0 \
  --memory 384m --cpus 0.5 --pids-limit 100 \
  -v "$proof_dir:/proof" --entrypoint sh "$app_image" -ec '
    python3 -m venv /proof/venv
    /proof/venv/bin/pip --disable-pip-version-check install --quiet websockets==16.0
  '
# Read credentials only after dependency installation has finished.
# Credentials never enter shell variables, command arguments or terminal output.
docker exec mirkam-line node -e '
const key=process.env.OPENAI_API_KEY;
const project=process.env.MIRKAM_LIVE_PROJECT_ID;
if(!key||!project||/[\r\n\0]/.test(key+project))process.exit(2);
process.stdout.write("OPENAI_API_KEY="+key+"\nMIRKAM_LIVE_PROJECT_ID="+project+"\n");
' > "$credentials"
echo 'Starting ONE real, billable sample with the previously selected voice.'
timeout 60 docker run --rm --name "$probe_name" --user 0:0 \
  --memory 384m --cpus 0.5 --pids-limit 100 \
  --env-file "$credentials" -v "$proof_dir:/proof" \
  --entrypoint /proof/venv/bin/python "$app_image" \
  /proof/probe.py --live --capture-only --output-parent /proof
rm -f -- "$credentials"
shopt -s nullglob
samples=("$proof_dir"/mirkam-chosen-voice-proof-*)
test "${#samples[@]}" = 1
sample_dir=${samples[0]}
timeout 15 docker run --rm --name "$probe_name" --user 0:0 --network none \
  --memory 128m --cpus 0.5 --pids-limit 50 \
  -v "$sample_dir:/proof" --entrypoint ffmpeg "$bridge_image" \
  -nostdin -hide_banner -loglevel error -y -i /proof/live-24k.wav \
  -ar 8000 -ac 1 -c:a pcm_s16le /proof/telephone-8k.wav
timeout 15 docker run --rm --name "$probe_name" --user 0:0 --network none \
  --memory 128m --cpus 0.5 --pids-limit 50 \
  -v "$sample_dir:/proof" --entrypoint python3 "$app_image" -c '
import json,wave
from pathlib import Path
with wave.open("/proof/telephone-8k.wav", "rb") as w:
 assert (w.getnchannels(),w.getsampwidth(),w.getframerate())==(1,2,8000)
 assert w.getnframes()>=4000
 duration=w.getnframes()/8000
p=Path("/proof/evidence.json")
e=json.loads(p.read_text()); e["converted_to_telephone_wav"]=True
p.write_text(json.dumps(e,ensure_ascii=False,indent=2))
print("REAL_VOICE_AUDIO_RECEIVED")
print("TELEPHONE_WAV_OK seconds="+str(duration))
print("PHONE_PLAYBACK_NOT_YET_TESTED")
'
printf 'Private audio and evidence: %s\n' "$sample_dir"
