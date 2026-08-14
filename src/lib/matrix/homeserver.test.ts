import { describe, expect, it } from 'vitest';
import { isLoopbackHost, resolveHomeserver, validateHomeserverUrl } from './homeserver.js';

describe('isLoopbackHost', () => {
	it('accepts localhost and *.localhost', () => {
		expect(isLoopbackHost('localhost')).toBe(true);
		expect(isLoopbackHost('synapse.localhost')).toBe(true);
	});

	it('accepts 127.0.0.0/8 and ::1', () => {
		expect(isLoopbackHost('127.0.0.1')).toBe(true);
		expect(isLoopbackHost('127.42.0.1')).toBe(true);
		expect(isLoopbackHost('::1')).toBe(true);
		expect(isLoopbackHost('[::1]')).toBe(true);
	});

	it('rejects everything else', () => {
		expect(isLoopbackHost('example.org')).toBe(false);
		expect(isLoopbackHost('localhost.example.org')).toBe(false);
		expect(isLoopbackHost('128.0.0.1')).toBe(false);
	});
});

describe('validateHomeserverUrl', () => {
	it('accepts https anywhere', () => {
		expect(validateHomeserverUrl('https://matrix.example.org').href).toBe(
			'https://matrix.example.org/'
		);
	});

	it('assumes https for a bare hostname', () => {
		expect(validateHomeserverUrl('example.org').protocol).toBe('https:');
	});

	// SECURITY_PLAN.md S9: the dev Synapse is plain http on localhost and has
	// to keep working — but ONLY there. Anywhere else, http means the user's
	// password crosses the network unencrypted.
	it('accepts http on loopback hosts', () => {
		expect(validateHomeserverUrl('http://localhost:8008').href).toBe('http://localhost:8008/');
		expect(validateHomeserverUrl('http://127.0.0.1:8008').protocol).toBe('http:');
	});

	it('rejects http on non-loopback hosts', () => {
		expect(() => validateHomeserverUrl('http://matrix.example.org')).toThrow(/unencrypted/);
	});

	it('rejects non-http(s) schemes and garbage', () => {
		expect(() => validateHomeserverUrl('ftp://example.org')).toThrow(/https/);
		expect(() => validateHomeserverUrl('')).toThrow();
		expect(() => validateHomeserverUrl('   ')).toThrow();
	});
});

function fakeFetch(responses: Record<string, { status: number; body?: unknown }>): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		const r = responses[url];
		if (!r) return new Response('not found', { status: 404 });
		return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
			status: r.status,
			headers: { 'content-type': 'application/json' }
		});
	}) as typeof fetch;
}

describe('resolveHomeserver', () => {
	it('follows m.homeserver.base_url delegation', async () => {
		const f = fakeFetch({
			'https://example.org/.well-known/matrix/client': {
				status: 200,
				body: { 'm.homeserver': { base_url: 'https://matrix.example.org/' } }
			}
		});
		expect(await resolveHomeserver('https://example.org', f)).toBe('https://matrix.example.org');
	});

	it('falls back to the typed URL when there is no well-known file', async () => {
		expect(await resolveHomeserver('https://matrix.example.org', fakeFetch({}))).toBe(
			'https://matrix.example.org'
		);
	});

	it('falls back when the well-known body is malformed', async () => {
		const f = fakeFetch({
			'https://example.org/.well-known/matrix/client': { status: 200, body: { nonsense: true } }
		});
		expect(await resolveHomeserver('https://example.org', f)).toBe('https://example.org');
	});

	// A well-known file must not be able to downgrade the connection: if the
	// delegated URL fails the scheme rules, that is an error, not a fallback.
	it('rejects a delegation to plain http', async () => {
		const f = fakeFetch({
			'https://example.org/.well-known/matrix/client': {
				status: 200,
				body: { 'm.homeserver': { base_url: 'http://matrix.example.org' } }
			}
		});
		await expect(resolveHomeserver('https://example.org', f)).rejects.toThrow(/unencrypted/);
	});

	it('keeps the dev Synapse path working without a network round-trip surprise', async () => {
		// Loopback with no well-known responds 404 → typed URL wins.
		expect(await resolveHomeserver('http://localhost:8008', fakeFetch({}))).toBe(
			'http://localhost:8008'
		);
	});
});
