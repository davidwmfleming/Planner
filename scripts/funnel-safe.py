#!/usr/bin/env python3
"""Checks Tailscale's serve settings (tailscale serve status --json, on stdin) before and after the shared-links
Funnel is turned on, so nothing but /feed is ever public.

  funnel-safe.py <https-port> <feed-port> before   fine to turn Funnel on for /feed?
  funnel-safe.py <https-port> <feed-port> after    is /feed on the feed port the only public address?

Funnel is switched on for a whole port, so the feed port must serve nothing but /feed, and the planner's own port
must never be public. Prints what is wrong and exits 1.
"""
import json
import sys


def problems(status, https_port, feed_port, after):
    funnel = [hp for hp, on in (status.get('AllowFunnel') or {}).items() if on]
    web = status.get('Web') or {}
    found = []
    for hp in funnel:
        if not hp.endswith(f':{feed_port}'):
            found.append(f'port {hp.rsplit(":", 1)[-1]} is public (Funnel on); only {feed_port} should be. '
                         f'Turn it off with: sudo tailscale funnel --https={hp.rsplit(":", 1)[-1]} off')
    for hp, served in web.items():
        if hp.endswith(f':{feed_port}'):
            others = sorted(p for p in (served.get('Handlers') or {}) if p not in ('/feed', '/feed/'))
            if others:
                found.append(f'port {feed_port} also serves {", ".join(others)}, which Funnel would make public. '
                             f'Move it to another port, or set FEED_PORT to 443, 8443 or 10000 (one not in use).')
    if after and not any(hp.endswith(f':{feed_port}') for hp in funnel):
        found.append(f'Funnel is not on for port {feed_port}, so shared links will not work yet.')
    if str(https_port) == str(feed_port):
        found.append('the feed port is the planner\'s own port')
    return found


if __name__ == '__main__':
    https_port, feed_port, when = sys.argv[1:4]
    text = sys.stdin.read().strip()
    found = problems(json.loads(text) if text else {}, https_port, feed_port, when == 'after')
    for line in found:
        print(f'Shared links: {line}')
    sys.exit(1 if found else 0)
