#!/usr/bin/env bash
# Starts a throwaway Radicale calendar server for development on http://127.0.0.1:5232
# User "david", password "dev". Data lives in .dev-calendar/ (git-ignored).
# Needs Radicale: python3 -m pip install radicale
set -euo pipefail
DIR="${DEV_CALENDAR_DIR:-.dev-calendar}"
PORT="${DEV_CALENDAR_PORT:-5232}"
mkdir -p "$DIR/collections"
printf 'david:dev\n' > "$DIR/users"
cat > "$DIR/config" <<CONF
[server]
hosts = 127.0.0.1:$PORT
[auth]
type = htpasswd
htpasswd_filename = $DIR/users
htpasswd_encryption = plain
[storage]
filesystem_folder = $DIR/collections
[logging]
level = warning
CONF
exec python3 -m radicale --config "$DIR/config"
