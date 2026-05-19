<script lang="ts">
	import { goto } from '$app/navigation';
	import { login, register } from '$lib/matrix/client.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';

	type Mode = 'login' | 'register';

	let mode = $state<Mode>('login');
	let baseUrl = $state('http://localhost:8008');
	let username = $state('');
	let password = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (submitting) return;
		error = null;
		submitting = true;
		try {
			const session =
				mode === 'login'
					? await login({ baseUrl, username, password })
					: await register({ baseUrl, username, password });
			matrixStore.session = session;
			await goto('/');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{mode === 'login' ? 'Log in' : 'Create account'} – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← home</a></p>
	<h1>{mode === 'login' ? 'Log in' : 'Create account'}</h1>

	<div class="mode-tabs" role="tablist">
		<button
			type="button"
			role="tab"
			class:active={mode === 'login'}
			aria-selected={mode === 'login'}
			onclick={() => (mode = 'login')}
		>
			Log in
		</button>
		<button
			type="button"
			role="tab"
			class:active={mode === 'register'}
			aria-selected={mode === 'register'}
			onclick={() => (mode = 'register')}
		>
			Create account
		</button>
	</div>

	<form onsubmit={handleSubmit} class="login-form">
		<label class="field">
			<span class="label">Homeserver URL</span>
			<input
				type="url"
				bind:value={baseUrl}
				required
				placeholder="http://localhost:8008"
				autocomplete="url"
			/>
			<small class="hint">
				Local dev server runs at <code>http://localhost:8008</code>. See
				<code>scripts/dev-matrix.sh up</code> in the README.
			</small>
		</label>

		<label class="field">
			<span class="label">Username</span>
			<input
				type="text"
				bind:value={username}
				required
				placeholder="alice"
				autocomplete={mode === 'login' ? 'username' : 'off'}
				pattern="^[a-z0-9._=\-/]+$"
				title="lowercase letters, digits, and . _ = - / are allowed"
			/>
			<small class="hint"
				>Without the leading <code>@</code> or the <code>:server</code> part.</small
			>
		</label>

		<label class="field">
			<span class="label">Password</span>
			<input
				type="password"
				bind:value={password}
				required
				autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
				minlength={mode === 'register' ? 8 : 1}
			/>
		</label>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<div class="actions">
			<button type="submit" class="primary" disabled={submitting}>
				{#if submitting}
					Working…
				{:else if mode === 'login'}
					Log in
				{:else}
					Create account
				{/if}
			</button>
		</div>
	</form>

	<details class="caveat">
		<summary>What this stores locally</summary>
		<p>
			On successful sign-in, queer-curves saves your homeserver URL, user id, device id, and Matrix
			access token to this browser's <code>localStorage</code>. Anyone with access to this browser
			profile can act as your Matrix account.
		</p>
		<p>
			A follow-up will encrypt this at rest using a key derived from your Matrix recovery key (see
			<code>STACK.md</code> §6). Until then, treat your browser as the trust boundary and log out on shared
			devices.
		</p>
	</details>
</main>

<style>
	main {
		max-width: 60ch;
	}
	.back a {
		color: var(--color-muted);
		text-decoration: none;
	}
	.back a:hover {
		color: var(--color-accent);
	}

	.mode-tabs {
		display: inline-flex;
		gap: var(--space-1);
		margin: var(--space-3) 0;
		padding: 2px;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 6px;
	}
	.mode-tabs button {
		background: transparent;
		border: none;
		color: var(--color-muted);
		padding: var(--space-1) var(--space-3);
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}
	.mode-tabs button:hover {
		color: var(--color-fg);
	}
	.mode-tabs button.active {
		background: rgba(201, 138, 255, 0.18);
		color: var(--color-accent);
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.label {
		font-size: 0.85em;
		color: var(--color-muted);
	}
	.hint {
		font-size: 0.8em;
		color: var(--color-muted);
	}
	input {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.error {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		background: rgba(255, 100, 100, 0.1);
		border: 1px solid rgba(255, 100, 100, 0.3);
		color: rgba(255, 180, 180, 1);
		border-radius: 4px;
		font-size: 0.9em;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
	}
	button.primary {
		background: var(--color-accent);
		color: #1a0a2a;
		border: none;
		padding: var(--space-2) var(--space-4);
		border-radius: 4px;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button.primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button.primary:not(:disabled):hover {
		filter: brightness(1.1);
	}

	.caveat {
		margin-top: var(--space-4);
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.02);
		border: 1px dashed rgba(255, 255, 255, 0.08);
		border-radius: 6px;
		font-size: 0.9em;
	}
	.caveat summary {
		cursor: pointer;
		color: var(--color-muted);
	}
	.caveat p {
		margin: var(--space-2) 0 0;
		color: var(--color-muted);
	}
	code {
		font-family: var(--font-mono);
		color: var(--color-accent);
	}
</style>
