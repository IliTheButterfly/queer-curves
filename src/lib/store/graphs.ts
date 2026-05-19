// CRUD for user-created graphs. Dispatches between localStorage (logged-out
// or no-crypto sessions) and Matrix (logged in with crypto ready), per the
// session state held in matrixStore.
//
// The interface is async across the board so call sites don't need to know
// which backend is active — Matrix operations are inherently async and
// pretending the localStorage path is sync would force a split API.

import type { Graph } from '$lib/types.js';
import { matrixStore } from '$lib/matrix/store.svelte.js';
import {
	deleteMatrixGraph,
	getMatrixGraph,
	listMatrixGraphs,
	saveMatrixGraph
} from './graphs-matrix.js';

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

function shouldUseMatrix(): boolean {
	return Boolean(matrixStore.session && matrixStore.cryptoStatus?.ready);
}

// On a full page load, +layout.svelte's onMount fires restoreSession +
// getCryptoStatus asynchronously and only flips matrixStore.hydrated=true
// when both have completed. Routes (especially /graphs/new) can otherwise
// run a save before hydration finishes, see cryptoStatus=null, and silently
// drop the graph into localStorage. Block here until hydration is done so
// the backend choice is based on a known auth state.
async function ensureHydrated(): Promise<void> {
	if (matrixStore.hydrated) return;
	await new Promise<void>((resolve) => {
		const check = () => {
			if (matrixStore.hydrated) resolve();
			else setTimeout(check, 25);
		};
		check();
	});
}

export async function listUserGraphs(): Promise<Graph[]> {
	await ensureHydrated();
	if (shouldUseMatrix()) {
		try {
			return await listMatrixGraphs();
		} catch (e) {
			console.warn('Matrix listUserGraphs failed; falling back to localStorage', e);
		}
	}
	return readAll();
}

export async function getUserGraph(id: string): Promise<Graph | undefined> {
	await ensureHydrated();
	if (shouldUseMatrix()) {
		try {
			const g = await getMatrixGraph(id);
			if (g) return g;
		} catch (e) {
			console.warn('Matrix getUserGraph failed; falling back to localStorage', e);
		}
	}
	return readAll().find((g) => g.id === id);
}

export async function saveUserGraph(graph: Graph): Promise<Graph> {
	await ensureHydrated();
	if (shouldUseMatrix()) {
		const saved = await saveMatrixGraph(graph);
		return saved;
	}
	const graphs = readAll();
	const idx = graphs.findIndex((g) => g.id === graph.id);
	if (idx >= 0) graphs[idx] = graph;
	else graphs.push(graph);
	writeAll(graphs);
	return graph;
}

export async function deleteUserGraph(id: string): Promise<void> {
	await ensureHydrated();
	if (shouldUseMatrix()) {
		await deleteMatrixGraph(id);
		return;
	}
	writeAll(readAll().filter((g) => g.id !== id));
}

export function generateGraphId(): string {
	// Only used for localStorage graphs; the Matrix path replaces this with
	// the new room id on save.
	const rand = Math.random().toString(36).slice(2, 10);
	const ts = Date.now().toString(36);
	return `g_${rand}_${ts}`;
}
