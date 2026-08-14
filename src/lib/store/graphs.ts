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
	acceptMatrixInvite,
	declineMatrixInvite,
	deleteMatrixGraph,
	getMatrixGraph,
	type GraphMember,
	inviteToMatrixGraph,
	listMatrixGraphMembers,
	listMatrixGraphs,
	listPendingMatrixInvites,
	matrixGraphCreator,
	type PendingInvite,
	revokeMatrixGraphAccess,
	saveMatrixGraph,
	type ShareGrant
} from './graphs-matrix.js';

export type { GraphMember, PendingInvite, ShareGrant };

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

/**
 * Matrix-backed graphs have room-id keys starting with `!`. Anything else
 * (the `g_…` ids from generateGraphId) lives in localStorage. Dispatch
 * per-graph instead of per-session so users who created graphs before
 * logging in still see them after, and so a single saveUserGraph call
 * can migrate a stranded localStorage graph to Matrix without the call
 * site having to know about it.
 */
function isMatrixId(id: string): boolean {
	return id.startsWith('!');
}

export async function listUserGraphs(): Promise<Graph[]> {
	await ensureHydrated();
	const local = readAll();
	if (!shouldUseMatrix()) return local;
	try {
		const matrix = await listMatrixGraphs();
		// Show the Matrix list first; append any local graphs that haven't
		// been migrated yet. (Local entries with a Matrix-style id are
		// stale duplicates of the server-side state — ignore them.)
		const localOnly = local.filter((g) => !isMatrixId(g.id));
		return [...matrix, ...localOnly];
	} catch (e) {
		console.warn('Matrix listUserGraphs failed; falling back to localStorage', e);
		return local;
	}
}

export async function getUserGraph(id: string): Promise<Graph | undefined> {
	await ensureHydrated();
	if (isMatrixId(id) && shouldUseMatrix()) {
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
	if (shouldUseMatrix() && !isMatrixId(graph.id)) {
		// Migrate a stranded localStorage graph into Matrix on the next
		// save. The save itself creates a new room with the data, and we
		// drop the local copy so the landing page doesn't show both.
		const saved = await saveMatrixGraph(graph);
		const local = readAll();
		const next = local.filter((g) => g.id !== graph.id);
		if (next.length !== local.length) writeAll(next);
		return saved;
	}
	if (isMatrixId(graph.id) && shouldUseMatrix()) {
		return await saveMatrixGraph(graph);
	}
	// Logged-out path, or a localStorage-id graph while logged in but
	// crypto isn't ready: write through to localStorage.
	const graphs = readAll();
	const idx = graphs.findIndex((g) => g.id === graph.id);
	if (idx >= 0) graphs[idx] = graph;
	else graphs.push(graph);
	writeAll(graphs);
	return graph;
}

export async function deleteUserGraph(id: string): Promise<void> {
	await ensureHydrated();
	if (isMatrixId(id) && shouldUseMatrix()) {
		await deleteMatrixGraph(id);
		return;
	}
	writeAll(readAll().filter((g) => g.id !== id));
}

/**
 * Move every localStorage graph into encrypted Matrix storage. Best-effort:
 * any graph that fails to migrate stays in localStorage so the user can
 * retry. Returns a summary the caller can display.
 */
export async function migrateLocalStorageToMatrix(): Promise<{
	migrated: number;
	failed: number;
}> {
	await ensureHydrated();
	if (!shouldUseMatrix()) {
		return { migrated: 0, failed: 0 };
	}
	const local = readAll().filter((g) => !isMatrixId(g.id));
	const migratedIds = new Set<string>();
	let failed = 0;
	for (const graph of local) {
		try {
			await saveMatrixGraph(graph);
			migratedIds.add(graph.id);
		} catch (e) {
			console.warn('migrate failed for', graph.id, e);
			failed++;
		}
	}
	// Keep what we couldn't move; drop what we did move.
	if (migratedIds.size > 0) {
		writeAll(readAll().filter((g) => !migratedIds.has(g.id)));
	}
	return { migrated: migratedIds.size, failed };
}

/**
 * Sharing only works for Matrix-backed graphs. localStorage-id graphs
 * have no remote endpoint to invite anyone to, so these helpers refuse
 * for non-Matrix ids rather than silently no-op'ing.
 */
function requireMatrixId(id: string): void {
	if (!isMatrixId(id)) {
		throw new Error(
			'This graph is only stored on your device. Move it to encrypted storage from the home page before sharing.'
		);
	}
}

export async function inviteToUserGraph(
	graphId: string,
	userId: string,
	grant: ShareGrant = 'current'
): Promise<void> {
	await ensureHydrated();
	requireMatrixId(graphId);
	if (!shouldUseMatrix()) {
		throw new Error('Log in and set up encryption to share graphs.');
	}
	await inviteToMatrixGraph(graphId, userId, grant);
}

/**
 * Hard revocation: kick a member out of a shared graph. Future changes are
 * encrypted with a rotated session they never receive; what they already
 * decrypted remains theirs (sharing_model.md §10.2 — the UI copy carries
 * that caveat).
 */
export async function revokeGraphAccess(graphId: string, userId: string): Promise<void> {
	await ensureHydrated();
	requireMatrixId(graphId);
	if (!shouldUseMatrix()) {
		throw new Error('Log in and set up encryption to manage sharing.');
	}
	await revokeMatrixGraphAccess(graphId, userId);
}

export async function listUserGraphMembers(graphId: string): Promise<GraphMember[]> {
	await ensureHydrated();
	if (!isMatrixId(graphId) || !shouldUseMatrix()) return [];
	return await listMatrixGraphMembers(graphId);
}

export async function listPendingInvites(): Promise<PendingInvite[]> {
	await ensureHydrated();
	if (!shouldUseMatrix()) return [];
	return await listPendingMatrixInvites();
}

export async function acceptInvite(roomId: string): Promise<void> {
	await ensureHydrated();
	if (!shouldUseMatrix()) {
		throw new Error('Log in to accept invites.');
	}
	await acceptMatrixInvite(roomId);
}

export async function declineInvite(roomId: string): Promise<void> {
	await ensureHydrated();
	if (!shouldUseMatrix()) {
		throw new Error('Log in to decline invites.');
	}
	await declineMatrixInvite(roomId);
}

/**
 * Whether the current user owns this graph. localStorage graphs are
 * always owned by the local user; Matrix graphs are owned by the room
 * creator. Used to gate the editing UI on /graphs/[id] — a graph you
 * were invited to is read-only by default so you can't accidentally
 * overwrite the owner's history.
 */
export function isOwnGraph(graphId: string): boolean {
	if (!isMatrixId(graphId)) return true;
	if (!shouldUseMatrix()) return false;
	const creator = matrixGraphCreator(graphId);
	const me = matrixStore.session?.userId ?? null;
	return creator !== null && creator === me;
}

export function generateGraphId(): string {
	// Only used for localStorage graphs; the Matrix path replaces this with
	// the new room id on save.
	const rand = Math.random().toString(36).slice(2, 10);
	const ts = Date.now().toString(36);
	return `g_${rand}_${ts}`;
}
