// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession, type MatrixSession } from './session.js';

const STORAGE_KEY = 'queer-curves:matrix-session';

const exampleSession: MatrixSession = {
	baseUrl: 'http://localhost:8008',
	userId: '@alice:localhost',
	accessToken: 'syt_example_token',
	deviceId: 'ABCDEF1234'
};

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	localStorage.clear();
});

describe('session storage', () => {
	it('round-trips a valid session', () => {
		saveSession(exampleSession);
		expect(loadSession()).toEqual(exampleSession);
	});

	it('returns null when no session is stored', () => {
		expect(loadSession()).toBeNull();
	});

	it('returns null on malformed JSON', () => {
		// Survives corruption — the typical recovery is "the user logs in
		// again", not "the app crashes on boot".
		localStorage.setItem(STORAGE_KEY, '{not json');
		expect(loadSession()).toBeNull();
	});

	it('returns null when required fields are missing', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ baseUrl: 'http://x', userId: '@a:x' /* no token/device */ })
		);
		expect(loadSession()).toBeNull();
	});

	it('returns null when a field is the wrong type', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...exampleSession, accessToken: 12345 }));
		expect(loadSession()).toBeNull();
	});

	it('clearSession removes the stored session', () => {
		saveSession(exampleSession);
		clearSession();
		expect(loadSession()).toBeNull();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('clearSession is a no-op when nothing is stored', () => {
		expect(() => clearSession()).not.toThrow();
	});

	it('saveSession overwrites an existing entry', () => {
		saveSession(exampleSession);
		const next = { ...exampleSession, accessToken: 'syt_new_token' };
		saveSession(next);
		expect(loadSession()).toEqual(next);
	});
});
