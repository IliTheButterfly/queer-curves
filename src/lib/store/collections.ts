// CRUD for collections (multi-graph views), plus the live composition that
// turns one into something renderable.
//
// Storage follows graphs.ts exactly: dispatch per id, `!`-prefixed ids are
// Matrix rooms and everything else (`c_…`) is localStorage, every entry
// point awaits hydration first so the backend choice is made against a known
// auth state, and a `c_…` collection migrates into a room on its next save
// once Matrix is live.

import {
	type Graph,
	type GraphCollection,
	type SpectrumGraph,
	SCHEMA_VERSION
} from '$lib/types.js';
import { matrixStore } from '$lib/matrix/store.svelte.js';
import { findPalette } from '$lib/presets/palettes.js';
import { getUserGraph } from './graphs.js';
import {
	type ComposeIssue,
	type ComposeSource,
	checkComposable,
	composeGraphs
} from './compose.js';
import {
	deleteMatrixCollection,
	getMatrixCollection,
	listMatrixCollections,
	saveMatrixCollection
} from './collections-matrix.js';

const STORAGE_KEY = 'queer-curves:user-collections';

function readAll(): GraphCollection[] {
	if (typeof localStorage === 'undefined') return [];
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as GraphCollection[]) : [];
	} catch {
		return [];
	}
}

function writeAll(collections: GraphCollection[]): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
}

function shouldUseMatrix(): boolean {
	return Boolean(matrixStore.session && matrixStore.cryptoStatus?.ready);
}

// Same reasoning as graphs.ts: +layout.svelte restores the session
// asynchronously, and acting before matrixStore.hydrated flips would drop a
// collection into localStorage for a user who has encrypted storage.
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

function isMatrixId(id: string): boolean {
	return id.startsWith('!');
}

export async function listCollections(): Promise<GraphCollection[]> {
	await ensureHydrated();
	const local = readAll();
	if (!shouldUseMatrix()) return local;
	try {
		const matrix = await listMatrixCollections();
		const localOnly = local.filter((c) => !isMatrixId(c.id));
		return [...matrix, ...localOnly];
	} catch (e) {
		console.warn('Matrix listCollections failed; falling back to localStorage', e);
		return local;
	}
}

export async function getCollection(id: string): Promise<GraphCollection | undefined> {
	await ensureHydrated();
	if (isMatrixId(id) && shouldUseMatrix()) {
		try {
			const c = await getMatrixCollection(id);
			if (c) return c;
		} catch (e) {
			console.warn('Matrix getCollection failed; falling back to localStorage', e);
		}
	}
	return readAll().find((c) => c.id === id);
}

export async function saveCollection(collection: GraphCollection): Promise<GraphCollection> {
	await ensureHydrated();
	if (shouldUseMatrix() && !isMatrixId(collection.id)) {
		const saved = await saveMatrixCollection(collection);
		const local = readAll();
		const next = local.filter((c) => c.id !== collection.id);
		if (next.length !== local.length) writeAll(next);
		return saved;
	}
	if (isMatrixId(collection.id) && shouldUseMatrix()) {
		return await saveMatrixCollection(collection);
	}
	const collections = readAll();
	const idx = collections.findIndex((c) => c.id === collection.id);
	if (idx >= 0) collections[idx] = collection;
	else collections.push(collection);
	writeAll(collections);
	return collection;
}

export async function deleteCollection(id: string): Promise<void> {
	await ensureHydrated();
	if (isMatrixId(id) && shouldUseMatrix()) {
		await deleteMatrixCollection(id);
		return;
	}
	writeAll(readAll().filter((c) => c.id !== id));
}

export function generateCollectionId(): string {
	const rand = Math.random().toString(36).slice(2, 10);
	const ts = Date.now().toString(36);
	return `c_${rand}_${ts}`;
}

// Series colours for collection members. Distinct hues matter more here
// than flag symbolism — the colour is the only thing telling two members'
// points apart — so this is the 6-stripe rainbow, which is both maximally
// separated and on-theme.
export const SERIES_PALETTE = findPalette('pride')?.colors ?? [
	'#E40303',
	'#FF8C00',
	'#FFED00',
	'#008026',
	'#004CFF',
	'#732982'
];

export function seriesColor(index: number): string {
	return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

export function newCollection(name: string, owner: string): GraphCollection {
	const now = new Date().toISOString();
	return {
		id: generateCollectionId(),
		kind: 'collection',
		name,
		created_at: now,
		modified_at: now,
		schema_version: SCHEMA_VERSION,
		owner,
		members: []
	};
}

// ─── Resolution and composition ─────────────────────────────────────────────

export interface ResolvedCollection {
	collection: GraphCollection;
	/** Sources in member order, ready for composeGraphs. */
	sources: ComposeSource[];
	/**
	 * Member graph ids that couldn't be loaded — deleted, or shared from an
	 * account whose keys we don't have yet. Surfaced rather than dropped:
	 * a view that silently omits a member is a view that lies.
	 */
	missing: string[];
	issues: ComposeIssue[];
}

/**
 * Load every member graph and check whether they can be plotted together.
 * Members are fetched through the ordinary graph store, so a collection can
 * mix localStorage graphs, Matrix rooms, and bundled fixtures.
 */
export async function resolveCollection(
	collection: GraphCollection,
	viewer?: string
): Promise<ResolvedCollection> {
	const sources: ComposeSource[] = [];
	const missing: string[] = [];
	for (const member of collection.members) {
		const graph = await getUserGraph(member.graph_id);
		if (!graph) {
			missing.push(member.graph_id);
			continue;
		}
		sources.push({ graph, color: member.color, label: member.label });
	}
	return {
		collection,
		sources,
		missing,
		issues: sources.length > 0 ? checkComposable(sources, viewer) : []
	};
}

/**
 * The throwaway graph a collection renders as. Composed on every open —
 * never stored — so edits to a member show up the next time the collection
 * is opened, and removing a member removes its points with no cleanup.
 */
export function composeCollection(resolved: ResolvedCollection): Graph | null {
	if (resolved.sources.length === 0) return null;
	if (resolved.issues.some((i) => i.level === 'error')) return null;
	const c = resolved.collection;
	return composeGraphs(resolved.sources, {
		id: c.id,
		name: c.name,
		description: c.description,
		owner: c.owner,
		now: c.modified_at,
		// The colour *is* the legend in a combined view.
		colorBySource: true
	});
}

/** Convenience for the spectrum path, which needs the narrowed type. */
export function composeSpectrumCollection(resolved: ResolvedCollection): SpectrumGraph | null {
	const composed = composeCollection(resolved);
	return composed && composed.type === 'spectrum' ? composed : null;
}
