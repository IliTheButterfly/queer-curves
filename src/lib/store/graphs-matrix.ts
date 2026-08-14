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
import { projectGraphForGrant, type ShareGrant } from './projection.js';

export type { ShareGrant };

export const MARKER_EVENT = 'app.queercurves.marker';
export const SNAPSHOT_EVENT = 'app.queercurves.snapshot';
export const TOMBSTONE_EVENT = 'app.queercurves.tombstone';

/**
 * Marker state content. A primary room (the owner's own copy, full graph,
 * pending consent links included) carries `{ v: 1 }`. A share room — one per
 * (graph × grant), holding only that grant's projection — additionally
 * carries `variant` and `parent`.
 *
 * `parent` is plaintext room state, so the homeserver learns that two rooms
 * belong to the same graph. Accepted residual: it already knows both rooms
 * were created by the same account with overlapping membership and
 * correlated write times; the link adds structure, not content, and no §7
 * rule 3 label. The alternative (an owner-side mapping in account_data) is
 * Stage 3's encrypted-account-data work.
 */
export interface MarkerContent {
	v: number;
	variant?: ShareGrant;
	parent?: string;
}

/**
 * The `createRoom` payload for a graph room. Pure so the security-relevant
 * parts are testable without a homeserver — see graphs-matrix.test.ts.
 *
 * Three things here are load-bearing for the threat model, not stylistic:
 *
 *  1. **No `name`.** `m.room.name` is unencrypted room state; the homeserver
 *     reads it. A graph called "my gender" or "alcohol" in room state is an
 *     outing primitive on its own (`sharing_model.md` §2.2, `THREATS.md` §7
 *     rule 3). The title lives in the encrypted snapshot only. Topic and
 *     avatar are left unset for the same reason.
 *  2. **Power levels.** `sharing_model.md` §9.1: only the owner may post
 *     snapshots/tombstones/markers or change membership. Without the
 *     override, `private_chat` leaves `events_default` at 0, so any invitee
 *     could publish a snapshot that every other viewer's `findLatestGraph`
 *     would then treat as the graph.
 *     Note *which* entry does the work: in an E2EE room the server only sees
 *     the outer `m.room.encrypted` type, so the per-type entries below can
 *     never gate a timeline event. `events_default` (and the explicit
 *     `m.room.encrypted`) is the enforceable control; the per-inner-type
 *     entries are documentation plus a guard for the unencrypted-send path.
 *     This is why §9.1's per-event-type table cannot be implemented as
 *     written — see `SECURITY_PLAN.md` §4.3.
 *  3. **`history_visibility: joined`.** The current-only default of
 *     `sharing_model.md` §8.1 at the server level: a joiner is not even
 *     offered the ciphertext of events from before their join, so a later
 *     key leak can't retroactively become a history grant.
 */
export function graphRoomCreateOptions(variant?: { kind: ShareGrant; parent: string }): {
	preset: string;
	initial_state: { type: string; state_key: string; content: object }[];
	power_level_content_override: object;
} {
	const marker: MarkerContent = variant
		? { v: 1, variant: variant.kind, parent: variant.parent }
		: { v: 1 };
	return {
		preset: 'private_chat',
		initial_state: [
			{
				type: 'm.room.encryption',
				state_key: '',
				content: { algorithm: 'm.megolm.v1.aes-sha2' }
			},
			{
				type: 'm.room.history_visibility',
				state_key: '',
				content: { history_visibility: 'joined' }
			},
			{
				type: MARKER_EVENT,
				state_key: '',
				content: marker
			}
		],
		power_level_content_override: {
			users_default: 0,
			events_default: 100,
			state_default: 100,
			invite: 100,
			kick: 100,
			ban: 100,
			redact: 100,
			events: {
				'm.room.encrypted': 100,
				[SNAPSHOT_EVENT]: 100,
				[TOMBSTONE_EVENT]: 100,
				[MARKER_EVENT]: 100,
				'm.room.name': 100,
				'm.room.topic': 100,
				'm.room.avatar': 100,
				'm.room.encryption': 100,
				'm.room.history_visibility': 100,
				'm.room.power_levels': 100
			}
		}
	};
}

