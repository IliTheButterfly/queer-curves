import { describe, expect, it } from 'vitest';
import { GraphImportError, parseGraphJson } from './io.js';
import { acefluxFixture, drinksFixture, polyculeFixture, pronounCardFixture } from '../fixtures.js';
import { SCHEMA_VERSION } from '../types.js';

describe('parseGraphJson', () => {
	it('round-trips a spectrum graph', () => {
		const json = JSON.stringify(acefluxFixture);
		const parsed = parseGraphJson(json);
		expect(parsed.id).toBe(acefluxFixture.id);
		expect(parsed.type).toBe('spectrum');
	});

	it('round-trips a network graph', () => {
		const json = JSON.stringify(polyculeFixture);
		const parsed = parseGraphJson(json);
		expect(parsed.id).toBe(polyculeFixture.id);
		expect(parsed.type).toBe('network');
	});

	it('round-trips a pronoun graph', () => {
		const json = JSON.stringify(pronounCardFixture);
		const parsed = parseGraphJson(json);
		expect(parsed.id).toBe(pronounCardFixture.id);
		expect(parsed.type).toBe('pronouns');
	});

	it('throws GraphImportError on invalid JSON', () => {
		expect(() => parseGraphJson('not json')).toThrow(GraphImportError);
	});

	it('throws GraphImportError on a non-object', () => {
		expect(() => parseGraphJson('null')).toThrow(GraphImportError);
		expect(() => parseGraphJson('"string"')).toThrow(GraphImportError);
		expect(() => parseGraphJson('[]')).toThrow(GraphImportError);
	});

	it('rejects missing id', () => {
		const g = { ...acefluxFixture, id: undefined };
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/id/);
	});

	it('rejects missing name', () => {
		const g = { ...acefluxFixture, name: undefined };
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/name/);
	});

	it('rejects unknown type', () => {
		const g = { ...acefluxFixture, type: 'pie-chart' };
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/type/);
	});

	it('rejects a future schema_version with a clear message', () => {
		const g = { ...acefluxFixture, schema_version: SCHEMA_VERSION + 1 };
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/schema version/);
	});

	it('rejects a spectrum graph missing axes', () => {
		const g = {
			...acefluxFixture,
			schema: { ...acefluxFixture.schema, axes: undefined }
		};
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/axes/);
	});

	it('rejects a spectrum graph missing datapoints', () => {
		const g = { ...acefluxFixture, datapoints: undefined };
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/datapoints/);
	});

	it('rejects a network graph missing edge_types', () => {
		const g = {
			...polyculeFixture,
			schema: { ...polyculeFixture.schema, edge_types: undefined }
		};
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/edge_types/);
	});

	it('rejects a network graph missing nodes or edges', () => {
		expect(() => parseGraphJson(JSON.stringify({ ...polyculeFixture, nodes: undefined }))).toThrow(
			/nodes|edges/
		);
		expect(() => parseGraphJson(JSON.stringify({ ...polyculeFixture, edges: undefined }))).toThrow(
			/nodes|edges/
		);
	});

	it('round-trips an occurrence graph', () => {
		const parsed = parseGraphJson(JSON.stringify(drinksFixture));
		expect(parsed.id).toBe(drinksFixture.id);
		expect(parsed.type).toBe('occurrence');
	});

	it('rejects an occurrence graph missing counters', () => {
		const g = { ...drinksFixture, schema: { ...drinksFixture.schema, counters: undefined } };
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/counters/);
	});

	it('rejects an occurrence graph missing occurrences', () => {
		const g = { ...drinksFixture, occurrences: undefined };
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/occurrences/);
	});

	it('rejects an occurrence pointing at a counter that does not exist', () => {
		// An orphaned entry disappears from every total the app computes, so
		// it must fail loudly at the import boundary rather than quietly.
		const g = {
			...drinksFixture,
			occurrences: [
				{ id: 'oc-x', counter_id: 'nicotine', timestamp: '2026-05-01T10:00:00Z', amount: 1 }
			]
		};
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/unknown counter/);
	});

	it('rejects an occurrence with a non-numeric amount', () => {
		const g = {
			...drinksFixture,
			occurrences: [
				{ id: 'oc-x', counter_id: 'alcohol', timestamp: '2026-05-01T10:00:00Z', amount: 'two' }
			]
		};
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/amount/);
	});

	it('rejects a pronoun graph with an empty scale', () => {
		const g = {
			...pronounCardFixture,
			schema: { ...pronounCardFixture.schema, levels: [] }
		};
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/levels/);
	});

	it('rejects a pronoun graph missing term_groups', () => {
		const g = {
			...pronounCardFixture,
			schema: { ...pronounCardFixture.schema, term_groups: undefined }
		};
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/term_groups/);
	});

	it('rejects a pronoun graph missing pronouns or terms', () => {
		expect(() =>
			parseGraphJson(JSON.stringify({ ...pronounCardFixture, pronouns: undefined }))
		).toThrow(/pronouns|terms/);
		expect(() =>
			parseGraphJson(JSON.stringify({ ...pronounCardFixture, terms: undefined }))
		).toThrow(/pronouns|terms/);
	});

	it('rejects a graph missing customization', () => {
		const g = { ...acefluxFixture, customization: undefined };
		expect(() => parseGraphJson(JSON.stringify(g))).toThrow(/customization/);
	});
});
