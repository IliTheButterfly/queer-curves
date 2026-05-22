// Try restoring with various bad recovery keys and report the exact error
// text the user would see. Drives the UI itself so we observe what the
// page renders, not what matrix-js-sdk throws internally.

import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const U = `re${Date.now().toString(36)}`;
const PW = 'devpass1234';
const log = (...a) => console.error('[restore-error]', ...a);

const browser = await chromium.launch({
	executablePath: '/home/iliana/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage();
page.on('console', (m) => {
	if (m.type() === 'error') console.error('  [page-error]', m.text().slice(0, 200));
});

try {
	// Bootstrap: register + setup + logout + relogin (lands on /restore-keys)
	await page.goto(`${DEV}/login`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('tab', { name: 'Create account' }).click();
	await page.locator('input[type="url"]').fill(HS);
	await page.locator('input[type="text"]').fill(U);
	await page.locator('input[type="password"]').fill(PW);
	await Promise.all([
		page.waitForURL(/setup-keys/, { timeout: 30000 }),
		page.getByRole('button', { name: /Create account/i }).click()
	]);
	await page.getByRole('button', { name: /Generate recovery key/i }).click();
	await page.waitForSelector('.recovery-key code', { timeout: 30000 });
	const validKey = (await page.locator('.recovery-key code').textContent())?.trim();
	await page.locator('input[type="checkbox"]').check();
	await Promise.all([
		page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 }),
		page.getByRole('button', { name: 'Continue' }).click()
	]);
	await page.getByRole('button', { name: /Log out/i }).click();
	await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
	await page.goto(`${DEV}/login`, { waitUntil: 'domcontentloaded' });
	await page.locator('input[type="url"]').fill(HS);
	await page.locator('input[type="text"]').fill(U);
	await page.locator('input[type="password"]').fill(PW);
	await page.getByRole('button', { name: /^Log in$/ }).click();
	try {
		await page.waitForURL((u) => new URL(u).pathname === '/restore-keys', { timeout: 30000 });
	} catch (e) {
		log('did not reach /restore-keys. current url:', page.url(), 'err:', e?.message?.slice(0, 100));
		const err = await page
			.locator('p.error')
			.textContent()
			.catch(() => null);
		log('error text on page:', err);
		const main = await page
			.locator('main')
			.textContent()
			.catch(() => null);
		log('main text head:', main?.slice(0, 400));
		throw e;
	}
	log('on /restore-keys, valid key length=', validKey?.length);

	async function tryRestore(key, label) {
		await page.locator('textarea').fill('');
		await page.locator('textarea').fill(key);
		await page.getByRole('button', { name: /Restore keys/i }).click();
		// Wait for either success or error
		const result = await Promise.race([
			page.waitForSelector('text=/Restored/', { timeout: 20000 }).then(() => ({ kind: 'success' })),
			page.waitForSelector('p.error[role="alert"]', { timeout: 20000 }).then(async () => ({
				kind: 'error',
				text: (await page.locator('p.error[role="alert"]').textContent())?.trim()
			}))
		]).catch((e) => ({ kind: 'timeout', text: e?.message }));
		log(`${label}:`, result);
		// Reload to clear any persistent error state before next case
		await page.reload({ waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(2000);
	}

	await tryRestore('not a key', 'gibberish');
	await tryRestore('EsTe ABCD efgh ijkl mnop qrst uvwx yzAB CDEF', 'plausible-but-fake');
	// Random base58 valid bytes — decodes but won't match this account
	await tryRestore('EsTd Hf3T q2nS qmxL ms5p qaUM Zwwf qatB sXcM wA', 'valid-format-wrong-account');
} finally {
	await browser.close();
}
