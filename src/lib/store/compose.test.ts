// Tests for graph composition — the shared core behind merging graphs and
// rendering multi-graph collection views. Pure functions, no environment.

import { describe, expect, it } from 'vitest';
import { checkComposable, composeGraphs, type ComposeSource } from './compose.js';
import type { NetworkGraph, SpectrumGraph } from '../types.js';

const NOW = '2026-08-14T12:00:00Z';

function spectrum(overrides: Partial<SpectrumGraph> = {}): SpectrumGraph {
	return {
		id: 'g_a',
		type: 'spectrum',
		name: 'A',
		created_at: NOW,
		modified_at: NOW,
		schema_version: 1,
		owner: '@me:localhost',
		editors: [],
		schema: {
			dimensions: 2,
			axes: [
				{ name: 'axis 1', min_label: 'agender', max_label: 'nb', range: [0, 1] },
				{ name: 'axis 2', min_label: 'agender', max_label: 'women', range: [0, 1] }
			],
			regions: []
		},
		customization: { theme: { palette: ['#c98aff'] }, title: { show: true, text: 'A' } },
		datapoints: [],
		...overrides
	};
}

function network(overrides: Partial<NetworkGraph> = {}): NetworkGraph {
	return {
		id: 'g_n',
		type: 'network',
		name: 'N',
		created_at: NOW,
		modified_at: NOW,
		schema_version: 1,
		owner: '@me:localhost',
		editors: [],
		schema: { edge_types: [{ id: 'romantic', label: 'romantic', color: '#f6a' }] },
		customization: { theme: { palette: ['#c98aff'] }, title: { show: true, text: 'N' } },
		nodes: [],
		edges: [],
		...overrides
	};
}

const opts = { id: 'g_merged', name: 'Merged', owner: '@me:localhost', now: NOW };

function sources(...graphs: (SpectrumGraph | NetworkGraph)[]): ComposeSource[] {
	return graphs.map((graph) => ({ graph }));
}

describe('checkComposable', () => {
	it('rejects mixing graph types', () => {
		const issues = checkComposable(sources(spectrum(), network()));
		expect(issues.some((i) => i.level === 'error')).toBe(true);
	});

	it('rejects spectra with different dimensionality', () => {
		const oneD = spectrum({
			id: 'g_b',
			schema: {
				dimensions: 1,
				axes: [{ name: 'attraction', min_label: 'ace', max_label: 'demi', range: [0, 1] }],
				regions: []
			}
		});
		const issues = checkComposable(sources(spectrum(), oneD));
		expect(issues.some((i) => i.level === 'error')).toBe(true);
	});

	it('accepts matching spectra with no complaints', () => {
		expect(checkComposable(sources(spectrum(), spectrum({ id: 'g_b', name: 'B' })))).toEqual([]);
	});

	it('warns — but does not block — when axis names or ranges differ', () => {
		const other = spectrum({
			id: 'g_b',
			name: 'B',
			schema: {
				dimensions: 2,
				axes: [
					{ name: 'genderness', min_label: 'agender', max_label: 'nb', range: [-1, 1] },
					{ name: 'axis 2', min_label: 'agender', max_label: 'women', range: [0, 1] }
				],
				regions: []
			}
		});
		const issues = checkComposable(sources(spectrum(), other));
		expect(issues.some((i) => i.level === 'error')).toBe(false);
		expect(issues.filter((i) => i.level === 'warning').length).toBeGreaterThanOrEqual(2);
	});

	it("warns when composing someone else's graph", () => {
		const theirs = spectrum({ id: 'g_b', name: 'Sam', owner: '@sam:localhost' });
		const issues = checkComposable(sources(spectrum(), theirs), '@me:localhost');
		expect(issues.some((i) => i.level === 'warning' && i.message.includes('re-sharing'))).toBe(
			true
		);
	});

	it('stays quiet about ownership when no viewer is supplied', () => {
		const theirs = spectrum({ id: 'g_b', name: 'Sam', owner: '@sam:localhost' });
		expect(checkComposable(sources(spectrum(), theirs))).toEqual([]);
	});
});

