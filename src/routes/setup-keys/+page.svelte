<script lang="ts">
	import { goto } from '$app/navigation';
	import { getCryptoStatus, hasPendingAuthPassword, setupCrypto } from '$lib/matrix/client.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';

	type Stage = 'intro' | 'showing' | 'done';

	let stage = $state<Stage>('intro');
	let recoveryKey = $state<string | null>(null);
	let savedConfirmed = $state(false);
	let working = $state(false);
	let error = $state<string | null>(null);
	let copied = $state(false);

	async function handleGenerate() {
		if (working) return;
		error = null;
		working = true;
		try {
			if (!hasPendingAuthPassword()) {
				error =
					'Re-authentication is required to set up encryption keys. Log out and back in to continue.';
				return;
			}
			const result = await setupCrypto();
			recoveryKey = result.encodedRecoveryKey;
			matrixStore.cryptoStatus = await getCryptoStatus();
			stage = 'showing';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			working = false;
		}
	}

	async function handleCopy() {
		if (!recoveryKey) return;
		try {
			await navigator.clipboard.writeText(recoveryKey);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard refused — leave the manual copy path.
		}
	}

	async function handleFinish() {
		stage = 'done';
		await goto('/');
	}
</script>

<svelte:head>
	<title>Set up encryption keys – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← home</a></p>
	<h1>Set up encryption keys</h1>

	{#if !matrixStore.session}
		<p class="error" role="alert">
			You need to be logged in to set up encryption keys. <a href="/login">Log in</a> first.
		</p>
	{:else if stage === 'intro'}
		<section class="explainer">
			<p>
				queer-curves stores your graphs in end-to-end encrypted Matrix rooms. To create or share
				graphs, your account needs:
			</p>
			<ul>
				<li>
					<strong>Cross-signing keys</strong> — so devices can verify each other and decrypt each other's
					history.
				</li>
				<li>
					<strong>Encrypted key backup</strong> — so if you lose this device you can still decrypt past
					data on a new one.
				</li>
			</ul>
			<p>
				Both are protected by a single <strong>recovery key</strong> we'll generate next. Save it somewhere
				safe — losing it means losing access to any history you couldn't otherwise re-derive.
			</p>
			<p class="muted">
				<small>
					This is required before any graph can be created. See
					<code>sharing_model.md</code> §16.4.
				</small>
			</p>
		</section>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<div class="actions">
			<button
				type="button"
				class="primary"
				onclick={handleGenerate}
				disabled={working || !hasPendingAuthPassword()}
			>
				{working ? 'Setting up…' : 'Generate recovery key'}
			</button>
		</div>

		{#if !hasPendingAuthPassword()}
			<p class="muted">
				<small>
					Your password isn't cached on this page. Log out and back in to enable key setup, then
					return here.
				</small>
			</p>
		{/if}
	{:else if stage === 'showing' && recoveryKey}
		<section class="explainer">
			<p>
				<strong>Save this recovery key now.</strong> If you lose it, encrypted data on this account becomes
				unrecoverable.
			</p>
			<p class="muted">
				A password manager works. A piece of paper in a safe place works. Anything that survives
				this device being lost or wiped.
			</p>
			<p class="muted">
				<small>
					You'll need this key again every time you log in on a new device or a fresh browser —
					paste it on the <a href="/restore-keys">Restore from recovery key</a> page to unlock your existing
					graphs.
				</small>
			</p>
		</section>

		<div class="recovery-key" aria-label="recovery key">
			<code>{recoveryKey}</code>
			<button type="button" class="copy" onclick={handleCopy}>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>

		<label class="confirm">
			<input type="checkbox" bind:checked={savedConfirmed} />
			I have saved this recovery key somewhere safe.
		</label>

		<div class="actions">
			<button type="button" class="primary" onclick={handleFinish} disabled={!savedConfirmed}>
				Continue
			</button>
		</div>
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
	.explainer ul {
		padding-left: var(--space-4);
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
	.recovery-key {
		display: flex;
		gap: var(--space-2);
		align-items: stretch;
		margin: var(--space-4) 0;
	}
	.recovery-key code {
		flex: 1;
		padding: var(--space-3);
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid rgba(201, 138, 255, 0.3);
		border-radius: 4px;
		font-family: var(--font-mono);
		color: var(--color-accent);
		word-break: break-all;
		user-select: all;
	}
	button.copy {
		background: rgba(201, 138, 255, 0.18);
		border: 1px solid rgba(201, 138, 255, 0.3);
		color: var(--color-accent);
		padding: 0 var(--space-3);
		border-radius: 4px;
		font: inherit;
		cursor: pointer;
	}
	button.copy:hover {
		background: rgba(201, 138, 255, 0.28);
	}
	.confirm {
		display: inline-flex;
		gap: var(--space-2);
		align-items: center;
		margin: var(--space-3) 0;
		color: var(--color-fg);
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
