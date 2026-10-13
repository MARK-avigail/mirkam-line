#!/usr/bin/env bash
# Local development setup only. Does not deploy or contact voice/mail providers.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo 'Install Node.js 22 or newer first.'; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("Node.js 22 or newer is required.");process.exit(1)}'
command -v python3 >/dev/null || { echo 'Install Python 3 first.'; exit 1; }
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -r requirements-document.txt
export PYTHON_BIN="$PWD/.venv/bin/python"
npm install --no-audit --no-fund
npm run verify
npm run test:offline
npm test
echo 'Local checks finished. No live call, AI request or mail delivery was tested.'