describe('composeGraphs — spectrum', () => {
	it('unions datapoints and sorts them by time', () => {
		const a = spectrum({
			datapoints: [{ id: 'd1', coordinates: [0.3, 0.7], timestamp: '2026-05-04T10:00:00Z' }]
		});
		const b = spectrum({
			id: 'g_b',
			name: 'B',
			datapoints: [{ id: 'd2', coordinates: [0.1, 0.2], timestamp: '2026-05-01T10:00:00Z' }]
		});
		const merged = composeGraphs(sources(a, b), opts) as SpectrumGraph;
		expect(merged.datapoints.map((d) => d.timestamp)).toEqual([
			'2026-05-01T10:00:00Z',
			'2026-05-04T10:00:00Z'
		]);
	});

	it('collapses identical points so re-merging does not double them', () => {
		const dp = { id: 'd1', coordinates: [0.3, 0.7], timestamp: '2026-05-04T10:00:00Z' };
		const a = spectrum({ datapoints: [dp] });
		const b = spectrum({ id: 'g_b', name: 'B', datapoints: [{ ...dp, id: 'other' }] });
		const merged = composeGraphs(sources(a, b), opts) as SpectrumGraph;
		expect(merged.datapoints).toHaveLength(1);
	});

	it('rewrites only colliding element ids', () => {
		const a = spectrum({
			datapoints: [{ id: 'd1', coordinates: [0, 0], timestamp: '2026-05-01T10:00:00Z' }]
		});
		const b = spectrum({
			id: 'g_b',
			name: 'B',
			datapoints: [{ id: 'd1', coordinates: [1, 1], timestamp: '2026-05-02T10:00:00Z' }]
		});
		const merged = composeGraphs(sources(a, b), opts) as SpectrumGraph;
		const ids = merged.datapoints.map((d) => d.id);
		expect(ids).toContain('d1');
		expect(new Set(ids).size).toBe(2);
	});

	it('tags each datapoint with its source graph', () => {
		const a = spectrum({
			datapoints: [{ id: 'd1', coordinates: [0, 0], timestamp: '2026-05-01T10:00:00Z' }]
		});
		const b = spectrum({
			id: 'g_b',
			name: 'Sam',
			datapoints: [{ id: 'd2', coordinates: [1, 1], timestamp: '2026-05-02T10:00:00Z' }]
		});
		const merged = composeGraphs(sources(a, b), opts) as SpectrumGraph;
		expect(merged.datapoints[0].tags).toContain('from:A');
		expect(merged.datapoints[1].tags).toContain('from:Sam');
	});

	it('does not tag when there is only one source', () => {
		const a = spectrum({
			datapoints: [{ id: 'd1', coordinates: [0, 0], timestamp: '2026-05-01T10:00:00Z' }]
		});
		const merged = composeGraphs(sources(a), opts) as SpectrumGraph;
		expect(merged.datapoints[0].tags).toBeUndefined();
	});

	it('widens axis ranges to cover every source without rescaling points', () => {
		const wide = spectrum({
			id: 'g_b',
			name: 'B',
			schema: {
				dimensions: 2,
				axes: [
					{ name: 'axis 1', min_label: 'agender', max_label: 'nb', range: [-1, 2] },
					{ name: 'axis 2', min_label: 'agender', max_label: 'women', range: [0, 1] }
				],
				regions: []
			},
			datapoints: [{ id: 'd2', coordinates: [-0.5, 0.5], timestamp: '2026-05-01T10:00:00Z' }]
		});
		const merged = composeGraphs(sources(spectrum(), wide), opts) as SpectrumGraph;
		expect(merged.schema.axes[0].range).toEqual([-1, 2]);
		expect(merged.datapoints[0].coordinates).toEqual([-0.5, 0.5]);
	});

	it('tints points by source when colorBySource is on', () => {
		const a = spectrum({
			datapoints: [{ id: 'd1', coordinates: [0, 0], timestamp: '2026-05-01T10:00:00Z' }]
		});
		const b = spectrum({
			id: 'g_b',
			name: 'B',
			datapoints: [{ id: 'd2', coordinates: [1, 1], timestamp: '2026-05-02T10:00:00Z' }]
		});
		const merged = composeGraphs(
			[
				{ graph: a, color: '#ff0000' },
				{ graph: b, color: '#00ff00' }
			],
			{ ...opts, colorBySource: true }
		) as SpectrumGraph;
		expect(merged.datapoints.map((d) => d.color)).toEqual(['#ff0000', '#00ff00']);
	});

	it('leaves point colours alone when colorBySource is off', () => {
		const a = spectrum({
			datapoints: [{ id: 'd1', coordinates: [0, 0], timestamp: '2026-05-01T10:00:00Z' }]
		});
		const merged = composeGraphs([{ graph: a, color: '#ff0000' }], opts) as SpectrumGraph;
		expect(merged.datapoints[0].color).toBeUndefined();
	});

	it('carries the composed graph identity, not the first source', () => {
		const merged = composeGraphs(sources(spectrum()), opts);
		expect(merged.id).toBe('g_merged');
		expect(merged.name).toBe('Merged');
		expect(merged.created_at).toBe(NOW);
	});

	it('refuses to compose incompatible graphs', () => {
		expect(() => composeGraphs(sources(spectrum(), network()), opts)).toThrow();
	});
});