/** Minimal shape of a matrix-js-sdk MatrixEvent that findLatestGraph cares about. */
export interface SnapshotScanEvent {
	getType(): string;
	getContent(): unknown;
	isDecryptionFailure(): boolean;
	getSender(): string | undefined;
	/** Origin server timestamp, ms. */
	getTs(): number;
}

/** Minimal room shape shared by the state-reading helpers below. */
interface StateReadableRoom {
	currentState: {
		getStateEvents(
			type: string,
			key: string
		):
			| { getContent(): unknown; getSender(): string | undefined }
			| { getContent(): unknown; getSender(): string | undefined }[]
			| null;
	};
}

/** The marker state content of a room, or null if it isn't one of ours. */
export function markerOf(room: StateReadableRoom): MarkerContent | null {
	const ev = room.currentState.getStateEvents(MARKER_EVENT, '');
	if (!ev) return null;
	const one = Array.isArray(ev) ? ev[0] : ev;
	if (!one) return null;
	const content = one.getContent() as MarkerContent | null;
	return content && typeof content === 'object' && typeof content.v === 'number' ? content : null;
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
 *
 * When `ownerId` is known, snapshots and tombstones from anyone else are
 * ignored. Power levels already stop a viewer sending either — but power
 * levels are enforced by the *sender's* homeserver on a federated send, so
 * the reader must not trust them alone (`SECURITY_PLAN.md` S2). If the
 * room's create event hasn't synced yet, `ownerId` is null and the check is
 * skipped rather than hiding the graph: server-side authorisation is still
 * in force, this is defence-in-depth on top of it.
 */
export function findLatestGraph(
	events: readonly SnapshotScanEvent[],
	ownerId?: string | null
): Graph | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i];
		const type = ev.getType();
		if (type !== TOMBSTONE_EVENT && type !== SNAPSHOT_EVENT) continue;
		if (ownerId && ev.getSender() !== ownerId) continue;
		if (type === TOMBSTONE_EVENT) return null;
		if (!ev.isDecryptionFailure()) {
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
	const me = client.getUserId();
	const out: Graph[] = [];
	for (const room of client.getRooms()) {
		// Two ways to recognise our rooms: the `app.queercurves.marker`
		// state event we set in initial_state, or any decrypted snapshot
		// in the timeline. We accept either because matrix-js-sdk doesn't
		// always have all state events in currentState immediately after
		// /sync delivers a brand-new room — relying on the marker alone
		// hides freshly-restored rooms from a second device until the next
		// state push lands.
		const marker = markerOf(room);
		// Share rooms we created are projection fan-out targets, not graphs:
		// the graph itself lives in the primary room. Viewers (who are not
		// the creator) DO see their share room as the graph — it's the only
		// copy they have.
		if (marker?.variant && roomCreator(room) === me) continue;
		const graph = findLatestGraph(room.getLiveTimeline().getEvents(), roomCreator(room));
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
	const graph = findLatestGraph(room.getLiveTimeline().getEvents(), roomCreator(room));
	if (!graph) return undefined;
	return { ...graph, id: room.roomId };
}

export async function saveMatrixGraph(graph: Graph): Promise<Graph> {
	const client = requireClient();
	const existing = graph.id ? client.getRoom(graph.id) : null;
	if (existing) {
		await scrubRoomName(client, existing.roomId);
		// Defensive: if this id is a share room (it shouldn't be — owners
		// edit via the primary room), never write the raw graph into it.
		const marker = markerOf(existing);
		if (marker?.variant) {
			await sendCustomEvent(
				client,
				existing.roomId,
				SNAPSHOT_EVENT,
				projectGraphForGrant(graph, marker.variant)
			);
			return { ...graph, id: existing.roomId };
		}
		await sendCustomEvent(client, existing.roomId, SNAPSHOT_EVENT, graph);
		await fanOutToShareRooms(client, { ...graph, id: existing.roomId });
		return { ...graph, id: existing.roomId };
	}
	// New graph — provision a Matrix room for it.
	const res = await client.createRoom(
		graphRoomCreateOptions() as unknown as Parameters<typeof client.createRoom>[0]
	);
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

/** Share rooms this account created for a given primary graph room. */
function shareRoomsOf(
	client: ReturnType<typeof requireClient>,
	graphId: string
): { roomId: string; grant: ShareGrant }[] {
	const me = client.getUserId();
	const out: { roomId: string; grant: ShareGrant }[] = [];
	for (const room of client.getRooms()) {
		const marker = markerOf(room);
		if (!marker?.variant || marker.parent !== graphId) continue;
		if (roomCreator(room) !== me) continue;
		const myMembership = me ? room.getMember(me)?.membership : undefined;
		if (myMembership !== 'join') continue;
		out.push({ roomId: room.roomId, grant: marker.variant });
	}
	return out;
}

/**
 * Push the freshest projection of `graph` into each of its share rooms.
 * Best-effort per room: one unreachable share room must not fail the
 * owner's save — the primary snapshot (already sent) is the data.
 */
async function fanOutToShareRooms(
	client: ReturnType<typeof requireClient>,
	graph: Graph
): Promise<void> {
	for (const share of shareRoomsOf(client, graph.id)) {
		try {
			await sendCustomEvent(
				client,
				share.roomId,
				SNAPSHOT_EVENT,
				projectGraphForGrant(graph, share.grant)
			);
		} catch (e) {
			console.warn('[qc.matrix] share-room fan-out failed for', share.roomId, e);
		}
	}
}

/**
 * Find or create the share room for (graph, grant), returning its room id.
 * New shares never put a viewer in the primary room: the primary carries the
 * full graph including pending consent links, and megolm has no per-member
 * granularity inside one room — the room IS the grant boundary.
 */
export async function ensureShareRoom(graphId: string, grant: ShareGrant): Promise<string> {
	const client = requireClient();
	const existing = shareRoomsOf(client, graphId).find((s) => s.grant === grant);
	if (existing) return existing.roomId;
	const primary = client.getRoom(graphId);
	if (!primary) throw new Error('Graph room not found');
	const graph = findLatestGraph(primary.getLiveTimeline().getEvents(), roomCreator(primary));
	if (!graph) throw new Error('No readable snapshot to share yet — save the graph first.');
	const res = await client.createRoom(
		graphRoomCreateOptions({ kind: grant, parent: graphId }) as unknown as Parameters<
			typeof client.createRoom
		>[0]
	);
	const roomId = res.room_id;
	await waitForEncryption(client, roomId, 10000);
	await sendCustomEvent(
		client,
		roomId,
		SNAPSHOT_EVENT,
		projectGraphForGrant({ ...graph, id: graphId }, grant)
	);
	return roomId;
}

/**
 * Clear `m.room.name` on a graph room we own.
 *
 * Rooms created before the room-name fix carry the user's graph title in
 * unencrypted room state, where the homeserver (and every federated peer of
 * every member) can read it. Deleting the event server-side is not possible,
 * but overwriting the state with an empty name stops it being the *current*
 * value — a homeserver that didn't already log the old value no longer has
 * it. The leak of anything already recorded is not recoverable; that is
 * called out in `SECURITY_PLAN.md` §3.1.
 *
 * Best-effort and silent: a viewer (power level 0) cannot set room state, and
 * failing here must never block the user's save.
 */
async function scrubRoomName(
	client: ReturnType<typeof requireClient>,
	roomId: string
): Promise<void> {
	const room = client.getRoom(roomId);
	if (!room) return;
	const nameEvent = room.currentState.getStateEvents('m.room.name', '');
	if (!nameEvent) return;
	const ev = Array.isArray(nameEvent) ? nameEvent[0] : nameEvent;
	const current = (ev?.getContent() as { name?: string } | undefined)?.name;
	if (!current) return;
	if (matrixGraphCreator(roomId) !== client.getUserId()) return;
	try {
		await client.setRoomName(roomId, '');
	} catch (e) {
		console.warn('[qc.matrix] could not clear plaintext room name for', roomId, e);
	}
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
	// Share rooms first, then the primary: each gets the same
	// tombstone → kick everyone → leave sequence.
	for (const share of shareRoomsOf(client, id)) {
		await tombstoneKickAndLeave(client, share.roomId);
	}
	await tombstoneKickAndLeave(client, id);
}

async function tombstoneKickAndLeave(
	client: ReturnType<typeof requireClient>,
	id: string
): Promise<void> {
	const room = client.getRoom(id);
	if (!room) return;
	// Best-effort tombstone so any other members see the deletion before we
	// leave; failures here aren't fatal because we still leave the room.
	try {
		await sendCustomEvent(client, room.roomId, TOMBSTONE_EVENT, { reason: 'deleted' });
	} catch {
		// ignore
	}
	// Kick every other member BEFORE leaving (`sharing_model.md` §10.3,
	// SECURITY_PLAN.md S5). Order matters twice over: the tombstone above is
	// sent while viewers are still joined, so their clients can decrypt it;
	// and once the owner leaves, nobody with power remains to kick anyone —
	// viewers would be stranded in an unmoderated room, holding keys, some of
	// them rendering a graph the owner believes deleted. The kick also makes
	// the SDK rotate the megolm session, so nothing sent later is readable to
	// them. Honest caveat: none of this retracts what a viewer already
	// decrypted (§10.2) — deletion stops the future, not the past.
	const me = client.getUserId();
	for (const member of room.currentState.getMembers()) {
		if (member.userId === me) continue;
		if (member.membership !== 'join' && member.membership !== 'invite') continue;
		try {
			await client.kick(room.roomId, member.userId, 'graph deleted by owner');
		} catch (e) {
			console.warn('[qc.matrix] delete: could not kick', member.userId, e);
		}
	}
	try {
		await client.leave(room.roomId);
	} catch {
		// ignore — graph may already be gone server-side
	}
}

/**
 * Hard revocation (`sharing_model.md` §10.2): kick one member out of a graph
 * room. The homeserver-side effect is immediate (they stop receiving events);
 * the crypto effect lands on the next send, when the SDK notices the
 * membership change and rotates the room's megolm session — so everything
 * published after the kick is unreadable to them. What they already decrypted
 * stays theirs; the UI copy must say so rather than implying otherwise.
 *
 * Soft revocation (§10.1) has no code path on purpose: it is "stop updating
 * the graph", which is the absence of sends, not an API call.
 */
export async function revokeMatrixGraphAccess(graphId: string, userId: string): Promise<void> {
	const client = requireClient();
	if (userId === client.getUserId()) {
		throw new Error("You can't revoke your own access — delete the graph instead.");
	}
	// A member may sit in the primary room (legacy, pre-Stage-2 shares) or
	// in any share room; revoking means kicking them wherever they are.
	const roomIds = [graphId, ...shareRoomsOf(client, graphId).map((s) => s.roomId)];
	let kicked = false;
	for (const roomId of roomIds) {
		const membership = client.getRoom(roomId)?.getMember(userId)?.membership;
		if (membership !== 'join' && membership !== 'invite') continue;
		await client.kick(roomId, userId, 'access revoked by owner');
		kicked = true;
	}
	if (!kicked) throw new Error('That account is not a member of this graph.');
}

export interface GraphMember {
	userId: string;
	displayName: string;
	/** join | invite | leave | ban — straight from m.room.member content. */
	membership: string;
	/**
	 * What this member was granted, derived from which room they're in.
	 * 'owner' is the creator; 'legacy' is a pre-Stage-2 member of the
	 * primary room, who de facto holds full history.
	 */
	grant: 'owner' | ShareGrant | 'legacy';
	/** The room this membership lives in — the kick target for a revoke. */
	roomId: string;
}

/**
 * The creator of the room (the user who originally called createRoom).
 * `m.room.create` events have a `creator` field in their content; even on
 * room versions that drop it from the content, the event's sender is the
 * creator. Returns null if the room (or its create event) isn't known
 * locally yet.
 */
export function matrixGraphCreator(id: string): string | null {
	const client = requireClient();
	const room = client.getRoom(id);
	if (!room) return null;
	return roomCreator(room);
}

/** Same lookup, for callers that already hold the room object. */
export function roomCreator(room: {
	currentState: {
		getStateEvents(
			type: string,
			key: string
		):
			| { getContent(): unknown; getSender(): string | undefined }
			| { getContent(): unknown; getSender(): string | undefined }[]
			| null;
	};
}): string | null {
	const create = room.currentState.getStateEvents('m.room.create', '');
	if (!create) return null;
	const ev = Array.isArray(create) ? create[0] : create;
	if (!ev) return null;
	const content = ev.getContent() as { creator?: string };
	return content.creator ?? ev.getSender() ?? null;
}

export async function listMatrixGraphMembers(id: string): Promise<GraphMember[]> {
	const client = requireClient();
	const primary = client.getRoom(id);
	if (!primary) return [];
	const creator = roomCreator(primary);
	const out: GraphMember[] = [];
	for (const m of primary.currentState.getMembers()) {
		out.push({
			userId: m.userId,
			displayName: m.name ?? m.userId,
			membership: m.membership ?? 'leave',
			grant: m.userId === creator ? 'owner' : 'legacy',
			roomId: id
		});
	}
	for (const share of shareRoomsOf(client, id)) {
		const room = client.getRoom(share.roomId);
		if (!room) continue;
		for (const m of room.currentState.getMembers()) {
			if (m.userId === creator) continue;
			out.push({
				userId: m.userId,
				displayName: m.name ?? m.userId,
				membership: m.membership ?? 'leave',
				grant: share.grant,
				roomId: share.roomId
			});
		}
	}
	return out;
}

/**
 * Invite a Matrix user (`@bob:server`) to a graph room. Megolm session keys
 * are shared automatically by the SDK once the invitee joins, so they can
 * read everything from their join point forward; older messages stay
 * unreadable to them unless the inviter explicitly shares history via key
 * backup or device-to-device key forwarding (sharing_model.md §7).
 */
export async function inviteToMatrixGraph(
	graphId: string,
	userId: string,
	grant: ShareGrant = 'current'
): Promise<void> {
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
	const shareRoomId = await ensureShareRoom(graphId, grant);
	// Changing someone's grant means changing which room they're in: kick
	// them out of any *other* share room of this graph first, so they never
	// hold two copies at different grants.
	for (const share of shareRoomsOf(client, graphId)) {
		if (share.roomId === shareRoomId) continue;
		const room = client.getRoom(share.roomId);
		const membership = room?.getMember(trimmed)?.membership;
		if (membership === 'join' || membership === 'invite') {
			await client.kick(share.roomId, trimmed, 'grant changed by owner');
		}
	}
	await client.invite(shareRoomId, trimmed);
}

/**
 * Pending invites to OUR rooms — graphs other users invited this account to.
 * There is deliberately no room name here: graph rooms don't have one
 * (SECURITY_PLAN.md S1), and anything that does have one is filtered out
 * before it reaches this list. The inviter is the only identity the user
 * has to decide on.
 */
export interface PendingInvite {
	roomId: string;
	invitedBy: string | null;
}

/**
 * What we can tell about an invited room before joining it. Invited users
 * only receive stripped state (create, join_rules, name, avatar, encryption,
 * the two members) — never our custom marker — so this is the whole basis
 * for pre-join filtering.
 */
export interface StrippedInviteSummary {
	hasName: boolean;
	isEncrypted: boolean;
	/** null when join_rules didn't arrive in the stripped state. */
	joinRule: string | null;
}

/**
 * Pre-join plausibility filter for invites (`SECURITY_PLAN.md` S8). Graph
 * rooms are E2EE from creation, carry no `m.room.name` (S1), and are
 * invite-only — so anything named, unencrypted, or joinable without an
 * invite is not one of ours and doesn't belong in the graph list, where a
 * crafted invite could otherwise phish an accept (T15). A missing
 * join_rules event is tolerated (stripped state isn't guaranteed complete);
 * a missing encryption event is not, because joining an unencrypted room is
 * the failure mode this filter exists to prevent.
 */
export function isPlausibleGraphInvite(s: StrippedInviteSummary): boolean {
	if (s.hasName) return false;
	if (!s.isEncrypted) return false;
	if (s.joinRule !== null && s.joinRule !== 'invite') return false;
	return true;
}

export async function listPendingMatrixInvites(): Promise<PendingInvite[]> {
	const client = requireClient();
	const userId = client.getUserId();
	if (!userId) return [];
	const out: PendingInvite[] = [];
	for (const room of client.getRooms()) {
		const me = room.getMember(userId);
		if (!me || me.membership !== 'invite') continue;
		const nameEv = room.currentState.getStateEvents('m.room.name', '');
		const name = nameEv
			? ((Array.isArray(nameEv) ? nameEv[0] : nameEv)?.getContent() as { name?: string })?.name
			: undefined;
		const joinRulesEv = room.currentState.getStateEvents('m.room.join_rules', '');
		const joinRule = joinRulesEv
			? ((
					(Array.isArray(joinRulesEv) ? joinRulesEv[0] : joinRulesEv)?.getContent() as {
						join_rule?: string;
					}
				)?.join_rule ?? null)
			: null;
		if (
			!isPlausibleGraphInvite({
				hasName: Boolean(name),
				isEncrypted: room.hasEncryptionStateEvent(),
				joinRule
			})
		) {
			continue;
		}
		out.push({
			roomId: room.roomId,
			invitedBy: me.events.member?.getSender() ?? null
		});
	}
	return out;
}

/**
 * Join an invited room, then verify it actually is a graph room. The
 * `app.queercurves.marker` state event is only visible post-join, so this is
 * the second half of the S8 filter: if no marker shows up within the
 * timeout, leave again and tell the user — never leave the account joined to
 * an arbitrary room something invited it to.
 */
export async function acceptMatrixInvite(roomId: string): Promise<void> {
	const client = requireClient();
	await client.joinRoom(roomId);
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) {
		const room = client.getRoom(roomId);
		if (room?.currentState.getStateEvents(MARKER_EVENT, '')) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	try {
		await client.leave(roomId);
	} catch {
		// leaving is best-effort; the error below is the part that matters
	}
	throw new Error(
		"That invite wasn't a queer-curves graph, so it was declined. If someone did share a graph with you, ask them to re-invite you."
	);
}

export async function declineMatrixInvite(roomId: string): Promise<void> {
	const client = requireClient();
	await client.leave(roomId);
}

// ─── Weekly heartbeat (SECURITY_PLAN.md S7, sharing_model.md §6.3) ─────────
//
// Every write is event-driven, so the homeserver reads activity timing
// straight off the timeline — for an occurrence graph, that's the log times
// of the thing being counted. An unconditional periodic re-send flattens
// "did anything change this week" to a constant yes. Honest limits: it adds
// noise, it does not remove the real writes; per-write timing is only truly
// hidden by batching/coarse timestamps (THREATS.md §9, scoped v1.x).

export const HEARTBEAT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Newest timestamp of anything that could be one of our app events. Counts
 * still-encrypted events too (`m.room.encrypted` is what an app event looks
 * like before/without decryption): timing is metadata, and a heartbeat
 * decision must not depend on whether decryption has caught up.
 */
export function latestAppEventTs(events: readonly SnapshotScanEvent[]): number | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const type = events[i].getType();
		if (type === SNAPSHOT_EVENT || type === TOMBSTONE_EVENT || type === 'm.room.encrypted') {
			return events[i].getTs();
		}
	}
	return null;
}

