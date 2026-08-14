// @vitest-environment happy-dom
//
// Tests for the collection store: the localStorage/Matrix dispatch (same
// contract as graphs.ts) and the resolve/compose path that turns a saved
// list of ids into something renderable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphCollection, SpectrumGraph } from '../types.js';

const mockMatrixStore = {
	session: null as { userId: string } | null,
	cryptoStatus: null as { ready: boolean } | null,
	hydrated: false,
	roomsEpoch: 0
};

vi.mock('$lib/matrix/store.svelte.js', () => ({ matrixStore: mockMatrixStore }));

const matrixOps = {
	listMatrixCollections: vi.fn(),
	getMatrixCollection: vi.fn(),
	saveMatrixCollection: vi.fn(),
	deleteMatrixCollection: vi.fn()
};
vi.mock('./collections-matrix.js', () => matrixOps);

const graphOps = { getUserGraph: vi.fn() };
vi.mock('./graphs.js', () => graphOps);

const {
	listCollections,
	getCollection,
	saveCollection,
	deleteCollection,
	generateCollectionId,
	newCollection,
	resolveCollection,
	composeCollection,
	seriesColor
} = await import('./collections.js');

const STORAGE_KEY = 'queer-curves:user-collections';
const NOW = '2026-08-14T12:00:00Z';

function collection(overrides: Partial<GraphCollection> = {}): GraphCollection {
	return {
		id: 'c_abc_1',
		kind: 'collection',
		name: 'me and Sam',
		created_at: NOW,
		modified_at: NOW,
		schema_version: 1,
		owner: '@me:localhost',
		members: [],
		...overrides
	};
}

function spectrum(id: string, name: string, coords: number[]): SpectrumGraph {
	return {
		id,
		type: 'spectrum',
		name,
		created_at: NOW,
		modified_at: NOW,
		schema_version: 1,
		owner: '@me:localhost',
		editors: [],
		schema: {
			dimensions: 2,
			axes: [
				{ name: 'axis 1', min_label: 'a', max_label: 'b', range: [0, 1] },
				{ name: 'axis 2', min_label: 'c', max_label: 'd', range: [0, 1] }
			],
			regions: []
		},
		customization: { theme: { palette: ['#c98aff'] }, title: { show: true, text: name } },
		datapoints: [{ id: `${id}-d1`, coordinates: coords, timestamp: NOW }]
	};
}

beforeEach(() => {
	mockMatrixStore.session = null;
	mockMatrixStore.cryptoStatus = null;
	mockMatrixStore.hydrated = true;
	localStorage.clear();
	vi.clearAllMocks();
});

afterEach(() => {
	localStorage.clear();
});

function goMatrix() {
	mockMatrixStore.session = { userId: '@me:localhost' };
	mockMatrixStore.cryptoStatus = { ready: true };
}

describe('collection storage dispatch', () => {
	it('writes to localStorage when logged out', async () => {
		await saveCollection(collection());
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
		expect(stored).toHaveLength(1);
		expect(matrixOps.saveMatrixCollection).not.toHaveBeenCalled();
	});

	it('updates an existing localStorage entry in place', async () => {
		await saveCollection(collection());
		await saveCollection(collection({ name: 'renamed' }));
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
		expect(stored).toHaveLength(1);
		expect(stored[0].name).toBe('renamed');
	});

	it('migrates a c_… collection into Matrix on the next save', async () => {
		goMatrix();
		// A collection stranded in localStorage from a logged-out session:
		// the next save with Matrix live moves it into a room and drops the
		// local copy, so the list doesn't show both.
		localStorage.setItem(STORAGE_KEY, JSON.stringify([collection()]));
		matrixOps.saveMatrixCollection.mockResolvedValue(collection({ id: '!room:localhost' }));
		const saved = await saveCollection(collection());

		expect(saved.id).toBe('!room:localhost');
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toHaveLength(0);
	});

	it('sends a room-id collection straight to Matrix', async () => {
		goMatrix();
		const remote = collection({ id: '!room:localhost' });
		matrixOps.saveMatrixCollection.mockResolvedValue(remote);
		await saveCollection(remote);
		expect(matrixOps.saveMatrixCollection).toHaveBeenCalledWith(remote);
	});

	it('lists Matrix collections ahead of unmigrated local ones', async () => {
		goMatrix();
		localStorage.setItem(STORAGE_KEY, JSON.stringify([collection({ id: 'c_local' })]));
		matrixOps.listMatrixCollections.mockResolvedValue([collection({ id: '!room:localhost' })]);
		const listed = await listCollections();
		expect(listed.map((c) => c.id)).toEqual(['!room:localhost', 'c_local']);
	});

	it('falls back to localStorage when the Matrix list fails', async () => {
		goMatrix();
		localStorage.setItem(STORAGE_KEY, JSON.stringify([collection({ id: 'c_local' })]));
		matrixOps.listMatrixCollections.mockRejectedValue(new Error('offline'));
		const listed = await listCollections();
		expect(listed.map((c) => c.id)).toEqual(['c_local']);
	});

	it('falls back to localStorage when a Matrix read fails', async () => {
		goMatrix();
		localStorage.setItem(STORAGE_KEY, JSON.stringify([collection({ id: '!room:localhost' })]));
		matrixOps.getMatrixCollection.mockRejectedValue(new Error('offline'));
		const got = await getCollection('!room:localhost');
		expect(got?.id).toBe('!room:localhost');
	});

	it('deletes a Matrix collection through the room path', async () => {
		goMatrix();
		await deleteCollection('!room:localhost');
		expect(matrixOps.deleteMatrixCollection).toHaveBeenCalledWith('!room:localhost');
	});

	it('deletes a local collection without touching Matrix', async () => {
		await saveCollection(collection());
		await deleteCollection('c_abc_1');
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toHaveLength(0);
		expect(matrixOps.deleteMatrixCollection).not.toHaveBeenCalled();
	});

	it('survives corrupt localStorage', async () => {
		localStorage.setItem(STORAGE_KEY, 'not json');
		expect(await listCollections()).toEqual([]);
	});

	it('mints c_-prefixed ids so the dispatch can tell them from room ids', () => {
		expect(generateCollectionId().startsWith('c_')).toBe(true);
	});
});

