// LocalStorage-backed CRUD for user-created graphs.
//
// This is the temporary backing store for v0. When Matrix integration
// lands, this module is the single seam to swap — same interface, the
// implementation goes from localStorage to matrix-js-sdk room state.

import type { Graph } from '$lib/types.js';

const STORAGE_KEY = 'queer-curves:user-graphs';

function readAll(): Graph[] {
	if (typeof localStorage === 'undefined') return [];
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as Graph[]) : [];
	} catch {
		return [];
	}
}

function writeAll(graphs: Graph[]): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(graphs));
}

export function listUserGraphs(): Graph[] {
	return readAll();
}

export function getUserGraph(id: string): Graph | undefined {
	return readAll().find((g) => g.id === id);
}

export function saveUserGraph(graph: Graph): void {
	const graphs = readAll();
	const idx = graphs.findIndex((g) => g.id === graph.id);
	if (idx >= 0) {
		graphs[idx] = graph;
	} else {
		graphs.push(graph);
	}
	writeAll(graphs);
}

export function deleteUserGraph(id: string): void {
	const graphs = readAll().filter((g) => g.id !== id);
	writeAll(graphs);
}

export function generateGraphId(): string {
	const rand = Math.random().toString(36).slice(2, 10);
	const ts = Date.now().toString(36);
	return `g_${rand}_${ts}`;
}
