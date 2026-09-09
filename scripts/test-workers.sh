#!/usr/bin/env bash
#
# Runs the whole suite against the Cloudflare Workers runtime.
#
# This is the only way to get evidence that the deployment target works:
# `next start` is Node, and the two runtimes differ in ways that matter — a
# connection pooled across requests works under Node and hangs the invocation on
# workerd. Everything here runs against `wrangler dev --local`, i.e. workerd.
#
#   npm run test:workers
#
# Requires a local PostgreSQL and DATABASE_URL. Uses its own `_workers_test`
# database, created and migrated here; no other database is touched.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${CC_WORKERS_PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
LOG="${TMPDIR:-/tmp}/cc-workers-dev.log"

if [ -z "${DATABASE_URL:-}" ]; then
  if [ -f .env.local ]; then
    # shellcheck disable=SC1091
    set -a && . ./.env.local && set +a
  fi
fi
: "${DATABASE_URL:?DATABASE_URL must be set (see .env.example)}"

# A dedicated database for this suite. The class database is never involved.
BASE_DB="${DATABASE_URL%%\?*}"
TEST_DB="${BASE_DB}_workers_test"
ADMIN_DB="$(printf '%s' "$BASE_DB" | sed -E 's#/[^/]+$#/postgres#')"
DB_NAME="$(printf '%s' "$TEST_DB" | sed -E 's#.*/##')"

echo "==> preparing ${DB_NAME}"
psql "$ADMIN_DB" -v ON_ERROR_STOP=1 -tAc \
  "select 1 from pg_database where datname='${DB_NAME}'" | grep -q 1 \
  || psql "$ADMIN_DB" -v ON_ERROR_STOP=1 -c "create database \"${DB_NAME}\"" >/dev/null
DATABASE_URL="$TEST_DB" npx tsx scripts/migrate.ts

echo "==> local configuration for wrangler dev"
cat > .dev.vars <<EOF
APP_ORIGIN=${BASE}
CC_ALLOW_INSECURE_COOKIES=1
CC_DISABLE_RATE_LIMIT=1
AI_API_KEY=
CC_STREAM_POLL_MS=1000
CC_STREAM_LIFETIME_MS=50000
EOF

echo "==> building for Workers"
npx opennextjs-cloudflare build

cleanup() {
  # Kill the dev server's whole process group: `wrangler dev` spawns workerd as
  # a child, and signalling only the wrapper leaves workerd holding the port.
  # Deliberately scoped to this script's own child — a pattern-based kill would
  # also match unrelated processes, including the shell that invoked us.
  if [ -n "${DEV_PID:-}" ]; then
    kill -- "-${DEV_PID}" 2>/dev/null || kill "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> starting workerd on ${PORT}"
# Point the Hyperdrive binding at this suite's database. In local dev wrangler
# reads WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>, which overrides
# the localConnectionString in wrangler.jsonc; in production the binding id is
# used and this is ignored.
export WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$TEST_DB"
# Own process group, so cleanup can take the whole tree down by group id.
setsid npx wrangler dev --port "$PORT" --local > "$LOG" 2>&1 &
DEV_PID=$!
for _ in $(seq 1 90); do
  curl -sf --max-time 3 "$BASE/" -o /dev/null 2>/dev/null && break
  sleep 1
done
curl -sf --max-time 3 "$BASE/" -o /dev/null || { echo "workerd never became ready:"; tail -20 "$LOG"; exit 1; }

echo "==> integration suite against workerd"
CC_TEST_BASE_URL="$BASE" CC_TEST_DATABASE_URL="$TEST_DB" \
  npx vitest run --project integration

echo "==> browser suite against workerd"
CC_E2E_BASE_URL="$BASE" npx playwright test

echo "All suites passed against the Workers runtime."
