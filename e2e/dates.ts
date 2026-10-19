/** Dates as the planner writes them (local time). */
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * A Monday a few weeks ahead and the days after it. Tests that add tasks use future days,
 * because rollover moves an open task on any earlier day straight onto today.
 */
export function futureWeek() {
	const now = new Date();
	const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21 - ((now.getDay() + 6) % 7));
	const day = (n: number) => iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + n));
	return { mon: day(0), tue: day(1), wed: day(2), nextMon: day(7), nextTue: day(8) };
}
