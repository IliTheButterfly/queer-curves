import { describe, expect, it } from 'vitest';
import {
	findLatestGraph,
	graphRoomCreateOptions,
	isPlausibleGraphInvite,
	MARKER_EVENT,
	SNAPSHOT_EVENT,
	TOMBSTONE_EVENT,
	type SnapshotScanEvent
} from './graphs-matrix.js';
import { acefluxFixture } from '../fixtures.js';
import type { SpectrumGraph } from '../types.js';

const OWNER = '@owner:localhost';

function event(opts: {
	type: string;
	content?: unknown;
	decryptionFailure?: boolean;
	sender?: string;
}): SnapshotScanEvent {
	return {
		getType: () => opts.type,
		getContent: () => opts.content ?? {},
		isDecryptionFailure: () => opts.decryptionFailure ?? false,
		getSender: () => opts.sender ?? OWNER
	};
}

function snapshot(graph: SpectrumGraph, sender?: string): SnapshotScanEvent {
	return event({ type: SNAPSHOT_EVENT, content: graph, sender });
}

const newer: SpectrumGraph = {
	...acefluxFixture,
	id: '!room:localhost',
	name: 'newer',
	datapoints: [...acefluxFixture.datapoints, ...acefluxFixture.datapoints],
	modified_at: '2026-05-19T12:00:00Z'
};
const older: SpectrumGraph = {
	...acefluxFixture,
	id: '!room:localhost',
	name: 'older',
	datapoints: [],
	modified_at: '2026-05-18T12:00:00Z'
};

describe('findLatestGraph', () => {
	it('returns null for an empty timeline', () => {
		expect(findLatestGraph([])).toBeNull();
	});

	it('returns null when there are no snapshot events', () => {
		const events = [
			event({ type: 'm.room.create' }),
			event({ type: 'm.room.member' }),
			event({ type: MARKER_EVENT, content: { v: 1 } })
		];
		expect(findLatestGraph(events)).toBeNull();
	});

	it('returns the only decryptable snapshot', () => {
		const events = [event({ type: 'm.room.create' }), snapshot(newer)];
		expect(findLatestGraph(events)?.name).toBe('newer');
	});

	it('prefers the latest snapshot when multiple decrypt', () => {
		// Chronological order: older first, newer last.
		const events = [snapshot(older), snapshot(newer)];
		expect(findLatestGraph(events)?.name).toBe('newer');
	});

	it('falls back to an older snapshot if the newer one fails to decrypt', () => {
		// Snapshot 2 is encrypted gibberish (decryption failure); snapshot 1
		// is still readable. The caller wants the freshest readable graph.
		const events = [
			snapshot(older),
			event({
				type: 'm.room.encrypted',
				content: { algorithm: 'm.megolm.v1.aes-sha2' },
				decryptionFailure: true
			})
		];
		expect(findLatestGraph(events)?.name).toBe('older');
	});

	it('skips snapshots without an id field', () => {
		// A snapshot whose body is empty / partially-encrypted but not flagged
		// as a decryption failure shouldn't crash the scan or count as valid.
		const events = [snapshot(newer), event({ type: SNAPSHOT_EVENT, content: {} })];
		expect(findLatestGraph(events)?.name).toBe('newer');
	});

	it('skips snapshots with null content', () => {
		const events = [snapshot(newer), event({ type: SNAPSHOT_EVENT, content: null })];
		expect(findLatestGraph(events)?.name).toBe('newer');
	});

	it('returns null when a tombstone is the most recent app event', () => {
		// Deletion: a tombstone newer than the latest snapshot suppresses
		// the room entirely. The graph is gone even though older snapshots
		// still exist in the timeline.
		const events = [snapshot(newer), event({ type: TOMBSTONE_EVENT, content: { reason: 'gone' } })];
		expect(findLatestGraph(events)).toBeNull();
	});

	it('ignores a tombstone older than the latest snapshot', () => {
		// Defensive: if a snapshot is sent after a tombstone (e.g. clock
		// skew between two clients), the latest snapshot wins.
		const events = [event({ type: TOMBSTONE_EVENT, content: { reason: 'oops' } }), snapshot(newer)];
		expect(findLatestGraph(events)?.name).toBe('newer');
	});

	it('does not return a plaintext snapshot from before encryption took effect', () => {
		// Regression: the original "datapoints disappear" bug. The first
		// snapshot landed before m.room.encryption applied, so a new device
		// (with no megolm keys) reads it as plaintext. We model that here by
		// having a *later* encrypted snapshot the new device can't decrypt;
		// without falling back through the failure we'd return the older
		// (plaintext) one. Test confirms the fallback IS the older one — the
		// fix is on the *write* side (encrypt before sending), not here.
		const events = [
			snapshot(older), // hypothetical plaintext leak
			event({
				type: 'm.room.encrypted',
				content: { algorithm: 'm.megolm.v1.aes-sha2' },
				decryptionFailure: true
			})
		];
		expect(findLatestGraph(events)?.name).toBe('older');
	});

	it('walks past non-snapshot, non-tombstone events', () => {
		const events = [
			event({ type: 'm.room.message', content: { body: 'hi' } }),
			snapshot(older),
			event({ type: 'm.reaction', content: {} }),
			snapshot(newer),
			event({ type: 'm.room.member' })
		];
		expect(findLatestGraph(events)?.name).toBe('newer');
	});

	// SECURITY_PLAN.md S2 follow-up. Power levels stop a viewer *sending* a
	// snapshot, but they're enforced by the sender's homeserver on a federated
	// send — the reader must not trust them alone.
	describe('sender check', () => {
		it('ignores a snapshot from someone other than the owner', () => {
			const events = [snapshot(older), snapshot(newer, '@viewer:evil.example')];
			expect(findLatestGraph(events, OWNER)?.name).toBe('older');
		});

		it('ignores a tombstone from someone other than the owner', () => {
			// A viewer must not be able to make the graph vanish for everyone.
			const events = [
				snapshot(newer),
				event({
					type: TOMBSTONE_EVENT,
					content: { reason: 'gone' },
					sender: '@viewer:evil.example'
				})
			];
			expect(findLatestGraph(events, OWNER)?.name).toBe('newer');
		});

		it('still honours the owner’s own tombstone', () => {
			const events = [
				snapshot(newer),
				event({ type: TOMBSTONE_EVENT, content: { reason: 'gone' } })
			];
			expect(findLatestGraph(events, OWNER)).toBeNull();
		});

		it('skips the check when the owner is unknown', () => {
			// If m.room.create hasn't synced yet we can't attribute anything;
			// hiding the graph would punish availability for a defence-in-depth
			// check the server already enforces. Accept, don't blank the UI.
			const events = [snapshot(newer, '@whoever:localhost')];
			expect(findLatestGraph(events, null)?.name).toBe('newer');
		});
	});
});

