#!/bin/bash
# Runs on David's Mac every morning (launchd, see planner-pull-backup.plist): fetches any new
# planner backups from the server over Tailscale into a folder inside Proton Drive, which then
# uploads them. Shows a macOS notification if the newest copy on the Mac is more than
# STALE_DAYS old, or if a fetch went wrong in a way that won't fix itself.
# It only ever adds files from the server: it never deletes because the server lost some, and
# never replaces a copy it already has. It removes its own nightly copies (planner-*) older than
# KEEP_DAYS, only after a good fetch; safety copies from restores (before-restore-*) are kept
# until removed by hand, as on the server.
#
# Written for the bash 3.2 and BSD tools that come with macOS.

# ---- Settings --------------------------------------------------------------------------------
# Put these in ~/.config/planner-backup.conf (so they survive updates of this script), e.g.:
#   SERVER=homebase                  the server's Tailscale name (as in `tailscale status`)
#   SERVER_USER=david                your account on it
#   PROTON_DRIVE="$HOME/Library/CloudStorage/ProtonDrive-you@pm.me-folder"
#                                    Proton Drive's synced folder; find it with: ls ~/Library/CloudStorage
# and, if you want other values than these:
SERVER=""
SERVER_USER=""
PROTON_DRIVE=""
FOLDER="Backups/planner"             # the folder inside Proton Drive the copies go in
SSH_KEY="$HOME/.ssh/planner-backup"  # the key made for this job; the server only lets it read
KEEP_DAYS=30                         # keep at least as many as the server does
STALE_DAYS=2
# ---------------------------------------------------------------------------------------------
CONFIG="$HOME/.config/planner-backup.conf"

SSH="${PLANNER_SSH:-ssh}"
RSYNC="${PLANNER_RSYNC:-rsync}"
ATTEMPTS="${PLANNER_ATTEMPTS:-5}"      # after waking, the network can take a minute to come back
RETRY_WAIT="${PLANNER_RETRY_WAIT:-60}" # seconds between attempts
# rsync's unfinished files go here, outside Proton Drive, so it never uploads half a file.
TEMP_DIR="$HOME/Library/Caches/planner-pull-backup"
# Homebrew's rsync if there is one (macOS 15's built-in rsync is a different program, openrsync).
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
set -u
umask 077
shopt -s nullglob

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
notify() {
	log "NOTICE: $1"
	if command -v osascript >/dev/null; then
		osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "Planner backup"' -e 'end run' "$1" >/dev/null
	fi
}
fail() { notify "$1"; exit 1; }

