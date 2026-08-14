#!/usr/bin/env node
// Interactive/batch driver for the queer-curves SPA.
//
// Reads one command per line from stdin, prints one `ok …` / `err …` line
// per command to stdout. Everything chatty (progress, browser console) goes
// to stderr so `driver.mjs < script | grep '^err'` is a usable check.
//
// Usage:
//   node .claude/skills/run-queer-curves/driver.mjs [--profile DIR] [--headed] <<'EOF'
//   goto /
//   ss landing
//   quit
//   EOF
//
// --profile DIR uses a persistent browser context. That matters here: the
// Matrix session lives in localStorage and the E2EE crypto store lives in
// IndexedDB, so a second run against the same profile resumes the same
// logged-in *device* (same device id, same megolm keys). A fresh profile is
// a brand-new device and will need the recovery key to read old graphs.
//
// Env: DEV_URL (default http://localhost:5174)
//      HOMESERVER (default http://localhost:8008)
//      CHROMIUM (default: auto-detected playwright chromium, then system)
//      SHOT_DIR (default /tmp/qc-shots)

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import path from 'node:path';

const DEV = process.env.DEV_URL ?? 'http://localhost:5174';
const HS = process.env.HOMESERVER ?? 'http://localhost:8008';
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/qc-shots';

const argv = process.argv.slice(2);
const profileDir = argFlag('--profile');
const headed = argv.includes('--headed');

function argFlag(name) {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : null;
}

// playwright-core ships no browser. Find the one `npx playwright install
// chromium` dropped in the cache, else fall back to a system chromium.
function findChromium() {
	if (process.env.CHROMIUM) return process.env.CHROMIUM;
	const cache = path.join(homedir(), '.cache', 'ms-playwright');
	if (existsSync(cache)) {
		for (const dir of readdirSync(cache)
			.filter((d) => d.startsWith('chromium-'))
			.sort()
			.reverse()) {
			for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
				const p = path.join(cache, dir, rel);
				if (existsSync(p)) return p;
			}
		}
	}
	for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
		if (existsSync(p)) return p;
	}
	throw new Error(
		'No chromium found. Run `pnpm exec playwright install chromium` or set CHROMIUM=/path/to/chrome'
	);
}

const log = (...a) => console.error('[driver]', ...a);
const consoleErrors = [];
const httpFailures = [];

mkdirSync(SHOT_DIR, { recursive: true });

const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage'];
let browser = null;
let ctx;
if (profileDir) {
	mkdirSync(profileDir, { recursive: true });
	ctx = await chromium.launchPersistentContext(profileDir, {
		executablePath: findChromium(),
		headless: !headed,
		args: launchArgs
	});
} else {
	browser = await chromium.launch({
		executablePath: findChromium(),
		headless: !headed,
		args: launchArgs
	});
	ctx = await browser.newContext();
}
const page = ctx.pages()[0] ?? (await ctx.newPage());

page.on('console', (m) => {
	if (m.type() === 'error') {
		consoleErrors.push(m.text());
		console.error('  [page err]', m.text().slice(0, 200));
	}
});
page.on('pageerror', (e) => {
	consoleErrors.push(`pageerror: ${e.message}`);
	console.error('  [pageerror]', e.message.slice(0, 200));
});
page.on('response', (r) => {
	if (r.status() >= 400) httpFailures.push(`${r.status()} ${r.request().method()} ${r.url()}`);
});
page.on('requestfailed', (r) => {
	httpFailures.push(`FAILED ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? '?'}`);
});
// The app confirms destructive actions (delete graph) with window.confirm.
page.on('dialog', (d) => d.accept());

const url = (p) => (p.startsWith('http') ? p : `${DEV}${p.startsWith('/') ? p : '/' + p}`);

