#!/usr/bin/env bash
# Runs every backup script test (scripts/tests/*.test.sh). Needs Docker and rsync.
set -uo pipefail
status=0
for t in "$(dirname "$0")"/*.test.sh; do
	printf '\n### %s\n' "$(basename "$t")"
	bash "$t" || status=1
done
exit $status
