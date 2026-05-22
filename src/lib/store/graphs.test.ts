// @vitest-environment happy-dom
//
// Tests for the localStorage/Matrix dispatch in graphs.ts. We mock both
// the matrixStore (so we can flip session + cryptoStatus + hydrated state
// without booting a real Matrix client) and the Matrix store ops (so a
// failure path exercises the localStorage fallback without HTTP).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acefluxFixture } from '../fixtures.js';
import type { Graph } from '../types.js';

const mockMatrixStore = {
	session: null as { userId: string } | null,
	cryptoStatus: null as { ready: boolean } | null,
	hydrated: false,
	roomsEpoch: 0
};

vi.mock('$lib/matrix/store.svelte.js', () => ({ matrixStore: mockMatrixStore }));

const matrixOps = {
	listMatrixGraphs: vi.fn(),
	getMatrixGraph: vi.fn(),
	saveMatrixGraph: vi.fn(),
	deleteMatrixGraph: vi.fn()
};

vi.mock('./graphs-matrix.js', () => matrixOps);

// Import after the mocks are set up so the SUT sees the mocked modules.
const {
	listUserGraphs,
	getUserGraph,
	saveUserGraph,
	deleteUserGraph,
	generateGraphId,
	migrateLocalStorageToMatrix
} = await import('./graphs.js');

const STORAGE_KEY = 'queer-curves:user-graphs';

// A "local-id" graph mirrors what `generateGraphId()` produces in the UI.
// Overrides are intersected with the SpectrumGraph type so the spread
// doesn't widen the `type` discriminator.
function localGraph(id = 'g_abc_1', overrides: Partial<typeof acefluxFixture> = {}): Graph {
	return { ...acefluxFixture, id, ...overrides };
}

beforeEach(() => {
	mockMatrixStore.session = null;
	mockMatrixStore.cryptoStatus = null;
	mockMatrixStore.hydrated = true;
	mockMatrixStore.roomsEpoch = 0;
	localStorage.clear();
	for (const fn of Object.values(matrixOps)) fn.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('dispatch (logged out)', () => {
	it('listUserGraphs reads from localStorage', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph()]));
		const out = await listUserGraphs();
		expect(out).toHaveLength(1);
		expect(out[0].id).toBe('g_abc_1');
		expect(matrixOps.listMatrixGraphs).not.toHaveBeenCalled();
	});

	it('saveUserGraph writes to localStorage', async () => {
		await saveUserGraph(localGraph());
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(stored).toHaveLength(1);
		expect(stored[0].id).toBe('g_abc_1');
		expect(matrixOps.saveMatrixGraph).not.toHaveBeenCalled();
	});

	it('saveUserGraph updates an existing localStorage entry', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph()]));
		await saveUserGraph(localGraph('g_abc_1', { name: 'renamed' }));
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(stored).toHaveLength(1);
		expect(stored[0].name).toBe('renamed');
	});

	it('deleteUserGraph removes from localStorage', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph()]));
		await deleteUserGraph('g_abc_1');
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
		expect(matrixOps.deleteMatrixGraph).not.toHaveBeenCalled();
	});

	it('getUserGraph reads from localStorage', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph()]));
		const g = await getUserGraph('g_abc_1');
		expect(g?.id).toBe('g_abc_1');
		expect(matrixOps.getMatrixGraph).not.toHaveBeenCalled();
	});
});

describe('dispatch (logged in, crypto ready)', () => {
	beforeEach(() => {
		mockMatrixStore.session = { userId: '@alice:localhost' };
		mockMatrixStore.cryptoStatus = { ready: true };
	});

	it('listUserGraphs returns Matrix graphs plus stranded localStorage graphs', async () => {
		// Real-world mixed state: user made a few graphs while logged out,
		// then signed in. Both sources show in the list so the local ones
		// aren't silently invisible.
		matrixOps.listMatrixGraphs.mockResolvedValue([{ ...acefluxFixture, id: '!room:x' }]);
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph()]));
		const out = await listUserGraphs();
		expect(out.map((g) => g.id)).toEqual(['!room:x', 'g_abc_1']);
	});

	it('listUserGraphs ignores stale Matrix-id entries left in localStorage', async () => {
		// After migration we drop the local entry — if something stale is
		// still there, don't show it on top of the real Matrix copy.
		matrixOps.listMatrixGraphs.mockResolvedValue([{ ...acefluxFixture, id: '!room:x' }]);
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph('!room:x')]));
		const out = await listUserGraphs();
		expect(out.map((g) => g.id)).toEqual(['!room:x']);
	});

	it('listUserGraphs falls back to localStorage on a Matrix error', async () => {
		matrixOps.listMatrixGraphs.mockRejectedValue(new Error('sync down'));
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph()]));
		const out = await listUserGraphs();
		expect(out).toHaveLength(1);
	});

	it('saveUserGraph on a Matrix-id graph delegates to saveMatrixGraph', async () => {
		const stored = { ...acefluxFixture, id: '!room:x' };
		matrixOps.saveMatrixGraph.mockResolvedValue(stored);
		const out = await saveUserGraph(stored);
		expect(out).toEqual(stored);
		expect(matrixOps.saveMatrixGraph).toHaveBeenCalledOnce();
	});

	it('saveUserGraph on a g_ id migrates the graph to Matrix and clears local', async () => {
		// This is the on-demand migration path: a graph created pre-login is
		// re-saved post-login and should land in encrypted storage. The local
		// copy goes away so the landing page doesn't keep showing the
		// pre-migration entry alongside the Matrix-backed one.
		const seeded = localGraph('g_abc_1');
		localStorage.setItem(STORAGE_KEY, JSON.stringify([seeded, localGraph('g_other_2')]));
		const stored = { ...seeded, id: '!room:x' };
		matrixOps.saveMatrixGraph.mockResolvedValue(stored);
		const out = await saveUserGraph(seeded);
		expect(out.id).toBe('!room:x');
		const remaining = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Graph[];
		expect(remaining.map((g) => g.id)).toEqual(['g_other_2']);
	});

	it('deleteUserGraph dispatches by id prefix', async () => {
		// Matrix-id deletes hit the Matrix backend; local-id deletes never
		// touch the network even if the user is logged in.
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph()]));
		matrixOps.deleteMatrixGraph.mockResolvedValue(undefined);
		await deleteUserGraph('!room:x');
		expect(matrixOps.deleteMatrixGraph).toHaveBeenCalledWith('!room:x');
		await deleteUserGraph('g_abc_1');
		expect(matrixOps.deleteMatrixGraph).toHaveBeenCalledTimes(1);
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
	});

	it('getUserGraph dispatches by id prefix', async () => {
		// Matrix-id lookups hit the Matrix backend; local-id lookups never do
		// even when the session is encrypted-ready.
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph()]));
		matrixOps.getMatrixGraph.mockResolvedValue({ ...acefluxFixture, id: '!room:x' });
		const matrixHit = await getUserGraph('!room:x');
		expect(matrixHit?.id).toBe('!room:x');
		const localHit = await getUserGraph('g_abc_1');
		expect(localHit?.id).toBe('g_abc_1');
		expect(matrixOps.getMatrixGraph).toHaveBeenCalledOnce();
	});

	it('getUserGraph falls back to localStorage when Matrix returns nothing', async () => {
		// Mostly defensive — a Matrix-id graph not in the sync cache yet
		// would otherwise look like a 404 to the page.
		matrixOps.getMatrixGraph.mockResolvedValue(undefined);
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph('!room:x')]));
		const g = await getUserGraph('!room:x');
		expect(g?.id).toBe('!room:x');
	});
});