// `ssr = false` means the served HTML is an empty shell — DOMContentLoaded
// fires with a blank <body> and a screenshot taken there is a white square.
// Wait for Svelte to hydrate something into the page before returning.
async function gotoHydrated(target) {
	await page.goto(url(target), { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, {
		timeout: 30000
	});
	return page.url();
}

// ─── High-level flows ───────────────────────────────────────────────────────

// Register a brand-new account AND run first-time key setup. This is the
// only path that yields a crypto-ready session: without cross-signing + key
// backup, store/graphs.ts falls back to localStorage and nothing touches
// Matrix. Returns the recovery key, which you need to unlock this account on
// any other browser profile.
async function registerAndSetup(username, password) {
	await gotoHydrated('/login');
	await page.getByRole('tab', { name: 'Create account' }).click();
	await page.locator('input[type="url"]').fill(HS);
	await page.locator('input[type="text"]').fill(username);
	await page.locator('input[type="password"]').fill(password);
	await Promise.all([
		page.waitForURL(/setup-keys/, { timeout: 60000 }),
		page.getByRole('button', { name: /Create account/i }).click()
	]);
	await page.getByRole('button', { name: /Generate recovery key/i }).click();
	await page.waitForSelector('.recovery-key code', { timeout: 60000 });
	const recoveryKey = (await page.locator('.recovery-key code').innerText()).trim();
	await page.locator('input[type="checkbox"]').check();
	await Promise.all([
		page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 30000 }),
		page.getByRole('button', { name: 'Continue' }).click()
	]);
	return recoveryKey;
}

async function loginExisting(username, password) {
	await gotoHydrated('/login');
	await page.locator('input[type="url"]').fill(HS);
	await page.locator('input[type="text"]').fill(username);
	await page.locator('input[type="password"]').fill(password);
	await Promise.all([
		page.waitForURL((u) => !/\/login$/.test(new URL(u).pathname), { timeout: 60000 }),
		page.getByRole('button', { name: /^Log in$/i }).click()
	]);
	return new URL(page.url()).pathname;
}

async function restoreKeys(recoveryKey) {
	await gotoHydrated('/restore-keys');
	await page.locator('input[type="text"], textarea').first().fill(recoveryKey);
	await page.getByRole('button', { name: /Restore keys/i }).click();
	// Success swaps the form for an explainer + a "Continue" button; failure
	// renders p.error in place. There is no single result container, so race
	// the two.
	await Promise.race([
		page.waitForSelector('button:has-text("Continue")', { timeout: 90000 }),
		page.waitForSelector('p.error', { timeout: 90000 })
	]);
	const out = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ').trim();
	if (await page.locator('button:has-text("Continue")').count()) {
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.waitForTimeout(2000);
	}
	return out.slice(0, 400);
}

// Create a spectrum graph via /graphs/new and return its id (a Matrix room
// id starting with `!` when logged in + crypto ready, else a local `g_…`).
async function newGraph(name, type = 'spectrum') {
	await gotoHydrated('/graphs/new');
	// GraphConfigForm has no ids and reuses the label "Name" for every axis,
	// so anchor on the top-level field and take the first match.
	if (type === 'network') await page.locator('input[type="radio"][value="network"]').check();
	await page
		.locator('label.field')
		.filter({ hasText: /^Name/ })
		.locator('input')
		.first()
		.fill(name);
	await Promise.all([
		// Must exclude /graphs/new itself — a bare /graphs/[^/]+$ matches the
		// page we're already on and resolves before the room even exists.
		page.waitForURL(
			(u) => /\/graphs\/[^/]+$/.test(u.pathname) && !/\/graphs\/new$/.test(u.pathname),
			{
				timeout: 60000
			}
		),
		page.getByRole('button', { name: /Create graph/i }).click()
	]);
	return decodeURIComponent(new URL(page.url()).pathname.split('/graphs/')[1]);
}

// Add a datapoint to the spectrum graph currently open. Coordinate inputs
// carry aria-label="<axis name> coordinate", but the axis names are
// user-chosen, so index into .coord-inputs instead.
async function addDatapoint(coords) {
	const inputs = page.locator('.coord-inputs input[type="number"]');
	const n = await inputs.count();
	if (n === 0)
		throw new Error('no coordinate inputs — is this a spectrum graph, and do you own it?');
	for (let i = 0; i < Math.min(n, coords.length); i++) {
		await inputs.nth(i).fill(String(coords[i]));
	}
	const before = await page.locator('.coord-inputs').count();
	await page.getByRole('button', { name: /commit datapoint/i }).click();
	await page.waitForTimeout(1500); // snapshot re-send round-trips through Matrix
	return `committed ${coords.slice(0, n).join(',')} (${before} form(s) on page)`;
}

// Invite another Matrix account to the graph currently open. Only works for
// Matrix-backed graphs (`!room:server` ids) that you own.
async function invite(userId) {
	const input = page.locator('input[placeholder="@bob:example.org"]');
	await input.fill(userId);
	await page
		.locator('form:has(input[placeholder="@bob:example.org"]) button[type="submit"]')
		.click();
	await page.waitForTimeout(3000);
	return (
		await page.locator('.share, aside, section').filter({ hasText: userId }).first().innerText()
	)
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 400);
}

