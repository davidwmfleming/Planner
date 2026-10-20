#!/usr/bin/env bash
# Checks scripts/restore.sh: back up, lose a calendar file, restore, and find it again.
set -uo pipefail
# shellcheck source=scripts/tests/helpers.sh
. "$(dirname "$0")/helpers.sh"

write_config
docker volume rm -f "$TEST_VOLUME" >/dev/null 2>&1 || true
start_compose
fill_volume
bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "backup.sh exits cleanly"; }
ARCHIVE="$WORK/srv/backups/planner-$(date +%F).tar.gz"
EVENT=./collections/collection-root/david/me/dentist.ics
safety_copies() { find "$WORK/srv/backups" -name 'before-restore-*.tar.gz' | wc -l; }

echo "== Restoring brings back a deleted calendar file"
docker run --rm -v "$TEST_VOLUME:/data" "$IMAGE" sh -c \
	"rm /data/$EVENT && echo new > /data/collections/collection-root/david/me/added-later.ics"
check "(the event is gone before the restore)" not volume_has dentist.ics
bash "$REPO/scripts/restore.sh" --yes "$ARCHIVE" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "restore.sh exits cleanly"; }
volume_files >"$WORK/files"
check "the deleted event is back, owned by Radicale" grep -qx "5232 $EVENT" "$WORK/files"
check "the password file is back" grep -qx "5232 ./users" "$WORK/files"
check "files added since the backup are gone" not grep -q added-later.ics "$WORK/files"
SAFETY=$(find "$WORK/srv/backups" -name 'before-restore-*.tar.gz' | head -n 1)
check "a safety copy of the data before the restore was made" test -n "$SAFETY"
check "the safety copy holds the newer file" sh -c "tar -tzf '$SAFETY' | grep -q added-later.ics"
check "the safety copy is private" test "$(stat -c %a "$SAFETY")" = 600
check "it says where the safety copy is" grep -q "before-restore-" "$WORK/out"
check "the planner is running again" compose_running

echo "== Answering anything but yes changes nothing"
docker run --rm -v "$TEST_VOLUME:/data" "$IMAGE" rm "/data/$EVENT"
if echo no | bash "$REPO/scripts/restore.sh" "$ARCHIVE" >"$WORK/out" 2>&1; then bad "restore.sh stops"; else ok "restore.sh stops"; fi
check "the data is untouched" not volume_has dentist.ics
check "the planner was left running" compose_running
check "no extra safety copy" test "$(safety_copies)" = 1

echo "== A file that isn't a planner backup is refused"
echo "not an archive" >"$WORK/junk.tar.gz"
tar -czf "$WORK/other.tar.gz" -C "$WORK" config
for f in "$WORK/junk.tar.gz" "$WORK/other.tar.gz" "$WORK/missing.tar.gz"; do
	if bash "$REPO/scripts/restore.sh" --yes "$f" >"$WORK/out" 2>&1; then bad "refuses $(basename "$f")"; else ok "refuses $(basename "$f")"; fi
done
check "the planner was left running" compose_running
check "no extra safety copy" test "$(safety_copies)" = 1

finish
