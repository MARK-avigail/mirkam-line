#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
# Build-only gate: no production restart, no credential loading, no calls.
command -v docker >/dev/null
release=$(git rev-parse --short HEAD)
docker build -t "mirkam-voice-elements:$release" integrations/voice-elements
printf 'VOICE_BRIDGE_BUILD_OK %s\n' "$release"
printf 'Build completed only. Provider registration and a live call are still unverified.\n'
