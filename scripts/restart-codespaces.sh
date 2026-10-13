#!/usr/bin/env bash
# Restart only the server recorded by our own Codespaces launcher.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .mirkam-runtime/server.pid ]]; then
  read -r server_pid < .mirkam-runtime/server.pid
  if [[ "$server_pid" =~ ^[0-9]+$ ]] && kill -0 "$server_pid" 2>/dev/null; then
    server_cwd=$(readlink "/proc/$server_pid/cwd")
    server_command=$(tr '\0' ' ' < "/proc/$server_pid/cmdline")
    if [[ "$server_cwd" != "$(pwd -P)" || "$server_command" != *"node src/mirkam-server.js"* ]]; then
      echo 'Cannot safely identify the running server. No process was stopped.' >&2
      exit 1
    fi
    kill -TERM "$server_pid"
    for attempt in {1..40}; do
      if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
      sleep 0.25
    done
    if kill -0 "$server_pid" 2>/dev/null; then
      echo 'Server is still shutting down. Retry shortly.' >&2
      exit 1
    fi
  fi
fi
bash scripts/autostart-codespaces.sh
