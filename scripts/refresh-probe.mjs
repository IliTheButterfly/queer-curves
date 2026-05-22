import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const U = `rp${Date.now().toString(36)}`;
const PW = 'devpass1234';
const log = (...a) => console.error('[refresh-probe]', ...a);

const browser = await chromium.launch({
	executablePath: '/home/iliana/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage();
page.on('console', (m) => {
	if (m.type() === 'error') console.error('  [page-error]', m.text().slice(0, 200));
});
page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
try {
	// register + setup keys
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
	const rk = (await page.locator('.recovery-key code').textContent())?.trim();
	await page.locator('input[type="checkbox"]').check();
	await Promise.all([
		page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 }),
		page.getByRole('button', { name: 'Continue' }).click()
	]);
	log('first setup done');

	// logout + login
	await page.getByRole('button', { name: /Log out/i }).click();
	await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
	await page.goto(`${DEV}/login`, { waitUntil: 'domcontentloaded' });
	await page.locator('input[type="url"]').fill(HS);
	await page.locator('input[type="text"]').fill(U);
	await page.locator('input[type="password"]').fill(PW);
	await page.getByRole('button', { name: /^Log in$/ }).click();
	try {
		await page.waitForURL((u) => !new URL(u).pathname.startsWith('/login'), { timeout: 30000 });
	} catch {
		log('login timed out; still on:', page.url());
		const err = await page
			.locator('p.error')
			.textContent()
			.catch(() => null);
		log('error text on page:', err);
	}
	await page.waitForTimeout(3000);
	log('after relogin, on:', page.url());

	// restore
	await page.locator('textarea').fill(rk ?? '');
	await page.getByRole('button', { name: /Restore keys/i }).click();
	await page.waitForSelector('text=/Restored/', { timeout: 30000 });
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
	log('after restore, on:', page.url());

	// REFRESH the page (no logout) — should NOT need restore again
	log('--- refreshing page ---');
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.waitForTimeout(5000);
	const url = page.url();
	const path = new URL(url).pathname;
	log('after refresh, on:', url);
	log('still on /restore-keys?', path === '/restore-keys');

	// Look for the orange banner
	const bannerCount = await page.locator('aside.banner a[href="/restore-keys"]').count();
	log('restore banner shown after refresh:', bannerCount > 0);
} finally {
	await browser.close();
}
