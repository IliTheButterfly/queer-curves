// matrix-js-sdk wrapper. The SDK is imported dynamically so its ~1MB bundle
// (and crypto WASM) only loads when the user actually logs in.
//
// Rust crypto is initialised inside startClient so the client is always
// ready to handle E2EE traffic. Crypto state is persisted in IndexedDB
// (queer-curves-matrix-crypto). For dev this is unencrypted at rest —
// STACK.md §6 wants WebCrypto-keyed at-rest encryption derived from the
// Matrix recovery key, which is a follow-up.

import type { MatrixClient } from 'matrix-js-sdk';
import { clearSession, loadSession, saveSession, type MatrixSession } from './session.js';
import { matrixStore } from './store.svelte.js';

let _client: MatrixClient | null = null;

// Held in memory across login → setup-keys → bootstrap so cross-signing's
// User-Interactive Authentication step can re-auth without prompting the
// user a second time for the same password they just typed. Cleared on
// successful setup, on logout, or when login is followed by anything other
// than the setup flow (page reload, navigation away, etc., per a fresh
// session restore which never sets it).
let _pendingAuthPassword: string | null = null;

// The just-generated secret-storage key, kept in memory for the duration
// of the bootstrap flow. matrix-js-sdk's bootstrapSecretStorage internally
// asks the app for the storage key (via the getSecretStorageKey crypto
// callback) right after creating it — there's no "and-here-it-is" handoff,
// so we cache the bytes ourselves and return them from the callback.
// Cleared once setup completes or anything tears down the client.
let _pendingSecretStorageKey: Uint8Array | null = null;

export function getClient(): MatrixClient | null {
	return _client;
}

export function hasPendingAuthPassword(): boolean {
	return _pendingAuthPassword !== null;
}

export function clearPendingAuthPassword(): void {
	_pendingAuthPassword = null;
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
	_pendingAuthPassword = opts.password;
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
	_pendingAuthPassword = opts.password;
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
	} catch (e) {
		await teardownClient();
		// matrix-js-sdk's rust crypto throws "the account in the store
		// doesn't match the account in the constructor" when the persisted
		// crypto state belongs to a different device id than the saved
		// session. This happens after a server-side data wipe or anything
		// else that gives the same user a new device id. Wipe the crypto
		// store and start over with a clean slate; the saved access token
		// is gone too, since it'd be paired with the old device.
		if (e instanceof Error && /account in the store/i.test(e.message)) {
			await clearCryptoStore();
		}
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
	// The crypto store is keyed to the now-defunct device id. If we left it
	// in place, the next login (which gets a fresh device id) would fail
	// with "account in the store doesn't match".
	await clearCryptoStore();
	_pendingAuthPassword = null;
}

async function clearCryptoStore(): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	// matrix-js-sdk's RUST_SDK_STORE_PREFIX is "matrix-js-sdk" and the rust
	// crypto WASM creates two databases off it. We also nuke any other DBs
	// whose name contains "matrix" so reused devices / older builds don't
	// leak crypto state forward. (indexedDB.databases() is the standardised
	// enumeration API; falling back to the known names if it isn't available
	// in this browser engine.)
	const known = ['matrix-js-sdk::matrix-sdk-crypto', 'matrix-js-sdk::matrix-sdk-crypto-meta'];
	let toDelete = known;
	try {
		const dbs = await indexedDB.databases();
		const names = dbs.map((d) => d.name).filter((n): n is string => !!n);
		toDelete = Array.from(new Set([...known, ...names.filter((n) => /matrix/i.test(n))]));
	} catch {
		// older browsers lacking indexedDB.databases — known list will do
	}
	await Promise.all(
		toDelete.map(
			(name) =>
				new Promise<void>((resolve) => {
					const req = indexedDB.deleteDatabase(name);
					req.onsuccess = req.onerror = req.onblocked = () => resolve();
				})
		)
	);
}

async function startClient(session: MatrixSession): Promise<void> {
	if (_client) await teardownClient();
	const sdk = await loadSdk();
	_client = sdk.createClient({
		baseUrl: session.baseUrl,
		userId: session.userId,
		accessToken: session.accessToken,
		deviceId: session.deviceId,
		useAuthorizationHeader: true,
		cryptoCallbacks: {
			// matrix-js-sdk asks for the secret-storage private key during
			// bootstrap (right after we generate it) and on any later
			// operation that needs to decrypt secrets. For the bootstrap path
			// we hand back the bytes we just cached; for restored sessions
			// the cache is empty and we return null — the caller is expected
			// to prompt the user for their recovery key (a follow-up).
			getSecretStorageKey: async ({ keys }) => {
				if (!_pendingSecretStorageKey) return null;
				const keyId = Object.keys(keys)[0];
				if (!keyId) return null;
				return [keyId, _pendingSecretStorageKey];
			}
		}
	});
	// Bring up Rust crypto with IndexedDB persistence before sync starts —
	// otherwise the client can't decrypt anything and sync events that come
	// through encrypted rooms are silently dropped to a re-decrypt queue.
	await _client.initRustCrypto({ useIndexedDB: true });
	// matrix-js-sdk's default filter sets room.timeline.unread_thread_notifications
	// (MSC3773). Synapse 1.144 (and at least the matrixdotorg/synapse:latest
	// image at the time of writing) drops *all* joined rooms from the initial
	// /sync response when both that flag and MSC4222 use_state_after=true
	// (which the SDK also sends) are present. Override the SDK's default
	// filter with a minimal one so our rooms actually arrive.
	const filter = new sdk.Filter(session.userId);
	filter.setDefinition({ room: { timeline: { limit: 20 } } });
	// startClient resolves before the first /sync completes, so callers that
	// run immediately afterward see an empty room list. Wait for PREPARED.
	const prepared = new Promise<void>((resolve) => {
		const handler = (state: string) => {
			if (state === 'PREPARED' || state === 'ERROR') {
				_client?.off('sync' as never, handler as never);
				resolve();
			}
		};
		_client!.on('sync' as never, handler as never);
	});
	// Bump the rooms epoch on anything that could change the room list or
	// the visible content of a room. PREPARED arrives before all the
	// catch-up /sync round-trips finish, so we can't rely on a one-shot
	// fetch at startup; this gives the UI reactivity instead. Event.decrypted
	// is critical: snapshots are encrypted and a later one may not be
	// readable until its megolm session is delivered via to_device messages,
	// which can land seconds after the timeline event itself.
	const bump = () => {
		matrixStore.roomsEpoch++;
	};
	_client.on('Room' as never, bump as never);
	_client.on('Room.timeline' as never, bump as never);
	_client.on('Room.myMembership' as never, bump as never);
	_client.on('Event.decrypted' as never, bump as never);
	await _client.startClient({ filter });
	await prepared;
}

