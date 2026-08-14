// Contacts — the owner's private friends list (sharing_model.md §3).
//
// A contact is a local record about someone you share with: their Matrix id
// plus the name YOU call them. Contacts are owner-private (§3.2): they sync
// across the owner's own devices via Matrix account_data, but the homeserver
// must never see them in plaintext — a friends list of people you haven't
// (yet) shared a room with is social-graph metadata the server otherwise
// wouldn't have.
//
// "Encrypted account_data" is implemented here with WebCrypto: the payload
// is AES-256-GCM encrypted under a key derived (HKDF) from the key-backup
// private key, which every provisioned device already holds — first-time
// setup stores it, and a new device gets it from the recovery-key restore
// flow. So exactly the devices that can read the user's graphs can read
// their contacts, with no extra prompt and no new secret to lose.
//
// Multi-device writes are last-write-wins with a version guard (§4.3): each
// payload carries a monotonic version, and a save whose base is older than
// what the server has fails loudly instead of silently clobbering the other
// device's edit.

import type { MatrixClient } from 'matrix-js-sdk';
import { getClient } from './client.js';

export const CONTACTS_EVENT = 'app.queercurves.contacts.v1';

export interface Contact {
	id: string;
	matrix_id: string;
	/** What this person is called in YOUR ui — never sent to them (§3.1). */
	display_name: string;
	note?: string;
	/** Cross-signing verification — surfaced in Stage 3 (SECURITY_PLAN S3). */
	verified: boolean;
	created_at: string;
}

export interface ContactsPayload {
	version: number;
	contacts: Contact[];
}

// ─── Friend links (§3.3) ────────────────────────────────────────────────────
//
// v1 uses matrix.to URLs: QR-friendly, copy-pastable, and understood by the
// wider Matrix ecosystem. A QR code rendering of the same payload is a UI
// addition for later (needs a QR dependency decision — STACK.md §15).

const USER_ID_RE = /^@[^\s:@]+:[^\s@]+$/;

/** The link you hand to a friend so they can add you. */
export function friendLinkFor(userId: string): string {
	return `https://matrix.to/#/${userId}`;
}

/**
 * Accepts whatever a friend pasted — a matrix.to link, a raw @user:server
 * id, or either with stray whitespace — and returns the canonical Matrix id.
 * Throws a user-facing error otherwise.
 */
export function parseFriendInput(input: string): string {
	let s = input.trim();
	const mto = s.match(/^https?:\/\/matrix\.to\/#\/(.+)$/i);
	if (mto) s = decodeURIComponent(mto[1]).trim();
	// Tolerate a missing @ on an otherwise well-formed id.
	if (!s.startsWith('@') && USER_ID_RE.test(`@${s}`)) s = `@${s}`;
	if (!USER_ID_RE.test(s)) {
		throw new Error(
			"That doesn't look like a friend link or Matrix id. Paste the link they sent you, or their id in the form @name:server."
		);
	}
	return s;
}

// ─── Payload crypto (pure given the key bytes; unit-testable) ───────────────

async function contactsAesKey(backupPrivateKey: Uint8Array): Promise<CryptoKey> {
	const hkdfKey = await crypto.subtle.importKey(
		'raw',
		backupPrivateKey as BufferSource,
		'HKDF',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(32),
			info: new TextEncoder().encode('app.queercurves.contacts.v1')
		},
		hkdfKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

function toB64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

function fromB64(s: string): Uint8Array {
	return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export interface EncryptedContactsBlob {
	/** Cleartext copy of payload.version so the LWW guard needs no decrypt. */
	version: number;
	iv: string;
	ciphertext: string;
}

export async function encryptContactsPayload(
	payload: ContactsPayload,
	backupPrivateKey: Uint8Array
): Promise<EncryptedContactsBlob> {
	const key = await contactsAesKey(backupPrivateKey);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const plaintext = new TextEncoder().encode(JSON.stringify(payload));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
	);
	return { version: payload.version, iv: toB64(iv), ciphertext: toB64(ciphertext) };
}

export async function decryptContactsPayload(
	blob: EncryptedContactsBlob,
	backupPrivateKey: Uint8Array
): Promise<ContactsPayload> {
	const key = await contactsAesKey(backupPrivateKey);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: fromB64(blob.iv) as BufferSource },
		key,
		fromB64(blob.ciphertext) as BufferSource
	);
	const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as ContactsPayload;
	if (!parsed || !Array.isArray(parsed.contacts)) throw new Error('Malformed contacts payload');
	return parsed;
}

// ─── Account-data plumbing ──────────────────────────────────────────────────

function requireClient(): MatrixClient {
	const client = getClient();
	if (!client) throw new Error('Matrix client not available');
	return client;
}

async function backupKeyOrThrow(client: MatrixClient): Promise<Uint8Array> {
	const crypto_ = client.getCrypto();
	if (!crypto_) throw new Error('Encryption is not ready on this device.');
	const key = await crypto_.getSessionBackupPrivateKey();
	if (!key) {
		throw new Error(
			'This device has no encryption keys yet — finish key setup (or restore from your recovery key) first.'
		);
	}
	return key;
}

function remoteBlob(client: MatrixClient): EncryptedContactsBlob | null {
	const ev = client.getAccountData(CONTACTS_EVENT as never);
	if (!ev) return null;
	const content = ev.getContent() as Partial<EncryptedContactsBlob>;
	if (typeof content.iv !== 'string' || typeof content.ciphertext !== 'string') return null;
	return {
		version: typeof content.version === 'number' ? content.version : 0,
		iv: content.iv,
		ciphertext: content.ciphertext
	};
}

/** The full payload, or an empty version-0 book if none exists yet. */
export async function loadContacts(): Promise<ContactsPayload> {
	const client = requireClient();
	const blob = remoteBlob(client);
	if (!blob) return { version: 0, contacts: [] };
	return decryptContactsPayload(blob, await backupKeyOrThrow(client));
}

/**
 * Persist a new contact list. `baseVersion` is the version of the payload
 * the edit was made against — if another device has written a newer one in
 * the meantime, this throws instead of clobbering it (§4.3).
 */
export async function saveContacts(
	contacts: Contact[],
	baseVersion: number
): Promise<ContactsPayload> {
	const client = requireClient();
	const remote = remoteBlob(client);
	if (remote && remote.version > baseVersion) {
		throw new Error(
			'Your friends list was changed on another device — reload this page and redo the edit.'
		);
	}
	const payload: ContactsPayload = { version: baseVersion + 1, contacts };
	const blob = await encryptContactsPayload(payload, await backupKeyOrThrow(client));
	await client.setAccountData(CONTACTS_EVENT as never, blob as never);
	return payload;
}

export function newContact(matrixId: string, displayName: string): Contact {
	return {
		id: `c_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
		matrix_id: matrixId,
		display_name: displayName.trim() || matrixId,
		verified: false,
		created_at: new Date().toISOString()
	};
}
