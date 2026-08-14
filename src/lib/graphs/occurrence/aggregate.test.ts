import { describe, expect, it } from 'vitest';
import {
	buildBuckets,
	busiestWeekday,
	bucketStart,
	chartWindow,
	counterTotals,
	currentBucketTotal,
	dayStart,
	formatAmount,
	formatElapsed,
	MAX_BUCKETS,
	msSinceLast,
	nextBucketStart,
	rollingMean,
	stepOf,
	targetStatuses
} from './aggregate.js';
import { SCHEMA_VERSION, type Counter, type Occurrence, type OccurrenceGraph } from '$lib/types.js';

// Tests build timestamps from *local* civil time and store them as UTC, the
// same way the UI does. Bucketing is local-zone by design, so anything
// hard-coding a "Z" literal would pass or fail depending on the machine's TZ.
function at(y: number, m: number, d: number, h = 12, min = 0): string {
	return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

function graph(counters: Counter[], occurrences: Occurrence[], schemaExtras = {}): OccurrenceGraph {
	return {
		id: 'g_test',
		type: 'occurrence',
		name: 'test',
		created_at: at(2026, 5, 1),
		modified_at: at(2026, 5, 1),
		schema_version: SCHEMA_VERSION,
		owner: '@t:example',
		editors: [],
		schema: { counters, ...schemaExtras },
		customization: { theme: { palette: ['#aaa'] }, title: { show: true, text: 'test' } },
		occurrences
	};
}

const beer: Counter = { id: 'beer', label: 'beer', unit: 'units' };
const smoke: Counter = { id: 'smoke', label: 'cigarettes', unit: 'cigarettes' };

function occ(id: string, counterId: string, ts: string, amount = 1): Occurrence {
	return { id, counter_id: counterId, timestamp: ts, amount };
}

describe('dayStart', () => {
	it('truncates to local midnight when day_start_hour is 0', () => {
		const d = dayStart(new Date(2026, 4, 7, 23, 30), 0);
		expect(d.getHours()).toBe(0);
		expect(d.getDate()).toBe(7);
	});

	it('attributes pre-cutoff hours to the previous day', () => {
		// 02:00 with a 4am cutoff belongs to the 6th, not the 7th.
		const d = dayStart(new Date(2026, 4, 7, 2, 0), 4);
		expect(d.getDate()).toBe(6);
		expect(d.getHours()).toBe(4);
	});

	it('keeps post-cutoff hours on the same day', () => {
		const d = dayStart(new Date(2026, 4, 7, 5, 0), 4);
		expect(d.getDate()).toBe(7);
	});
});

describe('bucketStart', () => {
	it('starts weeks on Monday', () => {
		// 2026-05-07 is a Thursday.
		const d = bucketStart(new Date(2026, 4, 7, 12), 'week', 0);
		expect(d.getDay()).toBe(1);
		expect(d.getDate()).toBe(4);
	});

	it('starts months on the 1st, at the day-start hour', () => {
		const d = bucketStart(new Date(2026, 4, 18, 12), 'month', 4);
		expect(d.getMonth()).toBe(4);
		expect(d.getDate()).toBe(1);
		expect(d.getHours()).toBe(4);
	});

	it('pushes an early-morning 1st into the previous month when shifted', () => {
		const d = bucketStart(new Date(2026, 4, 1, 2), 'month', 4);
		expect(d.getMonth()).toBe(3);
	});
});

describe('nextBucketStart', () => {
	it('advances by one day, week, or month', () => {
		const base = new Date(2026, 0, 31, 0);
		expect(nextBucketStart(base, 'day').getDate()).toBe(1);
		expect(nextBucketStart(base, 'week').getDate()).toBe(7);
		// Jan 31 + 1 month lands in March via JS date normalisation; the
		// series builder only ever calls this on month starts, so check that.
		const monthStart = new Date(2026, 0, 1, 0);
		expect(nextBucketStart(monthStart, 'month').getMonth()).toBe(1);
	});
});

describe('buildBuckets', () => {
	it('returns nothing for an empty graph', () => {
		const s = buildBuckets(graph([beer], []), 'day', new Date(2026, 4, 7));
		expect(s.buckets).toEqual([]);
		expect(s.truncated).toBe(false);
	});

	it('sums amounts and counts per counter', () => {
		const g = graph(
			[beer, smoke],
			[
				occ('a', 'beer', at(2026, 5, 5, 20), 2.3),
				occ('b', 'beer', at(2026, 5, 5, 22), 2.3),
				occ('c', 'smoke', at(2026, 5, 5, 21), 1)
			]
		);
		const s = buildBuckets(g, 'day', new Date(2026, 4, 5, 23));
		expect(s.buckets).toHaveLength(1);
		const b = s.buckets[0];
		expect(b.totals.beer).toBeCloseTo(4.6);
		expect(b.counts.beer).toBe(2);
		expect(b.totals.smoke).toBe(1);
		expect(b.count).toBe(3);
		expect(b.total).toBeCloseTo(5.6);
	});

	it('keeps empty buckets between occurrences — a gap is information', () => {
		const g = graph(
			[beer],
			[occ('a', 'beer', at(2026, 5, 1, 20)), occ('b', 'beer', at(2026, 5, 4, 20))]
		);
		const s = buildBuckets(g, 'day', new Date(2026, 4, 4, 23));
		expect(s.buckets.map((b) => b.count)).toEqual([1, 0, 0, 1]);
	});

	it('extends the series to the current bucket even after a quiet stretch', () => {
		const g = graph([beer], [occ('a', 'beer', at(2026, 5, 1, 20))]);
		const s = buildBuckets(g, 'day', new Date(2026, 4, 5, 12));
		expect(s.buckets).toHaveLength(5);
		expect(s.buckets[4].count).toBe(0);
	});

	it('groups a 2am drink with the night before when day_start_hour is 4', () => {
		const g = graph(
			[beer],
			[occ('a', 'beer', at(2026, 5, 5, 23)), occ('b', 'beer', at(2026, 5, 6, 2))],
			{ day_start_hour: 4 }
		);
		const s = buildBuckets(g, 'day', new Date(2026, 4, 6, 3));
		expect(s.buckets).toHaveLength(1);
		expect(s.buckets[0].count).toBe(2);
	});

	it('rolls up into weeks and months', () => {
		const g = graph(
			[beer],
			[occ('a', 'beer', at(2026, 5, 4, 20)), occ('b', 'beer', at(2026, 5, 7, 20))]
		);
		expect(buildBuckets(g, 'week', new Date(2026, 4, 8)).buckets).toHaveLength(1);
		expect(buildBuckets(g, 'month', new Date(2026, 4, 8)).buckets).toHaveLength(1);
	});

	it('truncates leading buckets past MAX_BUCKETS and flags it', () => {
		const g = graph([beer], [occ('a', 'beer', at(2023, 1, 1, 12))]);
		const s = buildBuckets(g, 'day', new Date(2026, 4, 7));
		expect(s.truncated).toBe(true);
		expect(s.buckets).toHaveLength(MAX_BUCKETS);
		// The occurrence fell in a dropped bucket, so nothing is double-counted.
		expect(s.buckets.reduce((n, b) => n + b.count, 0)).toBe(0);
	});

	it('still shows a future-dated occurrence', () => {
		const g = graph([beer], [occ('a', 'beer', at(2026, 5, 9, 12))]);
		const s = buildBuckets(g, 'day', new Date(2026, 4, 7, 12));
		expect(s.buckets.at(-1)?.count).toBe(1);
	});

	it('treats a non-finite amount as zero rather than poisoning the total', () => {
		const g = graph([beer], [{ ...occ('a', 'beer', at(2026, 5, 5)), amount: NaN }]);
		const s = buildBuckets(g, 'day', new Date(2026, 4, 5, 23));
		expect(s.buckets[0].total).toBe(0);
		expect(s.buckets[0].count).toBe(1);
	});
});

describe('chartWindow', () => {
	it('returns everything when the series is shorter than the window', () => {
		const g = graph([beer], [occ('a', 'beer', at(2026, 5, 1, 12))]);
		const w = chartWindow(buildBuckets(g, 'day', new Date(2026, 4, 3, 12)), 45);
		expect(w.buckets).toHaveLength(3);
		expect(w.clipped).toBe(false);
		expect(w.slid).toBe(false);
	});

	it('clips to the trailing window when data is recent', () => {
		const g = graph(
			[beer],
			[occ('a', 'beer', at(2026, 5, 1, 12)), occ('b', 'beer', at(2026, 6, 10, 12))]
		);
		const w = chartWindow(buildBuckets(g, 'day', new Date(2026, 5, 11, 12)), 10);
		expect(w.buckets).toHaveLength(10);
		expect(w.clipped).toBe(true);
		expect(w.slid).toBe(false);
	});

	it('slides back to the data when the trailing window is all empty', () => {
		// Entries in May, "now" is August — the last 10 days hold nothing.
		const g = graph(
			[beer],
			[occ('a', 'beer', at(2026, 5, 1, 12), 3), occ('b', 'beer', at(2026, 5, 20, 12), 2)]
		);
		const w = chartWindow(buildBuckets(g, 'day', new Date(2026, 7, 14, 12)), 10);
		expect(w.slid).toBe(true);
		expect(w.buckets).toHaveLength(10);
		// The window now *ends* on the day that has data, instead of showing
		// ten empty August days.
		expect(w.buckets.at(-1)?.totals.beer).toBe(2);
	});

	it('cannot slide back further than the first bucket', () => {
		// Only bucket with data is also the first, so the slid window is
		// shorter than requested rather than inventing earlier buckets.
		const g = graph([beer], [occ('a', 'beer', at(2026, 5, 1, 12), 3)]);
		const w = chartWindow(buildBuckets(g, 'day', new Date(2026, 7, 14, 12)), 10);
		expect(w.slid).toBe(true);
		expect(w.buckets).toHaveLength(1);
		expect(w.buckets[0].totals.beer).toBe(3);
	});

	it('keeps the trailing window when there is no data at all', () => {
		const g = graph([beer], []);
		const w = chartWindow(buildBuckets(g, 'day', new Date(2026, 7, 14)), 10);
		expect(w.buckets).toEqual([]);
		expect(w.slid).toBe(false);
	});
});

describe('counterTotals', () => {
	it('reports count, total, mean and last time per counter', () => {
		const g = graph(
			[beer, smoke],
			[occ('a', 'beer', at(2026, 5, 1, 20), 2), occ('b', 'beer', at(2026, 5, 3, 20), 4)]
		);
		const [b, s] = counterTotals(g);
		expect(b.count).toBe(2);
		expect(b.total).toBe(6);
		expect(b.mean).toBe(3);
		expect(b.lastAt).toBe(at(2026, 5, 3, 20));
		expect(s.count).toBe(0);
		expect(s.mean).toBeNull();
		expect(s.lastAt).toBeNull();
	});
});

describe('currentBucketTotal', () => {
	it('sums only the bucket containing now', () => {
		const g = graph(
			[beer],
			[occ('a', 'beer', at(2026, 5, 6, 20), 3), occ('b', 'beer', at(2026, 5, 7, 20), 2)]
		);
		expect(currentBucketTotal(g, 'beer', 'day', new Date(2026, 4, 7, 23))).toBe(2);
		expect(currentBucketTotal(g, null, 'week', new Date(2026, 4, 7, 23))).toBe(5);
	});
});

describe('msSinceLast', () => {
	it('measures from the newest occurrence', () => {
		const g = graph(
			[beer],
			[occ('a', 'beer', at(2026, 5, 5, 12)), occ('b', 'beer', at(2026, 5, 6, 12))]
		);
		const ms = msSinceLast(g, 'beer', new Date(2026, 4, 8, 12));
		expect(ms).toBe(2 * 86_400_000);
	});

	it('is null when a counter has never fired', () => {
		expect(
			msSinceLast(graph([beer, smoke], [occ('a', 'beer', at(2026, 5, 5))]), 'smoke')
		).toBeNull();
	});
});

describe('targetStatuses', () => {
	const limited: Counter = {
		id: 'beer',
		label: 'beer',
		unit: 'units',
		target: { amount: 4, period: 'day', direction: 'at_most' }
	};

	it('reports the current period against an at_most limit', () => {
		const g = graph([limited], [occ('a', 'beer', at(2026, 5, 7, 20), 5)]);
		const [st] = targetStatuses(g, new Date(2026, 4, 7, 23));
		expect(st.current).toBe(5);
		expect(st.ok).toBe(false);
		expect(st.ratio).toBe(1.25);
	});

	it('counts a streak of completed periods under the limit', () => {
		// 5th over, 6th and 7th under, 8th is "today" and excluded.
		const g = graph(
			[limited],
			[
				occ('a', 'beer', at(2026, 5, 5, 20), 9),
				occ('b', 'beer', at(2026, 5, 6, 20), 2),
				occ('c', 'beer', at(2026, 5, 7, 20), 1),
				occ('d', 'beer', at(2026, 5, 8, 20), 8)
			]
		);
		const [st] = targetStatuses(g, new Date(2026, 4, 8, 23));
		expect(st.streak).toBe(2);
		expect(st.bestStreak).toBe(2);
		// Today's overshoot shows in `current` but hasn't broken the streak.
		expect(st.current).toBe(8);
		expect(st.ok).toBe(false);
	});

	it('excludes the in-progress period from the streak', () => {
		const g = graph([limited], [occ('a', 'beer', at(2026, 5, 7, 20), 1)]);
		// Only bucket is today's, so there are no completed periods yet.
		const [st] = targetStatuses(g, new Date(2026, 4, 7, 23));
		expect(st.streak).toBe(0);
	});

	it('handles at_least goals', () => {
		const goal: Counter = {
			id: 'gym',
			label: 'gym',
			unit: 'sessions',
			target: { amount: 3, period: 'week', direction: 'at_least' }
		};
		const g = graph(
			[goal],
			[
				occ('a', 'gym', at(2026, 5, 4, 9)),
				occ('b', 'gym', at(2026, 5, 5, 9)),
				occ('c', 'gym', at(2026, 5, 6, 9))
			]
		);
		const [st] = targetStatuses(g, new Date(2026, 4, 7, 12));
		expect(st.current).toBe(3);
		expect(st.ok).toBe(true);
	});

	it('skips counters with no target', () => {
		expect(targetStatuses(graph([beer], []))).toEqual([]);
	});
});

describe('rollingMean', () => {
	it('is null until the window fills, then averages', () => {
		const g = graph(
			[beer],
			[
				occ('a', 'beer', at(2026, 5, 1, 12), 1),
				occ('b', 'beer', at(2026, 5, 2, 12), 3),
				occ('c', 'beer', at(2026, 5, 3, 12), 5)
			]
		);
		const { buckets } = buildBuckets(g, 'day', new Date(2026, 4, 3, 23));
		expect(rollingMean(buckets, 2)).toEqual([null, 2, 4]);
	});

	it('rejects a nonsense window instead of throwing', () => {
		const g = graph([beer], [occ('a', 'beer', at(2026, 5, 1, 12))]);
		const { buckets } = buildBuckets(g, 'day', new Date(2026, 4, 1, 23));
		expect(rollingMean(buckets, 0)).toEqual([null]);
	});
});

describe('busiestWeekday', () => {
	it('finds the heaviest local weekday', () => {
		// 2026-05-01 is a Friday.
		const g = graph(
			[beer],
			[
				occ('a', 'beer', at(2026, 5, 1, 20), 3),
				occ('b', 'beer', at(2026, 5, 2, 20), 1),
				occ('c', 'beer', at(2026, 5, 8, 20), 3)
			]
		);
		const best = busiestWeekday(g);
		expect(best).not.toBeNull();
		expect(best?.weekday).toBe(4);
		expect(best?.total).toBe(6);
	});

	it('is null with no occurrences', () => {
		expect(busiestWeekday(graph([beer], []))).toBeNull();
	});
});

describe('formatting helpers', () => {
	it('stepOf defaults to 1 and rejects non-positive steps', () => {
		expect(stepOf(beer)).toBe(1);
		expect(stepOf({ ...beer, step: 2.3 })).toBe(2.3);
		expect(stepOf({ ...beer, step: 0 })).toBe(1);
	});

	it('formatAmount trims trailing zeros', () => {
		expect(formatAmount(1)).toBe('1');
		expect(formatAmount(2.3)).toBe('2.3');
		expect(formatAmount(2.5)).toBe('2.5');
		expect(formatAmount(NaN)).toBe('—');
	});

	it('formatElapsed steps down to the useful granularity', () => {
		expect(formatElapsed(30_000)).toBe('just now');
		expect(formatElapsed(90 * 60_000)).toBe('1h 30m');
		expect(formatElapsed(3 * 86_400_000)).toBe('3d 0h');
		expect(formatElapsed(30 * 86_400_000)).toBe('30d');
		expect(formatElapsed(-1)).toBe('—');
	});
});
