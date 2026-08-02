#!/bin/sh
# Railway startup script
# 1. Pushes the Drizzle schema to the database (idempotent – safe to re-run)
# 2. Starts the API server
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "WARNING: DATABASE_URL is not set. Skipping schema push. Database operations will fail at runtime."
else
  echo "Running database schema push (timeout: 60s)..."
  # Use push-force so drizzle-kit never prompts for interactive confirmation.
  # Wrapped in a 60-second timeout so a hung DB connection never blocks startup.
  timeout 60 pnpm --filter @workspace/db run push-force
  echo "Schema push complete."
fi

echo "Starting API server on port $PORT..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
