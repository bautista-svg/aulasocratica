#!/usr/bin/env bash
# Local production build for audits: fake Claude on :47999 and the app on :4300 (DB aula_audit).
cd "$(dirname "$0")/../.."
node scripts/dev/fake-claude.mjs 47999 &
NODE_ENV=production API_PORT=4300 DATABASE_URL=postgres://aula:aula_dev_pw@127.0.0.1:54390/aula_audit \
DATA_DIR=./data-audit PUBLIC_URL=http://localhost:4300 TRUST_PROXY=false \
ANTHROPIC_API_KEY=fake-local ANTHROPIC_BASE_URL=http://127.0.0.1:47999 ADMIN_PASSWORD=audit-admin-password-123456 \
node dist/server/index.mjs
