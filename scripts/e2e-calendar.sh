#!/usr/bin/env bash
# Calendar server for browser tests: a fresh Radicale on port 5233, seeded with sample data.
set -euo pipefail
# An Outlook-style work calendar with meetings around today, read by the app as WORK_CALENDAR_URL.
mkdir -p .e2e && npx vite-node scripts/sample-work-feed.ts .e2e/work.ics
export DEV_CALENDAR_DIR="$(mktemp -d)" DEV_CALENDAR_PORT=5233
bash scripts/dev-calendar.sh &
SERVER=$!
trap 'kill $SERVER; rm -rf "$DEV_CALENDAR_DIR"' EXIT
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:5233/" && break; sleep 0.1; done
CALDAV_URL=http://127.0.0.1:5233/ npx vite-node scripts/seed-dev.ts
touch "$DEV_CALENDAR_DIR/seeded"
wait $SERVER
