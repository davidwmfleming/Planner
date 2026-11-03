// Who may use the planner: David's own Tailscale login, never just anyone who can reach the server, and never the
// planner-share machine except for a shared calendar link. See "Who gets in" in docs/design.md.
import { lookup } from 'node:dns/promises';

/** Whether a request over the tailnet comes from someone on the ALLOWED_USERS list (Tailscale logins, separated
 * by commas). Tailscale Serve sets Tailscale-User-Login itself and drops one a client sends; a tagged machine gets
 * none, so it is refused. With no list (a test machine, or before the setup script has written one) everyone is let in. */
export function allowedUser(headers: Headers, allowed: string | undefined): boolean {
	const list = (allowed ?? '').split(',').map((login) => login.trim().toLowerCase()).filter(Boolean);
	if (list.length === 0) return true;
	const login = headers.get('tailscale-user-login')?.trim().toLowerCase();
	return !!login && list.includes(login);
}

/** IPv4 addresses come as ::ffff:172.18.0.3 from a dual-stack socket. */
const plain = (address: string) => address.replace(/^::ffff:/i, '').toLowerCase();

const KEPT_MS = 30_000;
let known: { at: number; addresses: string[] } | undefined;

/** Whether a request comes straight from the planner-share container (the `share` service in compose.yaml), rather
 * than through it from the internet. Only that container can make such a request, and only if someone broke into it,
 * so it is treated like a request from the internet: it may read a shared link and nothing else, whatever headers it
 * sends. The container's address is looked up by its name on the Docker network and kept 30 seconds. */
export async function fromShareMachine(clientAddress: string, find = (name: string) => lookup(name, { all: true })): Promise<boolean> {
	if (!known || Date.now() - known.at > KEPT_MS) {
		let addresses: string[] = [];
		try {
			addresses = (await find('share')).map((found) => plain(found.address));
		} catch {
			// Not running (sharing off): nothing to match.
		}
		known = { at: Date.now(), addresses };
	}
	return known.addresses.includes(plain(clientAddress));
}

/** For tests: forget the looked-up address. */
export const forgetShareMachine = () => (known = undefined);
