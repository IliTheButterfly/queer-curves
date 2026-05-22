// Two-user share probe: alice creates a graph + datapoint, invites bob.
// Bob accepts the invite from his landing page and the graph appears in
// his list. Bob then opens the graph and confirms the datapoint is
// visible (megolm key was shared on join).
//
// Run:
//   node scripts/share-probe.mjs

import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const ALICE = `sa${Date.now().toString(36)}`;
const BOB = `sb${Date.now().toString(36)}`;
const PW = 'devpass1234';
const log = (...a) => console.error('[share-probe]', ...a);

const browser = await chromium.launch({
	executablePath: '/home/iliana/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
	headless: true,
	args: ['--no-sandbox']
});

async function fresh(name) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	page.on('console', (m) => {
		if (m.type() === 'error') console.error(`  [${name} err]`, m.text().slice(0, 160));
	});
	page.on('dialog', (d) => d.accept());
	return { ctx, page };
}

async function registerAndSetup(page, username) {
	await page.goto(`${DEV}/login`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('tab', { name: 'Create account' }).click();
	await page.locator('input[type="url"]').fill(HS);
	await page.locator('input[type="text"]').fill(username);
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
}

const a = await fresh('A');
const b = await fresh('B');

try {
	await registerAndSetup(a.page, ALICE);
	log('alice set up');
	await registerAndSetup(b.page, BOB);
	log('bob set up');

	// Alice creates a graph + datapoint
	await a.page.goto(`${DEV}/graphs/new`, { waitUntil: 'domcontentloaded' });
	const graphName = `shared-${ALICE}`;
	await a.page.locator('input[type="text"]').first().fill(graphName);
	await Promise.all([
		a.page.waitForURL(/\/graphs\/!/, { timeout: 30000 }),
		a.page.getByRole('button', { name: /Create graph/i }).click()
	]);
	const graphUrl = a.page.url();
	log('alice created graph at', graphUrl);

	await a.page.waitForSelector('h3:has-text("Add datapoint")', { timeout: 10000 });
	await a.page.getByRole('button', { name: /commit datapoint/i }).click();
	await a.page.waitForTimeout(2000);

	// Alice invites bob
	const bobMatrixId = `@${BOB}:localhost`;
	const shareSection = a.page.locator('section.share');
	await shareSection.waitFor({ timeout: 10000 });
	await a.page.locator('input[placeholder="@bob:example.org"]').fill(bobMatrixId);
	await a.page.getByRole('button', { name: /^Invite$/ }).click();
	await a.page.waitForSelector('p.success', { timeout: 10000 });
	log('alice invited', bobMatrixId);

	// Bob sees the invite on his landing page
	await b.page.goto(`${DEV}/`, { waitUntil: 'domcontentloaded' });
	let sawInvite = false;
	for (let i = 0; i < 30 && !sawInvite; i++) {
		await b.page.waitForTimeout(500);
		const text = (await b.page.locator('main').textContent()) ?? '';
		sawInvite =
			(text.includes(graphName) || text.includes(graphUrl.split('/').pop() ?? '')) &&
			text.includes('Pending invites');
	}
	log('bob sees invite on home:', sawInvite);

	// Bob clicks Accept
	await b.page.getByRole('button', { name: /^Accept$/ }).click();
	await b.page.waitForTimeout(8000); // let join + key share propagate

	// Server-side: is bob actually joined?
	const bobToken = await b.page.evaluate(
		() => JSON.parse(localStorage.getItem('queer-curves:matrix-session') ?? '{}').accessToken
	);
	const joinedRoomsResp = await fetch(`${HS}/_matrix/client/v3/joined_rooms`, {
		headers: { Authorization: `Bearer ${bobToken}` }
	});
	const joinedRooms = await joinedRoomsResp.json();
	log('bob joined_rooms (server):', JSON.stringify(joinedRooms));

	// Force bob to reload and re-fetch
	await b.page.goto(`${DEV}/`, { waitUntil: 'domcontentloaded' });

	// Bob opens the graph
	await b.page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	let bDp = -1;
	for (let i = 0; i < 120; i++) {
		await b.page.waitForTimeout(500);
		const text = (await b.page.locator('main').textContent()) ?? '';
		const m = text.match(/(\d+) datapoint/);
		const n = m ? Number(m[1]) : -1;
		if (n >= 1) {
			bDp = n;
			log(`bob sees datapoints at t=${(i + 1) * 500}ms: ${n}`);
			break;
		}
	}
	log("bob's final datapoint count from alice's graph:", bDp);
} finally {
	await browser.close();
}