describe('dispatch (logged in, crypto not ready)', () => {
	beforeEach(() => {
		mockMatrixStore.session = { userId: '@alice:localhost' };
		mockMatrixStore.cryptoStatus = { ready: false };
	});

	it('falls back to localStorage when crypto is not set up', async () => {
		await saveUserGraph(localGraph());
		expect(matrixOps.saveMatrixGraph).not.toHaveBeenCalled();
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([localGraph()]);
	});
});

describe('ensureHydrated', () => {
	it('blocks until matrixStore.hydrated flips to true', async () => {
		mockMatrixStore.hydrated = false;
		mockMatrixStore.session = { userId: '@alice:localhost' };
		mockMatrixStore.cryptoStatus = { ready: true };
		matrixOps.saveMatrixGraph.mockResolvedValue({ ...acefluxFixture, id: '!room:x' });

		const pending = saveUserGraph(localGraph());
		await new Promise((r) => setTimeout(r, 60));
		expect(matrixOps.saveMatrixGraph).not.toHaveBeenCalled();

		mockMatrixStore.hydrated = true;
		await pending;
		expect(matrixOps.saveMatrixGraph).toHaveBeenCalledOnce();
	});
});

describe('migrateLocalStorageToMatrix', () => {
	beforeEach(() => {
		mockMatrixStore.session = { userId: '@alice:localhost' };
		mockMatrixStore.cryptoStatus = { ready: true };
	});

	it('is a no-op when not logged in or crypto not ready', async () => {
		mockMatrixStore.cryptoStatus = null;
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph()]));
		const result = await migrateLocalStorageToMatrix();
		expect(result).toEqual({ migrated: 0, failed: 0 });
		expect(matrixOps.saveMatrixGraph).not.toHaveBeenCalled();
		// Local state untouched.
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
	});

	it('moves every local graph to Matrix and removes them from localStorage', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify([localGraph('g_a'), localGraph('g_b'), localGraph('g_c')])
		);
		let n = 0;
		matrixOps.saveMatrixGraph.mockImplementation(async (g) => ({ ...g, id: `!room:${++n}` }));
		const result = await migrateLocalStorageToMatrix();
		expect(result).toEqual({ migrated: 3, failed: 0 });
		expect(matrixOps.saveMatrixGraph).toHaveBeenCalledTimes(3);
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
	});

	it('keeps the failures in localStorage so the user can retry', async () => {
		// Mid-batch network failure shouldn't lose data. The successful ones
		// have been written to Matrix already, but the failures stay locally
		// so a second click can pick up where the first one stopped.
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph('g_ok'), localGraph('g_bad')]));
		matrixOps.saveMatrixGraph.mockImplementation(async (g) => {
			if (g.id === 'g_bad') throw new Error('boom');
			return { ...g, id: '!room:ok' };
		});
		const result = await migrateLocalStorageToMatrix();
		expect(result).toEqual({ migrated: 1, failed: 1 });
		const remaining = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Graph[];
		expect(remaining.map((g) => g.id)).toEqual(['g_bad']);
	});

	it('ignores Matrix-id entries that linger in localStorage', async () => {
		// Stale duplicates after a previous migration shouldn't be re-sent.
		localStorage.setItem(STORAGE_KEY, JSON.stringify([localGraph('!room:already')]));
		const result = await migrateLocalStorageToMatrix();
		expect(result).toEqual({ migrated: 0, failed: 0 });
		expect(matrixOps.saveMatrixGraph).not.toHaveBeenCalled();
	});
});

describe('generateGraphId', () => {
	it('produces ids that start with the g_ prefix and are reasonably unique', () => {
		const a = generateGraphId();
		const b = generateGraphId();
		expect(a).toMatch(/^g_/);
		expect(b).toMatch(/^g_/);
		expect(a).not.toBe(b);
	});
});
