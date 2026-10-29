#!/usr/bin/env bash
# funnel-safe.py: shared links are turned on only when nothing but /feed would become public.
set -uo pipefail
CHECK="$(cd "$(dirname "$0")/.." && pwd)/funnel-safe.py"
failed=0
expect() { # expect <exit code> <before|after> <serve status json> <what it shows>
	printf '%s' "$3" | python3 -I "$CHECK" 443 8443 "$2" >/dev/null
	local got=$?
	if [ "$got" = "$1" ]; then printf 'ok   %s\n' "$4"; else printf 'FAIL %s (exit %s)\n' "$4" "$got"; failed=1; fi
}
expect 0 before '' 'nothing served yet: fine'
expect 0 before '{"Web":{"h.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}}}}' 'the planner on 443, tailnet only: fine'
expect 1 before '{"Web":{"h.ts.net:443":{"Handlers":{"/":{}}}},"AllowFunnel":{"h.ts.net:443":true}}' 'the planner already public: refused'
expect 1 before '{"Web":{"h.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8123"}}}}}' 'something else on the feed port: refused'
expect 0 after '{"Web":{"h.ts.net:8443":{"Handlers":{"/feed":{}}}},"AllowFunnel":{"h.ts.net:8443":true}}' 'only /feed public: fine'
expect 1 after '{"Web":{"h.ts.net:8443":{"Handlers":{"/feed":{}}}}}' 'Funnel not on afterwards: reported'
expect 1 after '{"Web":{"h.ts.net:8443":{"Handlers":{"/feed":{},"/ha":{}}}},"AllowFunnel":{"h.ts.net:8443":true}}' 'more than /feed public afterwards: reported'
exit $failed
