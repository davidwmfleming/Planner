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

echo "== A calendar server left paused by a backup that was killed mid-copy is resumed"
docker run -d --name plannertest-radicale -v "$TEST_VOLUME:/data" "$IMAGE" sleep 600 >/dev/null
docker pause plannertest-radicale >/dev/null # what kill -9 during the copy leaves behind
bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "backup.sh exits cleanly"; }
check "the server is running again" test "$(docker inspect -f '{{.State.Status}}' plannertest-radicale)" = running
check "the backup says it found it paused" grep -q "left paused" "$WORK/out"
docker rm -f plannertest-radicale >/dev/null

echo "== A second copy on the same day never replaces the first"
todays() { find "$WORK/srv/backups" -maxdepth 1 -name "planner-$(date +%F)*.tar.gz" | wc -l; }
echo "the copy the Mac already has" >"$WORK/first"
cp "$WORK/first" "$TODAY"
before=$(todays)
bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "backup.sh exits cleanly"; }
check "today's first copy is unchanged" cmp -s "$WORK/first" "$TODAY"
check "the new copy is saved next to it, with the time in its name" test "$(todays)" = $((before + 1))

echo "== Two backups at once both finish, one after the other"
before=$(todays)
bash "$REPO/scripts/backup.sh" >"$WORK/out1" 2>&1 &
first=$!
bash "$REPO/scripts/backup.sh" >"$WORK/out2" 2>&1 || { cat "$WORK/out2"; bad "the second backup exits cleanly"; }
wait "$first" || { cat "$WORK/out1"; bad "the first backup exits cleanly"; }
check "two more copies were saved" test "$(todays)" = $((before + 2))
check "no half-written file is left behind" test -z "$(find "$WORK/srv/backups" -name '*.partial')"

echo "== KEEP_DAYS must be a whole number of days, 1 or more, read in base 10"
for bad_value in 0 00 -1 abc 7days 08x; do
	sed -i "s/^KEEP_DAYS=.*/KEEP_DAYS=$bad_value/" "$WORK/config"
	if bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1; then bad "KEEP_DAYS='$bad_value' is refused"; else check "KEEP_DAYS='$bad_value' is refused" grep -q "Backup failed: KEEP_DAYS" "$WORK/out"; fi
done
check "the copies are all still there" test -f "$TODAY"
sed -i "s/^KEEP_DAYS=.*/KEEP_DAYS=030/" "$WORK/config"
touch -d '25 days ago' "$WORK/srv/backups/planner-2000-01-04.tar.gz"
bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "backup.sh accepts KEEP_DAYS=030"; }
check "KEEP_DAYS=030 means 30 days (a 25-day-old copy is kept)" test -e "$WORK/srv/backups/planner-2000-01-04.tar.gz"
sed -i "s/^KEEP_DAYS=.*/KEEP_DAYS=30/" "$WORK/config"

echo "== A BACKUP_DIR that isn't a plain full path is refused"
for bad_value in relative/path '/srv/../etc' '/srv/back ups'; do
	sed "s|^BACKUP_DIR=.*|BACKUP_DIR='$bad_value'|" "$WORK/config" >"$WORK/config-bad"
	if PLANNER_BACKUP_CONFIG="$WORK/config-bad" bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1; then bad "BACKUP_DIR='$bad_value' is refused"; else check "BACKUP_DIR='$bad_value' is refused" grep -q "BACKUP_DIR" "$WORK/out"; fi
done
sed 's|^BACKUP_DIR=.*|BACKUP_DIR="'"$WORK"'/srv/quoted/"|' "$WORK/config" >"$WORK/config-quoted"
PLANNER_BACKUP_CONFIG="$WORK/config-quoted" bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "a quoted BACKUP_DIR with a trailing / works"; }
check "a quoted BACKUP_DIR with a trailing / works" test -f "$WORK/srv/quoted/planner-$(date +%F).tar.gz"

echo "== A missing volume fails loudly and changes nothing"
touch -d '31 days ago' "$WORK/srv/backups/planner-2000-01-02.tar.gz"
sed -i "s/^VOLUME=.*/VOLUME=plannertest_missing/" "$WORK/config"
if bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1; then bad "backup.sh fails when the volume is missing"; else ok "backup.sh fails when the volume is missing"; fi
check "the message names the missing volume" grep -q "plannertest_missing" "$WORK/out"
check "the missing volume is not created" sh -c "! docker volume inspect plannertest_missing >/dev/null 2>&1"
check "old archives are not removed after a failed run" test -e "$WORK/srv/backups/planner-2000-01-02.tar.gz"
sed -i "s/^VOLUME=.*/VOLUME=$TEST_VOLUME/" "$WORK/config"

