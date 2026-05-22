#!/usr/bin/env node
// End-to-end smoke test for the Matrix flow — drives a headless chromium
// through the login → key-setup → create-graph → reload → verify path.
// Not a CI test; manual harness for "did the latest PR break the demo".
//
// Prereqs:
//   - scripts/dev-matrix.sh up
//   - scripts/dev-matrix.sh user alice   (password: devpass)
//   - pnpm dev --port 5174 --strictPort  (or whatever DEV_URL points to)
//
// Run:
//   node scripts/smoke-test.mjs

import { chromium } from 'playwright-core';

const DEV_URL = process.env.DEV_URL ?? 'http://localhost:5174';
const HOMESERVER = process.env.HOMESERVER ?? 'http://localhost:8008';
const USERNAME = process.env.USERNAME ?? `smoke${Date.now().toString(36)}`;
const PASSWORD = process.env.PASSWORD ?? 'devpass1234';
const CHROMIUM = process.env.CHROMIUM ?? '/usr/bin/chromium';

function log(...args) {
	console.error('[smoke]', ...args);
}

async function withStep(name, fn) {
	log(`→ ${name}`);
	try {
		await fn();
		log(`✓ ${name}`);
	} catch (e) {
		log(`✗ ${name}: ${e?.message ?? e}`);
		throw e;
	}
}

async function main() {
	const browser = await chromium.launch({
		executablePath: CHROMIUM,
		headless: true,
		args: ['--no-sandbox', '--disable-dev-shm-usage']
	});
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const consoleErrors = [];
	const requestFailures = [];
	page.on('console', (msg) => {
		const t = msg.type();
		if (t === 'error' || t === 'warning') consoleErrors.push(`[${t}] ${msg.text()}`);
	});
	page.on('requestfailed', (req) => {
		requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? '?'}`);
	});
	page.on('response', (res) => {
		if (res.status() >= 400) {
			requestFailures.push(`${res.status()} ${res.request().method()} ${res.url()}`);
		}
	});
	page.on('pageerror', (err) => {
		consoleErrors.push(`pageerror: ${err.message}`);
	});

	try {
		await withStep('landing loads', async () => {
			await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
			const title = await page.title();
			if (!title.toLowerCase().includes('queer-curves')) {
				throw new Error(`unexpected title: ${title}`);
			}
		});

		await withStep('register fresh user', async () => {
			await page.goto(`${DEV_URL}/login`, { waitUntil: 'domcontentloaded' });
			await page.getByRole('tab', { name: 'Create account' }).click();
			await page.locator('input[type="url"]').fill(HOMESERVER);
			await page.locator('input[type="text"]').fill(USERNAME);
			await page.locator('input[type="password"]').fill(PASSWORD);
			await Promise.all([
				page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
				page.getByRole('button', { name: /Create account/i }).click()
			]);
			const url = page.url();
			log(`  landed on ${url}`);
			if (!url.includes('/setup-keys')) {
				throw new Error(`expected /setup-keys, got ${url}`);
			}
		});

		await withStep('generate recovery key', async () => {
			await page.getByRole('button', { name: /Generate recovery key/i }).click({ timeout: 30000 });
			// Wait for either the recovery-key reveal or an in-page error message.
			const result = await Promise.race([
				page.waitForSelector('.recovery-key code', { timeout: 30000 }).then(() => 'key'),
				page.waitForSelector('p.error[role="alert"]', { timeout: 30000 }).then(() => 'error')
			]);
			if (result === 'error') {
				const txt = await page.locator('p.error[role="alert"]').textContent();
				throw new Error(`setupCrypto reported: ${txt?.trim()}`);
			}
			const key = (await page.locator('.recovery-key code').textContent())?.trim();
			if (!key || key.length < 10) throw new Error(`bad recovery key: ${key}`);
			log(`  recovery key length=${key.length}`);
			await page.locator('input[type="checkbox"]').check();
			await Promise.all([
				page.waitForURL(DEV_URL + '/', { timeout: 15000 }),
				page.getByRole('button', { name: 'Continue' }).click()
			]);
		});

		await withStep('create a new spectrum graph', async () => {
			await page.goto(`${DEV_URL}/graphs/new`, { waitUntil: 'domcontentloaded' });
			await page.locator('input[type="text"]').first().fill(`smoke ${USERNAME}`);
			await Promise.all([
				// Only matches the post-creation URL — /graphs/new itself is
				// excluded because it'd resolve before the create even fires.
				page.waitForURL((u) => /\/graphs\/!/.test(u.pathname), { timeout: 30000 }),
				page.getByRole('button', { name: /Create graph/i }).click()
			]);
			log(`  landed on ${page.url()}`);
		});

		await withStep('graph appears on home', async () => {
			await page.goto(DEV_URL + '/', { waitUntil: 'domcontentloaded' });
			// give the matrix store $effect a moment to re-fetch
			await page.waitForTimeout(2000);
			const text = await page.locator('main').textContent();
			if (!text?.includes(`smoke ${USERNAME}`)) {
				throw new Error(`new graph not in landing list:\n${text?.slice(0, 1000)}`);
			}
		});

		log('all steps passed');
	} finally {
		if (consoleErrors.length > 0) {
			log('CONSOLE ERRORS:');
			for (const e of consoleErrors) log(`  ${e}`);
		}
		if (requestFailures.length > 0) {
			log('REQUEST FAILURES:');
			for (const e of requestFailures) log(`  ${e}`);
		}
		await browser.close();
		if (consoleErrors.length > 0 || requestFailures.length > 0) {
			process.exit(2);
		}
	}
}

main().catch((e) => {
	log('FATAL', e?.stack ?? e);
	process.exit(1);
});