describe('composeGraphs — network', () => {
	it('unifies people by matrix id across graphs', () => {
		const a = network({
			nodes: [{ id: 'n1', label: 'Alex', subject_ref: '@alex:s', link_status: 'confirmed' }]
		});
		const b = network({
			id: 'g_n2',
			name: 'N2',
			nodes: [{ id: 'x9', label: 'Alexandra', subject_ref: '@alex:s', link_status: 'confirmed' }]
		});
		const merged = composeGraphs(sources(a, b), opts) as NetworkGraph;
		expect(merged.nodes).toHaveLength(1);
		expect(merged.nodes[0].label).toBe('Alex');
	});

	it('unifies people by label when there is no matrix id', () => {
		const a = network({ nodes: [{ id: 'n1', label: 'Bea' }] });
		const b = network({ id: 'g_n2', name: 'N2', nodes: [{ id: 'n9', label: ' bea ' }] });
		const merged = composeGraphs(sources(a, b), opts) as NetworkGraph;
		expect(merged.nodes).toHaveLength(1);
	});

	it('remaps edges onto the unified node ids and drops duplicates', () => {
		const a = network({
			nodes: [
				{ id: 'n1', label: 'Alex' },
				{ id: 'n2', label: 'Bea' }
			],
			edges: [{ id: 'e1', source: 'n1', target: 'n2', type_id: 'romantic' }]
		});
		const b = network({
			id: 'g_n2',
			name: 'N2',
			nodes: [
				{ id: 'z1', label: 'Bea' },
				{ id: 'z2', label: 'Alex' }
			],
			// Same relationship, drawn the other way round.
			edges: [{ id: 'e9', source: 'z1', target: 'z2', type_id: 'romantic' }]
		});
		const merged = composeGraphs(sources(a, b), opts) as NetworkGraph;
		expect(merged.nodes).toHaveLength(2);
		expect(merged.edges).toHaveLength(1);
	});

	it('keeps a directed edge distinct from its reverse', () => {
		const a = network({
			nodes: [
				{ id: 'n1', label: 'Alex' },
				{ id: 'n2', label: 'Bea' }
			],
			edges: [{ id: 'e1', source: 'n1', target: 'n2', type_id: 'romantic', directed: true }]
		});
		const b = network({
			id: 'g_n2',
			name: 'N2',
			nodes: [
				{ id: 'z1', label: 'Bea' },
				{ id: 'z2', label: 'Alex' }
			],
			edges: [{ id: 'e9', source: 'z1', target: 'z2', type_id: 'romantic', directed: true }]
		});
		const merged = composeGraphs(sources(a, b), opts) as NetworkGraph;
		expect(merged.edges).toHaveLength(2);
	});

	it('drops edges whose endpoints are missing rather than dangling', () => {
		const a = network({
			nodes: [{ id: 'n1', label: 'Alex' }],
			edges: [{ id: 'e1', source: 'n1', target: 'ghost', type_id: 'romantic' }]
		});
		const merged = composeGraphs(sources(a), opts) as NetworkGraph;
		expect(merged.edges).toHaveLength(0);
	});

	it('takes the most restrictive consent state for a linked person', () => {
		const a = network({
			nodes: [{ id: 'n1', label: 'Alex', subject_ref: '@alex:s', link_status: 'confirmed' }]
		});
		const b = network({
			id: 'g_n2',
			name: 'N2',
			nodes: [{ id: 'n1', label: 'Alex', subject_ref: '@alex:s', link_status: 'pending' }]
		});
		const merged = composeGraphs(sources(a, b), opts) as NetworkGraph;
		expect(merged.nodes[0].link_status).toBe('pending');
	});

	it('lets a denial win over a confirmation', () => {
		const a = network({
			nodes: [{ id: 'n1', label: 'Alex', subject_ref: '@alex:s', link_status: 'confirmed' }]
		});
		const b = network({
			id: 'g_n2',
			name: 'N2',
			nodes: [{ id: 'n1', label: 'Alex', subject_ref: '@alex:s', link_status: 'denied' }]
		});
		const merged = composeGraphs(sources(a, b), opts) as NetworkGraph;
		expect(merged.nodes[0].link_status).toBe('denied');
	});

	it('unions edge types, keeping the first definition of a reused id', () => {
		const a = network();
		const b = network({
			id: 'g_n2',
			name: 'N2',
			schema: {
				edge_types: [
					{ id: 'romantic', label: 'dating', color: '#000' },
					{ id: 'qpr', label: 'queerplatonic', color: '#8fb' }
				]
			}
		});
		const merged = composeGraphs(sources(a, b), opts) as NetworkGraph;
		expect(merged.schema.edge_types.map((t) => t.id)).toEqual(['romantic', 'qpr']);
		expect(merged.schema.edge_types[0].label).toBe('romantic');
	});

	it('warns when two graphs disagree about an edge type id', () => {
		const a = network();
		const b = network({
			id: 'g_n2',
			name: 'N2',
			schema: { edge_types: [{ id: 'romantic', label: 'dating', color: '#000' }] }
		});
		const issues = checkComposable(sources(a, b));
		expect(issues.some((i) => i.level === 'warning')).toBe(true);
	});
});
