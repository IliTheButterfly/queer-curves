// Cross-graph axis plotting for collections.
//
// The combined mode in compose.ts lays members onto *shared* axes: it reads
// axis 0 as axis 0 for everybody, so it needs every member to agree about
// dimensionality and about what each axis means. That covers "the same kind
// of graph, several people" and nothing else.
//
// This module covers the rest. A CollectionView binds each visual channel to
// one specific (member, axis) pair, so any axis of any member can be plotted
// against any other:
//
//   * one axis over time, for several members at once (x = 'time');
//   * two axes of one graph against each other — a correlation scatter;
//   * one member's axis against another member's axis, joined on time.
//
// The output is an ordinary throwaway SpectrumGraph, so the existing
// renderer draws it with no changes: two axes, one series per y binding,
// each series colour-coded and `from:`-tagged so trails stay separate.
//
// This is the "computed projections between distinct axis systems" that
// data_model.md §10 deferred, scoped to reading named axes — it still does
// not *transform* one axis system into another (no rotation, no derived
// coordinates). Values are read as stored.

import type {
	Axis,
	CollectionSeries,
	CollectionView,
	SpectrumDatapoint,
	SpectrumGraph,
	Timestamp
} from '$lib/types.js';
import type { ComposeSource } from './compose.js';

export interface CrossPlotOptions {
	id: string;
	name: string;
	owner: string;
	now: Timestamp;
}

/** One selectable (member, axis) pair, for building the channel pickers. */
export interface AxisOption {
	member: number;
	axis: number;
	/** "Sam's gender — stress" */
	label: string;
	memberLabel: string;
	axisLabel: string;
}

/**
 * Every axis of every member, flattened. Network members contribute
 * nothing — they have no axes to plot.
 */
export function axisOptions(sources: ComposeSource[]): AxisOption[] {
	const out: AxisOption[] = [];
	sources.forEach((source, member) => {
		if (source.graph.type !== 'spectrum') return;
		const memberLabel = source.label ?? source.graph.name;
		source.graph.schema.axes.forEach((axis, i) => {
			const axisLabel = axis.name || `axis ${i + 1}`;
			out.push({
				member,
				axis: i,
				memberLabel,
				axisLabel,
				label: `${memberLabel} — ${axisLabel}`
			});
		});
	});
	return out;
}

function axisOf(sources: ComposeSource[], ref: CollectionSeries): Axis | undefined {
	const graph = sources[ref.member]?.graph;
	if (!graph || graph.type !== 'spectrum') return undefined;
	return graph.schema.axes[ref.axis];
}

function labelOf(sources: ComposeSource[], ref: CollectionSeries): string {
	const source = sources[ref.member];
	if (!source) return 'unknown';
	return source.label ?? source.graph.name;
}

