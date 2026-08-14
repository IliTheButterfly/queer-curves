// Headless coverage for network name privacy: masked-by-default labels,
// press-and-hold reveal (with its warning overlay), and the consent gate in
// front of PNG export.
//
// Unlike the other probes this needs no homeserver — it drives the bundled
// polycule fixture, because the behaviour under test is presentation-layer.
// What it can't check from the DOM is the label text itself: cytoscape draws
// to canvas, so "Person 1" vs "Bea" is covered by the unit tests in
// src/lib/graphs/network/privacy.test.ts. What it checks here is that the
// controls, the overlay, the gate and the download wiring actually work in a
// real browser.
//
// Run:
//   node scripts/name-privacy-probe.mjs

import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const CHROMIUM =
	process.env.CHROMIUM ?? '/home/iliana/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const log = (...a) => console.error('[name-privacy-probe]', ...a);

function assert(cond, msg) {
	if (!cond) throw new Error(msg);
	log('✓', msg);
}

const browser = await chromium.launch({
	executablePath: CHROMIUM,
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage();
page.on('console', (m) => {
	if (m.type() === 'error') console.error('  [page-error]', m.text().slice(0, 160));
});

try {
	await page.goto(`${DEV}/graphs/fixture-polycule`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('.privacy-bar', { timeout: 15000 });

	// 1. Hidden by default.
	assert(
		(await page.locator('.reveal-overlay').count()) === 0,
		'no reveal overlay on load — names start hidden'
	);
	const hold = page.locator('button.hold');
	assert(
		(await hold.getAttribute('aria-pressed')) === 'false',
		'hold button reports not-pressed on load'
	);

	// 2. Press and hold reveals, and warns while revealed.
	// hover() scrolls it into view first — the privacy bar sits below the fold
	// at the default viewport, and page.mouse takes viewport coordinates.
	await hold.hover();
	await page.mouse.down();
	await page.waitForSelector('.reveal-overlay', { timeout: 5000 });
	const warning = await page.locator('.reveal-overlay').innerText();
	assert(/don't screenshot/i.test(warning), 'overlay warns against sharing while names show');
	assert((await hold.getAttribute('aria-pressed')) === 'true', 'hold button reports pressed');

	// 3. Releasing re-hides immediately — this must not be a sticky toggle.
	await page.mouse.up();
	await page.waitForSelector('.reveal-overlay', { state: 'detached', timeout: 5000 });
	assert(true, 'names re-hide the moment the button is released');

	// 4. Export is gated on an explicit consent tick.
	await page.evaluate(() => {
		window.__downloads = [];
		HTMLAnchorElement.prototype.click = function () {
			window.__downloads.push({
				href: this.href.slice(0, 15),
				size: this.href.length,
				name: this.download
			});
		};
	});
	await page.getByRole('button', { name: /Export PNG/ }).click();
	await page.waitForSelector('.dialog', { timeout: 5000 });
	const dialogText = await page.locator('.dialog').innerText();
	assert(
		/Bea/.test(dialogText) && /Cy/.test(dialogText),
		'dialog names everyone the image exposes'
	);
	assert(!/Alex/.test(dialogText), 'dialog does not ask you for consent from yourself');
	const confirmBtn = page.locator('.dialog button.primary');
	assert(await confirmBtn.isDisabled(), 'export is disabled until consent is confirmed');

	await page.locator('.consent input').check();
	assert(await confirmBtn.isEnabled(), 'export enables once consent is confirmed');
	await confirmBtn.click();

	// 5. A real PNG comes out, and the screen stays masked afterwards.
	await page.waitForFunction(() => window.__downloads.length > 0, { timeout: 10000 });
	const [dl] = await page.evaluate(() => window.__downloads);
	assert(dl.href === 'data:image/png;', 'export produced a PNG data URL');
	assert(dl.size > 5000, `PNG is non-trivial (${dl.size} chars of base64)`);
	assert(/\.png$/.test(dl.name), `download is named ${dl.name}`);
	assert(
		(await page.locator('.reveal-overlay').count()) === 0,
		'exporting with names did not leave names showing on screen'
	);

	log('PASS');
} catch (e) {
	log('FAIL', e.message);
	process.exitCode = 1;
} finally {
	await browser.close();
}
