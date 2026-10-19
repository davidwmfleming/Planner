import { building } from '$app/environment';
import { scheduleNightlyRollover } from '$lib/server/rollover';

if (!building) scheduleNightlyRollover();
