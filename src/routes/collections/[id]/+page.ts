import type { PageLoad } from './$types';

// Collections always resolve asynchronously — even a localStorage one has to
// wait for matrixStore hydration before the store knows which backend to
// read, and its members may be Matrix rooms that haven't synced yet. So the
// loader just hands the id through and the page does the reactive fetch,
// same as /graphs/[id].
export const load: PageLoad = ({ params }) => {
	return { collectionId: params.id };
};
