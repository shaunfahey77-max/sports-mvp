#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/artifacts/api-server"

printf "Paste DATABASE_URL, then press Enter:\n" >&2
IFS= read -r DATABASE_URL

if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL was empty. Nothing ran." >&2
  exit 1
fi

export DATABASE_URL

corepack pnpm --dir "$API_DIR" exec node --import tsx ./src/scripts/validateGateChange.ts "$@"
