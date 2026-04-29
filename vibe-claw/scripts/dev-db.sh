#!/usr/bin/env bash
set -euo pipefail

export VIBE_CLAW_API_TOKEN="${VIBE_CLAW_API_TOKEN:-dev-token}"
export VIBE_CLAW_DATABASE_URL="${VIBE_CLAW_DATABASE_URL:-postgres://${USER}@localhost:5432/vibe_claw}"

bash scripts/db-local-setup.sh
npm run dev
