<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import '../app.css';
	import {
		checkKeyRestoreNeeded,
		getCryptoStatus,
		logout,
		restoreSession
	} from '$lib/matrix/client.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';

	let { children } = $props();
	let loggingOut = $state(false);
	let needsRestore = $state(false);

	const cryptoBannerVisible = $derived(
		matrixStore.hydrated &&
			matrixStore.session !== null &&
			matrixStore.cryptoStatus !== null &&
			!matrixStore.cryptoStatus.ready &&
			page.url.pathname !== '/setup-keys'
	);

	const restoreBannerVisible = $derived(
		matrixStore.hydrated &&
			matrixStore.session !== null &&
			matrixStore.cryptoStatus?.ready === true &&
			needsRestore &&
			page.url.pathname !== '/restore-keys'
	);

	onMount(async () => {
		try {
			const restored = await restoreSession();
			matrixStore.session = restored;
			if (restored) {
				matrixStore.cryptoStatus = await getCryptoStatus();
				// If this device has crypto-ready on the server side but no
				// cached backup-decryption-key locally, we need to ask the
				// user for their recovery key before any existing graph will
				// open.
				try {
					const restoreState = await checkKeyRestoreNeeded();
					needsRestore = restoreState.needsRestore;
				} catch {
					needsRestore = false;
				}
			}
		} catch {
			matrixStore.session = null;
		} finally {
			matrixStore.hydrated = true;
		}
	});

	async function handleLogout() {
		if (loggingOut) return;
		loggingOut = true;
		try {
			await logout();
			matrixStore.session = null;
			matrixStore.cryptoStatus = null;
			// Any route gated on a logged-in session (e.g. /graphs/{room-id})
			// would otherwise stay open after logout, showing the previous
			// data or a stale UI. Send the user home where the route is
			// session-agnostic.
			await goto('/');
		} finally {
			loggingOut = false;
		}
	}
</script>

<header class="app-chrome">
	<a class="brand" href="/">queer-curves</a>
	<div class="auth">
		{#if !matrixStore.hydrated}
			<span class="muted">…</span>
		{:else if matrixStore.session}
			<span class="user-id" title="Matrix user id">
				{matrixStore.session.userId}
			</span>
			<button type="button" class="link" onclick={handleLogout} disabled={loggingOut}>
				{loggingOut ? 'Logging out…' : 'Log out'}
			</button>
		{:else}
			<a class="login-link" href="/login">Log in</a>
		{/if}
	</div>
</header>

{#if cryptoBannerVisible}
	<aside class="banner" role="status">
		<span>
			Encryption keys aren't set up on this account yet. Until they are, you can't create or share
			Matrix-backed graphs.
		</span>
		<a class="banner-link" href="/setup-keys">Set up now →</a>
	</aside>
{:else if restoreBannerVisible}
	<aside class="banner" role="status">
		<span>
			This device hasn't unlocked your encrypted history yet. Paste your recovery key to read graphs
			you made on other devices.
		</span>
		<a class="banner-link" href="/restore-keys">Restore now →</a>
	</aside>
{/if}

{@render children()}

<style>
	.app-chrome {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		background: rgba(255, 255, 255, 0.02);
	}
	.brand {
		font-weight: 600;
		color: var(--color-accent);
		text-decoration: none;
	}
	.brand:hover {
		filter: brightness(1.15);
	}
	.auth {
		display: inline-flex;
		gap: var(--space-3);
		align-items: center;
		font-size: 0.9em;
	}
	.muted {
		color: var(--color-muted);
	}
	.user-id {
		font-family: var(--font-mono);
		color: var(--color-fg);
	}
	.login-link {
		color: var(--color-accent);
		text-decoration: none;
		padding: var(--space-1) var(--space-3);
		border: 1px solid rgba(201, 138, 255, 0.3);
		border-radius: 4px;
	}
	.login-link:hover {
		background: rgba(201, 138, 255, 0.1);
	}
	button.link {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-muted);
		padding: var(--space-1) var(--space-3);
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}
	button.link:hover:not(:disabled) {
		color: var(--color-fg);
		border-color: var(--color-accent);
	}
	button.link:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		background: rgba(255, 200, 80, 0.08);
		border-bottom: 1px solid rgba(255, 200, 80, 0.2);
		font-size: 0.9em;
		color: rgba(255, 220, 160, 1);
	}
	.banner-link {
		color: rgba(255, 220, 160, 1);
		text-decoration: none;
		padding: var(--space-1) var(--space-3);
		border: 1px solid rgba(255, 200, 80, 0.3);
		border-radius: 4px;
		white-space: nowrap;
	}
	.banner-link:hover {
		background: rgba(255, 200, 80, 0.12);
	}
</style>
