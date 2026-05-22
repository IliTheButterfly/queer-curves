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

export const MARKER_EVENT = 'app.queercurves.marker';
export const SNAPSHOT_EVENT = 'app.queercurves.snapshot';
export const TOMBSTONE_EVENT = 'app.queercurves.tombstone';

/** Minimal shape of a matrix-js-sdk MatrixEvent that findLatestGraph cares about. */
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

/**
 * Walk a room's timeline backwards and return the most recent snapshot
 * that decrypted to a valid Graph. A tombstone (newer than any snapshot
 * we'd consider) suppresses the room entirely — null means "deleted or no
 * readable snapshot". Decryption failures are skipped silently so the
 * caller can fall back to whatever earlier snapshot is still decryptable.
 */
export function findLatestGraph(events: readonly SnapshotScanEvent[]): Graph | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i];
		const type = ev.getType();
		if (type === TOMBSTONE_EVENT) return null;
		if (type === SNAPSHOT_EVENT && !ev.isDecryptionFailure()) {
			const content = ev.getContent() as Partial<Graph> | null;
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
		// Two ways to recognise our rooms: the `app.queercurves.marker`
		// state event we set in initial_state, or any decrypted snapshot
		// in the timeline. We accept either because matrix-js-sdk doesn't
		// always have all state events in currentState immediately after
		// /sync delivers a brand-new room — relying on the marker alone
		// hides freshly-restored rooms from a second device until the next
		// state push lands.
		const marker = room.currentState.getStateEvents(MARKER_EVENT, '');
		const graph = findLatestGraph(room.getLiveTimeline().getEvents());
		if (!marker && !graph) continue;
		if (graph) {
			out.push({ ...graph, id: room.roomId });
		}
	}
	return out;
}

export async function getMatrixGraph(id: string): Promise<Graph | undefined> {
	const client = requireClient();
	const room = client.getRoom(id);
	if (!room) return undefined;
	const graph = findLatestGraph(room.getLiveTimeline().getEvents());
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
	// `createRoom` resolves once the server has accepted the room, but the
	// local client's room object — including its m.room.encryption state —
	// only materialises when /sync delivers the room back. If we sendEvent
	// before then, matrix-js-sdk thinks the room is unencrypted and sends
	// the snapshot in plaintext, which then survives any future re-login
	// regardless of crypto state and overrides later (encrypted) snapshots.
	await waitForEncryption(client, roomId, 10000);
	const stored: Graph = { ...graph, id: roomId };
	await sendCustomEvent(client, roomId, SNAPSHOT_EVENT, stored);
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
	// Fall through after timeout. The send will still go out — better a
	// late, possibly-plaintext snapshot than dropping the user's data on
	// the floor.
	console.warn('[qc.matrix] waitForEncryption timed out for', roomId);
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

export interface GraphMember {
	userId: string;
	displayName: string;
	/** join | invite | leave | ban — straight from m.room.member content. */
	membership: string;
}

export async function listMatrixGraphMembers(id: string): Promise<GraphMember[]> {
	const client = requireClient();
	const room = client.getRoom(id);
	if (!room) return [];
	return room.currentState.getMembers().map((m) => ({
		userId: m.userId,
		displayName: m.name ?? m.userId,
		membership: m.membership ?? 'leave'
	}));
}

/**
 * Invite a Matrix user (`@bob:server`) to a graph room. Megolm session keys
 * are shared automatically by the SDK once the invitee joins, so they can
 * read everything from their join point forward; older messages stay
 * unreadable to them unless the inviter explicitly shares history via key
 * backup or device-to-device key forwarding (sharing_model.md §7).
 */
export async function inviteToMatrixGraph(graphId: string, userId: string): Promise<void> {
	const client = requireClient();
	const trimmed = userId.trim();
	if (!trimmed) throw new Error('Enter a Matrix user id (e.g. @alice:localhost).');
	if (!/^@[^:]+:[^@:]+$/.test(trimmed)) {
		throw new Error(
			"That doesn't look like a Matrix user id. Expected the form @localpart:server.tld"
		);
	}
	if (trimmed === client.getUserId()) {
		throw new Error("That's your own account — you already have access.");
	}
	await client.invite(graphId, trimmed);
}

/** Pending invites to OUR rooms — graphs other users invited this account to. */
export interface PendingInvite {
	roomId: string;
	roomName: string | null;
	invitedBy: string | null;
}

export async function listPendingMatrixInvites(): Promise<PendingInvite[]> {
	const client = requireClient();
	const userId = client.getUserId();
	if (!userId) return [];
	const out: PendingInvite[] = [];
	for (const room of client.getRooms()) {
		const me = room.getMember(userId);
		if (!me || me.membership !== 'invite') continue;
		// We can't filter invites by the `app.queercurves.marker` state
		// event the way we filter joined rooms — invited users only receive
		// the room's "stripped state" (m.room.name, m.room.member for the
		// two participants, m.room.join_rules, m.room.avatar). Custom state
		// events aren't included until they actually join. Show every
		// pending invite and trust the user to decline anything unexpected.
		out.push({
			roomId: room.roomId,
			roomName: room.name ?? null,
			invitedBy: me.events.member?.getSender() ?? null
		});
	}
	return out;
}

export async function acceptMatrixInvite(roomId: string): Promise<void> {
	const client = requireClient();
	await client.joinRoom(roomId);
}

export async function declineMatrixInvite(roomId: string): Promise<void> {
	const client = requireClient();
	await client.leave(roomId);
}
