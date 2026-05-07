import { error } from '@sveltejs/kit';
import { fixtures } from '$lib';
import type { PageLoad } from './$types';

// Fixtures are the data source for now. When Matrix integration lands,
// this load function will fetch from the user's homeserver instead.
export const load: PageLoad = ({ params }) => {
	const graph = fixtures.allFixtures.find((g) => g.id === params.id);
	if (!graph) {
		error(404, `No graph with id "${params.id}"`);
	}
	return { graph };
};
