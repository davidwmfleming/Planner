#!/usr/bin/env bash
# Nightly backup of the planner's calendars: copies the Docker volume planner_data (Radicale's
# calendars, the planner's settings and the hashed password file) into one dated archive,
# planner-YYYY-MM-DD.tar.gz, and removes archives older than KEEP_DAYS.
#
# Runs as root from planner-backup.timer (server-setup.sh installs it as /usr/local/sbin/planner-backup).
# Run it by hand with:  sudo systemctl start planner-backup
# Settings: /etc/default/planner-backup (PLANNER_BACKUP_CONFIG points elsewhere, for the tests).
set -euo pipefail

CONFIG="${PLANNER_BACKUP_CONFIG:-/etc/default/planner-backup}"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"
BACKUP_DIR="${BACKUP_DIR:-/srv/backups/planner}"
KEEP_DAYS="${KEEP_DAYS:-30}"
VOLUME="${VOLUME:-planner_data}"
IMAGE="${IMAGE:-debian:bookworm-slim}" # any image with GNU tar; pulled once, then reused
BACKUP_OWNER="${BACKUP_OWNER:-}"       # the account the Mac signs in as to fetch the copies

die() { echo "Backup failed: $1" >&2; exit 1; }

case "$KEEP_DAYS" in '' | *[!0-9]*) die "KEEP_DAYS must be a whole number of days, not '$KEEP_DAYS'." ;; esac
# Checked first because "docker run -v" would quietly make an empty volume and back that up.
docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "there is no Docker volume called $VOLUME. Is the planner installed?"

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
[ -z "$BACKUP_OWNER" ] || chown "$BACKUP_OWNER:" "$BACKUP_DIR"

ARCHIVE="$BACKUP_DIR/planner-$(date +%F).tar.gz"
PARTIAL="$BACKUP_DIR/.planner-$(date +%F).tar.gz.partial" # never picked up by the Mac's copy

# Fetch the helper image first (only ever needed once), so the pause below stays short.
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull -q "$IMAGE" >/dev/null

# Pause the containers that use the volume (Radicale) for the few seconds the copy takes, so no
# calendar is caught half-written. A calendar app that syncs just then simply waits.
PAUSED=$(docker ps -q --filter "volume=$VOLUME" --filter status=running)
resume() {
	# shellcheck disable=SC2086 # one container ID per word
	[ -z "$PAUSED" ] || docker unpause $PAUSED >/dev/null || true
	PAUSED=""
}
trap 'resume; rm -f "$PARTIAL"' EXIT
if [ -n "$PAUSED" ]; then
	# shellcheck disable=SC2086
	echo "Pausing $(docker inspect -f '{{.Name}}' $PAUSED | tr -d / | tr '\n' ' ')for the copy"
	# shellcheck disable=SC2086
	docker pause $PAUSED >/dev/null
fi

docker run --rm --network none -v "$VOLUME:/data:ro" "$IMAGE" \
	tar --numeric-owner -C /data -czf - . >"$PARTIAL"
resume

tar -tzf "$PARTIAL" >/dev/null || die "the new archive can't be read back."
chmod 600 "$PARTIAL"
[ -z "$BACKUP_OWNER" ] || chown "$BACKUP_OWNER:" "$PARTIAL"
mv -f "$PARTIAL" "$ARCHIVE"
echo "Saved $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Only now that today's copy is safe: remove nightly archives older than KEEP_DAYS.
# Safety copies made by restore.sh (before-restore-*) are kept until removed by hand.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'planner-*.tar.gz' -mmin +$((KEEP_DAYS * 24 * 60)) -print -delete |
	sed 's/^/Removed old copy /'
