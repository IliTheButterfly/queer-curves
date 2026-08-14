// Name privacy for network graphs.
//
// A polycule drawn on screen names real people. The most common harm in
// practice is T3 (screenshots/receipts) and T6 (non-consensual naming) —
// so the chart masks everyone's name *except your own* by default, and
// only reveals them while the viewer physically holds a button down.
//
// This module is deliberately pure: no Svelte, no cytoscape, no DOM. The
// chart and the export path both derive their labels from here so a
// masked view and an exported PNG can never disagree about who is who.

import type { NetworkGraph, NetworkNode, UserRef } from '$lib/types.js';

// What a node is called when names are hidden: nothing at all. An earlier
// version numbered them ("Person 1", "Person 2") to keep the graph
// discussable, but a positional pseudonym is still a handle — it survives a
// screenshot, and it lets someone reason about "who is Person 2" out loud.
// Hidden means hidden; the shape of the network is the only thing on screen.
export const HIDDEN_MASK = '';

// You are the exception, and are marked as such rather than named — without
// it you can't tell which dot you are.
export const SELF_MASK = 'You';

// Is this node the viewer themselves? Two ways to be self: the owner
// explicitly ticked "this is me" on the node, or the node is linked to the
// Matrix account currently signed in.
export function isSelfNode(node: NetworkNode, selfUserId?: UserRef | null): boolean {
	if (node.is_self) return true;
	return Boolean(selfUserId && node.subject_ref && node.subject_ref === selfUserId);
}

// Masked label for every node, keyed by node id. Self keeps a marker
// ("You"); everyone else gets nothing.
export function maskedLabels(
	graph: NetworkGraph,
	selfUserId?: UserRef | null
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const node of graph.nodes) {
		out[node.id] = isSelfNode(node, selfUserId) ? SELF_MASK : HIDDEN_MASK;
	}
	return out;
}

// The label a node should render with, given whether names are revealed.
// A node with no name of its own renders blank either way — there's nothing
// to hide and nothing to show.
export function displayLabels(
	graph: NetworkGraph,
	opts: { reveal: boolean; selfUserId?: UserRef | null }
): Record<string, string> {
	const masked = maskedLabels(graph, opts.selfUserId);
	if (!opts.reveal) return masked;
	const out: Record<string, string> = {};
	for (const node of graph.nodes) {
		out[node.id] = node.label.trim() || masked[node.id];
	}
	return out;
}

// Does this graph have anything worth hiding? A network of just you (or of
// nodes with no names at all) doesn't need the hold-to-reveal affordance.
export function hasHideableNames(graph: NetworkGraph, selfUserId?: UserRef | null): boolean {
	return graph.nodes.some((n) => !isSelfNode(n, selfUserId) && n.label.trim().length > 0);
}

// Everyone whose name would become visible in an export, in render order.
// This is the list the consent dialog shows: you are asked to confirm you
// have permission from each of these people specifically, not in the
// abstract.
export interface NamedMember {
	id: string;
	label: string;
	// True when this node is linked to a real queer-curves account whose
	// owner has *not* confirmed the link. Publishing an image that names
	// them is exactly what the consent handshake exists to prevent
	// (sharing_model.md §12), so the dialog calls these out.
	unconfirmedLink: boolean;
}

export function namedMembers(graph: NetworkGraph, selfUserId?: UserRef | null): NamedMember[] {
	return graph.nodes
		.filter((n) => !isSelfNode(n, selfUserId) && n.label.trim().length > 0)
		.map((n) => ({
			id: n.id,
			label: n.label.trim(),
			unconfirmedLink: Boolean(n.subject_ref) && n.link_status !== 'confirmed'
		}));
}
