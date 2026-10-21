#!/usr/bin/env bash
# BENCHMARK ONLY. Lab INP is noisy, so this alternates two builds (A B A B …) on the same machine:
# for each block it reseeds aula_perf from that checkout, starts its production server and the
# local AI simulator, and runs scripts/bench/inp.mjs. Labels: inp-<label>-<block>.json in each checkout.
# Usage: bash scripts/bench/inp-compare.sh <dirA> <labelA> <dirB> <labelB> [blocks=2] [runs=5]
set -euo pipefail
DIR_A="$1"; LABEL_A="$2"; DIR_B="$3"; LABEL_B="$4"; BLOCKS="${5:-2}"; RUNS="${6:-5}"
DB=postgres://aula:aula_dev_pw@127.0.0.1:54390/aula_perf
TOOLS="$(cd "$(dirname "$0")" && pwd)"

run_block() {
  local dir="$1" label="$2"
  (
    cd "$dir"
    mkdir -p data-perf
    DATABASE_URL=$DB node "$TOOLS/seed.mjs" > /dev/null
    node scripts/dev/fake-claude.mjs 47998 > /dev/null 2>&1 &
    local ai=$!
    NODE_ENV=production API_PORT=4500 DATABASE_URL=$DB DATA_DIR=./data-perf PUBLIC_URL=http://localhost:4500 \
      ADMIN_PASSWORD=perf-admin-password-123456 ANTHROPIC_API_KEY=fake-local ANTHROPIC_BASE_URL=http://127.0.0.1:47998 \
      node dist/server/index.mjs > /dev/null 2>&1 &
    local srv=$!
    until curl -sf http://localhost:4500/api/health > /dev/null; do sleep 1; done
    sleep 3
    node "$TOOLS/inp.mjs" "$label" "$RUNS" > /dev/null 2>&1 || true
    kill $srv $ai 2>/dev/null || true
    wait $srv $ai 2>/dev/null || true
  )
}

for b in $(seq 1 "$BLOCKS"); do
  run_block "$DIR_A" "$LABEL_A-$b"
  run_block "$DIR_B" "$LABEL_B-$b"
done
echo "inp-compare done"