/** A member's points along one axis, sorted by time. */
function seriesPoints(
	sources: ComposeSource[],
	ref: CollectionSeries
): { timestamp: Timestamp; value: number; source: SpectrumDatapoint }[] {
	const graph = sources[ref.member]?.graph;
	if (!graph || graph.type !== 'spectrum') return [];
	return graph.datapoints
		.filter((dp) => typeof dp.coordinates[ref.axis] === 'number')
		.map((dp) => ({ timestamp: dp.timestamp, value: dp.coordinates[ref.axis], source: dp }))
		.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Value of a time-sorted series as of `t`, using last-observation-carried-
 * forward: the most recent reading at or before `t`, or undefined if the
 * series hadn't started yet.
 *
 * Two graphs are recorded whenever their owners felt like it, so exact
 * timestamp matches are vanishingly rare and an inner join would produce an
 * empty plot. LOCF is the honest approximation — it treats a recorded value
 * as standing until the next one replaces it, which is exactly what these
 * graphs mean — but it *is* an approximation, and the UI says so.
 */
function valueAt(
	series: { timestamp: Timestamp; value: number }[],
	t: Timestamp
): number | undefined {
	let out: number | undefined;
	for (const p of series) {
		if (p.timestamp > t) break;
		out = p.value;
	}
	return out;
}

function mergeRanges(axes: (Axis | undefined)[]): [number, number] {
	const present = axes.filter((a): a is Axis => Boolean(a));
	if (present.length === 0) return [0, 1];
	return [Math.min(...present.map((a) => a.range[0])), Math.max(...present.map((a) => a.range[1]))];
}

/**
 * Build the throwaway graph a CollectionView renders as, or null if the
 * view references members/axes that aren't there (a member removed after
 * the view was saved).
 *
 * Always two dimensions: axis 0 is the x channel (unused when x is time,
 * where the renderer reads timestamps instead) and axis 1 is the y channel.
 */
export function buildCrossPlot(
	sources: ComposeSource[],
	view: CollectionView,
	opts: CrossPlotOptions
): SpectrumGraph | null {
	const ys = view.y.filter((ref) => axisOf(sources, ref) !== undefined);
	if (ys.length === 0) return null;
	if (view.x !== 'time' && axisOf(sources, view.x) === undefined) return null;

	const yAxes = ys.map((ref) => axisOf(sources, ref));
	const yRange = mergeRanges(yAxes);
	// When every y binding reads an axis of the same name, that name is the
	// channel's name; otherwise the label has to enumerate them or it would
	// claim a shared meaning the data doesn't have.
	const yNames = [...new Set(yAxes.map((a) => a?.name).filter(Boolean))];
	const yName = yNames.length === 1 ? yNames[0]! : yNames.join(' / ');
	const yAxis: Axis = {
		name: yName,
		min_label: yAxes[0]?.min_label ?? '',
		max_label: yAxes[0]?.max_label ?? '',
		range: yRange
	};

	const xAxisSrc = view.x === 'time' ? undefined : axisOf(sources, view.x);
	const xAxis: Axis = xAxisSrc
		? { ...xAxisSrc }
		: { name: 'time', min_label: '', max_label: '', range: [0, 1] };

	const datapoints: SpectrumDatapoint[] = [];
	const takenIds = new Set<string>();
	const mintId = (base: string) => {
		let id = base;
		let n = 2;
		while (takenIds.has(id)) id = `${base}-${n++}`;
		takenIds.add(id);
		return id;
	};

	ys.forEach((yRef, si) => {
		const label = labelOf(sources, yRef);
		const yAxisName = axisOf(sources, yRef)?.name ?? `axis ${yRef.axis + 1}`;
		// The member's name identifies the series on its own, unless that
		// member contributes more than one axis — "me — stress" vs
		// "me — libido". Adding the axis name unconditionally would clutter
		// the common case where each series is simply a different person.
		const repeated = ys.filter((r) => r.member === yRef.member).length > 1;
		const seriesTag = repeated ? `from:${label} — ${yAxisName}` : `from:${label}`;
		const color = sources[yRef.member]?.color;
		const ySeries = seriesPoints(sources, yRef);

		if (view.x === 'time') {
			// Straight time series — no join needed, each reading plots at
			// its own timestamp.
			for (const p of ySeries) {
				datapoints.push({
					id: mintId(`${p.source.id}@${si}`),
					coordinates: [0, p.value],
					timestamp: p.timestamp,
					notes: p.source.notes,
					tags: [...new Set([...(p.source.tags ?? []), seriesTag])],
					color
				});
			}
			return;
		}

		// Correlation: pair the two channels up over time. Driving off the
		// union of both series' timestamps means a reading on either side
		// produces a point, rather than silently dropping every reading the
		// other graph happens not to share.
		const xSeries = seriesPoints(sources, view.x as CollectionSeries);
		const stamps = [...new Set([...xSeries, ...ySeries].map((p) => p.timestamp))].sort((a, b) =>
			a.localeCompare(b)
		);
		for (const t of stamps) {
			const xv = valueAt(xSeries, t);
			const yv = valueAt(ySeries, t);
			// Before both series have started there is nothing to pair.
			if (xv === undefined || yv === undefined) continue;
			datapoints.push({
				id: mintId(`x${si}@${t}`),
				coordinates: [xv, yv],
				timestamp: t,
				tags: [seriesTag],
				color
			});
		}
	});

	datapoints.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

	return {
		id: opts.id,
		type: 'spectrum',
		name: opts.name,
		created_at: opts.now,
		modified_at: opts.now,
		schema_version: sources[0]?.graph.schema_version ?? 1,
		owner: opts.owner,
		editors: [],
		schema: { dimensions: 2, axes: [xAxis, yAxis], regions: [] },
		customization: {
			theme: {
				palette:
					sources[0]?.graph.type === 'spectrum'
						? sources[0].graph.customization.theme.palette
						: ['#c98aff']
			},
			title: { show: false, text: view.name }
		},
		datapoints
	};
}

/** Whether the correlation join actually had to interpolate anything. */
export function usesTimeJoin(view: CollectionView): boolean {
	return view.x !== 'time';
}

/** A reasonable starting view for a collection: everything over time. */
export function defaultCollectionView(sources: ComposeSource[]): CollectionView | null {
	const options = axisOptions(sources);
	if (options.length === 0) return null;
	// One series per member, using its first axis — the closest thing to
	// "just show me these graphs" that cross-graph plotting can express.
	const seen = new Set<number>();
	const y: CollectionSeries[] = [];
	for (const o of options) {
		if (seen.has(o.member)) continue;
		seen.add(o.member);
		y.push({ member: o.member, axis: o.axis });
	}
	return { id: 'axis-view', name: 'Over time', x: 'time', y };
}
