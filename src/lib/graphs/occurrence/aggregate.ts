// Aggregation for occurrence graphs: rolling raw events up into day/week/
// month buckets, comparing those buckets against counter targets, and
// deriving the figures counting apps put front and centre (today's total,
// time since last, streaks).
//
// Everything here is pure and local-time aware. Occurrence timestamps are
// stored UTC (data_model.md §3.4) but users count in *their* days, so all
// bucketing runs through the local zone plus the graph's `day_start_hour`.

import type { Counter, Occurrence, OccurrenceBucket, OccurrenceGraph } from '$lib/types.js';

// Upper bound on how many buckets we will materialise for a chart. A graph
// whose first occurrence is years back would otherwise generate thousands of
// empty daily buckets. Callers see the truncation via `BucketSeries.truncated`.
export const MAX_BUCKETS = 400;

export interface Bucket {
	// Stable key, unique within a series — used for keyed `{#each}`.
	key: string;
	start: Date;
	// Exclusive.
	end: Date;
	// Summed `amount` per counter id. Counters with nothing in this bucket
	// are absent rather than zero.
	totals: Record<string, number>;
	// Number of occurrences per counter id.
	counts: Record<string, number>;
	// Across all counters.
	total: number;
	count: number;
}

export interface BucketSeries {
	bucket: OccurrenceBucket;
	buckets: Bucket[];
	// True when older buckets were dropped to stay under MAX_BUCKETS.
	truncated: boolean;
}

export function dayStartHourOf(graph: OccurrenceGraph): number {
	const h = graph.schema.day_start_hour ?? 0;
	if (!Number.isInteger(h) || h < 0 || h > 23) return 0;
	return h;
}

export function defaultBucketOf(graph: OccurrenceGraph): OccurrenceBucket {
	return graph.schema.default_bucket ?? 'day';
}

// Start of the local "day" containing `d`, shifted by `dayStartHour`. With
// dayStartHour=4, anything before 04:00 belongs to the previous day.
export function dayStart(d: Date, dayStartHour: number): Date {
	const out = new Date(d.getTime());
	out.setHours(dayStartHour, 0, 0, 0);
	if (out.getTime() > d.getTime()) out.setDate(out.getDate() - 1);
	return out;
}

// Start of the bucket containing `d`. Weeks start Monday; months start on
// the 1st. Both inherit the day-start shift.
export function bucketStart(d: Date, bucket: OccurrenceBucket, dayStartHour: number): Date {
	const ds = dayStart(d, dayStartHour);
	if (bucket === 'day') return ds;
	if (bucket === 'week') {
		// getDay() is 0=Sunday; shift so Monday is 0.
		const mondayOffset = (ds.getDay() + 6) % 7;
		const out = new Date(ds.getTime());
		out.setDate(ds.getDate() - mondayOffset);
		return out;
	}
	return new Date(ds.getFullYear(), ds.getMonth(), 1, dayStartHour, 0, 0, 0);
}

export function nextBucketStart(start: Date, bucket: OccurrenceBucket): Date {
	const out = new Date(start.getTime());
	if (bucket === 'day') out.setDate(out.getDate() + 1);
	else if (bucket === 'week') out.setDate(out.getDate() + 7);
	else out.setMonth(out.getMonth() + 1);
	return out;
}

function keyOf(start: Date, bucket: OccurrenceBucket): string {
	const y = start.getFullYear();
	const m = String(start.getMonth() + 1).padStart(2, '0');
	const d = String(start.getDate()).padStart(2, '0');
	if (bucket === 'month') return `${y}-${m}`;
	return `${y}-${m}-${d}`;
}

