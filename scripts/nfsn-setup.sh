#!/bin/sh
# Sets up a TEST copy of the planner on a NearlyFreeSpeech.NET site, filled with sample data and
# behind a password, until the home server arrives. Never put real calendars here: it is on the
# open internet, not behind Tailscale.
#
# Run over SSH on the site:   sh nfsn-setup.sh your-site.nfshost.com
# Safe to run again: it updates the code and keeps the calendar data and passwords.
set -eu

SITE="${1:?Give the site address, for example: sh nfsn-setup.sh planner-test.nfshost.com}"
BASE="${NFSN_BASE:-/home/protected}"  # overridable only for testing this script elsewhere
REPO="${PLANNER_REPO:-https://github.com/davidwmfleming/Planner.git}"
APP="$BASE/planner"
DATA="$BASE/calendar"
SECRETS="$BASE/planner.env"
CAL_PORT=8232
APP_PORT=8080

say() { printf '\n== %s\n' "$1"; }

say "Checking tools"
for tool in git node npm python3 openssl; do
	command -v "$tool" >/dev/null || { echo "Missing: $tool. Tell Claude which one, and stop here."; exit 1; }
done
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node $NODE_MAJOR is too old (need 18 or newer). Tell Claude, and stop here."; exit 1; }
echo "git, node $(node -v), python $(python3 -V 2>&1 | cut -d' ' -f2): OK"

say "Getting the planner code"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone "$REPO" "$APP"; fi

say "Building it (a few minutes)"
cd "$APP"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
npm run build

say "Installing the calendar server (Radicale)"
export PYTHONUSERBASE="$BASE/python"
python3 -m pip install --user --quiet --upgrade radicale

say "Passwords"
if [ ! -f "$SECRETS" ]; then
	umask 077
	cat > "$SECRETS" <<EOF
CALDAV_PASSWORD=$(openssl rand -hex 16)
TEST_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
EOF
fi
chmod 600 "$SECRETS"
. "$SECRETS"

say "Calendar server settings"
mkdir -p "$DATA/collections"
printf 'david:%s\n' "$CALDAV_PASSWORD" > "$DATA/users"
chmod 600 "$DATA/users"
cat > "$DATA/config" <<EOF
[server]
hosts = 127.0.0.1:$CAL_PORT
[auth]
type = htpasswd
htpasswd_filename = $DATA/users
htpasswd_encryption = plain
[storage]
filesystem_folder = $DATA/collections
[logging]
level = warning
EOF

say "Run scripts for the two daemons"
cat > "$BASE/run-calendar.sh" <<EOF
#!/bin/sh
export PYTHONUSERBASE="$BASE/python"
exec python3 -m radicale --config "$DATA/config"
EOF
cat > "$BASE/run-planner.sh" <<EOF
#!/bin/sh
cd "$APP"
set -a
. "$SECRETS"
set +a
export CALDAV_URL=http://127.0.0.1:$CAL_PORT/ CALDAV_USER=david
export PORT=$APP_PORT ORIGIN=https://$SITE TZ=America/Toronto
exec node build
EOF
chmod 700 "$BASE/run-calendar.sh" "$BASE/run-planner.sh"

say "Sample entries"
if [ ! -f "$DATA/seeded" ]; then
	"$BASE/run-calendar.sh" &
	CAL=$!
	sleep 3
	CALDAV_URL=http://127.0.0.1:$CAL_PORT/ CALDAV_USER=david CALDAV_PASSWORD="$CALDAV_PASSWORD" npm run seed
	kill "$CAL"
	touch "$DATA/seeded"
else
	echo "Already there; skipped."
fi

cat <<EOF

== Done with the command line. Now the control panel (Sites → $SITE):

1. Daemons → Add a Daemon:
     Tag: calendar   Command Line: $BASE/run-calendar.sh   Run Daemon As: me
2. Daemons → Add a Daemon:
     Tag: planner    Command Line: $BASE/run-planner.sh    Run Daemon As: me
3. Proxies → Add a Proxy:
     Protocol: HTTP   Base Path: /   Document Root: /   Target Port: $APP_PORT
4. Wait a minute, then open https://$SITE
   User name: anything (david is fine)   Password: $TEST_PASSWORD

The password is kept in $SECRETS. To update after new changes: sh $APP/scripts/nfsn-setup.sh $SITE
then restart the planner daemon from the control panel.
EOF
