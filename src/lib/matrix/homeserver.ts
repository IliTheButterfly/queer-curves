// Homeserver URL validation and .well-known discovery (SECURITY_PLAN.md S9).
//
// login() posts the user's password to whatever URL it is given, so the URL
// is a security input, not a preference: a typo'd or downgraded scheme is a
// plaintext credential over the wire. Rules:
//
//  - `https:` is required, except for loopback hosts — the dev Synapse is
//    `http://localhost:8008` and must keep working.
//  - `.well-known/matrix/client` discovery runs on the typed origin, so a
//    user can enter `https://example.org` and land on the homeserver it
//    delegates to (`matrix.example.org` etc.), per the Matrix client-server
//    discovery spec. The delegated URL has to pass the same scheme rules —
//    a well-known file must not be able to downgrade the connection.
//
// Pure logic and fetch are separated so the rules are unit-testable without
// a network.

/** Loopback hosts where plain http is acceptable (local dev only). */
export function isLoopbackHost(hostname: string): boolean {
	const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (h === 'localhost' || h.endsWith('.localhost')) return true;
	if (h === '::1') return true;
	// 127.0.0.0/8
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Parse and validate a homeserver base URL. Accepts a bare hostname
 * ("example.org") by assuming https. Throws a user-facing Error when the
 * input is not a URL, uses a non-http(s) scheme, or uses plain http on a
 * non-loopback host.
 */
export function validateHomeserverUrl(input: string): URL {
	const trimmed = input.trim();
	if (!trimmed) throw new Error('Enter your homeserver (e.g. https://matrix.example.org).');
	const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new Error(`"${trimmed}" doesn't look like a homeserver address.`);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error(`Homeserver addresses must use https, not ${url.protocol.slice(0, -1)}.`);
	}
	if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
		throw new Error(
			'This homeserver address uses plain http, which would send your password unencrypted. Use https (http is only allowed for localhost development).'
		);
	}
	return url;
}

/** Origin plus any path prefix, without a trailing slash. */
function baseOf(url: URL): string {
	const path = url.pathname.replace(/\/+$/, '');
	return `${url.origin}${path}`;
}

/**
 * Resolve the homeserver base URL for a user-typed address: validate it,
 * then honour `/.well-known/matrix/client` delegation if the origin serves
 * one. Absence of a well-known file (404, network error, malformed JSON) is
 * not an error — the typed URL is used as-is, which is what every Matrix
 * client does. A *present* well-known whose delegated URL fails validation
 * IS an error: silently falling back would let a hostile or broken file be
 * ignored where the spec says FAIL_ERROR.
 */
export async function resolveHomeserver(
	input: string,
	fetchFn: typeof fetch = fetch
): Promise<string> {
	const url = validateHomeserverUrl(input);
	let body: unknown;
	try {
		const res = await fetchFn(`${url.origin}/.well-known/matrix/client`);
		if (!res.ok) return baseOf(url);
		body = await res.json();
	} catch {
		return baseOf(url);
	}
	const delegated = (body as { 'm.homeserver'?: { base_url?: unknown } } | null)?.['m.homeserver']
		?.base_url;
	if (typeof delegated !== 'string' || !delegated) return baseOf(url);
	return baseOf(validateHomeserverUrl(delegated));
}
