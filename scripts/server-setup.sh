#!/usr/bin/env bash
# Puts the planner on an Ubuntu machine (a test VM now, homebase later), reachable only over Tailscale.
# It installs Docker and Tailscale if they're missing, gets the code, makes the passwords, starts the
# planner and its calendar server, and gives the planner an https address on your tailnet.
#
# Run as your normal user (it asks for your password for the sudo steps):
#   bash server-setup.sh            the real thing
#   bash server-setup.sh --sample   a test machine: also adds the sample entries
# Safe to run again: it updates the code and keeps the calendars and passwords.
set -euo pipefail

SAMPLE=no
[ "${1:-}" = "--sample" ] && SAMPLE=yes
DIR="${PLANNER_DIR:-/srv/planner}"
REPO="${PLANNER_REPO:-https://github.com/davidwmfleming/Planner.git}"
HTTPS_PORT="${HTTPS_PORT:-443}"  # homebase will need another port if Home Assistant takes 443
APP_PORT=3000
# Shared calendar links: the Tailscale auth key for the planner-share machine, given once (it is kept in .env).
SHARE_AUTHKEY="${SHARE_AUTHKEY:-}"

say() { printf '\n== %s\n' "$1"; }

say "Basic tools"
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl git openssl python3 rsync >/dev/null

say "Docker"
if ! command -v docker >/dev/null; then
	# Docker's own package repository, as its install guide describes.
	sudo install -m 0755 -d /etc/apt/keyrings
	sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	sudo chmod a+r /etc/apt/keyrings/docker.asc
	# shellcheck disable=SC1091
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
		sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
	sudo apt-get update -qq
	sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
docker --version

say "Tailscale"
if ! command -v tailscale >/dev/null; then
	curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! sudo tailscale status >/dev/null 2>&1; then
	echo "Open the link below and sign in with your Tailscale account."
	sudo tailscale up
