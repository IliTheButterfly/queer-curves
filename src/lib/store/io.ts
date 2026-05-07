// JSON export and import for user graphs. Useful for backup before Matrix
// integration, and for round-tripping the data model out of the app.

import { SCHEMA_VERSION, type Graph } from '$lib/types.js';
import { saveUserGraph } from './graphs.js';

export function downloadGraphAsJson(graph: Graph): void {
	const json = JSON.stringify(graph, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${slugify(graph.name) || 'graph'}.json`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

function slugify(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.toLowerCase();
}

export class GraphImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GraphImportError';
	}
}

export function parseGraphJson(text: string): Graph {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		throw new GraphImportError(`Not valid JSON: ${e instanceof Error ? e.message : 'unknown'}`);
	}
	validate(parsed);
	return parsed;
}

function validate(value: unknown): asserts value is Graph {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new GraphImportError('Expected a JSON object describing a graph.');
	}
	const obj = value as Record<string, unknown>;

	if (typeof obj.id !== 'string') throw new GraphImportError('Missing or invalid `id`.');
	if (typeof obj.name !== 'string') throw new GraphImportError('Missing or invalid `name`.');
	if (obj.type !== 'spectrum' && obj.type !== 'network') {
		throw new GraphImportError(`Invalid \`type\`: ${JSON.stringify(obj.type)}.`);
	}

	if (typeof obj.schema_version !== 'number') {
		throw new GraphImportError('Missing `schema_version`.');
	}
	if (obj.schema_version > SCHEMA_VERSION) {
		throw new GraphImportError(
			`This graph uses schema version ${obj.schema_version}, but this build only understands up to version ${SCHEMA_VERSION}. Update queer-curves to import it.`
		);
	}

	if (!obj.schema || typeof obj.schema !== 'object') {
		throw new GraphImportError('Missing `schema`.');
	}

	if (obj.type === 'spectrum') {
		const schema = obj.schema as Record<string, unknown>;
		if (![1, 2, 3].includes(schema.dimensions as number)) {
			throw new GraphImportError('Invalid spectrum `schema.dimensions`.');
		}
		if (!Array.isArray(schema.axes)) {
			throw new GraphImportError('Spectrum graph missing `schema.axes`.');
		}
		if (!Array.isArray(obj.datapoints)) {
			throw new GraphImportError('Spectrum graph missing `datapoints`.');
		}
	} else {
		const schema = obj.schema as Record<string, unknown>;
		if (!Array.isArray(schema.edge_types)) {
			throw new GraphImportError('Network graph missing `schema.edge_types`.');
		}
		if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
			throw new GraphImportError('Network graph missing `nodes` or `edges`.');
		}
	}

	if (!obj.customization || typeof obj.customization !== 'object') {
		throw new GraphImportError('Missing `customization`.');
	}
}

export async function importGraphFromFile(file: File): Promise<Graph> {
	const text = await file.text();
	const graph = parseGraphJson(text);
	saveUserGraph(graph);
	return graph;
}
