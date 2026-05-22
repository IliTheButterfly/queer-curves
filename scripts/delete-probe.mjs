// End-to-end coverage for the delete-graph path: create a Matrix-backed
// graph, hit the Delete button on the [id] page, accept the confirm
// dialog, then verify the graph is gone — both right after the click
// and after a full page reload (so we know the tombstone state event
// propagated through sync, not just the local cache).
//
// Run:
//   node scripts/delete-probe.mjs

import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const U = `dl${Date.now().toString(36)}`;
const PW = 'devpass1234';
const log = (...a) => console.error('[delete-probe]', ...a);

const browser = await chromium.launch({
	executablePath: '/home/iliana/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage();
page.on('console', (m) => {
	if (m.type() === 'error') console.error('  [page-error]', m.text().slice(0, 160));
});

// Auto-accept the window.confirm dialog the Delete button uses.
page.on('dialog', (d) => d.accept());

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
	await page.locator('input[type="checkbox"]').check();
	await Promise.all([
		page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 }),
		page.getByRole('button', { name: 'Continue' }).click()
	]);
	log('keys set up, on home');

	// Create a spectrum graph
	await page.goto(`${DEV}/graphs/new`, { waitUntil: 'domcontentloaded' });
	const graphName = `to-delete-${U}`;
	await page.locator('input[type="text"]').first().fill(graphName);
	await Promise.all([
		page.waitForURL(/\/graphs\/!/, { timeout: 30000 }),
		page.getByRole('button', { name: /Create graph/i }).click()
	]);
	const graphUrl = page.url();
	log('graph created at', graphUrl);

	// Wait for the graph to appear on the home page first (so we know the
	// before-state is "visible").
	await page.goto(`${DEV}/`, { waitUntil: 'domcontentloaded' });
	let visible = false;
	for (let i = 0; i < 20 && !visible; i++) {
		await page.waitForTimeout(500);
		const text = (await page.locator('main').textContent()) ?? '';
		visible = text.includes(graphName);
	}
	log('graph visible on home before delete:', visible);

	// Click into the graph and delete
	await page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector(`h1:has-text("${graphName}")`, { timeout: 15000 });
	await page.getByRole('button', { name: /^Delete$/ }).click();
	// handleDelete goes to / after deleteUserGraph completes.
	await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 30000 });
	log('post-delete url:', page.url());

	// Immediate check — landing page should no longer show this graph.
	await page.waitForTimeout(2000);
	const afterText = (await page.locator('main').textContent()) ?? '';
	log('graph visible immediately after delete:', afterText.includes(graphName));

	// Hard reload — the tombstone state event needs to have been written
	// server-side so a fresh sync skips this room.
	log('--- reloading ---');
	await page.goto(`${DEV}/`, { waitUntil: 'domcontentloaded' });
	let stillThere = false;
	for (let i = 0; i < 30; i++) {
		await page.waitForTimeout(500);
		const text = (await page.locator('main').textContent()) ?? '';
		if (text.includes(graphName)) {
			stillThere = true;
			break;
		}
	}
	log('graph visible after reload:', stillThere);
} finally {
	await browser.close();
}
