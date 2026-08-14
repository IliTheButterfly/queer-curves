// Canonical test fixtures from data_model.md §11. These are the cases the
// data model must always remain expressible against — useful for dev,
// demos, and tests.

import { SCHEMA_VERSION, type NetworkGraph, type SpectrumGraph } from './types.js';

const now = '2026-05-07T12:00:00Z';
const placeholderOwner = '@example:queercurves.app';

const baseTheme = {
	palette: ['#c98aff', '#80a8ff', '#80ffb0', '#ff8aa8', '#ffd080'],
	background: '#1a1424'
};

// ─── Aceflux: 1D spectrum (data_model.md §11.1) ─────────────────────────────

export const acefluxFixture: SpectrumGraph = {
	id: 'fixture-aceflux',
	type: 'spectrum',
	name: 'my attraction',
	description: 'Where I am on the asexual spectrum, day to day.',
	created_at: now,
	modified_at: now,
	schema_version: SCHEMA_VERSION,
	owner: placeholderOwner,
	editors: [],
	schema: {
		dimensions: 1,
		axes: [
			{
				name: 'attraction',
				min_label: 'ace',
				max_label: 'demi',
				range: [0, 1],
				waypoints: [{ position: 0.5, label: 'gray' }]
			}
		],
		regions: [
			{
				id: 'attractive-band',
				label: 'sex feels attractive',
				shape: { type: 'range', min: 0.65, max: 1.0 },
				color: '#c98aff',
				opacity: 0.25
			}
		]
	},
	customization: {
		theme: baseTheme,
		title: { show: true, text: 'my attraction' }
	},
	datapoints: [
		{ id: 'dp-1', coordinates: [0.3], timestamp: '2026-05-01T10:00:00Z' },
		{ id: 'dp-2', coordinates: [0.45], timestamp: '2026-05-04T22:00:00Z' },
		{ id: 'dp-3', coordinates: [0.7], timestamp: '2026-05-06T09:30:00Z' }
	]
};

// ─── Genderfluid: 2D spectrum (data_model.md §11.2) ─────────────────────────

export const genderfluidFixture: SpectrumGraph = {
	id: 'fixture-genderfluid',
	type: 'spectrum',
	name: 'my gender',
	created_at: now,
	modified_at: now,
	schema_version: SCHEMA_VERSION,
	owner: placeholderOwner,
	editors: [],
	schema: {
		dimensions: 2,
		axes: [
			{
				name: 'axis 1',
				min_label: 'agender',
				max_label: 'non-binary',
				range: [0, 1]
			},
			{
				name: 'axis 2',
				min_label: 'agender',
				max_label: 'women',
				range: [0, 1],
				waypoints: [{ position: 0.5, label: 'girl' }]
			}
		],
		regions: [],
		point_waypoints: [
			{ id: 'pwp-gendervoid', label: 'gendervoid', coordinates: [0.2, 0.3], color: '#998aaa' }
		]
	},
	customization: {
		theme: baseTheme,
		title: { show: true, text: 'my gender' }
	},
	datapoints: [
		{ id: 'dp-1', coordinates: [0.3, 0.7], timestamp: '2026-05-01T10:00:00Z' },
		{ id: 'dp-2', coordinates: [0.4, 0.6], timestamp: '2026-05-04T22:00:00Z' },
		// Custom color demo — overrides the default palette-cycle slot for
		// this datapoint specifically.
		{ id: 'dp-3', coordinates: [0.5, 0.55], timestamp: '2026-05-06T09:30:00Z', color: '#ff8aa8' }
	]
};

// ─── Mood-energy-attraction: 3D spectrum, third axis as colour ramp ──────────

export const moodEnergyFixture: SpectrumGraph = {
	id: 'fixture-mood-energy',
	type: 'spectrum',
	name: 'mood, energy, and attraction',
	description:
		'Two spatial axes (mood × energy) plus an attraction axis encoded as colour on the scatter.',
	created_at: now,
	modified_at: now,
	schema_version: SCHEMA_VERSION,
	owner: placeholderOwner,
	editors: [],
	schema: {
		dimensions: 3,
		axes: [
			{
				name: 'mood',
				min_label: 'low',
				max_label: 'high',
				range: [-1, 1],
				zero_label: 'neutral'
			},
			{
				name: 'energy',
				min_label: 'depleted',
				max_label: 'energised',
				range: [-1, 1],
				zero_label: 'baseline'
			},
			{
				name: 'attraction',
				min_label: 'ace',
				max_label: 'demi',
				range: [0, 1]
			}
		],
		regions: []
	},
	customization: {
		theme: baseTheme,
		title: { show: true, text: 'mood, energy, and attraction' }
	},
	datapoints: [
		{ id: 'dp-1', coordinates: [-0.4, -0.3, 0.2], timestamp: '2026-05-01T10:00:00Z' },
		{ id: 'dp-2', coordinates: [0.1, 0.2, 0.45], timestamp: '2026-05-03T18:00:00Z' },
		{ id: 'dp-3', coordinates: [0.5, 0.6, 0.7], timestamp: '2026-05-06T09:30:00Z' }
	]
};

// ─── Polycule: network (data_model.md §11.3) ────────────────────────────────

export const polyculeFixture: NetworkGraph = {
	id: 'fixture-polycule',
	type: 'network',
	name: 'our polycule',
	created_at: now,
	modified_at: now,
	schema_version: SCHEMA_VERSION,
	owner: placeholderOwner,
	editors: [],
	schema: {
		edge_types: [
			{ id: 'romantic', label: 'romantic', color: '#ff6090' },
			{ id: 'sexual', label: 'sexual', color: '#9080ff' },
			{ id: 'qpr', label: 'queerplatonic', color: '#80ffb0' }
		]
	},
	customization: {
		theme: baseTheme,
		title: { show: true, text: 'our polycule' },
		legend: { position: 'right' }
	},
	nodes: [
		// Alex is the graph owner, so their name stays visible while Bea and Cy
		// render as "Person 1" / "Person 2" until names are held open.
		{ id: 'n1', label: 'Alex', is_self: true },
		{ id: 'n2', label: 'Bea' },
		{ id: 'n3', label: 'Cy' }
	],
	edges: [
		{ id: 'e1', source: 'n1', target: 'n2', type_id: 'romantic' },
		{ id: 'e2', source: 'n1', target: 'n2', type_id: 'sexual' },
		{ id: 'e3', source: 'n2', target: 'n3', type_id: 'qpr' }
	]
};

// ─── Polycule, redacted-legend variant (data_model.md §11.3) ────────────────
//
// Shared with audiences outside the polycule itself. Same nodes, edges
// collapsed to a single "connected" edge type. See sharing_model.md §7.

export const polyculeRedactedFixture: NetworkGraph = {
	...polyculeFixture,
	id: 'fixture-polycule-redacted',
	schema: {
		edge_types: [{ id: 'any', label: 'connected', color: '#998aaa' }]
	},
	edges: polyculeFixture.edges.map((e) => ({ ...e, type_id: 'any' }))
};

export const allFixtures = [
	acefluxFixture,
	genderfluidFixture,
	moodEnergyFixture,
	polyculeFixture,
	polyculeRedactedFixture
];
