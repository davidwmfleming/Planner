#!/usr/bin/env bash
# Checks scripts/backup.sh against a throwaway Docker volume.
set -uo pipefail
# shellcheck source=scripts/tests/helpers.sh
. "$(dirname "$0")/helpers.sh"

make_volume
write_config
TODAY="$WORK/srv/backups/planner-$(date +%F).tar.gz"

echo "== A backup run makes today's archive"
bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "backup.sh exits cleanly"; }
check "today's archive exists" test -f "$TODAY"
check "the archive holds the calendar file" sh -c "tar -tzf '$TODAY' | grep -q 'collections/collection-root/david/me/dentist.ics'"
check "the archive keeps Radicale's owner (5232)" sh -c "tar -tvzf '$TODAY' --numeric-owner | grep dentist.ics | grep -q '5232/5232'"
check "the archive is readable only by its owner" test "$(stat -c %a "$TODAY")" = 600
check "the backup folder is private" test "$(stat -c %a "$WORK/srv/backups")" = 700
check "a folder made above it can still be passed through" test "$(stat -c %a "$WORK/srv")" = 755
check "no half-written file is left behind" test -z "$(find "$WORK/srv/backups" -name '*.partial')"

echo "== Old archives are removed, recent ones and other files kept"
touch -d '31 days ago' "$WORK/srv/backups/planner-2000-01-01.tar.gz"
touch -d '29 days ago' "$WORK/srv/backups/planner-2000-01-03.tar.gz"
touch -d '40 days ago' "$WORK/srv/backups/before-restore-2000-01-01-0101.tar.gz" "$WORK/srv/backups/notes.txt"
bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "backup.sh exits cleanly"; }
check "a 31-day-old archive is removed" test ! -e "$WORK/srv/backups/planner-2000-01-01.tar.gz"
check "a 29-day-old archive is kept" test -e "$WORK/srv/backups/planner-2000-01-03.tar.gz"
check "a safety copy from a restore is kept" test -e "$WORK/srv/backups/before-restore-2000-01-01-0101.tar.gz"
check "other files are left alone" test -e "$WORK/srv/backups/notes.txt"

echo "== A running calendar server is paused for the copy and carries on afterwards"
docker run -d --name plannertest-radicale -v "$TEST_VOLUME:/data" "$IMAGE" sleep 600 >/dev/null
bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "backup.sh exits cleanly"; }
check "the backup says it paused the server" grep -q "plannertest-radicale" "$WORK/out"
check "the server is running again (not paused)" test "$(docker inspect -f '{{.State.Status}}' plannertest-radicale)" = running
docker rm -f plannertest-radicale >/dev/null

echo "== A missing volume fails loudly and changes nothing"
touch -d '31 days ago' "$WORK/srv/backups/planner-2000-01-02.tar.gz"
sed -i "s/^VOLUME=.*/VOLUME=plannertest_missing/" "$WORK/config"
if bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1; then bad "backup.sh fails when the volume is missing"; else ok "backup.sh fails when the volume is missing"; fi
check "the message names the missing volume" grep -q "plannertest_missing" "$WORK/out"
check "the missing volume is not created" sh -c "! docker volume inspect plannertest_missing >/dev/null 2>&1"
check "old archives are not removed after a failed run" test -e "$WORK/srv/backups/planner-2000-01-02.tar.gz"

finish