[ -f "$CONFIG" ] || fail "Put SERVER, SERVER_USER and PROTON_DRIVE in $CONFIG (see the README)."
# shellcheck source=/dev/null
. "$CONFIG"
if [ -z "$SERVER" ] || [ -z "$SERVER_USER" ]; then fail "Set SERVER and SERVER_USER in $CONFIG."; fi
[ -n "$PROTON_DRIVE" ] || fail "Set PROTON_DRIVE (Proton Drive's folder) in $CONFIG."
whole_number() { # whole_number NAME VALUE SMALLEST: a plain number, read in base 10
	if ! [[ $2 =~ ^[0-9]{1,5}$ ]] || [ $((10#$2)) -lt "$3" ]; then
		fail "$1 in $CONFIG must be a whole number, $3 or more, not '$2'."
	fi
}
whole_number KEEP_DAYS "$KEEP_DAYS" 1
whole_number STALE_DAYS "$STALE_DAYS" 1
whole_number ATTEMPTS "$ATTEMPTS" 1
whole_number RETRY_WAIT "$RETRY_WAIT" 0
KEEP_DAYS=$((10#$KEEP_DAYS))
STALE_DAYS=$((10#$STALE_DAYS))
# Proton Drive's folder must already be there (Proton Drive installed and signed in); otherwise
# the copies would land in a folder that is never uploaded.
[ -d "$PROTON_DRIVE" ] || fail "Can't find $PROTON_DRIVE. Is Proton Drive running and signed in?"
DEST="$PROTON_DRIVE/$FOLDER"
mkdir -p "$DEST" || fail "Can't make $DEST (if this says 'Operation not permitted', see the README)."
# Find out now if this Mac can't save there, so that isn't blamed on the server later.
PROBE=$(mktemp "$DEST/.planner-write-check.XXXXXX" 2>/dev/null) ||
	fail "Can't save files in $DEST (if the log says 'Operation not permitted', see the README)."
rm -f "$PROBE"
mkdir -p "$TEMP_DIR" || fail "Can't make $TEMP_DIR."
PROBE=$(mktemp "$TEMP_DIR/.planner-write-check.XXXXXX" 2>/dev/null) ||
	fail "Can't save files in $TEMP_DIR (where unfinished downloads wait). Is the disk full?"
rm -f "$PROBE"

# ---- Fetch -----------------------------------------------------------------------------------
# --ignore-existing: a copy the Mac already has is never replaced (say, by a same-named copy
# from a rebuilt server). Files that aren't finished archives (.planner-*.partial) are skipped.
PULLED=no
PROBLEM="" # something that won't fix itself by waiting: always notified
attempt=1
while :; do
	"$RSYNC" -rt --ignore-existing --temp-dir="$TEMP_DIR" --include='*.tar.gz' --exclude='*' \
		-e "$SSH -i '$SSH_KEY' -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20" \
		"$SERVER_USER@$SERVER:" "$DEST/"
	code=$?
	case $code in
	0) PULLED=yes; break ;;
	24) # the server removed an old copy while the list was being made: harmless
		log "Some old copies went from the server during the fetch; that's fine."
		PULLED=yes
		break
		;;
	10 | 12 | 30 | 35 | 255) ;; # the connection failed or timed out: try again
	11) PROBLEM="couldn't save the copies on this Mac (rsync code 11: is the disk full?)"; break ;;
	23) PROBLEM="some copies couldn't be fetched (rsync code 23; the log says which)"; break ;;
	*) PROBLEM="the fetch from $SERVER failed (rsync code $code; see the log)"; break ;;
	esac
	if [ "$attempt" -ge "$ATTEMPTS" ]; then
		log "Fetch failed (rsync code $code); gave up after $ATTEMPTS tries."
		break
	fi
	log "Fetch failed (attempt $attempt of $ATTEMPTS, rsync code $code); trying again in $RETRY_WAIT seconds."
	attempt=$((attempt + 1))
	sleep "$RETRY_WAIT"
done

# ---- How old is the newest copy? -------------------------------------------------------------
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; } # GNU, then macOS
NEWEST=""
for f in "$DEST"/planner-*.tar.gz; do
	if [ -z "$NEWEST" ] || [ "$(mtime "$f")" -gt "$(mtime "$NEWEST")" ]; then NEWEST=$f; fi
done
AGE_DAYS=""
[ -z "$NEWEST" ] || AGE_DAYS=$((($(date +%s) - $(mtime "$NEWEST")) / 86400))
FRESH=no
[ -n "$AGE_DAYS" ] && [ "$AGE_DAYS" -le "$STALE_DAYS" ] && FRESH=yes

if [ "$PULLED" = yes ]; then
	log "Fetched from $SERVER; newest copy: $(basename "${NEWEST:-none}")"
	# Remove old copies only while there is a recent one, so a server that stopped making
	# backups can never cause the Mac to delete its last good copies.
	if [ "$FRESH" = yes ]; then
		find "$DEST" -maxdepth 1 -type f -name 'planner-*.tar.gz' -mmin +$((KEEP_DAYS * 24 * 60)) -print -delete |
			while read -r old; do log "Removed old copy $(basename "$old")"; done
	fi
fi

[ -z "$PROBLEM" ] || fail "Fetching the planner backups went wrong: $PROBLEM."
[ "$FRESH" = yes ] && exit 0
if [ "$PULLED" = no ]; then
	why="couldn't reach $SERVER"
else
	why="the server has no newer one"
fi
if [ -z "$AGE_DAYS" ]; then
	fail "No planner backup on this Mac yet: $why."
fi
fail "The newest planner backup on this Mac is $AGE_DAYS days old: $why."
