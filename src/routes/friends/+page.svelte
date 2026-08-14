<script lang="ts">
	import {
		friendLinkFor,
		loadContacts,
		newContact,
		parseFriendInput,
		saveContacts,
		type Contact
	} from '$lib/matrix/contacts.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';

	let contacts = $state<Contact[]>([]);
	let version = $state(0);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);

	let addInput = $state('');
	let addName = $state('');
	let working = $state(false);
	let addError = $state<string | null>(null);
	let copied = $state(false);

	const ready = $derived(
		matrixStore.hydrated && matrixStore.session !== null && matrixStore.cryptoStatus?.ready === true
	);
	const myLink = $derived(matrixStore.session ? friendLinkFor(matrixStore.session.userId) : null);

	$effect(() => {
		if (!ready || loaded) return;
		(async () => {
			try {
				const payload = await loadContacts();
				contacts = payload.contacts;
				version = payload.version;
				loaded = true;
			} catch (e) {
				loadError = e instanceof Error ? e.message : String(e);
			}
		})();
	});

	async function handleAdd(e: SubmitEvent) {
		e.preventDefault();
		if (working) return;
		addError = null;
		working = true;
		try {
			const matrixId = parseFriendInput(addInput);
			if (matrixId === matrixStore.session?.userId) {
				throw new Error("That's your own link — send it to a friend instead.");
			}
			if (contacts.some((c) => c.matrix_id === matrixId)) {
				throw new Error('They are already in your friends list.');
			}
			const next = [...contacts, newContact(matrixId, addName)];
			const payload = await saveContacts(next, version);
			contacts = payload.contacts;
			version = payload.version;
			addInput = '';
			addName = '';
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			working = false;
		}
	}

	async function handleRemove(contact: Contact) {
		if (working) return;
		if (
			!confirm(
				`Remove ${contact.display_name} from your friends list?\n\nThis only edits your list — it doesn't change what they can already see. Use each graph's sharing section to revoke access.`
			)
		) {
			return;
		}
		working = true;
		addError = null;
		try {
			const next = contacts.filter((c) => c.id !== contact.id);
			const payload = await saveContacts(next, version);
			contacts = payload.contacts;
			version = payload.version;
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			working = false;
		}
	}

	async function copyLink() {
		if (!myLink) return;
		try {
			await navigator.clipboard.writeText(myLink);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard can be unavailable (permissions, http); the link is
			// visible and selectable as a fallback.
		}
	}
</script>

<svelte:head>
	<title>Friends – queer-curves</title>
</svelte:head>

<main>
	<a class="back" href="/">← home</a>
	<h1>Friends</h1>
	<p class="muted">
		Your friends list is private to you: it's stored encrypted, synced only between your own
		devices, and never shown to anyone else — not even the server.
	</p>

	{#if !matrixStore.hydrated}
		<p class="muted">…</p>
	{:else if !ready}
		<p class="muted">
			Log in and finish encryption setup to keep a friends list — it needs your device keys to stay
			private.
		</p>
	{:else}
		<section class="panel">
			<h2>Your friend link</h2>
			<p class="muted">
				Send this to someone (or let them scan it later — QR is coming). When they add you, they can
				share their graphs with you by name.
			</p>
			{#if myLink}
				<div class="link-row">
					<code class="friend-link">{myLink}</code>
					<button type="button" class="cta" onclick={copyLink}>
						{copied ? 'Copied!' : 'Copy'}
					</button>
				</div>
			{/if}
		</section>

		<section class="panel">
			<h2>Add a friend</h2>
			<form onsubmit={handleAdd}>
				<label class="field">
					<span class="label">Their friend link or Matrix id</span>
					<input
						type="text"
						bind:value={addInput}
						placeholder="https://matrix.to/#/@bea:example.org"
						autocomplete="off"
						spellcheck="false"
						disabled={working}
					/>
				</label>
				<label class="field">
					<span class="label">What you call them (only you see this)</span>
					<input type="text" bind:value={addName} placeholder="Bea" disabled={working} />
				</label>
				{#if addError}
					<p class="error" role="alert">{addError}</p>
				{/if}
				<div class="actions">
					<button type="submit" class="cta" disabled={working || !addInput.trim()}>
						{working ? 'Adding…' : 'Add friend'}
					</button>
				</div>
			</form>
		</section>

		<section class="panel">
			<h2>
				Your friends {#if loaded}({contacts.length}){/if}
			</h2>
			{#if loadError}
				<p class="error" role="alert">{loadError}</p>
			{:else if loaded && contacts.length === 0}
				<p class="muted">Nobody yet. Swap links with someone above.</p>
			{:else}
				<ul class="friend-list">
					{#each contacts as c (c.id)}
						<li>
							<div class="who">
								<strong>{c.display_name}</strong>
								<span class="mid" title="Matrix id">{c.matrix_id}</span>
							</div>
							<button
								type="button"
								class="danger"
								onclick={() => handleRemove(c)}
								disabled={working}
							>
								Remove
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: var(--space-4);
	}
	.back {
		color: var(--color-muted);
		text-decoration: none;
	}
	h1 {
		color: var(--color-accent);
		margin: var(--space-2) 0;
	}
	h2 {
		font-size: 1.05rem;
		color: var(--color-accent);
		margin: 0 0 var(--space-2);
	}
	.muted {
		color: var(--color-muted);
	}
	.panel {
		margin-top: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
	}
	.link-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.friend-link {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 0.85em;
		padding: var(--space-2);
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		overflow-wrap: anywhere;
		user-select: all;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}
	.label {
		font-size: 0.85em;
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
	.actions {
		display: flex;
		justify-content: flex-end;
	}
	.cta {
		background: var(--color-accent);
		color: #1a0a2a;
		border: none;
		padding: var(--space-2) var(--space-4);
		border-radius: 4px;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.cta:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.cta:not(:disabled):hover {
		filter: brightness(1.1);
	}
	.error {
		padding: var(--space-2) var(--space-3);
		background: rgba(255, 100, 100, 0.1);
		border: 1px solid rgba(255, 100, 100, 0.3);
		color: rgba(255, 180, 180, 1);
		border-radius: 4px;
		font-size: 0.9em;
	}
	.friend-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.friend-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2);
		background: rgba(255, 255, 255, 0.02);
		border-radius: 4px;
	}
	.who {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.mid {
		font-family: var(--font-mono);
		font-size: 0.8em;
		color: var(--color-muted);
	}
	.danger {
		background: transparent;
		border: 1px solid rgba(255, 100, 100, 0.35);
		color: rgba(255, 160, 160, 1);
		padding: 2px var(--space-2);
		border-radius: 4px;
		font: inherit;
		font-size: 0.85em;
		cursor: pointer;
	}
	.danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.danger:not(:disabled):hover {
		background: rgba(255, 100, 100, 0.1);
	}
</style>
