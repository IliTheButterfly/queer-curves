// Grant probe (SECURITY_PLAN.md Stage 2, S4): the assertions run on the
// DECRYPTED EVENT CONTENT bob's client received — never on the rendered UI,
// because a projection bug is exactly the kind of leak a masked view hides.
//
//   1. alice creates a spectrum graph with TWO datapoints and shares it
//      with the default current-only grant. Every snapshot bob can decrypt
//      must contain exactly ONE datapoint and a projection marker; no event
//      anywhere in his client may contain two.
//   2. bob's UI shows the current-only disclosure line.
//   3. alice re-invites bob with the full-history grant. Bob accepts the
//      new invite; the snapshot in his new room must contain BOTH
//      datapoints, and his old current-only membership must be gone
//      (grant change = room change).
//
// Run:
//   node scripts/grant-probe.mjs

import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const ALICE = `ga${Date.now().toString(36)}`;
const BOB = `gb${Date.now().toString(36)}`;
const PW = 'devpass1234';
const log = (...a) => console.error('[grant-probe]', ...a);

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

// Every decrypted snapshot in every room of this page's client.
// __qcClient is exposed by matrix/client.ts in dev builds for exactly this.
async function decryptedSnapshots(page) {
	return await page.evaluate(async () => {
		const c = globalThis.__qcClient;
		if (!c) return null;
		const out = [];
		for (const room of c.getRooms()) {
			for (const ev of room.getLiveTimeline().getEvents()) {
				if (ev.getType() === 'app.queercurves.snapshot' && !ev.isDecryptionFailure()) {
					out.push({ roomId: room.roomId, content: ev.getContent() });
				}
			}
		}
		return out;
	});
}

async function acceptFirstInvite(page) {
	await page.goto(`${DEV}/`, { waitUntil: 'domcontentloaded' });
	let saw = false;
	for (let i = 0; i < 40 && !saw; i++) {
		await page.waitForTimeout(500);
		saw = ((await page.locator('main').textContent()) ?? '').includes('Pending invites');
	}
	if (!saw) throw new Error('invite never arrived');
	await page.getByRole('button', { name: /^Accept$/ }).click();
	await page.waitForTimeout(8000);
}

const a = await fresh('A');
const b = await fresh('B');

try {
	await registerAndSetup(a.page, ALICE);
	await registerAndSetup(b.page, BOB);
	log('both accounts set up');
	const bobMatrixId = `@${BOB}:localhost`;

	// alice: graph with TWO datapoints
	await a.page.goto(`${DEV}/graphs/new`, { waitUntil: 'domcontentloaded' });
	const graphName = `granted-${ALICE}`;
	await a.page.locator('input[type="text"]').first().fill(graphName);
	await Promise.all([
		a.page.waitForURL(/\/graphs\/!/, { timeout: 30000 }),
		a.page.getByRole('button', { name: /Create graph/i }).click()
	]);
	await a.page.getByRole('button', { name: /commit datapoint/i }).click();
	await a.page.waitForTimeout(1500);
	await a.page.getByRole('button', { name: /commit datapoint/i }).click();
	await a.page.waitForTimeout(1500);
	log('alice created graph with 2 datapoints');

	// ── Part 1: current-only (the default — no radio touched) ─────────
	await a.page.locator('details.manual-invite summary').click();
	await a.page.locator('input[placeholder="@bob:example.org"]').fill(bobMatrixId);
	await a.page.getByRole('button', { name: /^Invite$/ }).click();
	await a.page.waitForSelector('p.success', { timeout: 15000 });
	await acceptFirstInvite(b.page);
	log('bob accepted the current-only invite');

	// give decryption a moment, then assert on CONTENT
	let snaps = null;
	for (let i = 0; i < 30; i++) {
		await b.page.waitForTimeout(1000);
		snaps = await decryptedSnapshots(b.page);
		if (snaps && snaps.length > 0) break;
	}
	if (!snaps || snaps.length === 0) throw new Error('bob decrypted no snapshots');
	const currentOk = snaps.every(
		(s) => (s.content.datapoints ?? []).length === 1 && s.content.projection?.grant === 'current'
	);
	const historyLeak = snaps.some((s) => (s.content.datapoints ?? []).length > 1);
	const currentRoomId = snaps[0].roomId;
	log(`bob decrypted ${snaps.length} snapshot(s) in ${currentRoomId}`);
	log('every snapshot is a 1-datapoint current projection (want true):', currentOk);
	log('any snapshot carries >1 datapoint (want false):', historyLeak);

	// UI disclosure line
	await b.page.goto(`${DEV}/graphs/${encodeURIComponent(currentRoomId)}`, {
		waitUntil: 'domcontentloaded'
	});
	let disclosure = false;
	for (let i = 0; i < 30 && !disclosure; i++) {
		await b.page.waitForTimeout(500);
		disclosure = ((await b.page.locator('main').textContent()) ?? '').includes(
			'current state only'
		);
	}
	log('bob sees the current-only disclosure (want true):', disclosure);

	// ── Part 2: upgrade to full history ────────────────────────────────
	// (the fold is already open from part 1; guard anyway for reload paths.
	// NB: check the DOM `open` property — getAttribute returns "" when open,
	// which is falsy and would toggle the fold shut.)
	const foldOpen = await a.page.locator('details.manual-invite').evaluate((el) => el.open);
	if (!foldOpen) {
		await a.page.locator('details.manual-invite summary').click();
	}
	await a.page.locator('input[placeholder="@bob:example.org"]').fill(bobMatrixId);
	await a.page.locator('input[type="radio"][value="history"]').check();
	await a.page.getByRole('button', { name: /^Invite$/ }).click();
	await a.page.waitForSelector('p.success', { timeout: 15000 });
	await acceptFirstInvite(b.page);
	log('bob accepted the history invite');

	let historySnaps = null;
	let upgraded = false;
	for (let i = 0; i < 30 && !upgraded; i++) {
		await b.page.waitForTimeout(1000);
		historySnaps = await decryptedSnapshots(b.page);
		upgraded = (historySnaps ?? []).some(
			(s) =>
				s.roomId !== currentRoomId &&
				(s.content.datapoints ?? []).length === 2 &&
				s.content.projection === undefined
		);
	}
	log('bob received a 2-datapoint, unmarked snapshot in a new room (want true):', upgraded);

	// grant change = room change: bob must no longer be joined to the
	// current-only room.
	const bobToken = await b.page.evaluate(
		() => JSON.parse(localStorage.getItem('queer-curves:matrix-session') ?? '{}').accessToken
	);
	const joined = await (
		await fetch(`${HS}/_matrix/client/v3/joined_rooms`, {
			headers: { Authorization: `Bearer ${bobToken}` }
		})
	).json();
	const stillInCurrent = (joined.joined_rooms ?? []).includes(currentRoomId);
	log('bob still joined to the current-only room (want false):', stillInCurrent);

	const ok = currentOk && !historyLeak && disclosure && upgraded && !stillInCurrent;
	log(ok ? 'PROBE PASSED' : 'PROBE FAILED');
	process.exitCode = ok ? 0 : 1;
} finally {
	await browser.close();
}
