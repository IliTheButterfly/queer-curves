// Matrix-backed implementation of the graph CRUD.
//
// v1 protocol: every change publishes the whole Graph as an
// `app.queercurves.snapshot` event. Reading reconstructs by finding the
// latest snapshot in the room's timeline (or null if the room has been
// tombstoned). This is deliberately simpler than the event-stream design
// in sharing_model.md — we lose history granularity but the implementation
// is small enough to verify against a real homeserver before specialising.
//
// Each graph lives in its own Matrix room (per sharing_model.md §2.1's
// "one room per (graph × detail-level audience)" — we just have one
// audience in v1, the owner themselves). The room is E2EE from creation;
// a small `app.queercurves.marker` state event identifies it as one of
// ours so listing can filter without reading every encrypted timeline.

import type { Graph } from '$lib/types.js';
import { getClient } from '$lib/matrix/client.js';

const MARKER_EVENT = 'app.queercurves.marker';
const SNAPSHOT_EVENT = 'app.queercurves.snapshot';
const TOMBSTONE_EVENT = 'app.queercurves.tombstone';

function requireClient() {
	const client = getClient();
	if (!client) throw new Error('Matrix client not available');
	return client;
}

// matrix-js-sdk types restrict sendEvent's eventType to a built-in union;
// our `app.queercurves.*` custom types aren't in it. At runtime the SDK
// passes any string through, so we wrap in a permissive helper.
async function sendCustomEvent(
	client: ReturnType<typeof requireClient>,
	roomId: string,
	type: string,
	content: object
): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (client.sendEvent as any)(roomId, type, content);
}

function findLatestGraph(
	room: ReturnType<ReturnType<typeof getClient> & {} extends { getRoom: infer F } ? F : never>
): Graph | null {
	if (!room) return null;
	const events = room.getLiveTimeline().getEvents();
	// Walk backwards to find the most recent snapshot before any tombstone.
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i];
		const type = ev.getType();
		if (type === TOMBSTONE_EVENT) return null;
		if (type === SNAPSHOT_EVENT && !ev.isDecryptionFailure()) {
			const content = ev.getContent() as Partial<Graph>;
			if (content && typeof content === 'object' && content.id) {
				return content as Graph;
			}
		}
	}
	return null;
}

export async function listMatrixGraphs(): Promise<Graph[]> {
	const client = requireClient();
	const out: Graph[] = [];
	for (const room of client.getRooms()) {
		const marker = room.currentState.getStateEvents(MARKER_EVENT, '');
		if (!marker) continue;
		const graph = findLatestGraph(room);
		if (graph) {
			// The canonical id is the Matrix room id, in case the stored
			// snapshot drifted somehow.
			out.push({ ...graph, id: room.roomId });
		}
	}
	return out;
}

export async function getMatrixGraph(id: string): Promise<Graph | undefined> {
	const client = requireClient();
	const room = client.getRoom(id);
	if (!room) return undefined;
	const graph = findLatestGraph(room);
	if (!graph) return undefined;
	return { ...graph, id: room.roomId };
}

export async function saveMatrixGraph(graph: Graph): Promise<Graph> {
	const client = requireClient();
	const existing = graph.id ? client.getRoom(graph.id) : null;
	if (existing) {
		await sendCustomEvent(client, existing.roomId, SNAPSHOT_EVENT, graph);
		return { ...graph, id: existing.roomId };
	}
	// New graph — provision a Matrix room for it.
	const res = await client.createRoom({
		name: graph.name,
		preset: 'private_chat',
		initial_state: [
			{
				type: 'm.room.encryption',
				state_key: '',
				content: { algorithm: 'm.megolm.v1.aes-sha2' }
			},
			{
				type: MARKER_EVENT,
				state_key: '',
				content: { v: 1 }
			}
		]
	} as Parameters<typeof client.createRoom>[0]);
	const roomId = res.room_id;
	const stored: Graph = { ...graph, id: roomId };
	await sendCustomEvent(client, roomId, SNAPSHOT_EVENT, stored);
	return stored;
}

export async function deleteMatrixGraph(id: string): Promise<void> {
	const client = requireClient();
	const room = client.getRoom(id);
	if (!room) return;
	// Best-effort tombstone so any other members see the deletion before we
	// leave; failures here aren't fatal because we still leave the room.
	try {
		await sendCustomEvent(client, room.roomId, TOMBSTONE_EVENT, { reason: 'deleted' });
	} catch {
		// ignore
	}
	try {
		await client.leave(room.roomId);
	} catch {
		// ignore — graph may already be gone server-side
	}
}