export function formatBucketLabel(start: Date, bucket: OccurrenceBucket): string {
	if (bucket === 'month') {
		return start.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
	}
	return start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sortedOccurrences(graph: OccurrenceGraph): Occurrence[] {
	return [...graph.occurrences].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// Dense bucket series: every bucket between the first occurrence and `now`
// exists, including the empty ones — a gap in a drinks chart is information,
// so it has to be drawn rather than skipped.
export function buildBuckets(
	graph: OccurrenceGraph,
	bucket: OccurrenceBucket = defaultBucketOf(graph),
	now: Date = new Date()
): BucketSeries {
	const dayStartHour = dayStartHourOf(graph);
	const events = sortedOccurrences(graph);
	if (events.length === 0) return { bucket, buckets: [], truncated: false };

	const first = bucketStart(new Date(events[0].timestamp), bucket, dayStartHour);
	const lastEvent = bucketStart(
		new Date(events[events.length - 1].timestamp),
		bucket,
		dayStartHour
	);
	const nowBucket = bucketStart(now, bucket, dayStartHour);
	// Run to whichever is later — a future-dated occurrence should still be
	// visible, and a quiet stretch up to today should still show as empty.
	const last = nowBucket.getTime() > lastEvent.getTime() ? nowBucket : lastEvent;

	const starts: Date[] = [];
	let cursor = first;
	while (cursor.getTime() <= last.getTime()) {
		starts.push(cursor);
		cursor = nextBucketStart(cursor, bucket);
		// Defensive: nextBucketStart always advances, but a malformed date
		// would otherwise spin forever.
		if (starts.length > 10_000) break;
	}

	const truncated = starts.length > MAX_BUCKETS;
	const kept = truncated ? starts.slice(starts.length - MAX_BUCKETS) : starts;

	const buckets: Bucket[] = kept.map((start) => ({
		key: keyOf(start, bucket),
		start,
		end: nextBucketStart(start, bucket),
		totals: {},
		counts: {},
		total: 0,
		count: 0
	}));

	const byKey = new Map(buckets.map((b) => [b.key, b]));
	for (const ev of events) {
		const start = bucketStart(new Date(ev.timestamp), bucket, dayStartHour);
		const b = byKey.get(keyOf(start, bucket));
		// Missing only when the event fell in a truncated leading bucket.
		if (!b) continue;
		const amount = Number.isFinite(ev.amount) ? ev.amount : 0;
		b.totals[ev.counter_id] = (b.totals[ev.counter_id] ?? 0) + amount;
		b.counts[ev.counter_id] = (b.counts[ev.counter_id] ?? 0) + 1;
		b.total += amount;
		b.count += 1;
	}

	return { bucket, buckets, truncated };
}

// How many buckets a chart shows by default, per bucket kind. Counting apps
// show a trailing window rather than all history: a year of daily bars is
// unreadable, and a graph you stopped using would otherwise squash its data
// into the left edge behind months of empty space.
export const DEFAULT_WINDOW: Record<OccurrenceBucket, number> = {
	day: 45,
	week: 26,
	month: 12
};

export interface ChartWindow {
	buckets: Bucket[];
	// True when buckets before the window exist and were left out.
	clipped: boolean;
	// True when the window was slid back to reach the data — i.e. the most
	// recent `size` buckets were all empty. Callers should say so, otherwise
	// the x axis silently lies about how recent the bars are.
	slid: boolean;
}

// Trailing window over a dense series. When the trailing window turns out to
// be entirely empty (an abandoned graph), slide it back to end at the last
// bucket that has data, rather than showing a blank chart.
export function chartWindow(series: BucketSeries, size?: number): ChartWindow {
	const all = series.buckets;
	const n = size ?? DEFAULT_WINDOW[series.bucket];
	if (!Number.isInteger(n) || n < 1 || all.length <= n) {
		return { buckets: all, clipped: series.truncated, slid: false };
	}

	const trailing = all.slice(all.length - n);
	if (trailing.some((b) => b.count > 0)) {
		return { buckets: trailing, clipped: true, slid: false };
	}

	let lastWithData = -1;
	for (let i = all.length - 1; i >= 0; i--) {
		if (all[i].count > 0) {
			lastWithData = i;
			break;
		}
	}
	// No data anywhere: keep the trailing window so the axis still reads as
	// "now" rather than jumping to an arbitrary point.
	if (lastWithData < 0) return { buckets: trailing, clipped: true, slid: false };

	const end = lastWithData + 1;
	const start = Math.max(0, end - n);
	return { buckets: all.slice(start, end), clipped: true, slid: true };
}

// Where an occurrence falls within its own shifted local day, as 0..1. This
// is what lets the history render as a 24-hour track per day instead of a
// flat list: position carries "when in the day", which a table row can only
// state in words.
export function dayFraction(d: Date, dayStartHour: number): number {
	const start = dayStart(d, dayStartHour);
	const f = (d.getTime() - start.getTime()) / 86_400_000;
	// DST days are 23 or 25 hours long, so the nominal divisor can push this
	// slightly outside the range. Clamp rather than letting a dot escape the
	// track.
	if (!Number.isFinite(f)) return 0;
	return Math.min(1, Math.max(0, f));
}

export interface DaySubtotal {
	counterId: string;
	label: string;
	unit: string;
	color: string;
	total: number;
}

export interface DayGroup {
	key: string;
	start: Date;
	// Newest first within the day, matching the reverse-chronological list.
	entries: Occurrence[];
	subtotals: DaySubtotal[];
}

// Group occurrences into shifted local days, newest day first. `limit` caps
// the number of *entries* considered (not days), so a long history can page
// in without walking everything.
export function groupByDay(graph: OccurrenceGraph, limit?: number): DayGroup[] {
	const hour = dayStartHourOf(graph);
	const palette = graph.customization.theme.palette;
	const counters = graph.schema.counters;
	const meta = new Map(
		counters.map((c, i) => [
			c.id,
			{ label: c.label, unit: c.unit, color: counterColor(c, i, palette) }
		])
	);

	const sorted = [...graph.occurrences].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	const visible = limit === undefined ? sorted : sorted.slice(0, limit);

	const out: DayGroup[] = [];
	const byKey = new Map<string, DayGroup>();
	for (const o of visible) {
		const start = dayStart(new Date(o.timestamp), hour);
		const key = start.toISOString();
		let group = byKey.get(key);
		if (!group) {
			group = { key, start, entries: [], subtotals: [] };
			byKey.set(key, group);
			out.push(group);
		}
		group.entries.push(o);
	}

	for (const group of out) {
		const totals = new Map<string, number>();
		for (const o of group.entries) {
			const amount = Number.isFinite(o.amount) ? o.amount : 0;
			totals.set(o.counter_id, (totals.get(o.counter_id) ?? 0) + amount);
		}
		// Subtotals stay per counter — summing across units is meaningless.
		group.subtotals = [...totals.entries()].map(([counterId, total]) => {
			const m = meta.get(counterId);
			return {
				counterId,
				label: m?.label ?? counterId,
				unit: m?.unit ?? '',
				color: m?.color ?? '#c98aff',
				total
			};
		});
	}

	return out;
}

export interface CounterTotal {
	counter: Counter;
	count: number;
	total: number;
	// Mean amount per occurrence, or null with no occurrences.
	mean: number | null;
	// Newest occurrence timestamp for this counter, or null.
	lastAt: string | null;
}

export function counterTotals(graph: OccurrenceGraph): CounterTotal[] {
	return graph.schema.counters.map((counter) => {
		const mine = graph.occurrences.filter((o) => o.counter_id === counter.id);
		const total = mine.reduce((sum, o) => sum + (Number.isFinite(o.amount) ? o.amount : 0), 0);
		let lastAt: string | null = null;
		for (const o of mine) if (lastAt === null || o.timestamp > lastAt) lastAt = o.timestamp;
		return {
			counter,
			count: mine.length,
			total,
			mean: mine.length > 0 ? total / mine.length : null,
			lastAt
		};
	});
}

// Total in the bucket containing `now` — "today's drinks", the number a
// counting app shows biggest.
export function currentBucketTotal(
	graph: OccurrenceGraph,
	counterId: string | null,
	bucket: OccurrenceBucket,
	now: Date = new Date()
): number {
	const dayStartHour = dayStartHourOf(graph);
	const start = bucketStart(now, bucket, dayStartHour);
	const end = nextBucketStart(start, bucket);
	let sum = 0;
	for (const o of graph.occurrences) {
		if (counterId !== null && o.counter_id !== counterId) continue;
		const t = new Date(o.timestamp).getTime();
		if (t >= start.getTime() && t < end.getTime()) {
			sum += Number.isFinite(o.amount) ? o.amount : 0;
		}
	}
	return sum;
}

// Milliseconds since the most recent occurrence, or null if there are none.
// This is the "N days clean" figure when read against a counter you're
// trying not to feed.
export function msSinceLast(
	graph: OccurrenceGraph,
	counterId: string | null = null,
	now: Date = new Date()
): number | null {
	let latest: number | null = null;
	for (const o of graph.occurrences) {
		if (counterId !== null && o.counter_id !== counterId) continue;
		const t = new Date(o.timestamp).getTime();
		if (!Number.isFinite(t)) continue;
		if (latest === null || t > latest) latest = t;
	}
	if (latest === null) return null;
	return Math.max(0, now.getTime() - latest);
}

export interface TargetStatus {
	counter: Counter;
	// The bucket the target is expressed over — may differ from the chart's.
	period: OccurrenceBucket;
	target: number;
	direction: 'at_most' | 'at_least';
	// Total in the current period.
	current: number;
	// current / target, unclamped so an overshoot is visible.
	ratio: number;
	// Whether the current period satisfies the target right now. For an
	// 'at_least' goal this is provisional — the period isn't over yet.
	ok: boolean;
	// Consecutive *completed* periods satisfying the target, counting back
	// from the most recently completed one.
	streak: number;
	// Longest such run anywhere in the history.
	bestStreak: number;
}

export function targetStatuses(graph: OccurrenceGraph, now: Date = new Date()): TargetStatus[] {
	const out: TargetStatus[] = [];
	for (const counter of graph.schema.counters) {
		const t = counter.target;
		if (!t || !Number.isFinite(t.amount)) continue;

		const current = currentBucketTotal(graph, counter.id, t.period, now);
		const satisfied = (v: number) => (t.direction === 'at_most' ? v <= t.amount : v >= t.amount);

		// Streaks are computed over completed periods only: a day you are
		// still living in hasn't kept the limit yet, and counting it would
		// make every streak reset at midnight.
		const series = buildBuckets(graph, t.period, now);
		const currentKey = keyOf(bucketStart(now, t.period, dayStartHourOf(graph)), t.period);
		const completed = series.buckets.filter((b) => b.key !== currentKey);
		const values = completed.map((b) => b.totals[counter.id] ?? 0);

		let streak = 0;
		for (let i = values.length - 1; i >= 0; i--) {
			if (!satisfied(values[i])) break;
			streak++;
		}
		let bestStreak = 0;
		let run = 0;
		for (const v of values) {
			if (satisfied(v)) {
				run++;
				if (run > bestStreak) bestStreak = run;
			} else {
				run = 0;
			}
		}

		out.push({
			counter,
			period: t.period,
			target: t.amount,
			direction: t.direction,
			current,
			ratio: t.amount === 0 ? (current === 0 ? 0 : Infinity) : current / t.amount,
			ok: satisfied(current),
			streak,
			bestStreak
		});
	}
	return out;
}

// Rolling mean of bucket totals over `window` buckets, aligned to the end of
// each window. Entries before the window is full are null so the line starts
// where it is meaningful.
export function rollingMean(
	buckets: Bucket[],
	window: number,
	counterId: string | null = null
): (number | null)[] {
	if (!Number.isInteger(window) || window < 1) return buckets.map(() => null);
	const values = buckets.map((b) => (counterId === null ? b.total : (b.totals[counterId] ?? 0)));
	return values.map((_, i) => {
		if (i + 1 < window) return null;
		let sum = 0;
		for (let j = i + 1 - window; j <= i; j++) sum += values[j];
		return sum / window;
	});
}

// Which local weekday sees the most of a counter — the "you drink on
// Fridays" insight. Returns 0=Monday…6=Sunday, or null with no data.
export function busiestWeekday(
	graph: OccurrenceGraph,
	counterId: string | null = null
): { weekday: number; total: number } | null {
	const dayStartHour = dayStartHourOf(graph);
	const totals = new Array<number>(7).fill(0);
	let any = false;
	for (const o of graph.occurrences) {
		if (counterId !== null && o.counter_id !== counterId) continue;
		const d = new Date(o.timestamp);
		if (Number.isNaN(d.getTime())) continue;
		// Attribute to the shifted day, so a 2am Saturday drink lands on
		// Friday when day_start_hour is 4.
		const ds = dayStart(d, dayStartHour);
		totals[(ds.getDay() + 6) % 7] += Number.isFinite(o.amount) ? o.amount : 0;
		any = true;
	}
	if (!any) return null;
	let best = 0;
	for (let i = 1; i < 7; i++) if (totals[i] > totals[best]) best = i;
	return { weekday: best, total: totals[best] };
}

export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Amount a bare tap on a counter records.
export function stepOf(counter: Counter): number {
	const s = counter.step;
	return Number.isFinite(s) && (s as number) > 0 ? (s as number) : 1;
}

// Resolve a counter's colour, falling back to a palette cycle by index so a
// counter list is legible without anyone picking colours.
export function counterColor(counter: Counter, index: number, palette: string[]): string {
	if (counter.color) return counter.color;
	if (palette.length === 0) return '#c98aff';
	return palette[index % palette.length];
}

// Human-readable elapsed time, at the granularity counting apps use: they
// care about "4 days", not "4 days 3 hours 12 minutes".
export function formatElapsed(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return '—';
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${minutes % 60}m`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ${hours % 24}h`;
	return `${days}d`;
}

// Trim trailing zeros so "2.30 units" renders as "2.3 units" and "1.00" as
// "1" — amounts are user-facing counts, not measurements.
export function formatAmount(n: number): string {
	if (!Number.isFinite(n)) return '—';
	if (Number.isInteger(n)) return String(n);
	return n.toFixed(2).replace(/\.?0+$/, '');
}
