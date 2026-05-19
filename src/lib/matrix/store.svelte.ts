// Reactive Matrix session state for the UI. Components read `matrixStore.session`
// and re-render when the auth state changes.

import { loadSession, type MatrixSession } from './session.js';

class MatrixStore {
	session = $state<MatrixSession | null>(null);
	/** True once we've attempted to restore a saved session from localStorage. */
	hydrated = $state(false);

	constructor() {
		if (typeof window !== 'undefined') {
			this.session = loadSession();
		}
	}
}

export const matrixStore = new MatrixStore();
