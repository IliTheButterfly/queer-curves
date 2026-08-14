// Tests for cross-graph axis plotting — the mode where each visual channel
// binds to one specific (member, axis) pair.

import { describe, expect, it } from 'vitest';
import {
	axisOptions,
	buildCrossPlot,
	defaultCollectionView,
	type CrossPlotOptions
} from './crossplot.js';
import type { ComposeSource } from './compose.js';
import type { CollectionView, SpectrumGraph } from '../types.js';

const NOW = '2026-08-14T12:00:00Z';
const opts: CrossPlotOptions = { id: 'c_1', name: 'plot', owner: '@me:localhost', now: NOW };

function graph(
	name: string,
	axisNames: string[],
	points: { t: string; c: number[] }[]
): SpectrumGraph {
	return {
		id: `g_${name}`,
		type: 'spectrum',
		name,
		created_at: NOW,
		modified_at: NOW,
		schema_version: 1,
		owner: '@me:localhost',
		editors: [],
		schema: {
			dimensions: axisNames.length as 1 | 2 | 3,
			axes: axisNames.map((n) => ({
				name: n,
				min_label: 'low',
				max_label: 'high',
				range: [0, 1] as [number, number]
			})),
			regions: []
		},
		customization: { theme: { palette: ['#c98aff'] }, title: { show: true, text: name } },
		datapoints: points.map((p, i) => ({ id: `${name}-${i}`, coordinates: p.c, timestamp: p.t }))
	};
}

// Person 1 records stress and libido together; person 2 records only stress,
// on a different day, and has a different number of axes.
const p1 = graph(
	'me',
	['stress', 'libido'],
	[
		{ t: '2026-05-01T00:00:00Z', c: [0.2, 0.8] },
		{ t: '2026-05-03T00:00:00Z', c: [0.6, 0.4] },
		{ t: '2026-05-05T00:00:00Z', c: [0.9, 0.1] }
	]
);
const p2 = graph(
	'Sam',
	['stress'],
	[
		{ t: '2026-05-02T00:00:00Z', c: [0.3] },
		{ t: '2026-05-04T00:00:00Z', c: [0.7] }
	]
);

const sources: ComposeSource[] = [
	{ graph: p1, color: '#ff0000' },
	{ graph: p2, color: '#00ff00' }
];

