import { chromium } from 'playwright-core';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const U = `mp${Date.now().toString(36)}`;
const PW = 'devpass1234';
const log = (...a) => console.error('[migrate-probe]', ...a);

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
	// 1. NOT logged in — create a localStorage graph by visiting / and using /graphs/new
	await page.goto(`${DEV}/`, { waitUntil: 'domcontentloaded' });
	await page.waitForTimeout(1000);
	await page.goto(`${DEV}/graphs/new`, { waitUntil: 'domcontentloaded' });
	await page.locator('input[type="text"]').first().fill(`local-only-${U}`);
	await Promise.all([
		page.waitForURL(/\/graphs\/g_/, { timeout: 30000 }),
		page.getByRole('button', { name: /Create graph/i }).click()
	]);
	log('created local-only graph at', page.url());

	// 2. Verify the landing page shows it
	await page.goto(`${DEV}/`, { waitUntil: 'domcontentloaded' });
	await page.waitForTimeout(500);
	let main = (await page.locator('main').textContent()) ?? '';
	log('local-only visible while logged out:', main.includes(`local-only-${U}`));

	// 3. Register + setup keys (now logged in)
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
	log('logged in + keys set up');

	// 4. Landing page should show the local-only graph AND the migrate banner
	await page.waitForTimeout(2000);
	main = (await page.locator('main').textContent()) ?? '';
	const promptCount = await page.locator('aside.migrate-prompt').count();
	log('local-only visible after login:', main.includes(`local-only-${U}`));
	log('migrate prompt visible:', promptCount > 0);

	// 5. Click the migrate button
	if (promptCount > 0) {
		await page.getByRole('button', { name: /Move to encrypted storage/i }).click();
		// wait for either "Moving…" to disappear or the prompt to vanish
		await page.waitForFunction(
			() => document.querySelectorAll('aside.migrate-prompt').length === 0,
			null,
			{ timeout: 30000 }
		);
		log('migrate prompt gone after click');
	}

	// 6. Graph should still be listed (now Matrix-backed). Check id changed.
	await page.waitForTimeout(2000);
	const links = await page
		.locator('.graph-list a')
		.evaluateAll((els) =>
			els.map((el) => ({ href: el.getAttribute('href'), text: el.textContent?.trim() }))
		);
	const ourGraph = links.find((l) => l.text?.includes(`local-only-${U}`));
	log('graph after migration:', ourGraph);
	log('id is now a Matrix room id:', /\/graphs\/!/.test(ourGraph?.href ?? ''));
} finally {
	await browser.close();
}
