#!/usr/bin/env bash
# Nightly backup of the planner's calendars: copies the Docker volume planner_data (Radicale's
# calendars, the planner's settings and the hashed password file) into one dated archive,
# planner-YYYY-MM-DD.tar.gz, and removes archives older than KEEP_DAYS. A second run on the same
# day never replaces the first copy; it is saved as planner-YYYY-MM-DD-HHMMSS.tar.gz.
#
# Runs as root from planner-backup.timer (server-setup.sh installs it as /usr/local/sbin/planner-backup).
# Run it by hand with:  sudo systemctl start planner-backup
# restore.sh runs it with --safety-copy NAME to save the data before a restore (no pruning).
# Settings: /etc/default/planner-backup (PLANNER_BACKUP_CONFIG points elsewhere, for the tests).
#
# The folder and the copies belong to root; BACKUP_OWNER's group may only read them (folder 750,
# copies 640). Root never writes through a file or folder that another account could have made.
set -euo pipefail

CONFIG="${PLANNER_BACKUP_CONFIG:-/etc/default/planner-backup}"
LOCK="${PLANNER_BACKUP_LOCK:-/run/planner-backup.lock}" # shared with restore.sh
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "$CONFIG"
BACKUP_DIR="${BACKUP_DIR:-/srv/backups/planner}"
KEEP_DAYS="${KEEP_DAYS:-30}"
VOLUME="${VOLUME:-planner_data}"
# Any image with GNU tar, pinned so a changed image can't slip in; pulled once, then reused.
IMAGE="${IMAGE:-debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f}"
BACKUP_OWNER="${BACKUP_OWNER:-}" # the account the Mac signs in as to fetch the copies
COPY_MINUTES=15                  # the copy takes seconds; give up (and resume Radicale) after this

die() { echo "Backup failed: $1" >&2; exit 1; }

SAFETY_NAME=""
if [ "${1:-}" = --safety-copy ]; then
	SAFETY_NAME=${2:-}
	[[ $SAFETY_NAME =~ ^before-restore-[0-9-]+\.tar\.gz$ ]] || die "--safety-copy needs a name like before-restore-2026-10-19-101010.tar.gz."
fi

