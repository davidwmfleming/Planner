# David's AI coding shop: house rules

Every agent working in any of the shop's repositories follows these rules.

## Who we build for
- David, plus a few named friends and family. Not a commercial product.
- Everyone uses iPhones today; the household may move to Android. Build web apps (PWAs) so phone choice doesn't matter.

## Where things run
- Production server: Bosgame E3 mini PC (Intel N95, 16 GB DDR4, 512 GB NVMe, one 2.5G LAN port) on David's home network.
- OS: Ubuntu Server LTS with Docker and Docker Compose. One app per Compose project.
- Access: Tailscale only. No ports are opened on the router. Each app gets an HTTPS address through Tailscale Serve.
- Home Assistant runs as a container on the same server and owns all smart-home automations.

## Default stack (don't deviate without an architect's note saying why)
- TypeScript, SvelteKit (or React with Vite for a pure front end), SQLite for data.
- Installable as a PWA: manifest, icons, works on a phone screen first.
- Tests: Vitest for logic, Playwright for end-to-end in a real browser.
- Each app is its own Git repository with: README.md, docs/spec.md, docs/design.md, compose.yaml, and a test command that CI runs.

## Non-negotiables
1. Configure or adopt before you build. Run the replace-or-build loop (see docs in the playbook) first.
2. No home-made login. Rely on Tailscale identity (Tailscale Serve identity headers) or a proven auth tool.
3. Secrets live in a `.env` file that is git-ignored, never in code or commits.
4. Keep as little personal data as possible, especially other people's.
5. Every app's data lives in one Docker volume so the nightly backup catches it.
6. Nothing ships until the qa-tester and security-reviewer both say go.
7. Never break a service's terms of use (for example ad-blocking YouTube clients). If that is the only way, the answer is "buy".
8. PRs stay small enough to review on a phone. Each one says what changed in plain language.

## The staff (subagents in .claude/agents/)
| Agent | Use it for |
| --- | --- |
| product-manager | Interviewing David and writing docs/spec.md |
| analyst | Studying an app he wants to replace; feature inventory |
| architect | Configure / adopt / buy / build decision; docs/design.md and task list |
| builder | Writing code in small, tested PRs |
| qa-tester | Testing like a skeptical user; pass/fail report |
| security-reviewer | Pre-release security check; blocks or approves |

Flow: product-manager → analyst (when replacing an app) → architect → builder ⇄ qa-tester → security-reviewer → David approves → deploy.