async function teardownClient(): Promise<void> {
	if (!_client) return;
	try {
		_client.stopClient();
	} catch {
		// no-op
	}
	_client = null;
	_pendingSecretStorageKey = null;
}

// ─── Crypto setup ──────────────────────────────────────────────────────────

export interface CryptoStatus {
	/** True once initRustCrypto has run on the active client. */
	initialised: boolean;
	/** True if cross-signing public keys exist on the server for this user. */
	hasCrossSigning: boolean;
	/** True if a server-side key backup exists. */
	hasKeyBackup: boolean;
	/** True if both are present — the precondition for graph work. */
	ready: boolean;
}

export async function getCryptoStatus(): Promise<CryptoStatus> {
	const empty: CryptoStatus = {
		initialised: false,
		hasCrossSigning: false,
		hasKeyBackup: false,
		ready: false
	};
	if (!_client) return empty;
	const crypto = _client.getCrypto();
	if (!crypto) return empty;
	let hasCrossSigning = false;
	let hasKeyBackup = false;
	try {
		hasCrossSigning = await crypto.userHasCrossSigningKeys();
	} catch {
		// Network or auth hiccup; treat as not set up so we can re-run setup.
	}
	try {
		const backup = await crypto.checkKeyBackupAndEnable();
		hasKeyBackup = backup !== null;
	} catch {
		// Same.
	}
	return {
		initialised: true,
		hasCrossSigning,
		hasKeyBackup,
		ready: hasCrossSigning && hasKeyBackup
	};
}

export interface CryptoSetupResult {
	encodedRecoveryKey: string;
}

/**
 * Run the full first-time crypto setup: cross-signing upload (with UIA),
 * a fresh recovery key, secret storage tied to that key, and a new key
 * backup. Returns the encoded recovery key the user must save somewhere
 * safe — losing it means losing access to any encrypted history.
 *
 * Requires the password to be in memory (set by login() or register()
 * earlier in the same session). If it isn't, the caller should make the
 * user log in again.
 */
export async function setupCrypto(): Promise<CryptoSetupResult> {
	if (!_client) throw new Error('Not logged in');
	const crypto = _client.getCrypto();
	if (!crypto) throw new Error('Crypto not initialised on this client');
	if (!_pendingAuthPassword) {
		throw new Error(
			'Re-authentication is required to set up encryption keys. Log out and back in, then try again.'
		);
	}
	const session = loadSession();
	if (!session) throw new Error('No active session');

	const password = _pendingAuthPassword;

	// 1. Generate a fresh recovery key. The SDK gives us both the raw bytes
	//    (used internally) and the base58-ish encoded form for the user.
	const recoveryKey = await crypto.createRecoveryKeyFromPassphrase();
	// Cache the bytes so the getSecretStorageKey crypto callback can
	// satisfy matrix-js-sdk's internal lookups during bootstrap.
	_pendingSecretStorageKey = recoveryKey.privateKey;

	try {
		// 2. Bootstrap cross-signing. This is the step the server requires
		//    UIA for — we supply the password the user just typed.
		await crypto.bootstrapCrossSigning({
			authUploadDeviceSigningKeys: async (makeRequest) => {
				await makeRequest({
					type: 'm.login.password',
					identifier: { type: 'm.id.user', user: session.userId },
					password
				});
			}
		});

		// 3. Create secret storage tied to the recovery key, then turn on a new
		//    server-side key backup. Both are stored under the same recovery
		//    key so the user only has to remember one thing.
		await crypto.bootstrapSecretStorage({
			createSecretStorageKey: async () => recoveryKey,
			setupNewKeyBackup: true,
			setupNewSecretStorage: true
		});

		_pendingAuthPassword = null;

		return { encodedRecoveryKey: recoveryKey.encodedPrivateKey ?? '' };
	} finally {
		// Drop the cached key — anything that needs it later (multi-device
		// unlock, etc.) will prompt the user to type it in.
		_pendingSecretStorageKey = null;
	}
}