# Settings come from a file, so check them before using them.
if ! [[ $KEEP_DAYS =~ ^[0-9]{1,5}$ ]] || ((10#$KEEP_DAYS < 1)); then
	die "KEEP_DAYS must be a whole number of days, 1 or more, not '$KEEP_DAYS'."
fi
KEEP_DAYS=$((10#$KEEP_DAYS))
BACKUP_DIR=${BACKUP_DIR%/}
[[ $BACKUP_DIR =~ ^/[A-Za-z0-9._/-]+$ && ! $BACKUP_DIR =~ (^|/)\.\.?(/|$) ]] ||
	die "BACKUP_DIR must be a full path made of letters, digits and . _ - /, not '$BACKUP_DIR'."
[[ $VOLUME =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "VOLUME '$VOLUME' isn't a Docker volume name."
GROUP=root
if [ -n "$BACKUP_OWNER" ]; then
	GROUP=$(id -gn "$BACKUP_OWNER" 2>/dev/null) || die "BACKUP_OWNER '$BACKUP_OWNER' isn't an account on this machine."
fi

# Checked first because "docker run -v" would quietly make an empty volume and back that up.
docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "there is no Docker volume called $VOLUME. Is the planner installed?"

# The folders above BACKUP_DIR must be root's and not writable by anyone else, or another account
# could swap the folder for a link to somewhere else. (Only checked when running as root, as the
# real job does; the tests also run as an ordinary user.)
mkdir -p "$(dirname "$BACKUP_DIR")"
if [ "$(id -u)" = 0 ]; then
	d=$(dirname "$BACKUP_DIR")
	while :; do
		[ ! -L "$d" ] || die "$d is a link; BACKUP_DIR must be a real folder path."
		read -r uid mode <<<"$(stat -c '%u %a' "$d")"
		[ "$uid" = 0 ] || die "$d must belong to root (it holds the backup folder)."
		# Writable by group or others is only safe with the sticky bit (like /tmp).
		(((8#$mode & 8#022) == 0 || (8#$mode & 8#1000) != 0)) || die "$d must not be writable by other accounts."
		[ "$d" != / ] || break
		d=$(dirname "$d")
	done
fi
[ ! -L "$BACKUP_DIR" ] || die "$BACKUP_DIR is a link; it must be a real folder."
umask 077
mkdir -p "$BACKUP_DIR"

# One backup or restore at a time; a second one waits for the first to finish. The lock is a file
# in /run, where only root can make files. (restore.sh holds it while it runs this for the safety copy.)
if [ -z "${PLANNER_BACKUP_LOCKED:-}" ]; then
	exec 9>>"$LOCK"
	flock -w 1800 9 || die "another backup or restore has been running for 30 minutes."
fi

# Root owns the folder and the copies; the owner's group can read them. Earlier versions let the
# owner's account own them, so take them back (shutting that account out first), and drop
# anything it could have planted. A file with a second name (a hard link) may be another file
# entirely, so it is never given to the group.
if [ "$(id -u)" = 0 ]; then
	chown root:"$GROUP" "$BACKUP_DIR"
	chmod 700 "$BACKUP_DIR"
	find "$BACKUP_DIR" -maxdepth 1 \( -type l -o -name '.planner-*.partial' \) -print -delete | sed 's/^/Removed stray /'
	find "$BACKUP_DIR" -maxdepth 1 -type f -links 1 -name '*.tar.gz' -exec chown root:"$GROUP" {} +
fi
if [ "$GROUP" = root ]; then
	chmod 700 "$BACKUP_DIR"
	FILE_MODE=600
else
	find "$BACKUP_DIR" -maxdepth 1 -type f -links 1 -name '*.tar.gz' -exec chmod 640 {} +
	chmod 750 "$BACKUP_DIR"
	FILE_MODE=640
fi

NAME=${SAFETY_NAME:-planner-$(date +%F).tar.gz}
# A new, private, randomly named file: never an existing file or link. The Mac's copy skips it.
PARTIAL=$(mktemp "$BACKUP_DIR/.planner-XXXXXX.partial")

# Fetch the helper image first (only ever needed once), so the pause below stays short.
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull -q "$IMAGE" >/dev/null

# Pause the containers that use the volume (Radicale) for the few seconds the copy takes, so no
# calendar is caught half-written. A calendar app that syncs just then simply waits.
# A container left paused by a backup that was killed mid-copy is resumed afterwards as well.
RUNNING=$(docker ps -q --filter "volume=$VOLUME" --filter status=running)
LEFT_PAUSED=$(docker ps -q --filter "volume=$VOLUME" --filter status=paused)
PAUSED=$(echo "$RUNNING" "$LEFT_PAUSED" | xargs)
resume() {
	# shellcheck disable=SC2086 # one container ID per word
	[ -z "$PAUSED" ] || docker unpause $PAUSED >/dev/null || true
	PAUSED=""
}
trap 'resume; rm -f "$PARTIAL"' EXIT
# systemd stopping the job (by hand or at the time limit) still resumes Radicale, and says so.
trap 'die "stopped (by systemctl stop, a shutdown or the 30-minute limit)."' TERM INT HUP
names() { docker inspect -f '{{.Name}}' "$@" | tr -d / | tr '\n' ' '; }
if [ -n "$LEFT_PAUSED" ]; then
	# shellcheck disable=SC2086
	echo "Found $(names $LEFT_PAUSED)left paused (by an earlier backup that was stopped); resuming it after the copy"
fi
if [ -n "$RUNNING" ]; then
	# shellcheck disable=SC2086
	echo "Pausing $(names $RUNNING)for the copy"
	for c in $RUNNING; do
		# One that stopped since the list was made is fine: it isn't writing either.
		docker pause "$c" >/dev/null 2>&1 || [ "$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)" != running ] ||
			die "couldn't pause container $c for the copy."
	done
fi

timeout $((COPY_MINUTES * 60 + 60)) docker run --rm --network none -v "$VOLUME:/data:ro" "$IMAGE" \
	timeout $((COPY_MINUTES * 60)) tar --numeric-owner -C /data -czf - . >"$PARTIAL" ||
	die "couldn't copy the volume into $BACKUP_DIR (is the disk full? Check with: df -h $BACKUP_DIR)."
resume

tar -tzf "$PARTIAL" >/dev/null || die "the new archive can't be read back."
chmod "$FILE_MODE" "$PARTIAL"
[ "$(id -u)" != 0 ] || chown root:"$GROUP" "$PARTIAL"
# Never replace a copy that is already there (the Mac may have fetched it): a second copy on the
# same day gets the time added. ln refuses to replace anything; then the temporary name goes.
ARCHIVE="$BACKUP_DIR/$NAME"
n=1
until ln -T "$PARTIAL" "$ARCHIVE" 2>/dev/null; do
	[ -e "$ARCHIVE" ] || [ -L "$ARCHIVE" ] || die "couldn't save $ARCHIVE."
	[ -z "$SAFETY_NAME" ] || die "$ARCHIVE already exists; nothing was replaced."
	n=$((n + 1))
	[ "$n" -le 100 ] || die "too many copies today; nothing was replaced."
	ARCHIVE="$BACKUP_DIR/planner-$(date +%F-%H%M%S)$([ "$n" = 2 ] || echo "-$n").tar.gz"
done
rm -f "$PARTIAL"
echo "Saved $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Only now that today's copy is safe: remove nightly archives older than KEEP_DAYS.
# Safety copies made by restore.sh (before-restore-*) are kept until removed by hand.
[ -z "$SAFETY_NAME" ] || exit 0
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'planner-*.tar.gz' -mmin +$((KEEP_DAYS * 24 * 60)) -print -delete |
	sed 's/^/Removed old copy /'
