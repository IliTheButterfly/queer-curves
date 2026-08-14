// Merging graphs into a new, persisted graph.
//
// Thin wrapper over compose.ts: it supplies the id, timestamp and owner, and
// writes the result through the ordinary graph store so a merge lands in
// whichever backend the session is using. Deliberately non-destructive —
// the sources are neither modified nor deleted, so a merge can always be
// undone by deleting the result.

import type { Graph, UserRef } from '$lib/types.js';
import { generateGraphId, saveUserGraph } from './graphs.js';
import { type ComposeSource, composeGraphs } from './compose.js';

export interface MergeRequest {
	sources: ComposeSource[];
	name: string;
	description?: string;
	owner: UserRef;
}

/**
 * Compose the sources and save the result as a new graph. Returns the saved
 * graph — with its final id, which the Matrix path rewrites to the new room
 * id — so the caller can navigate straight to it.
 */
export async function mergeIntoNewGraph(req: MergeRequest): Promise<Graph> {
	const merged = composeGraphs(req.sources, {
		id: generateGraphId(),
		name: req.name,
		description: req.description,
		owner: req.owner,
		now: new Date().toISOString(),
		// A merge produces one graph the user will go on editing. Freezing
		// per-source colours into every datapoint would make the seam
		// permanent; leave point colours alone and let the palette cycle
		// treat the result as a single series.
		colorBySource: false
	});
	return await saveUserGraph(merged);
}

/** Default name for a merge, e.g. `"my gender" + "Sam's gender"`. */
export function suggestMergeName(sources: ComposeSource[]): string {
	const names = sources.map((s) => s.label ?? s.graph.name);
	if (names.length === 0) return 'Merged graph';
	if (names.length <= 3) return names.map((n) => `"${n}"`).join(' + ');
	return `${names.length} graphs merged`;
}
