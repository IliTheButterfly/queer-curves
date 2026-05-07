import { error } from '@sveltejs/kit';
import { findPalette } from '$lib/presets/palettes.js';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const palette = findPalette(params.id);
	if (!palette) {
		error(404, `No palette with id "${params.id}"`);
	}
	return { palette };
};
