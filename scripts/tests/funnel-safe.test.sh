#!/usr/bin/env bash
# funnel-safe.py: says when anything on the server itself is public, so only planner-share ever is.
set -uo pipefail
CHECK="$(cd "$(dirname "$0")/.." && pwd)/funnel-safe.py"
failed=0
expect() { # expect <exit code> <serve status json> <what it shows>
	printf '%s' "$2" | python3 -I "$CHECK" >/dev/null
	local got=$?
	if [ "$got" = "$1" ]; then printf 'ok   %s\n' "$3"; else printf 'FAIL %s (exit %s)\n' "$3" "$got"; failed=1; fi
}
expect 0 '' 'nothing served: private'
expect 0 '{"TCP":{"8443":{"TCPForward":"127.0.0.1:8123","TerminateTLS":"h.ts.net"}},"Web":{"h.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}}}}' 'planner and Home Assistant, tailnet only: private'
expect 1 '{"Web":{"h.ts.net:443":{"Handlers":{"/":{}}}},"AllowFunnel":{"h.ts.net:443":true}}' 'the planner public: reported'
expect 1 '{"AllowFunnel":{"h.ts.net:8443":true}}' 'another port public: reported'
expect 0 '{"AllowFunnel":{"h.ts.net:443":false}}' 'Funnel switched off: private'
exit $failed
