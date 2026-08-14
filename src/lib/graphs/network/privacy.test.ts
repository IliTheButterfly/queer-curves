import { describe, expect, it } from 'vitest';
import {
	displayLabels,
	hasHideableNames,
	HIDDEN_MASK,
	isSelfNode,
	maskedLabels,
	namedMembers,
	redactPendingLinks,
	SELF_MASK
} from './privacy.js';
import { polyculeFixture } from '$lib/fixtures.js';
import type { NetworkGraph, NetworkNode } from '$lib/types.js';

function graphWith(nodes: NetworkNode[]): NetworkGraph {
	return { ...polyculeFixture, nodes, edges: [] };
}

describe('isSelfNode', () => {
	it('honours an explicit is_self flag', () => {
		expect(isSelfNode({ id: 'n1', label: 'Alex', is_self: true })).toBe(true);
	});

	it('matches the signed-in Matrix account via subject_ref', () => {
		const node: NetworkNode = { id: 'n1', label: 'Alex', subject_ref: '@alex:example.org' };
		expect(isSelfNode(node, '@alex:example.org')).toBe(true);
		expect(isSelfNode(node, '@bea:example.org')).toBe(false);
	});

	it('is false with no flag and no session', () => {
		expect(isSelfNode({ id: 'n1', label: 'Alex' })).toBe(false);
		expect(isSelfNode({ id: 'n1', label: 'Alex' }, null)).toBe(false);
	});
});

describe('maskedLabels', () => {
	it('gives everyone but you no label at all', () => {
		const g = graphWith([
			{ id: 'n1', label: 'Alex', is_self: true },
			{ id: 'n2', label: 'Bea' },
			{ id: 'n3', label: 'Cy' }
		]);
		expect(maskedLabels(g)).toEqual({ n1: SELF_MASK, n2: HIDDEN_MASK, n3: HIDDEN_MASK });
	});

	it('emits no per-person handle a viewer could reason about', () => {
		// Not even a positional pseudonym: "Person 2" survives a screenshot
		// and can be talked about, which is the thing being prevented.
		const g = graphWith([
			{ id: 'n1', label: 'Alex', is_self: true },
			{ id: 'n2', label: 'Bea' },
			{ id: 'n3', label: 'Cy' }
		]);
		for (const label of Object.values(maskedLabels(g))) {
			expect(label).not.toMatch(/person|\d/i);
		}
	});

	it('leaks no real names when nobody is you', () => {
		// e.g. a graph shared with you by someone else: no node is flagged
		// self and there's no matching session, so nothing is named at all.
		const g = graphWith(polyculeFixture.nodes.map((n) => ({ ...n, is_self: false })));
		const masked = maskedLabels(g);
		expect(Object.values(masked)).toEqual(['', '', '']);
		for (const node of g.nodes) {
			expect(Object.values(masked)).not.toContain(node.label);
		}
	});
});

describe('displayLabels', () => {
	it('returns the masked set when not revealing', () => {
		const g = graphWith([
			{ id: 'n1', label: 'Alex', is_self: true },
			{ id: 'n2', label: 'Bea' }
		]);
		expect(displayLabels(g, { reveal: false })).toEqual({ n1: SELF_MASK, n2: HIDDEN_MASK });
	});

	it('returns real names when revealing', () => {
		const g = graphWith([
			{ id: 'n1', label: 'Alex', is_self: true },
			{ id: 'n2', label: 'Bea' }
		]);
		expect(displayLabels(g, { reveal: true })).toEqual({ n1: 'Alex', n2: 'Bea' });
	});

	it('renders a node with no name of its own as blank either way', () => {
		const g = graphWith([{ id: 'n1', label: '   ' }]);
		expect(displayLabels(g, { reveal: true })).toEqual({ n1: HIDDEN_MASK });
		expect(displayLabels(g, { reveal: false })).toEqual({ n1: HIDDEN_MASK });
	});
});

describe('hasHideableNames', () => {
	it('is false when the only named node is you', () => {
		const g = graphWith([{ id: 'n1', label: 'Alex', is_self: true }]);
		expect(hasHideableNames(g)).toBe(false);
	});

	it('is false when other nodes are unnamed', () => {
		const g = graphWith([
			{ id: 'n1', label: 'Alex', is_self: true },
			{ id: 'n2', label: '' }
		]);
		expect(hasHideableNames(g)).toBe(false);
	});

	it('is true as soon as someone else is named', () => {
		expect(hasHideableNames(polyculeFixture)).toBe(true);
	});
});

describe('namedMembers', () => {
	it('lists everyone whose name an export would expose', () => {
		const g = graphWith([
			{ id: 'n1', label: 'Alex', is_self: true },
			{ id: 'n2', label: 'Bea' },
			{ id: 'n3', label: '' }
		]);
		expect(namedMembers(g)).toEqual([{ id: 'n2', label: 'Bea', unconfirmedLink: false }]);
	});

	it('flags links the named user has not confirmed', () => {
		const g = graphWith([
			{ id: 'n1', label: 'Bea', subject_ref: '@bea:example.org', link_status: 'pending' },
			{ id: 'n2', label: 'Cy', subject_ref: '@cy:example.org', link_status: 'confirmed' }
		]);
		expect(namedMembers(g).map((m) => m.unconfirmedLink)).toEqual([true, false]);
	});
});

describe('redactPendingLinks', () => {
	// SECURITY_PLAN.md S10 / sharing_model.md §12: an unconfirmed subject_ref
	// is an unconsented claim about a real account — a non-owner viewer's
	// render path must never see it.
	it('strips subject_ref and link_status from pending and denied links', () => {
		const g = graphWith([
			{ id: 'n1', label: 'Alex', subject_ref: '@alex:example.org', link_status: 'pending' },
			{ id: 'n2', label: 'Bea', subject_ref: '@bea:example.org', link_status: 'denied' }
		]);
		const redacted = redactPendingLinks(g);
		for (const n of redacted.nodes) {
			expect(n.subject_ref).toBeUndefined();
			expect(n.link_status).toBeUndefined();
		}
	});

	it('keeps confirmed links and untouched nodes intact', () => {
		const g = graphWith([
			{ id: 'n1', label: 'Alex', subject_ref: '@alex:example.org', link_status: 'confirmed' },
			{ id: 'n2', label: 'Bea', is_self: true }
		]);
		const redacted = redactPendingLinks(g);
		expect(redacted.nodes[0].subject_ref).toBe('@alex:example.org');
		expect(redacted.nodes[1]).toEqual(g.nodes[1]);
	});

	it('stops a pending link from marking a viewer as self', () => {
		// Bea views a graph that links her without consent. Before redaction
		// her node would render "You" — leaking that she's been named.
		const g = graphWith([
			{ id: 'n1', label: 'Bea', subject_ref: '@bea:example.org', link_status: 'pending' }
		]);
		expect(isSelfNode(redactPendingLinks(g).nodes[0], '@bea:example.org')).toBe(false);
	});
});
