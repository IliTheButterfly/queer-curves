import { error } from '@sveltejs/kit';
import { fixtures } from '$lib';
import { getUserGraph } from '$lib/store/graphs.js';
import type { PageLoad } from './$types';

// Look in user-created graphs (localStorage) first, then in the bundled
// fixtures. Same shape either way; the page doesn't care which source.
// When Matrix integration lands, the user-graph lookup grows to include
// the homeserver too.
export const load: PageLoad = ({ params }) => {
	const userGraph = getUserGraph(params.id);
	if (userGraph) return { graph: userGraph, isUserGraph: true };

	const fixture = fixtures.allFixtures.find((g) => g.id === params.id);
	if (fixture) return { graph: fixture, isUserGraph: false };

	error(404, `No graph with id "${params.id}"`);
};
