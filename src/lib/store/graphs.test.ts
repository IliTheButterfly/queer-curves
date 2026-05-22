// @vitest-environment happy-dom
//
// Tests for the localStorage/Matrix dispatch in graphs.ts. We mock both
// the matrixStore (so we can flip session + cryptoStatus + hydrated state
// without booting a real Matrix client) and the Matrix store ops (so a
// failure path exercises the localStorage fallback without HTTP).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acefluxFixture } from '../fixtures.js';

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
const { listUserGraphs, getUserGraph, saveUserGraph, deleteUserGraph, generateGraphId } =
	await import('./graphs.js');

const STORAGE_KEY = 'queer-curves:user-graphs';

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

describe('shouldUseMatrix dispatch (logged out)', () => {
	it('listUserGraphs reads from localStorage', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([acefluxFixture]));
		const out = await listUserGraphs();
		expect(out).toHaveLength(1);
		expect(out[0].id).toBe(acefluxFixture.id);
		expect(matrixOps.listMatrixGraphs).not.toHaveBeenCalled();
	});

	it('saveUserGraph writes to localStorage', async () => {
		await saveUserGraph(acefluxFixture);
		const raw = localStorage.getItem(STORAGE_KEY);
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw!)).toEqual([acefluxFixture]);
		expect(matrixOps.saveMatrixGraph).not.toHaveBeenCalled();
	});

	it('saveUserGraph updates an existing localStorage entry', async () => {
		const renamed = { ...acefluxFixture, name: 'renamed' };
		localStorage.setItem(STORAGE_KEY, JSON.stringify([acefluxFixture]));
		await saveUserGraph(renamed);
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(stored).toHaveLength(1);
		expect(stored[0].name).toBe('renamed');
	});

	it('deleteUserGraph removes from localStorage', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([acefluxFixture]));
		await deleteUserGraph(acefluxFixture.id);
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
		expect(matrixOps.deleteMatrixGraph).not.toHaveBeenCalled();
	});

	it('getUserGraph reads from localStorage', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([acefluxFixture]));
		const g = await getUserGraph(acefluxFixture.id);
		expect(g?.id).toBe(acefluxFixture.id);
		expect(matrixOps.getMatrixGraph).not.toHaveBeenCalled();
	});
});

describe('shouldUseMatrix dispatch (logged in, crypto ready)', () => {
	beforeEach(() => {
		mockMatrixStore.session = { userId: '@alice:localhost' };
		mockMatrixStore.cryptoStatus = { ready: true };
	});

	it('listUserGraphs delegates to listMatrixGraphs', async () => {
		matrixOps.listMatrixGraphs.mockResolvedValue([acefluxFixture]);
		const out = await listUserGraphs();
		expect(out).toEqual([acefluxFixture]);
		expect(matrixOps.listMatrixGraphs).toHaveBeenCalledOnce();
	});

	it('listUserGraphs falls back to localStorage on a Matrix error', async () => {
		// Reduces surprise during a transient network failure: better to
		// show whatever localStorage has than nothing at all.
		matrixOps.listMatrixGraphs.mockRejectedValue(new Error('sync down'));
		localStorage.setItem(STORAGE_KEY, JSON.stringify([acefluxFixture]));
		const out = await listUserGraphs();
		expect(out).toHaveLength(1);
	});

	it('saveUserGraph delegates to saveMatrixGraph and returns its result', async () => {
		const stored = { ...acefluxFixture, id: '!room:localhost' };
		matrixOps.saveMatrixGraph.mockResolvedValue(stored);
		const out = await saveUserGraph(acefluxFixture);
		expect(out).toEqual(stored);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('deleteUserGraph delegates to deleteMatrixGraph', async () => {
		matrixOps.deleteMatrixGraph.mockResolvedValue(undefined);
		await deleteUserGraph('!room:localhost');
		expect(matrixOps.deleteMatrixGraph).toHaveBeenCalledWith('!room:localhost');
	});

	it('getUserGraph falls back to localStorage when Matrix returns nothing', async () => {
		// Mixed-source scenario: a graph was created in the localStorage era
		// (or imported by file) and still exists there.
		matrixOps.getMatrixGraph.mockResolvedValue(undefined);
		localStorage.setItem(STORAGE_KEY, JSON.stringify([acefluxFixture]));
		const g = await getUserGraph(acefluxFixture.id);
		expect(g?.id).toBe(acefluxFixture.id);
	});
});

describe('shouldUseMatrix dispatch (logged in, crypto not ready)', () => {
	beforeEach(() => {
		mockMatrixStore.session = { userId: '@alice:localhost' };
		mockMatrixStore.cryptoStatus = { ready: false };
	});

	it('falls back to localStorage when crypto is not set up', async () => {
		// We can't write encrypted graphs without keys, so logged-in-but-
		// not-yet-set-up sessions behave the same as logged-out.
		await saveUserGraph(acefluxFixture);
		expect(matrixOps.saveMatrixGraph).not.toHaveBeenCalled();
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([acefluxFixture]);
	});
});

describe('ensureHydrated', () => {
	it('blocks until matrixStore.hydrated flips to true', async () => {
		// Without this gate, /graphs/new could fire saveUserGraph during the
		// first paint after a full reload — cryptoStatus is null at that
		// moment and the dispatcher would silently drop the graph into
		// localStorage instead of Matrix.
		mockMatrixStore.hydrated = false;
		mockMatrixStore.session = { userId: '@alice:localhost' };
		mockMatrixStore.cryptoStatus = { ready: true };
		matrixOps.saveMatrixGraph.mockResolvedValue({ ...acefluxFixture, id: '!room:x' });

		const pending = saveUserGraph(acefluxFixture);
		// Give the polling loop a chance to run; it shouldn't resolve yet.
		await new Promise((r) => setTimeout(r, 60));
		expect(matrixOps.saveMatrixGraph).not.toHaveBeenCalled();

		mockMatrixStore.hydrated = true;
		await pending;
		expect(matrixOps.saveMatrixGraph).toHaveBeenCalledOnce();
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
