#!/usr/bin/env python3
"""Checks that nothing on this machine is public: reads `tailscale serve status --json` on stdin and lists every
port Tailscale Funnel publishes. The planner, CalDAV and anything else served here (Home Assistant, say) should be
tailnet-only; shared calendar links are published by the separate planner-share machine instead.

Prints what is public, with the command that stops it, and exits 1.
"""
import json
import sys


def problems(status):
    found = []
    for host_port, on in sorted((status.get('AllowFunnel') or {}).items()):
        if on:
            port = host_port.rsplit(':', 1)[-1]
            found.append(f'port {port} of this machine is public on the internet (Funnel on). '
                         f'Stop it with: sudo tailscale funnel --https={port} off')
    return found


if __name__ == '__main__':
    text = sys.stdin.read().strip()
    found = problems(json.loads(text) if text else {})
    for line in found:
        print(f'Not private: {line}')
    sys.exit(1 if found else 0)
