// Per-grant projections of a graph (SECURITY_PLAN.md S4, Stage 2).
//
// The v1 protocol resends the whole Graph on every change, and the whole
// graph contains every datapoint ever recorded — so before this module
// existed, "view current" was a fiction: every viewer received full history
// in the newest event. A snapshot sent to a shared room must therefore be a
// *projection* of the graph for that room's grant, never the graph itself.
//
// Megolm encrypts per room, so a grant level is enforced by which room a
// viewer is in (one variant room per grant — sharing_model.md §2.1's
// "one room per (graph × audience)"). This module decides what each of
// those rooms is allowed to contain. It is deliberately pure: a projection
// bug is a silent data leak, and these functions carry the highest-value
// tests in the repo.
//
// What "current" means, per family (SECURITY_PLAN.md §3 S4):
//  - spectrum:   only the newest datapoint — the position, not the journey.
//  - occurrence: per-counter totals over each counter's own interval, with
//                the per-entry log collapsed to ONE synthetic entry stamped
//                at the interval's start. THREATS.md §11 is sharpest here: a
//                viewer with the raw log can reconstruct binges and dose
//                schedules; a viewer with "6 units this week" cannot.
//  - network:    unchanged nodes/edges (a network has no history dimension).
//  - pronouns:   the card as it stands (nothing historical to strip).
//
// Both grants — including full history — strip unconfirmed subject_ref
// links from network graphs: sharing_model.md §12 forbids publishing an
// unconsented claim about a real account to any non-owner viewer. The
// owner's own (primary) room is the only room that carries pending links,
// which is why the primary room must never contain non-owner members for
// new shares.

import type { Graph, Occurrence, OccurrenceGraph, SpectrumGraph } from '$lib/types.js';
import { redactPendingLinks } from '$lib/graphs/network/privacy.js';
import { bucketStart, dayStartHourOf, intervalOf } from '$lib/graphs/occurrence/aggregate.js';

/**
 * What a share grants. 'history' is the whole record; 'current' is the
 * present state only. There is deliberately no 'edit' here — the editor role
 * is an open design question (SECURITY_PLAN.md §7 Q3) and under E2EE it
 * would be convention, not enforcement (§4.3).
 */
export type ShareGrant = 'current' | 'history';

function currentSpectrum(graph: SpectrumGraph): SpectrumGraph {
	if (graph.datapoints.length === 0) return { ...graph, datapoints: [] };
	let latest = graph.datapoints[0];
	for (const dp of graph.datapoints) {
		if (dp.timestamp > latest.timestamp) latest = dp;
	}
	return { ...graph, datapoints: [latest] };
}

function currentOccurrence(graph: OccurrenceGraph, now: Date): OccurrenceGraph {
	const dayStartHour = dayStartHourOf(graph);
	const occurrences: Occurrence[] = [];
	for (const counter of graph.schema.counters) {
		const interval = intervalOf(counter);
		// The window the counter's own headline number covers. 'lifetime'
		// has no boundary; everything counts.
		const windowStart = interval === 'lifetime' ? null : bucketStart(now, interval, dayStartHour);
		let total = 0;
		let any = false;
		for (const o of graph.occurrences) {
			if (o.counter_id !== counter.id) continue;
			if (windowStart !== null && new Date(o.timestamp).getTime() < windowStart.getTime()) {
				continue;
			}
			total += Number.isFinite(o.amount) ? o.amount : 0;
			any = true;
		}
		if (!any) continue;
		// One synthetic entry per counter. Its timestamp is the window start
		// (or the day start for lifetime counters) — a boundary the viewer
		// could compute anyway — so no real log time survives. Notes and tags
		// never survive either.
		const stamp = windowStart ?? bucketStart(now, 'day', dayStartHour);
		occurrences.push({
			id: `proj_${counter.id}`,
			counter_id: counter.id,
			timestamp: stamp.toISOString(),
			amount: total
		});
	}
	return { ...graph, occurrences };
}

/**
 * The snapshot content for a room carrying `grant`. Pass `now` explicitly in
 * tests; the default is only for call sites at the moment of a send.
 *
 * The returned graph carries `projection: { grant: 'current' }` when it is
 * a current-only view, so a viewer's client can say honestly that history
 * is not being shared with them (THREATS.md §7 rule 13). History-grant
 * projections carry no marker — for every family except networks they are
 * the graph itself.
 */
export function projectGraphForGrant(
	graph: Graph,
	grant: ShareGrant,
	now: Date = new Date()
): Graph {
	let out: Graph = graph;
	if (out.type === 'network') out = redactPendingLinks(out);
	if (grant === 'history') {
		// Strip a stale current-only marker if this graph object round-tripped
		// through a variant room at some point.
		if (out.projection) {
			const { projection: _p, ...rest } = out;
			out = rest as Graph;
		}
		return out;
	}
	if (out.type === 'spectrum') out = currentSpectrum(out);
	else if (out.type === 'occurrence') out = currentOccurrence(out, now);
	// network and pronouns: current state IS the graph.
	return { ...out, projection: { grant: 'current' } };
}