echo "== As root: the folder and copies are root's, readable by the owner's group, and links are never followed"
if can_be_root; then
	root_work
	RDIR="$ROOT_WORK/backups"
	GROUP=$(id -gn nobody)
	# What an older version left: the folder and a copy owned by the account (here: nobody), which
	# could plant links to files root would then overwrite and hand over.
	# shellcheck disable=SC2016 # expanded by the inner sh
	as_root sh -c '
		echo "root secret" >"$1/target" && chmod 600 "$1/target"
		mkdir "$2" && echo old >"$2/planner-2000-01-05.tar.gz" && chown -R nobody "$2"
		ln -s "$1/target" "$2/.planner-$3.tar.gz.partial"
		ln -s "$1/target" "$2/planner-$3.tar.gz"' _ "$ROOT_WORK" "$RDIR" "$(date +%F)"
	sed -e "s|^BACKUP_DIR=.*|BACKUP_DIR=$RDIR|" "$WORK/config" | as_root tee "$ROOT_WORK/config" >/dev/null
	echo "BACKUP_OWNER=nobody" | as_root tee -a "$ROOT_WORK/config" >/dev/null
	as_root env PLANNER_BACKUP_CONFIG="$ROOT_WORK/config" bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1 || { cat "$WORK/out"; bad "backup.sh exits cleanly as root"; }
	owner() { as_root stat -c '%U:%G %a' "$1"; }
	check "the folder is root's, group $GROUP may read it (750)" test "$(owner "$RDIR")" = "root:$GROUP 750"
	check "today's copy is root's, group $GROUP may read it (640)" test "$(owner "$RDIR/planner-$(date +%F).tar.gz")" = "root:$GROUP 640"
	check "an older copy is taken back by root (640)" test "$(owner "$RDIR/planner-2000-01-05.tar.gz")" = "root:$GROUP 640"
	check "the file a planted link pointed to is untouched" test "$(as_root cat "$ROOT_WORK/target") $(owner "$ROOT_WORK/target")" = "root secret root:root 600"
	check "the planted links are gone" test -z "$(as_root find "$RDIR" -type l)"
	check "the owner's account can read today's copy" as_root su -s /bin/sh nobody -c "tar -tzf '$RDIR/planner-$(date +%F).tar.gz' >/dev/null"
	check "the owner's account can't add files to the folder" not as_root su -s /bin/sh nobody -c "touch '$RDIR/x' 2>/dev/null"

	echo "== As root: a backup folder inside a folder another account can change is refused"
	# shellcheck disable=SC2016 # expanded by the inner sh
	as_root sh -c 'mkdir "$1/user" && chown nobody "$1/user"' _ "$ROOT_WORK"
	sed -e "s|^BACKUP_DIR=.*|BACKUP_DIR=$ROOT_WORK/user/backups|" "$WORK/config" | as_root tee "$ROOT_WORK/config-user" >/dev/null
	if as_root env PLANNER_BACKUP_CONFIG="$ROOT_WORK/config-user" bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1; then bad "it is refused"; else check "it is refused" grep -q "must belong to root" "$WORK/out"; fi

	echo "== As root: a full disk is reported as a failed backup"
	docker run --rm -v "$TEST_VOLUME:/data" "$IMAGE" sh -c 'head -c 2000000 /dev/urandom >/data/big'
	# shellcheck disable=SC2016 # expanded by the inner sh
	as_root sh -c 'mkdir "$1/full" && mount -t tmpfs -o size=64k,mode=755 tmpfs "$1/full"' _ "$ROOT_WORK"
	sed -e "s|^BACKUP_DIR=.*|BACKUP_DIR=$ROOT_WORK/full/backups|" "$WORK/config" | as_root tee "$ROOT_WORK/config-full" >/dev/null
	if as_root env PLANNER_BACKUP_CONFIG="$ROOT_WORK/config-full" bash "$REPO/scripts/backup.sh" >"$WORK/out" 2>&1; then bad "the backup fails"; else ok "the backup fails"; fi
	check "the message starts with 'Backup failed:' and mentions the disk" grep -q "^Backup failed: .*disk full" "$WORK/out"
	check "no copy or half-written file is left" test -z "$(as_root find "$ROOT_WORK/full/backups" -type f)"
	docker run --rm -v "$TEST_VOLUME:/data" "$IMAGE" rm /data/big
else
	echo "skip (needs root or sudo without a password)"
fi

echo "== The service and the helper image"
UNIT="$REPO/scripts/systemd/planner-backup.service"
for line in TimeoutStartSec=30min PrivateTmp=yes ProtectHome=yes NoNewPrivileges=yes; do
	check "the service has $line" grep -qx "$line" "$UNIT"
done
check "the helper image is pinned by digest in backup.sh and restore.sh" \
	test "$(grep -c 'IMAGE:-debian:trixie-slim@sha256:[0-9a-f]\{64\}}' "$REPO/scripts/backup.sh" "$REPO/scripts/restore.sh" | grep -c ':1$')" = 2

finish
