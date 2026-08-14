import { describe, expect, it } from 'vitest';
import { projectGraphForGrant } from './projection.js';
import { acefluxFixture, drinksFixture, polyculeFixture, pronounCardFixture } from '../fixtures.js';
import type { NetworkGraph, OccurrenceGraph, SpectrumGraph } from '../types.js';

// A projection bug is a silent data leak (SECURITY_PLAN.md §6), so these
// tests are written negatively where it matters: assert what must be ABSENT
// from a current-only payload, not just what should be present.

const NOW = new Date('2026-08-14T18:00:00Z');

describe('spectrum · current', () => {
	const projected = projectGraphForGrant(acefluxFixture, 'current', NOW) as SpectrumGraph;

	it('keeps only the newest datapoint', () => {
		expect(acefluxFixture.datapoints.length).toBeGreaterThan(1);
		expect(projected.datapoints).toHaveLength(1);
		const newest = [...acefluxFixture.datapoints].sort((a, b) =>
			a.timestamp < b.timestamp ? 1 : -1
		)[0];
		expect(projected.datapoints[0].id).toBe(newest.id);
	});

	it('marks itself as a current-only view', () => {
		expect(projected.projection).toEqual({ grant: 'current' });
	});

	it('keeps schema and customization so the viewer can render it', () => {
		expect(projected.schema).toEqual(acefluxFixture.schema);
		expect(projected.customization).toEqual(acefluxFixture.customization);
	});

	it('handles an empty graph', () => {
		const empty = { ...acefluxFixture, datapoints: [] };
		expect((projectGraphForGrant(empty, 'current', NOW) as SpectrumGraph).datapoints).toEqual([]);
	});
});

describe('occurrence · current', () => {
	// Pin the projection moment relative to the fixture's entries: the
	// fixture stamps entries relative to its own `now`, so build a graph
	// with explicit timestamps instead of trusting it.
	const graph: OccurrenceGraph = {
		...drinksFixture,
		occurrences: [
			// alcohol counts weekly (interval: 'week'); NOW is a Friday.
			{ id: 'o1', counter_id: 'alcohol', timestamp: '2026-08-12T20:15:00Z', amount: 2.3 },
			{
				id: 'o2',
				counter_id: 'alcohol',
				timestamp: '2026-08-13T23:45:00Z',
				amount: 2.1,
				notes: 'work thing'
			},
			{ id: 'o3', counter_id: 'alcohol', timestamp: '2026-07-01T22:00:00Z', amount: 9 }, // outside the week
			// caffeine counts daily. 16:30Z sits inside the day-start-hour-4
			// window containing NOW in every timezone (aggregate.ts is
			// local-time aware, and this suite must pass anywhere).
			{
				id: 'o4',
				counter_id: 'caffeine',
				timestamp: '2026-08-14T16:30:00Z',
				amount: 2,
				tags: ['espresso']
			}
		]
	};
	const projected = projectGraphForGrant(graph, 'current', NOW) as OccurrenceGraph;

	it('collapses each counter to ONE synthetic entry with the interval total', () => {
		expect(projected.occurrences).toHaveLength(2);
		const alcohol = projected.occurrences.find((o) => o.counter_id === 'alcohol');
		const caffeine = projected.occurrences.find((o) => o.counter_id === 'caffeine');
		expect(alcohol?.amount).toBeCloseTo(4.4); // o1 + o2, o3 outside the week
		expect(caffeine?.amount).toBe(2);
	});

	it('leaks no real log timestamp', () => {
		// THREATS.md §11: per-entry timing reconstructs binges and dose
		// schedules. Every projected timestamp must be a window boundary,
		// never one of the input times.
		const inputTimes = new Set(graph.occurrences.map((o) => o.timestamp));
		for (const o of projected.occurrences) {
			expect(inputTimes.has(o.timestamp)).toBe(false);
		}
	});

	it('leaks no notes, tags, or real entry ids', () => {
		for (const o of projected.occurrences) {
			expect(o.notes).toBeUndefined();
			expect(o.tags).toBeUndefined();
			expect(graph.occurrences.some((real) => real.id === o.id)).toBe(false);
		}
	});

	it('omits counters with nothing in their current window', () => {
		const stale: OccurrenceGraph = {
			...graph,
			occurrences: [
				{ id: 'o5', counter_id: 'caffeine', timestamp: '2026-01-01T08:00:00Z', amount: 1 }
			]
		};
		const p = projectGraphForGrant(stale, 'current', NOW) as OccurrenceGraph;
		expect(p.occurrences).toEqual([]);
	});
});

describe('network', () => {
	const graph: NetworkGraph = {
		...polyculeFixture,
		nodes: [
			{ id: 'n1', label: 'Alex', is_self: true },
			{ id: 'n2', label: 'Bea', subject_ref: '@bea:example.org', link_status: 'pending' },
			{ id: 'n3', label: 'Cy', subject_ref: '@cy:example.org', link_status: 'confirmed' }
		]
	};

	it('strips unconfirmed subject_refs from BOTH grants', () => {
		// sharing_model.md §12: an unconsented link never leaves the owner's
		// primary room — not even under a full-history grant.
		for (const grant of ['current', 'history'] as const) {
			const p = projectGraphForGrant(graph, grant, NOW) as NetworkGraph;
			const bea = p.nodes.find((n) => n.id === 'n2');
			expect(bea?.subject_ref).toBeUndefined();
			expect(bea?.link_status).toBeUndefined();
			const cy = p.nodes.find((n) => n.id === 'n3');
			expect(cy?.subject_ref).toBe('@cy:example.org');
		}
	});
});

describe('history grant', () => {
	it('is the graph itself for non-network families', () => {
		expect(projectGraphForGrant(acefluxFixture, 'history', NOW)).toEqual(acefluxFixture);
		expect(projectGraphForGrant(pronounCardFixture, 'history', NOW)).toEqual(pronounCardFixture);
	});

	it('carries no current-only marker, even after a round-trip', () => {
		const roundTripped = { ...acefluxFixture, projection: { grant: 'current' as const } };
		const p = projectGraphForGrant(roundTripped, 'history', NOW);
		expect(p.projection).toBeUndefined();
	});
});

describe('pronouns · current', () => {
	it('is the card as it stands, marked as current', () => {
		const p = projectGraphForGrant(pronounCardFixture, 'current', NOW);
		expect(p).toEqual({ ...pronounCardFixture, projection: { grant: 'current' } });
	});
});
