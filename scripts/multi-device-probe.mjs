// Multi-device coverage: log the same account into two browser contexts
// (e.g. "laptop" and "phone") and verify what each device can read.
//
// Device A creates a graph + adds a datapoint. Device B then logs in
// as the same account, restores from the recovery key, and we check
// that the graph + datapoint are visible.
//
// Run:
//   node scripts/multi-device-probe.mjs

import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const U = `md${Date.now().toString(36)}`;
const PW = 'devpass1234';
const log = (...a) => console.error('[multi-device]', ...a);

const browser = await chromium.launch({
	executablePath: '/home/iliana/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
	headless: true,
	args: ['--no-sandbox']
});

async function newContext(name) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	page.on('console', (m) => {
		if (m.type() === 'error') console.error(`  [${name} err]`, m.text().slice(0, 160));
	});
	page.on('dialog', (d) => d.accept());
	return { ctx, page };
}

const a = await newContext('A');
const b = await newContext('B');

try {
	// ── Device A: register, set up keys, create graph + datapoint ──
	await a.page.goto(`${DEV}/login`, { waitUntil: 'domcontentloaded' });
	await a.page.getByRole('tab', { name: 'Create account' }).click();
	await a.page.locator('input[type="url"]').fill(HS);
	await a.page.locator('input[type="text"]').fill(U);
	await a.page.locator('input[type="password"]').fill(PW);
	await Promise.all([
		a.page.waitForURL(/setup-keys/, { timeout: 30000 }),
		a.page.getByRole('button', { name: /Create account/i }).click()
	]);
	await a.page.getByRole('button', { name: /Generate recovery key/i }).click();
	await a.page.waitForSelector('.recovery-key code', { timeout: 30000 });
	const rk = (await a.page.locator('.recovery-key code').textContent())?.trim();
	await a.page.locator('input[type="checkbox"]').check();
	await Promise.all([
		a.page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 }),
		a.page.getByRole('button', { name: 'Continue' }).click()
	]);
	log('A: keys set up. recovery key length:', rk?.length);

	await a.page.goto(`${DEV}/graphs/new`, { waitUntil: 'domcontentloaded' });
	const graphName = `shared-${U}`;
	await a.page.locator('input[type="text"]').first().fill(graphName);
	await Promise.all([
		a.page.waitForURL(/\/graphs\/!/, { timeout: 30000 }),
		a.page.getByRole('button', { name: /Create graph/i }).click()
	]);
	const graphUrl = a.page.url();
	log('A: graph created at', graphUrl);

	await a.page.waitForSelector('h3:has-text("Add datapoint")', { timeout: 10000 });
	await a.page.getByRole('button', { name: /commit datapoint/i }).click();
	await a.page.waitForTimeout(2500);
	const aAfterAdd = (await a.page.locator('main').textContent()) ?? '';
	log('A: shows "1 datapoint" after add:', /\b1\s+datapoints?\b/.test(aAfterAdd));

	// ── Device B: log in as the same user, restore from recovery key ──
	log('--- B logging in as the same user ---');
	await b.page.goto(`${DEV}/login`, { waitUntil: 'domcontentloaded' });
	await b.page.locator('input[type="url"]').fill(HS);
	await b.page.locator('input[type="text"]').fill(U);
	await b.page.locator('input[type="password"]').fill(PW);
	await b.page.getByRole('button', { name: /^Log in$/ }).click();
	await b.page.waitForURL((u) => !new URL(u).pathname.startsWith('/login'), { timeout: 30000 });
	log('B: landed on', b.page.url());

	if (new URL(b.page.url()).pathname === '/restore-keys') {
		await b.page.locator('textarea').fill(rk ?? '');
		await b.page.getByRole('button', { name: /Restore keys/i }).click();
		await b.page.waitForSelector('text=/Restored/', { timeout: 30000 });
		await b.page.getByRole('button', { name: 'Continue' }).click();
		await b.page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
		log('B: keys restored');
	}

	// ── Confirm B sees the graph + datapoint A created ──
	let visibleOnB = false;
	for (let i = 0; i < 30 && !visibleOnB; i++) {
		await b.page.waitForTimeout(500);
		const text = (await b.page.locator('main').textContent()) ?? '';
		visibleOnB = text.includes(graphName);
	}
	log('B: graph visible on home:', visibleOnB);

	await b.page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	let bDp = -1;
	for (let i = 0; i < 60; i++) {
		await b.page.waitForTimeout(500);
		const text = (await b.page.locator('main').textContent()) ?? '';
		const m = text.match(/(\d+) datapoint/);
		const n = m ? Number(m[1]) : -1;
		if (n >= 1) {
			bDp = n;
			log(`B: t=${(i + 1) * 500}ms datapoints=${n}`);
			break;
		}
	}
	log("B: final datapoint count from A's session:", bDp);
} finally {
	await browser.close();
}
