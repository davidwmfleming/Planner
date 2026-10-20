# Shared bits for the backup script tests. Sourced, not run.
# The tests use Docker with a throwaway volume, never the real planner_data.
# shellcheck shell=bash

# shellcheck disable=SC2034 # used by the tests that source this file
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=$(mktemp -d)
TEST_VOLUME="plannertest_data"
IMAGE="${TEST_IMAGE:-debian:bookworm-slim}"
FAILED=0

cleanup() {
	docker compose --project-directory "$WORK/compose" down >/dev/null 2>&1 || true
	docker volume rm -f "$TEST_VOLUME" >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT

ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }
check() { # check "description" command...
	local what=$1
	shift
	if "$@"; then ok "$what"; else bad "$what"; fi
}
finish() {
	[ "$FAILED" = 0 ] || { echo "Some checks failed."; exit 1; }
	echo "All checks passed."
}

# A volume that looks like Radicale's: one calendar with one event, owned by Radicale's user.
make_volume() {
	docker volume rm -f "$TEST_VOLUME" >/dev/null 2>&1 || true
	docker volume create "$TEST_VOLUME" >/dev/null
	docker run --rm -v "$TEST_VOLUME:/data" "$IMAGE" sh -c '
		mkdir -p /data/collections/collection-root/david/me
		printf "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" > /data/collections/collection-root/david/me/dentist.ics
		echo "david:hashed" > /data/users
		chown -R 5232:5232 /data'
}

# Lists what is in the test volume, one path per line, with owners.
volume_files() {
	docker run --rm -v "$TEST_VOLUME:/data:ro" "$IMAGE" sh -c 'cd /data && find . -type f -printf "%u %p\n" | sort'
}

# The settings file the scripts read instead of /etc/default/planner-backup.
write_config() {
	mkdir -p "$WORK/compose"
	cat > "$WORK/config" <<EOF
BACKUP_DIR=$WORK/backups
KEEP_DAYS=30
VOLUME=$TEST_VOLUME
PLANNER_DIR=$WORK/compose
IMAGE=$IMAGE
EOF
	export PLANNER_BACKUP_CONFIG="$WORK/config"
}