describe('resolveCollection / composeCollection', () => {
	it('composes members in order, tinted by their series colour', async () => {
		const a = spectrum('g_a', 'me', [0.2, 0.3]);
		const b = spectrum('g_b', 'Sam', [0.8, 0.9]);
		graphOps.getUserGraph.mockImplementation(async (id: string) =>
			id === 'g_a' ? a : id === 'g_b' ? b : undefined
		);
		const c = collection({
			members: [
				{ graph_id: 'g_a', color: '#ff0000' },
				{ graph_id: 'g_b', color: '#00ff00' }
			]
		});
		const resolved = await resolveCollection(c, '@me:localhost');
		expect(resolved.missing).toEqual([]);
		const composed = composeCollection(resolved);
		expect(composed?.type).toBe('spectrum');
		const points = (composed as SpectrumGraph).datapoints;
		expect(points).toHaveLength(2);
		expect(points.map((p) => p.color)).toEqual(['#ff0000', '#00ff00']);
	});

	it('resolves bundled fixtures, which never live in the store', async () => {
		// Regression: resolveCollection used to go through getUserGraph only,
		// so a collection containing a fixture always reported it missing.
		graphOps.getUserGraph.mockResolvedValue(undefined);
		const resolved = await resolveCollection(
			collection({ members: [{ graph_id: 'fixture-genderfluid' }] })
		);
		expect(resolved.missing).toEqual([]);
		expect(resolved.sources[0].graph.id).toBe('fixture-genderfluid');
	});

	it('reports members it could not load instead of silently dropping them', async () => {
		graphOps.getUserGraph.mockImplementation(async (id: string) =>
			id === 'g_a' ? spectrum('g_a', 'me', [0.2, 0.3]) : undefined
		);
		const resolved = await resolveCollection(
			collection({ members: [{ graph_id: 'g_a' }, { graph_id: 'g_gone' }] })
		);
		expect(resolved.missing).toEqual(['g_gone']);
		expect(resolved.sources).toHaveLength(1);
	});

	it('composes nothing when the members are incompatible', async () => {
		const twoD = spectrum('g_a', 'me', [0.2, 0.3]);
		const oneD: SpectrumGraph = {
			...spectrum('g_b', 'other', [0.5]),
			schema: {
				dimensions: 1,
				axes: [{ name: 'x', min_label: 'a', max_label: 'b', range: [0, 1] }],
				regions: []
			}
		};
		graphOps.getUserGraph.mockImplementation(async (id: string) => (id === 'g_a' ? twoD : oneD));
		const resolved = await resolveCollection(
			collection({ members: [{ graph_id: 'g_a' }, { graph_id: 'g_b' }] })
		);
		expect(resolved.issues.some((i) => i.level === 'error')).toBe(true);
		expect(composeCollection(resolved)).toBeNull();
	});

	it('composes nothing for an empty collection', async () => {
		const resolved = await resolveCollection(collection());
		expect(composeCollection(resolved)).toBeNull();
	});

	it('gives a fresh collection a valid identity', () => {
		const c = newCollection('trial', '@me:localhost');
		expect(c.kind).toBe('collection');
		expect(c.members).toEqual([]);
		expect(c.owner).toBe('@me:localhost');
	});

	it('cycles series colours so a big collection never runs out', () => {
		expect(seriesColor(0)).toBe(seriesColor(6));
		expect(seriesColor(0)).not.toBe(seriesColor(1));
	});
});
