import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const U = `dp${Date.now().toString(36)}`;
const PW = 'devpass1234';

function log(...a) {
	console.error('[probe]', ...a);
}

const browser = await chromium.launch({
	executablePath: '/home/iliana/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage();
page.on('console', (m) => {
	const t = m.type();
	const x = m.text();
	if (x.startsWith('[qc.matrix]')) console.error('  page>', x);
	if (t === 'error') console.error('  [page-error]', x);
});
page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

try {
	// 1. Register
	await page.goto(`${DEV}/login`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('tab', { name: 'Create account' }).click();
	await page.locator('input[type="url"]').fill(HS);
	await page.locator('input[type="text"]').fill(U);
	await page.locator('input[type="password"]').fill(PW);
	await Promise.all([
		page.waitForURL(/setup-keys/, { timeout: 30000 }),
		page.getByRole('button', { name: /Create account/i }).click()
	]);
	log('registered & on setup-keys');

	// 2. Setup keys
	await page.getByRole('button', { name: /Generate recovery key/i }).click();
	await page.waitForSelector('.recovery-key code', { timeout: 30000 });
	const rk = (await page.locator('.recovery-key code').textContent())?.trim();
	log('recovery key len=', rk?.length);
	await page.locator('input[type="checkbox"]').check();
	await Promise.all([
		page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 }),
		page.getByRole('button', { name: 'Continue' }).click()
	]);
	log('keys set up, on home');

	// 3. Create graph (1D spectrum default)
	await page.goto(`${DEV}/graphs/new`, { waitUntil: 'domcontentloaded' });
	await page.locator('input[type="text"]').first().fill(`probe-${U}`);
	await Promise.all([
		page.waitForURL(/\/graphs\/!/, { timeout: 30000 }),
		page.getByRole('button', { name: /Create graph/i }).click()
	]);
	const graphUrl = page.url();
	log('graph created at', graphUrl);

	// 4. Add a datapoint. The 1D form should have a coord input and submit button.
	// Find the "Add datapoint" form/button. Simplest: click in the picker, then submit.
	await page.waitForSelector('h3:has-text("Add datapoint")', { timeout: 10000 });
	await page.getByRole('button', { name: /commit datapoint/i }).click();
	await page.waitForTimeout(3000);
	const text1 = (await page.locator('main').textContent()) ?? '';
	log('after add, page text head:', text1.slice(0, 600));

	// 5. Actually log out, then log back in
	log('--- logging out ---');
	await page.getByRole('button', { name: /Log out/i }).click();
	await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
	log('logged out, on:', page.url());

	log('--- logging back in ---');
	await page.goto(`${DEV}/login`, { waitUntil: 'domcontentloaded' });
	await page.locator('input[type="url"]').fill(HS);
	await page.locator('input[type="text"]').fill(U);
	await page.locator('input[type="password"]').fill(PW);
	await page.getByRole('button', { name: /^Log in$/ }).click();
	await page.waitForURL((u) => !new URL(u).pathname.startsWith('/login'), { timeout: 30000 });
	log('logged in, on:', page.url());

	log('--- navigating to graph page (expect Loading, no keys yet) ---');
	await page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	await page.waitForTimeout(3000);
	const beforeRestore = (await page.locator('main').textContent()) ?? '';
	const loadingBeforeRestore = /Loading graph/.test(beforeRestore);
	log('graph page shows "Loading…" before restore:', loadingBeforeRestore);

	log('--- restoring from recovery key ---');
	await page.goto(`${DEV}/restore-keys`, { waitUntil: 'domcontentloaded' });
	await page.locator('textarea').fill(rk ?? '');
	await page.getByRole('button', { name: /Restore keys/i }).click();
	// Result section shows "Restored N key(s)…"
	await page.waitForSelector('text=/Restored/', { timeout: 30000 });
	const restoreText = (await page.locator('main').textContent()) ?? '';
	log('restore result:', restoreText.slice(0, 300));
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });

	log('--- navigating to graph page (expect datapoint visible) ---');
	await page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	let lastDp = -1;
	for (let i = 0; i < 60; i++) {
		await page.waitForTimeout(500);
		const main = await page
			.locator('main')
			.textContent()
			.catch(() => null);
		if (!main) continue;
		const m = main.match(/(\d+) datapoint/);
		const dp = m ? Number(m[1]) : -1;
		if (dp !== lastDp) {
			log(`t=${(i + 1) * 500}ms datapoints=${dp}`);
			lastDp = dp;
			if (dp >= 1) break;
		}
	}
	log('final datapoint count:', lastDp);
} finally {
	await browser.close();
}