describe('axisOptions', () => {
	it('flattens every axis of every member with a readable label', () => {
		expect(axisOptions(sources).map((o) => o.label)).toEqual([
			'me — stress',
			'me — libido',
			'Sam — stress'
		]);
	});

	it('skips network members, which have no axes', () => {
		const net = {
			...p1,
			id: 'g_n',
			type: 'network' as const,
			schema: { edge_types: [] },
			nodes: [],
			edges: []
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(axisOptions([{ graph: net as any }])).toEqual([]);
	});
});

describe('buildCrossPlot — over time', () => {
	const view: CollectionView = {
		id: 'v',
		name: 'stress over time',
		x: 'time',
		y: [
			{ member: 0, axis: 0 },
			{ member: 1, axis: 0 }
		]
	};

	it('plots each member as its own series, reading the named axis', () => {
		const g = buildCrossPlot(sources, view, opts)!;
		expect(g.datapoints).toHaveLength(5);
		// Values come from the referenced axis, not from axis 0 positionally
		// for everyone — here they coincide, but the y axis proves the bind.
		expect(g.schema.axes[1].name).toBe('stress');
	});

	it('tags and colours each series so trails and legend stay separate', () => {
		const g = buildCrossPlot(sources, view, opts)!;
		const mine = g.datapoints.filter((d) => d.tags?.includes('from:me'));
		const theirs = g.datapoints.filter((d) => d.tags?.includes('from:Sam'));
		expect(mine).toHaveLength(3);
		expect(theirs).toHaveLength(2);
		expect(mine.every((d) => d.color === '#ff0000')).toBe(true);
		expect(theirs.every((d) => d.color === '#00ff00')).toBe(true);
	});

	it('combines members of different dimensionality, which combined mode cannot', () => {
		// p1 is 2D, p2 is 1D — checkComposable would reject this outright.
		expect(buildCrossPlot(sources, view, opts)).not.toBeNull();
	});

	it('distinguishes two axes of the same member in the series label', () => {
		const g = buildCrossPlot(
			sources,
			{
				id: 'v',
				name: 'both',
				x: 'time',
				y: [
					{ member: 0, axis: 0 },
					{ member: 0, axis: 1 }
				]
			},
			opts
		)!;
		expect(g.datapoints.some((d) => d.tags?.includes('from:me — stress'))).toBe(true);
		expect(g.datapoints.some((d) => d.tags?.includes('from:me — libido'))).toBe(true);
	});

	it('names the y axis after both axes when they disagree', () => {
		const g = buildCrossPlot(
			sources,
			{
				id: 'v',
				name: 'both',
				x: 'time',
				y: [
					{ member: 0, axis: 0 },
					{ member: 0, axis: 1 }
				]
			},
			opts
		)!;
		expect(g.schema.axes[1].name).toBe('stress / libido');
	});
});

describe('buildCrossPlot — correlation', () => {
	it('correlates two axes of one graph directly', () => {
		const g = buildCrossPlot(
			sources,
			{ id: 'v', name: 'stress vs libido', x: { member: 0, axis: 0 }, y: [{ member: 0, axis: 1 }] },
			opts
		)!;
		expect(g.schema.axes[0].name).toBe('stress');
		expect(g.schema.axes[1].name).toBe('libido');
		expect(g.datapoints.map((d) => d.coordinates)).toEqual([
			[0.2, 0.8],
			[0.6, 0.4],
			[0.9, 0.1]
		]);
	});

	it("correlates one member's axis against another's, joined on time", () => {
		const g = buildCrossPlot(
			sources,
			{ id: 'v', name: 'my stress vs Sam', x: { member: 0, axis: 0 }, y: [{ member: 1, axis: 0 }] },
			opts
		)!;
		// Timestamps union: 05-01, 05-02, 05-03, 05-04, 05-05. 05-01 has no
		// Sam reading yet, so it drops; the rest carry the last value forward.
		expect(g.datapoints.map((d) => d.coordinates)).toEqual([
			[0.2, 0.3], // 05-02: my 05-01 value held, Sam's first reading
			[0.6, 0.3], // 05-03: my new reading, Sam's held
			[0.6, 0.7], // 05-04: mine held, Sam's new reading
			[0.9, 0.7] // 05-05: my new reading, Sam's held
		]);
	});

	it('drops timestamps before both series have started', () => {
		const g = buildCrossPlot(
			sources,
			{ id: 'v', name: 'x', x: { member: 0, axis: 0 }, y: [{ member: 1, axis: 0 }] },
			opts
		)!;
		expect(g.datapoints.some((d) => d.timestamp === '2026-05-01T00:00:00Z')).toBe(false);
	});

	it('is symmetric about which side supplies a timestamp', () => {
		const g = buildCrossPlot(
			sources,
			{ id: 'v', name: 'x', x: { member: 1, axis: 0 }, y: [{ member: 0, axis: 0 }] },
			opts
		)!;
		// Every timestamp from 05-02 onward, from either side.
		expect(g.datapoints).toHaveLength(4);
	});
});

describe('buildCrossPlot — robustness', () => {
	it('returns null when the view references a member that is gone', () => {
		const view: CollectionView = { id: 'v', name: 'x', x: 'time', y: [{ member: 9, axis: 0 }] };
		expect(buildCrossPlot(sources, view, opts)).toBeNull();
	});

	it('returns null when the view references an axis that is gone', () => {
		const view: CollectionView = { id: 'v', name: 'x', x: 'time', y: [{ member: 1, axis: 5 }] };
		expect(buildCrossPlot(sources, view, opts)).toBeNull();
	});

	it('returns null when the x binding is gone', () => {
		const view: CollectionView = {
			id: 'v',
			name: 'x',
			x: { member: 9, axis: 0 },
			y: [{ member: 0, axis: 0 }]
		};
		expect(buildCrossPlot(sources, view, opts)).toBeNull();
	});

	it('keeps the surviving series when only one y binding is stale', () => {
		const view: CollectionView = {
			id: 'v',
			name: 'x',
			x: 'time',
			y: [
				{ member: 0, axis: 0 },
				{ member: 9, axis: 0 }
			]
		};
		const g = buildCrossPlot(sources, view, opts)!;
		expect(g.datapoints).toHaveLength(3);
	});

	it('gives every datapoint a unique id', () => {
		const view: CollectionView = {
			id: 'v',
			name: 'x',
			x: 'time',
			y: [
				{ member: 0, axis: 0 },
				{ member: 0, axis: 1 }
			]
		};
		const g = buildCrossPlot(sources, view, opts)!;
		expect(new Set(g.datapoints.map((d) => d.id)).size).toBe(g.datapoints.length);
	});
});

describe('defaultCollectionView', () => {
	it('starts with one series per member over time', () => {
		const v = defaultCollectionView(sources)!;
		expect(v.x).toBe('time');
		expect(v.y).toEqual([
			{ member: 0, axis: 0 },
			{ member: 1, axis: 0 }
		]);
	});

	it('is null when no member has axes to plot', () => {
		expect(defaultCollectionView([])).toBeNull();
	});
});