// Accept the first pending invite listed on the landing page.
async function acceptInvite() {
	await gotoHydrated('/');
	await page.waitForSelector('button:has-text("Accept")', { timeout: 60000 });
	await page.getByRole('button', { name: 'Accept' }).first().click();
	await page.waitForTimeout(4000); // join + megolm re-share from the inviter
	return 'accepted';
}

// Read the graph list off the landing page.
async function listGraphs() {
	await gotoHydrated('/');
	await page.waitForTimeout(2500); // catch-up sync trickles rooms in
	return await page.evaluate(() =>
		Array.from(document.querySelectorAll('a[href^="/graphs/"]'))
			.filter((a) => a.getAttribute('href') !== '/graphs/new')
			.map(
				(a) => `${a.getAttribute('href').slice(8)} :: ${a.textContent.replace(/\s+/g, ' ').trim()}`
			)
	);
}

// ─── Command table ──────────────────────────────────────────────────────────

const commands = {
	goto: async (p) => await gotoHydrated(p),
	ss: async (name = `shot-${Date.now()}`) => {
		const file = path.join(SHOT_DIR, `${name}.png`);
		await page.screenshot({ path: file, fullPage: true });
		return file;
	},
	click: async (...sel) => {
		await page.locator(sel.join(' ')).first().click();
		return 'clicked';
	},
	// `role button Create graph` — the app is built with semantic roles, so
	// this reaches most controls without brittle CSS.
	role: async (role, ...name) => {
		await page
			.getByRole(role, { name: name.join(' ') })
			.first()
			.click();
		return 'clicked';
	},
	fill: async (sel, ...val) => {
		await page.locator(sel).first().fill(val.join(' '));
		return 'filled';
	},
	text: async (...sel) => {
		const s = sel.length ? sel.join(' ') : 'body';
		return (await page.locator(s).first().innerText()).replace(/\s+/g, ' ').trim().slice(0, 2000);
	},
	// Args are whitespace-split, so a selector containing spaces or a
	// comma-list arrives in pieces — rejoin everything except a trailing
	// numeric timeout.
	wait: async (...args) => {
		let ms = 30000;
		if (args.length > 1 && /^\d+$/.test(args[args.length - 1])) ms = Number(args.pop());
		await page.waitForSelector(args.join(' '), { timeout: ms });
		return 'present';
	},
	sleep: async (ms) => {
		await page.waitForTimeout(Number(ms));
		return `slept ${ms}ms`;
	},
	eval: async (...js) => JSON.stringify(await page.evaluate(js.join(' '))),
	url: async () => page.url(),
	register: async (user, pass = 'devpass1234') => await registerAndSetup(user, pass),
	login: async (user, pass = 'devpass1234') => await loginExisting(user, pass),
	restore: async (...key) => await restoreKeys(key.join(' ')),
	newgraph: async (type, ...name) => await newGraph(name.join(' '), type),
	datapoint: async (...coords) => await addDatapoint(coords.map(Number)),
	invite: async (userId) => await invite(userId),
	accept: async () => await acceptInvite(),
	graphs: async () => JSON.stringify(await listGraphs()),
	// Everything the page logged as an error / every >=400 response so far.
	errors: async () => JSON.stringify({ console: consoleErrors, http: httpFailures }),
	quit: async () => 'bye'
};

// ─── REPL loop ──────────────────────────────────────────────────────────────

let failures = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const raw of rl) {
	const line = raw.trim();
	if (!line || line.startsWith('#')) continue;
	const [name, ...args] = line.split(/\s+/);
	const fn = commands[name];
	if (!fn) {
		failures++;
		console.log(`err unknown command: ${name} (have: ${Object.keys(commands).join(' ')})`);
		continue;
	}
	log(`→ ${line}`);
	try {
		const out = await fn(...args);
		console.log(`ok ${name}: ${out ?? ''}`);
	} catch (e) {
		failures++;
		console.log(`err ${name}: ${(e?.message ?? String(e)).split('\n')[0]}`);
	}
	if (name === 'quit') break;
}

await ctx.close();
if (browser) await browser.close();
log(failures ? `${failures} command(s) failed` : 'all commands ok');
process.exit(failures ? 1 : 0);
