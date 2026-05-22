import { fixtures } from '$lib';
import type { PageLoad } from './$types';

// Only resolve the bits we can resolve synchronously — fixtures are bundled
// and always known. For user-created graphs (localStorage or Matrix), the
// page does its own reactive fetch so it can render a "Loading…" state
// instead of blocking on hydration + sync.
export const load: PageLoad = ({ params }) => {
	const fixture = fixtures.allFixtures.find((g) => g.id === params.id);
	if (fixture) {
		return { graph: fixture, isUserGraph: false, pendingId: null as string | null };
	}
	return { graph: null, isUserGraph: true, pendingId: params.id };
};