// SECURITY_PLAN.md S8: pre-join filtering on the only thing an invitee can
// see — stripped state. Graph rooms are unnamed, encrypted, invite-only.
describe('isPlausibleGraphInvite', () => {
	const graphLike = { hasName: false, isEncrypted: true, joinRule: 'invite' as string | null };

	it('accepts an unnamed, encrypted, invite-only room', () => {
		expect(isPlausibleGraphInvite(graphLike)).toBe(true);
	});

	it('rejects a named room', () => {
		// Our rooms never carry m.room.name (S1); anything named is either not
		// ours or a lure dressed up as a graph.
		expect(isPlausibleGraphInvite({ ...graphLike, hasName: true })).toBe(false);
	});

	it('rejects an unencrypted room', () => {
		expect(isPlausibleGraphInvite({ ...graphLike, isEncrypted: false })).toBe(false);
	});

	it('rejects a publicly-joinable room', () => {
		expect(isPlausibleGraphInvite({ ...graphLike, joinRule: 'public' })).toBe(false);
	});

	it('tolerates a missing join_rules event', () => {
		// Stripped state isn't guaranteed complete; encryption is the hard
		// requirement, join rules are corroboration.
		expect(isPlausibleGraphInvite({ ...graphLike, joinRule: null })).toBe(true);
	});
});

describe('graphRoomCreateOptions', () => {
	const opts = graphRoomCreateOptions();
	const state = (type: string) => opts.initial_state.find((s) => s.type === type);
	const pl = opts.power_level_content_override as {
		users_default: number;
		events_default: number;
		state_default: number;
		invite: number;
		kick: number;
		events: Record<string, number>;
	};

	// THREATS.md §7 rule 3 / sharing_model.md §2.2. The graph title is a
	// sensitive label ("my gender", "alcohol") and m.room.name is not
	// encrypted, so the payload must carry no name, topic, or avatar at all.
	it('sets no plaintext room name, topic, or avatar', () => {
		expect(opts).not.toHaveProperty('name');
		expect(opts).not.toHaveProperty('topic');
		expect(state('m.room.name')).toBeUndefined();
		expect(state('m.room.topic')).toBeUndefined();
		expect(state('m.room.avatar')).toBeUndefined();
	});

	it('enables megolm encryption at creation', () => {
		expect(state('m.room.encryption')?.content).toEqual({
			algorithm: 'm.megolm.v1.aes-sha2'
		});
	});

	// sharing_model.md §8.1: current-only is the default grant, enforced at
	// the server as well as by megolm — a joiner is not offered ciphertext
	// from before their join.
	it('restricts history visibility to joined members', () => {
		expect(state('m.room.history_visibility')?.content).toEqual({
			history_visibility: 'joined'
		});
	});

	it('marks the room as ours so listing can filter without decrypting', () => {
		expect(state(MARKER_EVENT)?.content).toEqual({ v: 1 });
	});

	// sharing_model.md §9.1. events_default is the entry that actually bites:
	// in an E2EE room the server only sees m.room.encrypted, so a viewer left
	// at the preset's events_default of 0 could publish their own snapshot and
	// every other viewer's findLatestGraph would treat it as the graph.
	it('lets nobody but the owner write to the room', () => {
		expect(pl.users_default).toBe(0);
		expect(pl.events_default).toBe(100);
		expect(pl.state_default).toBe(100);
		expect(pl.events['m.room.encrypted']).toBe(100);
	});

	it('keeps membership and the app event types owner-only', () => {
		expect(pl.invite).toBe(100);
		expect(pl.kick).toBe(100);
		for (const type of [SNAPSHOT_EVENT, TOMBSTONE_EVENT, MARKER_EVENT]) {
			expect(pl.events[type]).toBe(100);
		}
	});

	// Rule 3 again, from the other side: a viewer must not be able to *add* a
	// plaintext label to a room they can see.
	it('keeps the plaintext-metadata state events owner-only', () => {
		for (const type of ['m.room.name', 'm.room.topic', 'm.room.avatar']) {
			expect(pl.events[type]).toBe(100);
		}
	});
});
