#!/bin/sh
# Railway startup script
# 1. Applies the database schema with an explicit, idempotent migration
# 2. Starts the API server
#
# NOTE: we no longer use `drizzle-kit push` here. On deployments that still had
# the legacy Bybit-era `bot_settings` table, push did not add the Capital.com
# columns, so every settings/bot query failed with a 500 and the bot could never
# log in to the Capital.com demo account. init-db.mjs is explicit, idempotent,
# and verifies the result before the server boots.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is not set. Add the Postgres reference variable in Railway."
  exit 1
fi

echo "Applying database schema..."
pnpm --filter @workspace/db exec node /app/scripts/init-db.mjs
echo "Schema ready."

echo "Starting API server on port $PORT..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