/** Pure decision: re-send only when there is something to re-send and it's stale. */
export function needsHeartbeat(
	latestTs: number | null,
	now: number,
	maxAgeMs: number = HEARTBEAT_MAX_AGE_MS
): boolean {
	return latestTs !== null && now - latestTs > maxAgeMs;
}

/**
 * Re-send a stale room's latest content. Called once per app open, after
 * sync has settled. Best-effort per room; two of the owner's devices doing
 * this concurrently just produces a duplicate snapshot, which
 * findLatestGraph tolerates by construction.
 */
export async function sendHeartbeats(now: number = Date.now()): Promise<number> {
	const client = requireClient();
	const me = client.getUserId();
	let sent = 0;
	for (const room of client.getRooms()) {
		const marker = markerOf(room);
		if (!marker) continue;
		if (roomCreator(room) !== me) continue;
		if (me && room.getMember(me)?.membership !== 'join') continue;
		if (!needsHeartbeat(latestAppEventTs(room.getLiveTimeline().getEvents()), now)) continue;
		try {
			if (marker.variant && marker.parent) {
				// Re-project from the primary so the share room heartbeat also
				// heals any missed fan-out.
				const primary = client.getRoom(marker.parent);
				const graph = primary
					? findLatestGraph(primary.getLiveTimeline().getEvents(), roomCreator(primary))
					: null;
				if (!graph) continue;
				await sendCustomEvent(
					client,
					room.roomId,
					SNAPSHOT_EVENT,
					projectGraphForGrant({ ...graph, id: marker.parent }, marker.variant)
				);
			} else {
				const graph = findLatestGraph(room.getLiveTimeline().getEvents(), me);
				if (!graph) continue;
				await sendCustomEvent(client, room.roomId, SNAPSHOT_EVENT, {
					...graph,
					id: room.roomId
				});
			}
			sent++;
		} catch (e) {
			console.warn('[qc.matrix] heartbeat failed for', room.roomId, e);
		}
	}
	return sent;
}
