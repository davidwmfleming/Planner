#!/usr/bin/env bash
# Checks scripts/mac/pull-backup.sh on Linux. A stand-in for ssh hands the connection straight to
# rrsync -ro, the way the server's authorized_keys line does, and a stand-in for osascript records
# notifications instead of showing them. No Docker needed.
set -uo pipefail
# shellcheck source=scripts/tests/helpers.sh
. "$(dirname "$0")/helpers.sh"

command -v rrsync >/dev/null || { echo "rrsync (part of rsync 3.2.4 or later) is needed for this test"; exit 1; }
SERVER_DIR="$WORK/server/backups/planner"
PROTON="$WORK/ProtonDrive"
DEST="$PROTON/Backups/planner"
mkdir -p "$SERVER_DIR" "$PROTON" "$WORK/bin"

# ssh stand-in: drop ssh's own arguments and the host, then run what authorized_keys would run.
cat >"$WORK/bin/fake-ssh" <<EOF
#!/usr/bin/env bash
[ -e "$WORK/server-down" ] && { echo "ssh: connect to host homebase port 22: Operation timed out" >&2; exit 255; }
while [ \$# -gt 0 ] && [ "\$1" != rsync ]; do shift; done
SSH_ORIGINAL_COMMAND="\$*" exec rrsync -ro "$SERVER_DIR"
EOF
cat >"$WORK/bin/osascript" <<EOF
#!/usr/bin/env bash
echo "\${*: -1}" >>"$WORK/notifications"
EOF
chmod +x "$WORK/bin/fake-ssh" "$WORK/bin/osascript"

export PLANNER_SERVER=homebase PLANNER_SERVER_USER=david PLANNER_PROTON_DRIVE="$PROTON" \
	PLANNER_SSH="$WORK/bin/fake-ssh" PLANNER_RETRY_WAIT=0 PLANNER_ATTEMPTS=2
pull() {
	rm -f "$WORK/notifications"
	PATH="$WORK/bin:$PATH" bash "$REPO/scripts/mac/pull-backup.sh" >"$WORK/out" 2>&1
}
notified() { [ -s "$WORK/notifications" ] && grep -q "$1" "$WORK/notifications"; }
TODAY="planner-$(date +%F).tar.gz"

echo "== The first pull copies the archives, and only the archives"
echo today >"$SERVER_DIR/$TODAY"
touch -d '10 days ago' "$SERVER_DIR/planner-2000-01-10.tar.gz"
touch -d '5 days ago' "$SERVER_DIR/before-restore-2000-01-15-101010.tar.gz"
touch "$SERVER_DIR/.planner-2000-01-20.tar.gz.partial" "$SERVER_DIR/notes.txt"
pull || { cat "$WORK/out"; bad "pull-backup.sh exits cleanly"; }
check "today's archive is copied" test -f "$DEST/$TODAY"
check "older archives and safety copies are copied" test -f "$DEST/planner-2000-01-10.tar.gz" -a -f "$DEST/before-restore-2000-01-15-101010.tar.gz"
check "a half-written archive is not copied" test ! -e "$DEST/.planner-2000-01-20.tar.gz.partial"
check "other files are not copied" test ! -e "$DEST/notes.txt"
check "the copy keeps the server's date" test "$(stat -c %Y "$DEST/planner-2000-01-10.tar.gz")" = "$(stat -c %Y "$SERVER_DIR/planner-2000-01-10.tar.gz")"
check "no notification when all is well" test ! -s "$WORK/notifications"

echo "== Old copies on the Mac are removed after a good pull"
touch -d '31 days ago' "$DEST/planner-2000-01-01.tar.gz"
touch -d '29 days ago' "$DEST/planner-2000-01-02.tar.gz"
pull || { cat "$WORK/out"; bad "pull-backup.sh exits cleanly"; }
check "a 31-day-old copy is removed" test ! -e "$DEST/planner-2000-01-01.tar.gz"
check "a 29-day-old copy is kept" test -e "$DEST/planner-2000-01-02.tar.gz"

echo "== An emptied server never empties the Mac"
rm -f "$SERVER_DIR"/*
pull || { cat "$WORK/out"; bad "pull-backup.sh exits cleanly"; }
check "the Mac still has today's copy" test -f "$DEST/$TODAY"
check "and the older ones" test -f "$DEST/planner-2000-01-10.tar.gz"

echo "== Copies more than 2 days old bring a notification"
rm -f "$DEST"/*
touch -d '3 days ago' "$SERVER_DIR/planner-2000-02-01.tar.gz"
if pull; then bad "pull-backup.sh reports a problem"; else ok "pull-backup.sh reports a problem"; fi
check "the copy was still made" test -f "$DEST/planner-2000-02-01.tar.gz"
check "a notification says the newest copy is old" notified "3 days old"

echo "== When the server can't be reached, it retries, notifies if stale, and deletes nothing"
touch -d '31 days ago' "$DEST/planner-2000-01-01.tar.gz"
touch "$WORK/server-down"
if pull; then bad "pull-backup.sh reports a problem"; else ok "pull-backup.sh reports a problem"; fi
check "it tried twice" test "$(grep -c 'timed out' "$WORK/out")" = 2
check "a notification says the server couldn't be reached" notified "couldn't reach homebase"
check "old copies are kept when the pull failed" test -e "$DEST/planner-2000-01-01.tar.gz"
touch "$DEST/$TODAY"
pull
check "no notification when the server is down but yesterday's copy is fresh" test ! -s "$WORK/notifications"
rm -f "$WORK/server-down"

echo "== Missing settings or a missing Proton Drive folder are reported, not guessed"
if PLANNER_PROTON_DRIVE="" pull; then bad "fails without a destination"; else ok "fails without a destination"; fi
check "a notification asks for the setting" notified "PROTON_DRIVE"
if PLANNER_PROTON_DRIVE="$WORK/NoProton" pull; then bad "fails without the Proton Drive folder"; else ok "fails without the Proton Drive folder"; fi
check "a notification says the folder is missing" notified "NoProton"
check "no stray folder is made" test ! -e "$WORK/NoProton"

echo "== The server's restricted key can only read"
echo evil >"$WORK/evil.tar.gz"
if rsync -t -e "$WORK/bin/fake-ssh" "$WORK/evil.tar.gz" david@homebase: >"$WORK/out" 2>&1; then bad "an upload is refused"; else ok "an upload is refused"; fi
check "rrsync is what refused it" grep -q "read-only" "$WORK/out"
check "nothing was written on the server" test ! -e "$SERVER_DIR/evil.tar.gz"
if rsync -r -e "$WORK/bin/fake-ssh" david@homebase:../ "$WORK/escape/" >"$WORK/out" 2>&1; then bad "reading outside the backup folder is refused"; else ok "reading outside the backup folder is refused"; fi
check "rrsync is what refused it" grep -q "do not use \.\." "$WORK/out"

echo "== The launchd job file"
PLIST="$REPO/scripts/mac/local.planner.pull-backup.plist"
check "it is a valid property list that runs the script daily at 07:00 and at login" python3 -I -c '
import plistlib, sys
d = plistlib.load(open(sys.argv[1], "rb"))
assert d["Label"] == "local.planner.pull-backup"
assert d["ProgramArguments"] == ["/bin/bash", "/Users/YOURNAME/bin/planner-pull-backup.sh"]
assert d["StartCalendarInterval"] == {"Hour": 7, "Minute": 0}
assert d["RunAtLoad"] is True
' "$PLIST"

finish
