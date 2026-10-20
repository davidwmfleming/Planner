#!/usr/bin/env bash
# Puts the planner's calendars back from a backup archive made by backup.sh.
#
#   sudo bash scripts/restore.sh /srv/backups/planner/planner-2026-10-19.tar.gz
#
# It stops the planner, saves the current data as before-restore-<time>.tar.gz in the backup
# folder (so the restore itself can be undone), replaces the data with the archive, and starts
# the planner again. It asks before changing anything (--yes skips the question).
# The safety copy is made by backup.sh (next to this script), with the same care over who owns it.
# Settings: /etc/default/planner-backup (PLANNER_BACKUP_CONFIG points elsewhere, for the tests).
set -euo pipefail

CONFIG="${PLANNER_BACKUP_CONFIG:-/etc/default/planner-backup}"
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"
BACKUP_DIR="${BACKUP_DIR:-/srv/backups/planner}"
VOLUME="${VOLUME:-planner_data}"
PLANNER_DIR="${PLANNER_DIR:-/srv/planner}"
IMAGE="${IMAGE:-debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f}"
BACKUP_SCRIPT="$(dirname "$0")/backup.sh"

die() { echo "Restore stopped: $1" >&2; exit 1; }

YES=no
[ "${1:-}" = "--yes" ] && { YES=yes; shift; }
[ $# = 1 ] || die "say which archive to restore, for example: sudo bash $0 $BACKUP_DIR/planner-$(date +%F).tar.gz"
ARCHIVE=$1

# Check everything before touching anything.
[ -f "$ARCHIVE" ] || die "there is no file $ARCHIVE."
LIST=$(tar -tzf "$ARCHIVE" 2>/dev/null) || die "$ARCHIVE isn't a readable .tar.gz archive."
grep -qE '^(\./)?collections/' <<<"$LIST" || die "$ARCHIVE doesn't look like a planner backup (it has no calendars folder)."
[ -f "$PLANNER_DIR/compose.yaml" ] || die "the planner isn't in $PLANNER_DIR (no compose.yaml there)."
docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "there is no Docker volume called $VOLUME. On a new machine, run server-setup.sh first."
[ -d "$BACKUP_DIR" ] || die "there is no backup folder $BACKUP_DIR for the safety copy. Make one with: sudo systemctl start planner-backup"
[ -f "$BACKUP_SCRIPT" ] || die "$BACKUP_SCRIPT is missing; run this from the planner's scripts folder."
compose() { docker compose -f "$PLANNER_DIR/compose.yaml" "$@"; }

echo "This replaces ALL the planner's calendars, tasks and settings with the copy in"
echo "  $ARCHIVE"
echo "Anything added or changed since that copy was made is set aside in a safety copy."
if [ "$YES" != yes ]; then
	read -r -p "Type yes to go ahead: " answer || answer=""
	[ "$answer" = yes ] || die "nothing was changed."
fi

# No backup may run while the data is being replaced; a nightly one that is running is waited for.
exec 9<"$BACKUP_DIR"
flock -w 1800 9 || die "a backup has been running for 30 minutes."
SAFETY_NAME="before-restore-$(date +%F-%H%M%S).tar.gz"
SAFETY="${BACKUP_DIR%/}/$SAFETY_NAME"
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull -q "$IMAGE" >/dev/null

STAGE=stopping
on_exit() {
	status=$?
	[ "$status" = 0 ] && return
	if [ "$STAGE" = replacing ]; then
		echo "Restore failed while replacing the data, so the planner was left stopped." >&2
		echo "To put back what was there before:  sudo bash $0 $SAFETY" >&2
	elif [ "$STAGE" = starting ]; then
		echo "The data was restored, but the planner didn't start. Try:  cd $PLANNER_DIR && sudo docker compose up -d" >&2
	else
		echo "Restore failed before any data was changed; starting the planner again." >&2
		rm -f "$SAFETY"
		compose up -d >&2 || true
	fi
}
trap on_exit EXIT

echo "== Stopping the planner"
compose down

echo "== Saving the current data"
STAGE=saving
PLANNER_BACKUP_LOCKED=yes bash "$BACKUP_SCRIPT" --safety-copy "$SAFETY_NAME"
echo "Safety copy: $SAFETY"

echo "== Putting back the copy"
STAGE=replacing
docker run --rm -i --network none -v "$VOLUME:/data" "$IMAGE" \
	sh -c 'find /data -mindepth 1 -delete && tar --numeric-owner --same-owner -C /data -xzpf -' <"$ARCHIVE"

echo "== Starting the planner"
STAGE=starting
compose up -d
STAGE=finished

cat <<EOF

== Restored from $ARCHIVE
Phones and computers catch up on their next sync. If one still shows old items,
remove the calendar account on it and add it again.
If this was the wrong copy, the data from just before is in
  $SAFETY
EOF
