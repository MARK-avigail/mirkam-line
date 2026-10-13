#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  node --input-type=module -e 'import fs from "node:fs"; import {randomBytes} from "node:crypto"; const template=fs.readFileSync(".env.example","utf8"); fs.writeFileSync(".env",template.replace(/^ADMIN_TOKEN=$/m,"ADMIN_TOKEN="+randomBytes(32).toString("hex")),{flag:"wx",mode:0o600});'
fi
export PYTHON_BIN="$PWD/.venv/bin/python"
echo 'Keep port 3000 private. Open .env locally to obtain ADMIN_TOKEN; do not send it in chat.'
echo 'Member/account interface: /members.html'
node src/mirkam-server.js
