<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { logout, restoreSession } from '$lib/matrix/client.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';

	let { children } = $props();
	let loggingOut = $state(false);

	onMount(async () => {
		try {
			const restored = await restoreSession();
			matrixStore.session = restored;
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
</style>
