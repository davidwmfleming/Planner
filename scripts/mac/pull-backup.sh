#!/bin/bash
# Runs on David's Mac every morning (launchd, see planner-pull-backup.plist): fetches any new
# planner backups from the server over Tailscale into a folder inside Proton Drive, which then
# uploads them. Shows a macOS notification if the newest copy on the Mac is more than
# STALE_DAYS old. It only ever adds files from the server (never deletes because the server
# lost some); it removes its own copies older than KEEP_DAYS, and only after a good fetch.
#
# Written for the bash 3.2 and BSD tools that come with macOS.

# ---- Settings: fill these in once ----------------------------------------------------------
# The server's Tailscale name (as in `tailscale status`), and your account on it.
SERVER="${PLANNER_SERVER:-}"           # for example: homebase
SERVER_USER="${PLANNER_SERVER_USER:-}" # for example: david
# Proton Drive's synced folder on this Mac. Find it with:  ls ~/Library/CloudStorage
# For example:  PROTON_DRIVE="$HOME/Library/CloudStorage/ProtonDrive-you@pm.me-folder"
PROTON_DRIVE="${PLANNER_PROTON_DRIVE:-}"
# The folder inside Proton Drive that the copies go in (made if it isn't there).
FOLDER="Backups/planner"
# The key made for this job; the server only lets it read the backup folder.
SSH_KEY="${PLANNER_SSH_KEY:-$HOME/.ssh/planner-backup}"
KEEP_DAYS=30
STALE_DAYS=2
# ---------------------------------------------------------------------------------------------

SSH="${PLANNER_SSH:-ssh}"
ATTEMPTS="${PLANNER_ATTEMPTS:-5}"      # after waking, the network can take a minute to come back
RETRY_WAIT="${PLANNER_RETRY_WAIT:-60}" # seconds between attempts
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

if [ -z "$SERVER" ] || [ -z "$SERVER_USER" ]; then fail "Set SERVER and SERVER_USER at the top of $0."; fi
[ -n "$PROTON_DRIVE" ] || fail "Set PROTON_DRIVE (Proton Drive's folder) at the top of $0."
# Proton Drive's folder must already be there (Proton Drive installed and signed in); otherwise
# the copies would land in a folder that is never uploaded.
[ -d "$PROTON_DRIVE" ] || fail "Can't find $PROTON_DRIVE. Is Proton Drive running and signed in?"
DEST="$PROTON_DRIVE/$FOLDER"
mkdir -p "$DEST" || fail "Can't make $DEST (if this says 'Operation not permitted', see the README)."

# ---- Fetch -----------------------------------------------------------------------------------
PULLED=no
attempt=1
while :; do
	if rsync -rt --include='*.tar.gz' --exclude='*' \
		-e "$SSH -i $SSH_KEY -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20" \
		"$SERVER_USER@$SERVER:" "$DEST/"; then
		PULLED=yes
		break
	fi
	[ "$attempt" -lt "$ATTEMPTS" ] || break
	log "Fetch failed (attempt $attempt of $ATTEMPTS); trying again in $RETRY_WAIT seconds."
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
		find "$DEST" -maxdepth 1 -type f -name '*.tar.gz' -mmin +$((KEEP_DAYS * 24 * 60)) -print -delete |
			while read -r old; do log "Removed old copy $(basename "$old")"; done
	fi
fi

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
