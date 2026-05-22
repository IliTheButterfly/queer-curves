import { error } from '@sveltejs/kit';
import { getUserGraph } from '$lib/store/graphs.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const graph = await getUserGraph(params.id);
	if (!graph) {
		// Editing fixtures isn't supported; only user graphs (localStorage- or
		// Matrix-backed) are mutable. The detail page already gates the Edit
		// affordance.
		error(404, `No editable graph with id "${params.id}"`);
	}
	return { graph };
};
