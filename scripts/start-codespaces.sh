#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  (umask 077; cp .env.example .env)
fi
if [[ -x "$PWD/.venv/bin/python" ]]; then
  export PYTHON_BIN="$PWD/.venv/bin/python"
fi
echo 'Mirkam Line opens at /. Keep port 3000 private.'
echo 'Local administrator setup: mirkam-admin-secret.txt (unless MIRKAM_ADMIN_TOKEN is configured).'
exec node src/mirkam-server.js
