// Revocation probe (SECURITY_PLAN.md Stage 1, S5): alice shares a graph
// with bob, verifies he can read it, then revokes his access from the
// ShareSection member list. Assertions, all negative-path:
//   1. server-side: bob's membership becomes "leave" (the kick landed)
//   2. alice adds a datapoint AFTER the kick; bob's client must never
//      show the new count (the rotated megolm session excludes him)
//   3. delete path: alice shares a second graph, then deletes it — bob
//      must be kicked (not left stranded joined) before alice leaves,
//      i.e. kick-then-leave order per sharing_model.md §10.3.
//
// Run:
//   node scripts/revoke-probe.mjs

import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const ALICE = `rv${Date.now().toString(36)}`;
const BOB = `rw${Date.now().toString(36)}`;
const PW = 'devpass1234';
const log = (...a) => console.error('[revoke-probe]', ...a);

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

async function createGraph(page, graphName) {
	await page.goto(`${DEV}/graphs/new`, { waitUntil: 'domcontentloaded' });
	await page.locator('input[type="text"]').first().fill(graphName);
	await Promise.all([
		page.waitForURL(/\/graphs\/!/, { timeout: 30000 }),
		page.getByRole('button', { name: /Create graph/i }).click()
	]);
	return page.url();
}

async function inviteAndAccept(a, b, graphUrl, bobMatrixId) {
	await a.page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	await a.page.locator('section.share').waitFor({ timeout: 10000 });
	await a.page.locator('input[placeholder="@bob:example.org"]').fill(bobMatrixId);
	await a.page.getByRole('button', { name: /^Invite$/ }).click();
	await a.page.waitForSelector('p.success', { timeout: 10000 });
	await b.page.goto(`${DEV}/`, { waitUntil: 'domcontentloaded' });
	let sawInvite = false;
	for (let i = 0; i < 40 && !sawInvite; i++) {
		await b.page.waitForTimeout(500);
		const text = (await b.page.locator('main').textContent()) ?? '';
		sawInvite = text.includes('Pending invites');
	}
	if (!sawInvite) throw new Error('bob never saw the invite');
	await b.page.getByRole('button', { name: /^Accept$/ }).click();
	await b.page.waitForTimeout(8000);
}

async function membershipOf(roomId, token, userId) {
	const res = await fetch(
		`${HS}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(userId)}`,
		{ headers: { Authorization: `Bearer ${token}` } }
	);
	if (!res.ok) return `http-${res.status}`;
	return (await res.json()).membership;
}

const a = await fresh('A');
const b = await fresh('B');

try {
	await registerAndSetup(a.page, ALICE);
	log('alice set up');
	await registerAndSetup(b.page, BOB);
	log('bob set up');
	const bobMatrixId = `@${BOB}:localhost`;

	// ── Part 1: revoke ────────────────────────────────────────────────
	const graphUrl = await createGraph(a.page, `revocable-${ALICE}`);
	const roomId = decodeURIComponent(graphUrl.split('/graphs/')[1]);
	log('alice created', roomId);
	await a.page.getByRole('button', { name: /commit datapoint/i }).click();
	await a.page.waitForTimeout(1500);
	await inviteAndAccept(a, b, graphUrl, bobMatrixId);
	log('bob accepted invite');

	// bob reads the graph (1 datapoint expected)
	await b.page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	let bobSaw = false;
	for (let i = 0; i < 60 && !bobSaw; i++) {
		await b.page.waitForTimeout(500);
		const text = (await b.page.locator('main').textContent()) ?? '';
		bobSaw = /1 datapoint/.test(text);
	}
	log('bob can read the shared graph before revoke:', bobSaw);

	// alice revokes bob from the member list
	await a.page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	await a.page.locator('.member-list').waitFor({ timeout: 15000 });
	await a.page
		.locator('.member-list li', { hasText: bobMatrixId })
		.getByRole('button', { name: /^Remove/ })
		.click();
	await a.page.waitForTimeout(3000);

	const aliceToken = await a.page.evaluate(
		() => JSON.parse(localStorage.getItem('queer-curves:matrix-session') ?? '{}').accessToken
	);
	const afterRevoke = await membershipOf(roomId, aliceToken, bobMatrixId);
	log('bob membership after revoke (want leave):', afterRevoke);

	// alice writes AFTER the kick — new megolm session must exclude bob
	await a.page.getByRole('button', { name: /commit datapoint/i }).click();
	await a.page.waitForTimeout(2000);

	// bob reloads; must not see 2 datapoints (nor the graph at all)
	await b.page.goto(graphUrl, { waitUntil: 'domcontentloaded' });
	let bobLeaked = false;
	for (let i = 0; i < 20; i++) {
		await b.page.waitForTimeout(500);
		const text = (await b.page.locator('main').textContent()) ?? '';
		if (/2 datapoints/.test(text)) {
			bobLeaked = true;
			break;
		}
	}
	log('bob sees post-revoke datapoint (want false):', bobLeaked);

	// ── Part 2: delete kicks members before leaving ───────────────────
	const graphUrl2 = await createGraph(a.page, `deletable-${ALICE}`);
	const roomId2 = decodeURIComponent(graphUrl2.split('/graphs/')[1]);
	await inviteAndAccept(a, b, graphUrl2, bobMatrixId);
	log('bob accepted invite to second graph');

	await a.page.goto(graphUrl2, { waitUntil: 'domcontentloaded' });
	await a.page.getByRole('button', { name: /^Delete$/ }).click();
	await a.page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 30000 });
	await a.page.waitForTimeout(2000);

	// bob's own view of his membership (alice left, so ask as bob)
	const bobToken = await b.page.evaluate(
		() => JSON.parse(localStorage.getItem('queer-curves:matrix-session') ?? '{}').accessToken
	);
	const joined = await (
		await fetch(`${HS}/_matrix/client/v3/joined_rooms`, {
			headers: { Authorization: `Bearer ${bobToken}` }
		})
	).json();
	const bobStillJoined = (joined.joined_rooms ?? []).includes(roomId2);
	log('bob still joined to deleted graph room (want false):', bobStillJoined);

	const ok = bobSaw && afterRevoke === 'leave' && !bobLeaked && !bobStillJoined;
	log(ok ? 'PROBE PASSED' : 'PROBE FAILED');
	process.exitCode = ok ? 0 : 1;
} finally {
	await browser.close();
}
