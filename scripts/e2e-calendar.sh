#!/usr/bin/env bash
# Calendar server for browser tests: a fresh Radicale on port 5233, seeded with sample data.
set -euo pipefail
DEV_CALENDAR_DIR="$(mktemp -d)"
export DEV_CALENDAR_DIR DEV_CALENDAR_PORT=5233
bash scripts/dev-calendar.sh &
SERVER=$!
trap 'kill $SERVER; rm -rf "$DEV_CALENDAR_DIR"' EXIT
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:5233/" && break; sleep 0.1; done
CALDAV_URL=http://127.0.0.1:5233/ npx vite-node scripts/seed-dev.ts
touch "$DEV_CALENDAR_DIR/seeded"
wait $SERVER
