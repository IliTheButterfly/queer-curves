<script lang="ts">
	import { goto } from '$app/navigation';
	import { restoreFromRecoveryKey } from '$lib/matrix/client.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';

	let recoveryKey = $state('');
	let working = $state(false);
	let error = $state<string | null>(null);
	let result = $state<{ importedTotal: number; importedNew: number } | null>(null);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (working) return;
		error = null;
		working = true;
		try {
			result = await restoreFromRecoveryKey(recoveryKey);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			working = false;
		}
	}

	async function handleFinish() {
		await goto('/');
	}
</script>

<svelte:head>
	<title>Restore from recovery key – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← home</a></p>
	<h1>Restore from recovery key</h1>

	{#if !matrixStore.session}
		<p class="error" role="alert">
			You need to be logged in first. <a href="/login">Log in</a>.
		</p>
	{:else if result}
		<section class="explainer">
			<p>
				Restored <strong>{result.importedNew}</strong>
				{result.importedNew === 1 ? 'key' : 'keys'} from your server-side backup
				{#if result.importedTotal !== result.importedNew}
					({result.importedTotal} total were available).
				{:else}
					.
				{/if}
			</p>
			<p class="muted">
				Existing encrypted graphs on this device should now open. If something still shows
				<em>Loading…</em>, give sync a moment and refresh.
			</p>
		</section>
		<div class="actions">
			<button type="button" class="primary" onclick={handleFinish}>Continue</button>
		</div>
	{:else}
		<section class="explainer">
			<p>
				Paste the recovery key you saved when you first set up encryption. queer-curves uses it to
				download your existing room keys from the server-side backup so this device can read graphs
				you created on other devices (or before logging out).
			</p>
			<p class="muted">
				<small>
					The key starts with <code>Es</code> and looks like
					<code>Es#X Y#X Y#X Y#X Y</code>… If you've lost it, encrypted history on this account is
					unrecoverable; you can still create new graphs.
				</small>
			</p>
		</section>

		<form onsubmit={handleSubmit} class="restore-form">
			<label class="field">
				<span class="label">Recovery key</span>
				<textarea
					bind:value={recoveryKey}
					required
					rows="3"
					placeholder="Es… (paste the full key, spaces are OK)"
					autocomplete="off"
					spellcheck="false"
				></textarea>
			</label>

			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			<div class="actions">
				<button type="submit" class="primary" disabled={working || !recoveryKey.trim()}>
					{working ? 'Restoring…' : 'Restore keys'}
				</button>
			</div>
		</form>
	{/if}
</main>

<style>
	main {
		max-width: 70ch;
	}
	.back a {
		color: var(--color-muted);
		text-decoration: none;
	}
	.back a:hover {
		color: var(--color-accent);
	}
	.explainer {
		padding: var(--space-3) var(--space-4);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
	}
	.explainer p:first-child {
		margin-top: 0;
	}
	.explainer p:last-child {
		margin-bottom: 0;
	}
	.muted {
		color: var(--color-muted);
	}
	.error {
		margin: var(--space-3) 0;
		padding: var(--space-2) var(--space-3);
		background: rgba(255, 100, 100, 0.1);
		border: 1px solid rgba(255, 100, 100, 0.3);
		color: rgba(255, 180, 180, 1);
		border-radius: 4px;
	}
	.restore-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-4);
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
	textarea {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
		font-family: var(--font-mono);
		resize: vertical;
	}
	textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	code {
		font-family: var(--font-mono);
		color: var(--color-accent);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--space-3);
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
</style>
