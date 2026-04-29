#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${VIBE_CLAW_DB_NAME:-vibe_claw}"
DB_USER="${VIBE_CLAW_DB_USER:-${USER}}"
DB_HOST="${VIBE_CLAW_DB_HOST:-localhost}"
DB_PORT="${VIBE_CLAW_DB_PORT:-5432}"
DATABASE_URL_DEFAULT="postgres://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

if ! command -v psql >/dev/null 2>&1; then
  echo "[db:setup:local] psql not found. Install and start PostgreSQL first." >&2
  exit 1
fi

if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -Atc "select 1 from pg_database where datname='${DB_NAME}'" | grep -q 1; then
  createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
  echo "[db:setup:local] created database ${DB_NAME}"
fi

export VIBE_CLAW_DATABASE_URL="${VIBE_CLAW_DATABASE_URL:-$DATABASE_URL_DEFAULT}"
npm run db:migrate
echo "[db:setup:local] ready: ${VIBE_CLAW_DATABASE_URL}"
