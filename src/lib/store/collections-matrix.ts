// Matrix-backed storage for collections (multi-graph views).
//
// Same shape as graphs-matrix.ts — one room per collection, E2EE from
// creation, whole-object snapshots, a marker state event so listing can
// filter without decrypting. Distinct event types keep the two entity kinds
// from showing up in each other's lists: a collection room has no
// `app.queercurves.marker` and no `app.queercurves.snapshot`, so
// listMatrixGraphs skips it, and vice versa.
//
// One deliberate difference from graphs: the room is created **without an
// m.room.name**. Room names are unencrypted state, and a collection's name
// ("me and Sam", "before and after HRT") is exactly the kind of label
// THREATS.md §7 says must not sit in plaintext. Graph rooms still set one —
// that's pre-existing behaviour, tracked separately; new surface shouldn't
// widen the leak. The name lives in the encrypted snapshot instead, so the
// UI still shows it and the homeserver never sees it.

import type { GraphCollection } from '$lib/types.js';
import { getClient } from '$lib/matrix/client.js';
import { TOMBSTONE_EVENT } from './graphs-matrix.js';

export const COLLECTION_MARKER_EVENT = 'app.queercurves.collection.marker';
export const COLLECTION_SNAPSHOT_EVENT = 'app.queercurves.collection.snapshot';

/** Minimal shape of a matrix-js-sdk MatrixEvent that the scan cares about. */
export interface SnapshotScanEvent {
	getType(): string;
	getContent(): unknown;
	isDecryptionFailure(): boolean;
}

function requireClient() {
	const client = getClient();
	if (!client) throw new Error('Matrix client not available');
	return client;
}

// See graphs-matrix.ts: the SDK's sendEvent type union doesn't include our
// custom `app.queercurves.*` types, but it passes any string through.
async function sendCustomEvent(
	client: ReturnType<typeof requireClient>,
	roomId: string,
	type: string,
	content: object
): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (client.sendEvent as any)(roomId, type, content);
}

/**
 * Newest decryptable collection snapshot in a timeline, or null if the room
 * was tombstoned or nothing decrypted. Mirrors findLatestGraph.
 */
export function findLatestCollection(events: readonly SnapshotScanEvent[]): GraphCollection | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i];
		const type = ev.getType();
		if (type === TOMBSTONE_EVENT) return null;
		if (type === COLLECTION_SNAPSHOT_EVENT && !ev.isDecryptionFailure()) {
			const content = ev.getContent() as Partial<GraphCollection> | null;
			if (content && typeof content === 'object' && content.id && Array.isArray(content.members)) {
				return content as GraphCollection;
			}
		}
	}
	return null;
}

export async function listMatrixCollections(): Promise<GraphCollection[]> {
	const client = requireClient();
	const out: GraphCollection[] = [];
	for (const room of client.getRooms()) {
		// Marker OR a decrypted snapshot, for the same reason as graphs: a
		// freshly-synced room may not have its custom state in currentState
		// yet, and relying on the marker alone hides it on a second device.
		const marker = room.currentState.getStateEvents(COLLECTION_MARKER_EVENT, '');
		const collection = findLatestCollection(room.getLiveTimeline().getEvents());
		if (!marker && !collection) continue;
		if (collection) out.push({ ...collection, id: room.roomId });
	}
	return out;
}

export async function getMatrixCollection(id: string): Promise<GraphCollection | undefined> {
	const client = requireClient();
	const room = client.getRoom(id);
	if (!room) return undefined;
	const collection = findLatestCollection(room.getLiveTimeline().getEvents());
	if (!collection) return undefined;
	return { ...collection, id: room.roomId };
}

export async function saveMatrixCollection(collection: GraphCollection): Promise<GraphCollection> {
	const client = requireClient();
	const existing = collection.id ? client.getRoom(collection.id) : null;
	if (existing) {
		await sendCustomEvent(client, existing.roomId, COLLECTION_SNAPSHOT_EVENT, collection);
		return { ...collection, id: existing.roomId };
	}
	const res = await client.createRoom({
		preset: 'private_chat',
		initial_state: [
			{
				type: 'm.room.encryption',
				state_key: '',
				content: { algorithm: 'm.megolm.v1.aes-sha2' }
			},
			{
				type: COLLECTION_MARKER_EVENT,
				state_key: '',
				content: { v: 1 }
			}
		]
	} as Parameters<typeof client.createRoom>[0]);
	const roomId = res.room_id;
	// Sending before the local client sees m.room.encryption publishes the
	// snapshot in plaintext, permanently. Same trap as graphs-matrix.ts.
	await waitForEncryption(client, roomId, 10000);
	const stored: GraphCollection = { ...collection, id: roomId };
	await sendCustomEvent(client, roomId, COLLECTION_SNAPSHOT_EVENT, stored);
	return stored;
}

async function waitForEncryption(
	client: ReturnType<typeof requireClient>,
	roomId: string,
	timeoutMs: number
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const room = client.getRoom(roomId);
		if (room && room.hasEncryptionStateEvent()) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	console.warn('[qc.matrix] waitForEncryption timed out for', roomId);
}

export async function deleteMatrixCollection(id: string): Promise<void> {
	const client = requireClient();
	const room = client.getRoom(id);
	if (!room) return;
	try {
		await sendCustomEvent(client, room.roomId, TOMBSTONE_EVENT, { reason: 'deleted' });
	} catch {
		// ignore — we still leave the room below
	}
	try {
		await client.leave(room.roomId);
	} catch {
		// ignore — may already be gone server-side
	}
}
