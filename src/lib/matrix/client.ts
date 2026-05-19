// matrix-js-sdk wrapper. The SDK is imported dynamically so its ~1MB bundle
// (and crypto WASM) only loads when the user actually logs in.
//
// The current shape is just enough to prove the auth/session round-trip:
// login, register, restore from saved session, logout. Sync is started with
// minimal coverage (we don't have rooms yet, and sharing_model.md §1's
// pull-on-app-open model wants to drive sync explicitly later). Crypto setup
// (cross-signing, key backup) is deferred to a follow-up since it's a
// substantial chunk on its own.

import type { MatrixClient } from 'matrix-js-sdk';
import { clearSession, loadSession, saveSession, type MatrixSession } from './session.js';

let _client: MatrixClient | null = null;

export function getClient(): MatrixClient | null {
	return _client;
}

/** Loaded matrix-js-sdk module, cached so subsequent calls don't re-import. */
let _sdkPromise: Promise<typeof import('matrix-js-sdk')> | null = null;
function loadSdk() {
	if (!_sdkPromise) _sdkPromise = import('matrix-js-sdk');
	return _sdkPromise;
}

export interface LoginOptions {
	baseUrl: string;
	username: string;
	password: string;
}

export async function login(opts: LoginOptions): Promise<MatrixSession> {
	const sdk = await loadSdk();
	const tmp = sdk.createClient({ baseUrl: opts.baseUrl });
	const res = await tmp.login('m.login.password', {
		identifier: { type: 'm.id.user', user: opts.username },
		password: opts.password,
		initial_device_display_name: 'queer-curves (web)'
	});
	const session: MatrixSession = {
		baseUrl: opts.baseUrl,
		userId: res.user_id,
		accessToken: res.access_token,
		deviceId: res.device_id
	};
	saveSession(session);
	await startClient(session);
	return session;
}

export async function register(opts: LoginOptions): Promise<MatrixSession> {
	const sdk = await loadSdk();
	const tmp = sdk.createClient({ baseUrl: opts.baseUrl });
	// The dummy auth flow is what Synapse exposes when registration is open
	// (`enable_registration_without_verification: true` in the dev compose).
	// Production homeservers will require richer auth (recaptcha, terms,
	// email verification) — handling that interactively is a later concern.
	const res = await tmp.registerRequest({
		username: opts.username,
		password: opts.password,
		auth: { type: 'm.login.dummy' },
		initial_device_display_name: 'queer-curves (web)'
	});
	if (!res.user_id || !res.access_token || !res.device_id) {
		throw new Error('Registration succeeded but the homeserver did not return a session');
	}
	const session: MatrixSession = {
		baseUrl: opts.baseUrl,
		userId: res.user_id,
		accessToken: res.access_token,
		deviceId: res.device_id
	};
	saveSession(session);
	await startClient(session);
	return session;
}

export async function restoreSession(): Promise<MatrixSession | null> {
	const session = loadSession();
	if (!session) return null;
	try {
		await startClient(session);
		// Verify the access token still works. /whoami is the canonical
		// cheap check — if it 401s, the session is dead.
		await _client!.whoami();
		return session;
	} catch {
		await teardownClient();
		clearSession();
		return null;
	}
}

export async function logout(): Promise<void> {
	if (_client) {
		try {
			await _client.logout(true);
		} catch {
			// Best-effort — if the homeserver is unreachable we still clear
			// the local session.
		}
	}
	await teardownClient();
	clearSession();
}

async function startClient(session: MatrixSession): Promise<void> {
	if (_client) await teardownClient();
	const sdk = await loadSdk();
	_client = sdk.createClient({
		baseUrl: session.baseUrl,
		userId: session.userId,
		accessToken: session.accessToken,
		deviceId: session.deviceId,
		useAuthorizationHeader: true
	});
	// Minimal sync — we don't have rooms yet, and pull-on-open will drive
	// sync explicitly in follow-up work.
	await _client.startClient({ initialSyncLimit: 0 });
}

async function teardownClient(): Promise<void> {
	if (!_client) return;
	try {
		_client.stopClient();
	} catch {
		// no-op
	}
	_client = null;
}
