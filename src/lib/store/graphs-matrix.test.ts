import { describe, expect, it } from 'vitest';
import {
	findLatestGraph,
	MARKER_EVENT,
	SNAPSHOT_EVENT,
	TOMBSTONE_EVENT,
	type SnapshotScanEvent
} from './graphs-matrix.js';
import { acefluxFixture } from '../fixtures.js';
import type { SpectrumGraph } from '../types.js';

function event(opts: {
	type: string;
	content?: unknown;
	decryptionFailure?: boolean;
}): SnapshotScanEvent {
	return {
		getType: () => opts.type,
		getContent: () => opts.content ?? {},
		isDecryptionFailure: () => opts.decryptionFailure ?? false
	};
}

function snapshot(graph: SpectrumGraph): SnapshotScanEvent {
	return event({ type: SNAPSHOT_EVENT, content: graph });
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
});
