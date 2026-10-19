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

say() { printf '\n== %s\n' "$1"; }

say "Basic tools"
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl git openssl python3 >/dev/null

say "Docker"
if ! command -v docker >/dev/null; then
	# Docker's own package repository, as its install guide describes.
	sudo install -m 0755 -d /etc/apt/keyrings
	sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	sudo chmod a+r /etc/apt/keyrings/docker.asc
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
TZ=America/Toronto
PLANNER_PORT=$APP_PORT
EOF
	)
else
	sed -i "s|^ORIGIN=.*|ORIGIN=$ORIGIN|" .env
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

say "https address"
# If HTTPS certificates are off for your tailnet, this prints a link to turn them on; then run the script again.
sudo tailscale serve --bg --https="$HTTPS_PORT" "http://127.0.0.1:$APP_PORT"
# Shows it is on your tailnet only ("Funnel off" means not on the internet).
sudo tailscale serve status

cat <<EOF

== Done.

Planner:  $ORIGIN
  Open it on any device signed in to your Tailscale account.

Calendar apps (Apple Calendar on the Mac or iPhone, DAVx5 on Android):
  Add a CalDAV account. Server: $NAME$( [ "$HTTPS_PORT" = 443 ] || echo ":$HTTPS_PORT" )
  User name: david    Password: shown by  grep CALDAV_PASSWORD $DIR/.env
  If the app asks for more, choose Advanced or Manual: path /dav/david/, port $HTTPS_PORT, SSL on.

To update to the newest version later, run this script again.
EOF
