import { describe, expect, it } from 'vitest';
import {
	decryptContactsPayload,
	encryptContactsPayload,
	friendLinkFor,
	newContact,
	parseFriendInput,
	type ContactsPayload
} from './contacts.js';

describe('parseFriendInput', () => {
	it('accepts a raw Matrix id', () => {
		expect(parseFriendInput('@alice:example.org')).toBe('@alice:example.org');
		expect(parseFriendInput('  @alice:example.org \n')).toBe('@alice:example.org');
	});

	it('accepts a matrix.to friend link, URL-encoded or not', () => {
		expect(parseFriendInput('https://matrix.to/#/@alice:example.org')).toBe('@alice:example.org');
		expect(parseFriendInput('https://matrix.to/#/%40alice%3Aexample.org')).toBe(
			'@alice:example.org'
		);
	});

	it('tolerates a missing @', () => {
		expect(parseFriendInput('alice:example.org')).toBe('@alice:example.org');
	});

	it('rejects garbage with a human message', () => {
		for (const bad of ['', 'alice', 'https://evil.example/#/@a:b', '@a b:c']) {
			expect(() => parseFriendInput(bad)).toThrow(/friend link or Matrix id/);
		}
	});

	it('round-trips with friendLinkFor', () => {
		expect(parseFriendInput(friendLinkFor('@bea:queer.example'))).toBe('@bea:queer.example');
	});
});

describe('contacts payload crypto', () => {
	const key = new Uint8Array(32).fill(7);
	const payload: ContactsPayload = {
		version: 3,
		contacts: [newContact('@alice:example.org', 'Alice'), newContact('@bea:example.org', 'Bea')]
	};

	it('round-trips', async () => {
		const blob = await encryptContactsPayload(payload, key);
		expect(await decryptContactsPayload(blob, key)).toEqual(payload);
	});

	it('exposes only the version in cleartext — no ids, no names', async () => {
		// §3.2: never sent to the homeserver in plaintext. The blob is what
		// the server stores, so nothing identifying may be readable in it.
		const blob = await encryptContactsPayload(payload, key);
		const stored = JSON.stringify(blob);
		expect(blob.version).toBe(3);
		expect(stored).not.toContain('alice');
		expect(stored).not.toContain('Alice');
		expect(stored).not.toContain('example.org');
	});

	it('fails closed on a wrong key', async () => {
		const blob = await encryptContactsPayload(payload, key);
		await expect(decryptContactsPayload(blob, new Uint8Array(32).fill(8))).rejects.toThrow();
	});

	it('produces a fresh IV per write', async () => {
		const a = await encryptContactsPayload(payload, key);
		const b = await encryptContactsPayload(payload, key);
		expect(a.iv).not.toBe(b.iv);
		expect(a.ciphertext).not.toBe(b.ciphertext);
	});
});
