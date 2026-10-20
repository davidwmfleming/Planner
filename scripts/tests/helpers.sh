# Shared bits for the backup script tests. Sourced, not run.
# The tests use Docker with a throwaway volume, never the real planner_data.
# shellcheck shell=bash

# shellcheck disable=SC2034 # used by the tests that source this file
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=$(mktemp -d)
TEST_VOLUME="plannertest_data"
IMAGE="${TEST_IMAGE:-debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f}"
FAILED=0
ROOT_WORK="" # a folder only root can change, for the checks that need root (see root_work)

cleanup() {
	docker compose --project-directory "$WORK/compose" down >/dev/null 2>&1 || true
	docker volume rm -f "$TEST_VOLUME" >/dev/null 2>&1 || true
	rm -rf "$WORK"
	if [ -n "$ROOT_WORK" ]; then
		# $ROOT_WORK/full is where a test may mount a tiny disk.
		# shellcheck disable=SC2016 # expanded by the inner sh
		as_root sh -c 'umount "$1/full" 2>/dev/null; rm -rf "$1"' _ "$ROOT_WORK" || true
	fi
}
trap cleanup EXIT

ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }
check() { # check "description" command...
	local what=$1
	shift
	if "$@"; then ok "$what"; else bad "$what"; fi
}
not() { ! "$@"; }

# The real backup runs as root. These run a command as root: directly when the tests already run
# as root, otherwise with sudo if it needs no password (as on CI). Without either, those checks are skipped.
as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@"; fi; }
can_be_root() { [ "$(id -u)" = 0 ] || sudo -n true 2>/dev/null; }
# Makes ROOT_WORK: a folder owned by root (755) that cleanup removes.
root_work() {
	ROOT_WORK=$(as_root mktemp -d)
	as_root chmod 755 "$ROOT_WORK"
}
finish() {
	[ "$FAILED" = 0 ] || { echo "Some checks failed."; exit 1; }
	echo "All checks passed."
}

# A volume that looks like Radicale's: one calendar with one event, owned by Radicale's user.
make_volume() {
	docker volume rm -f "$TEST_VOLUME" >/dev/null 2>&1 || true
	docker volume create "$TEST_VOLUME" >/dev/null
	fill_volume
}
fill_volume() {
	docker run --rm -v "$TEST_VOLUME:/data" "$IMAGE" sh -c '
		mkdir -p /data/collections/collection-root/david/me
		printf "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" > /data/collections/collection-root/david/me/dentist.ics
		echo "david:hashed" > /data/users
		chown -R 5232:5232 /data'
}

# A stand-in for the planner's compose.yaml: one long-running service on the test volume.
start_compose() {
	mkdir -p "$WORK/compose"
	cat >"$WORK/compose/compose.yaml" <<EOF
name: plannertest
services:
  radicale:
    image: $IMAGE
    command: sleep infinity
    init: true
    volumes:
      - data:/data
volumes:
  data:
EOF
	docker compose -f "$WORK/compose/compose.yaml" up -d --quiet-pull >/dev/null 2>&1
}
compose_running() {
	[ "$(docker compose -f "$WORK/compose/compose.yaml" ps -q --status running | wc -l)" = 1 ]
}

# Lists what is in the test volume, one path per line, with owners.
volume_files() {
	docker run --rm -v "$TEST_VOLUME:/data:ro" "$IMAGE" sh -c 'cd /data && find . -type f -printf "%u %p\n" | sort'
}
volume_has() { volume_files | grep -q "$1"; }

# The settings file the scripts read instead of /etc/default/planner-backup.
write_config() {
	mkdir -p "$WORK/compose"
	cat > "$WORK/config" <<EOF
BACKUP_DIR=$WORK/srv/backups
KEEP_DAYS=30
VOLUME=$TEST_VOLUME
PLANNER_DIR=$WORK/compose
IMAGE=$IMAGE
EOF
	export PLANNER_BACKUP_CONFIG="$WORK/config"
}
