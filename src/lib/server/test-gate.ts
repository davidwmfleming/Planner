// A password in front of a test copy that has to sit on the open internet (no Tailscale), filled
// with sample data only. The browser's own password prompt (HTTP Basic) does the asking.
// Off unless TEST_PASSWORD is set; the real planner relies on Tailscale instead.
import { timingSafeEqual } from 'node:crypto';

/** True when the request's Authorization header carries the test password (any user name). */
export function passesTestGate(authorization: string | null, password: string): boolean {
	if (!authorization?.startsWith('Basic ')) return false;
	const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
	const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
	const wanted = Buffer.from(password);
	return given.length === wanted.length && timingSafeEqual(given, wanted);
}
