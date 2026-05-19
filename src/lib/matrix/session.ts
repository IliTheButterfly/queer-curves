// Session persistence for the Matrix client.
//
// v0 stores the session in plain localStorage. STACK.md §6 mandates
// encrypted-at-rest via WebCrypto with a key derived from the Matrix
// recovery key — that recovery key only exists *after* key-backup setup
// (which can't happen before login completes), so the encrypt-at-rest
// migration is a follow-up. For now: dev-only, treat the host browser as
// the trust boundary.

export interface MatrixSession {
	/** Homeserver base URL (e.g. http://localhost:8008). */
	baseUrl: string;
	/** Canonical `@user:server` id returned by the homeserver. */
	userId: string;
	/** Access token issued by login/register. Treat as a bearer credential. */
	accessToken: string;
	/** Device id issued by the homeserver. Stable across token refreshes. */
	deviceId: string;
}

const STORAGE_KEY = 'queer-curves:matrix-session';

export function loadSession(): MatrixSession | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<MatrixSession>;
		if (
			typeof parsed.baseUrl === 'string' &&
			typeof parsed.userId === 'string' &&
			typeof parsed.accessToken === 'string' &&
			typeof parsed.deviceId === 'string'
		) {
			return parsed as MatrixSession;
		}
		return null;
	} catch {
		return null;
	}
}

export function saveSession(session: MatrixSession): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(STORAGE_KEY);
}
