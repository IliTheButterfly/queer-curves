// End-to-end smoke for network graphs over Matrix. Until now only spectrum
// graphs had headless coverage; this exercises the network path through the
// same Matrix snapshot mechanism so any breakage shows up before the user
// hits it.
//
// Run:
//   node scripts/network-probe.mjs

import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const U = `np${Date.now().toString(36)}`;
const PW = 'devpass1234';
const log = (...a) => console.error('[network-probe]', ...a);

const browser = await chromium.launch({
	executablePath: '/home/iliana/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage();
page.on('console', (m) => {
	if (m.type() === 'error') console.error('  [page-error]', m.text().slice(0, 160));
});

try {
	// 1. Register + set up keys
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
	await page.locator('input[type="checkbox"]').check();
	await Promise.all([
		page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 }),
		page.getByRole('button', { name: 'Continue' }).click()
	]);
	log('keys set up');

	// 2. Create a NETWORK graph
	await page.goto(`${DEV}/graphs/new`, { waitUntil: 'domcontentloaded' });
	await page.locator('input[type="radio"][value="network"]').check();
	await page.locator('input[type="text"]').first().fill(`polycule-${U}`);
	await Promise.all([
		page.waitForURL(/\/graphs\/!/, { timeout: 30000 }),
		page.getByRole('button', { name: /Create graph/i }).click()
	]);
	const graphUrl = page.url();
	log('network graph created at', graphUrl);

	// 3. Add two people via the node form
	await page.waitForSelector('h3:has-text("Add person")', { timeout: 10000 });
	await page.locator('input[placeholder="Alex"]').fill('Alice');
	await page.getByRole('button', { name: /add person/i }).click();
	await page.waitForTimeout(1500);
	await page.locator('input[placeholder="Alex"]').fill('Bob');
	await page.getByRole('button', { name: /add person/i }).click();
	await page.waitForTimeout(2000);

	const afterAdd = (await page.locator('main').textContent()) ?? '';
	log(
		'after adding 2 people. has "2 nodes":',
		/\b2 nodes\b/.test(afterAdd),
		'  Alice listed:',
		afterAdd.includes('Alice'),
		'  Bob listed:',
		afterAdd.includes('Bob')
	);

	// 4. Reload — the snapshot should round-trip both nodes
	log('--- reloading ---');
	await page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	let lastSummary = '';
	for (let i = 0; i < 40; i++) {
		await page.waitForTimeout(500);
		const main = (await page.locator('main').textContent()) ?? '';
		const m = main.match(/(\d+) nodes/);
		const n = m ? Number(m[1]) : -1;
		const summary = `nodes=${n} alice=${main.includes('Alice')} bob=${main.includes('Bob')}`;
		if (summary !== lastSummary) {
			log(`t=${(i + 1) * 500}ms ${summary}`);
			lastSummary = summary;
			if (n >= 2) break;
		}
	}
	log('final state after reload:', lastSummary);
} finally {
	await browser.close();
}