fi
NAME=$(sudo tailscale status --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
[ -n "$NAME" ] || { echo "Tailscale didn't report this machine's name. Turn on MagicDNS in the Tailscale admin console, then run this again."; exit 1; }
ORIGIN="https://$NAME"
[ "$HTTPS_PORT" = 443 ] || ORIGIN="$ORIGIN:$HTTPS_PORT"
echo "This machine is $NAME"

say "Planner code"
if [ -d "$DIR/.git" ]; then
	git -C "$DIR" pull --ff-only
else
	sudo mkdir -p "$DIR"
	sudo chown "$(id -u):$(id -g)" "$DIR"
	git clone "$REPO" "$DIR"
fi
cd "$DIR"

say "Settings and passwords (.env)"
if [ ! -f .env ]; then
	(
		umask 077
		cat > .env <<EOF
CALDAV_USER=david
CALDAV_PASSWORD=$(openssl rand -hex 16)
ORIGIN=$ORIGIN
TZ=America/Halifax
PLANNER_PORT=$APP_PORT
EOF
	)
else
	sed -i "s|^ORIGIN=.*|ORIGIN=$ORIGIN|" .env
fi
# Sets NAME=value in .env, replacing a line already there.
set_env() {
	[ -z "$(tail -c1 .env)" ] || echo >> .env  # a hand edit may have left no newline at the end
	if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
# Shared calendar links are published by a Tailscale machine of their own (planner-share, in compose.yaml), so
# nothing on this machine is ever public. It runs once .env has its auth key.
SHARE_NAME="planner-share.${NAME#*.}"
[[ "$SHARE_AUTHKEY" =~ ^[A-Za-z0-9_-]*$ ]] || { echo "SHARE_AUTHKEY doesn't look like a Tailscale auth key (tskey-auth-...)."; exit 1; }
[ -z "$SHARE_AUTHKEY" ] || set_env SHARE_AUTHKEY "$SHARE_AUTHKEY"
if grep -q '^SHARE_AUTHKEY=.' .env; then
	set_env COMPOSE_PROFILES share
	set_env FEED_ORIGIN "https://$SHARE_NAME"
else
	sed -i '/^COMPOSE_PROFILES=/d; /^FEED_ORIGIN=/d' .env
fi
chmod 600 .env

say "Building and starting (the first time takes a few minutes)"
sudo docker compose up -d --build

if [ "$SAMPLE" = yes ] && [ ! -f .sample-added ]; then
	say "Sample entries"
	sleep 3
	sudo docker compose --profile sample run --rm seed
	touch .sample-added
fi

say "Nightly backup"
# backup.sh is copied (not run from $DIR) so the root-run job can't be changed by editing the checkout.
sudo install -m 0755 scripts/backup.sh /usr/local/sbin/planner-backup
if [ ! -f /etc/default/planner-backup ]; then
	sed -e "s|^BACKUP_OWNER=.*|BACKUP_OWNER=$(id -un)|" -e "s|^PLANNER_DIR=.*|PLANNER_DIR=$DIR|" \
		scripts/systemd/planner-backup.default | sudo tee /etc/default/planner-backup >/dev/null
fi
sudo install -m 0644 scripts/systemd/planner-backup.service scripts/systemd/planner-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now planner-backup.timer
# One backup now, to check it works (and fetch the small helper image it uses).
sudo systemctl start planner-backup || echo "Warning: the first backup failed; the messages below say why."
sudo journalctl -u planner-backup -n 3 --no-pager -o cat
systemctl list-timers planner-backup.timer --no-pager

say "Copy on the Mac"
# The Mac fetches the copies over ssh with its own key, which may only read the backup folder.
# This also tightens the ssh server (keys only, Tailscale only); see the README.
MAC_BACKUP_KEY="${MAC_BACKUP_KEY:-}" bash scripts/backup-access.sh ||
	echo "Warning: the Mac's access isn't finished; the message above says why. Fix that and run this again."

say "https address"
# If HTTPS certificates are off for your tailnet, this prints a link to turn them on; then run the script again.
sudo tailscale serve --bg --https="$HTTPS_PORT" "http://127.0.0.1:$APP_PORT"

# Nothing on this machine should be public: shared links come from planner-share instead.
# The planner's own port being public stops the setup; anything else public (Home Assistant, say) is your call.
safe=0
sudo tailscale serve status --json | python3 scripts/funnel-safe.py "$HTTPS_PORT" || safe=$?
if [ "$safe" = 2 ]; then
	echo "Stopped: the planner itself is public on the internet. Run the command above, then run this again."
	exit 1
fi
[ "$safe" = 0 ] || echo "Warning: the line above names something on this machine that anyone on the internet can reach."
sudo tailscale serve status

say "Shared calendar links"
if grep -q '^COMPOSE_PROFILES=share' .env; then
	# Give planner-share a moment to sign in and turn on Funnel, then show what it publishes (only /feed).
	sleep 10
	sudo docker compose exec -T share tailscale funnel status ||
		echo "Warning: planner-share isn't running yet; see  cd $DIR && sudo docker compose logs share"
	echo "If  cd $DIR && sudo docker compose logs share  mentions Funnel not being enabled, open the link it gives, allow"
	echo "Funnel, then run  cd $DIR && sudo docker compose restart share."
	SHARING="On. Make links on the planner's Settings page (Shared links); they start with https://$SHARE_NAME/feed/"
else
	SHARING="Off. To turn it on, see \"Shared calendar links\" in $DIR/README.md"
fi
echo "$SHARING"

cat <<EOF

== Done.

Planner:  $ORIGIN
  Open it on any device signed in to your Tailscale account.

Calendar apps (Apple Calendar on the Mac or iPhone, DAVx5 on Android):
  Add a CalDAV account. Server: $NAME$( [ "$HTTPS_PORT" = 443 ] || echo ":$HTTPS_PORT" )
  User name: david    Password: shown by  grep CALDAV_PASSWORD $DIR/.env
  If the app asks for more, choose Advanced or Manual: path /dav/david/, port $HTTPS_PORT, SSL on.

Shared calendar links: $SHARING

To update to the newest version later, run this script again.
EOF
