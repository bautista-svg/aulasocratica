#!/usr/bin/env bash
# BENCHMARK ONLY. Runs the whole lab suite for one label against the production build in dist/:
# reseed aula_perf → start the server (with the memory probe) + the local AI simulator →
# Lighthouse (8 pages × RUNS) → lab INP (3 scenarios × 3 runs) → API under concurrency → stop.
# Usage: bash scripts/bench/run-suite.sh <label> [runs]
set -euo pipefail
cd "$(dirname "$0")/../.."
LABEL="$1"
RUNS="${2:-5}"
DB=postgres://aula:aula_dev_pw@127.0.0.1:54390/aula_perf
mkdir -p data-perf
rm -f "data-perf/mem-$LABEL.jsonl"

DATABASE_URL=$DB node scripts/bench/seed.mjs > "data-perf/seed-$LABEL.log"

node scripts/dev/fake-claude.mjs 47998 > /dev/null 2>&1 &
AI_PID=$!
NODE_ENV=production API_PORT=4500 DATABASE_URL=$DB DATA_DIR=./data-perf PUBLIC_URL=http://localhost:4500 \
  ADMIN_PASSWORD=perf-admin-password-123456 ANTHROPIC_API_KEY=fake-local ANTHROPIC_BASE_URL=http://127.0.0.1:47998 \
  MEM_PROBE_FILE="./data-perf/mem-$LABEL.jsonl" node --import ./scripts/bench/mem-probe.mjs dist/server/index.mjs > "data-perf/server-$LABEL.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID $AI_PID 2>/dev/null || true' EXIT
until curl -sf http://localhost:4500/api/health > /dev/null; do sleep 1; done
sleep 5

node scripts/bench/lighthouse-pages.mjs "$LABEL" "$RUNS" > "data-perf/lighthouse-$LABEL.log" 2>&1
node scripts/bench/inp.mjs "$LABEL" 3 > "data-perf/inp-$LABEL.log" 2>&1
node scripts/bench/api-suite.mjs "$LABEL" "data-perf/mem-$LABEL.jsonl" > "data-perf/api-$LABEL.log" 2>&1
echo "suite $LABEL done"
