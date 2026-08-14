<script lang="ts">
	import { goto } from '$app/navigation';
	import { fixtures, type Graph } from '$lib';
	import { palettes } from '$lib/presets/palettes.js';
	import {
		acceptInvite,
		declineInvite,
		listPendingInvites,
		listUserGraphs,
		migrateLocalStorageToMatrix,
		type PendingInvite
	} from '$lib/store/graphs.js';
	import { importGraphFromFile } from '$lib/store/io.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';
	import PaletteSwatch from '$lib/ui/PaletteSwatch.svelte';

	const fixtureGraphs: Graph[] = fixtures.allFixtures;
	let userGraphs = $state<Graph[]>([]);
	let invites = $state<PendingInvite[]>([]);
	let importInput: HTMLInputElement;
	let importError = $state<string | null>(null);
	let migrating = $state(false);
	let migrateError = $state<string | null>(null);
	let inviteWorking = $state<string | null>(null);
	let inviteError = $state<string | null>(null);

	// Graphs that still have `g_…` ids — they were created before the user
	// signed in or while crypto wasn't set up. We surface a one-click
	// migration when the session is now encrypted-ready.
	const localOnly = $derived(userGraphs.filter((g) => !g.id.startsWith('!')));
	const canMigrate = $derived(
		matrixStore.hydrated &&
			matrixStore.session !== null &&
			matrixStore.cryptoStatus?.ready === true &&
			localOnly.length > 0
	);

	async function handleMigrate() {
		if (migrating) return;
		migrateError = null;
		migrating = true;
		try {
			const result = await migrateLocalStorageToMatrix();
			userGraphs = await listUserGraphs();
			if (result.failed > 0) {
				migrateError = `Moved ${result.migrated}; ${result.failed} failed and stayed in localStorage — try again.`;
			}
		} catch (e) {
			migrateError = e instanceof Error ? e.message : String(e);
		} finally {
			migrating = false;
		}
	}

	const featuredPalettes = palettes
		.filter((p) => ['pride', 'progress', 'trans', 'bi', 'lesbian', 'nb'].includes(p.id))
		.slice(0, 6);

	// Refetch whenever the session/crypto state changes — switching from
	// logged-out to logged-in (or vice versa) swaps the active store
	// backend, so the list needs to reload. Also refetch when roomsEpoch
	// bumps: on a fresh page load, matrix-js-sdk's initial /sync returns
	// rooms only after several catch-up cycles, so we re-list as rooms
	// arrive instead of trying to wait for everything up-front.
	$effect(() => {
		void matrixStore.session;
		void matrixStore.cryptoStatus;
		void matrixStore.roomsEpoch;
		if (!matrixStore.hydrated) return;
		(async () => {
			try {
				userGraphs = await listUserGraphs();
			} catch (e) {
				console.warn('listUserGraphs failed', e);
				userGraphs = [];
			}
			try {
				invites = await listPendingInvites();
			} catch (e) {
				console.warn('listPendingInvites failed', e);
				invites = [];
			}
		})();
	});

	async function handleAcceptInvite(roomId: string) {
		if (inviteWorking) return;
		inviteError = null;
		inviteWorking = roomId;
		try {
			await acceptInvite(roomId);
			invites = await listPendingInvites();
			userGraphs = await listUserGraphs();
		} catch (e) {
			inviteError = e instanceof Error ? e.message : String(e);
		} finally {
			inviteWorking = null;
		}
	}

	async function handleDeclineInvite(roomId: string) {
		if (inviteWorking) return;
		inviteError = null;
		inviteWorking = roomId;
		try {
			await declineInvite(roomId);
			invites = await listPendingInvites();
		} catch (e) {
			inviteError = e instanceof Error ? e.message : String(e);
		} finally {
			inviteWorking = null;
		}
	}

	async function handleImport() {
		importError = null;
		const file = importInput.files?.[0];
		if (!file) return;
		try {
			const graph = await importGraphFromFile(file);
			await goto(`/graphs/${graph.id}`);
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Failed to import.';
			importInput.value = '';
		}
	}

	function summarize(g: Graph): string {
		if (g.type === 'spectrum') {
			const n = g.datapoints.length;
			return `${g.schema.dimensions}D spectrum · ${n} datapoint${n === 1 ? '' : 's'}`;
		}
		if (g.type === 'occurrence') {
			const n = g.occurrences.length;
			const c = g.schema.counters.length;
			return `occurrence · ${c} counter${c === 1 ? '' : 's'} · ${n} ${n === 1 ? 'entry' : 'entries'}`;
		}
		if (g.type === 'network') {
			return `network · ${g.nodes.length} nodes · ${g.edges.length} edges`;
		}
		const sets = g.pronouns.length;
		const words = g.terms.length;
		return `pronoun card · ${sets} pronoun set${sets === 1 ? '' : 's'} · ${words} word${words === 1 ? '' : 's'}`;
	}
</script>

<svelte:head>
	<title>queer-curves</title>
</svelte:head>

<main>
	<h1>queer-curves</h1>
	<p>Privacy-respecting graphs for tracking and sharing identity over time.</p>
	<p class="muted">
		Pre-development. See the design docs in the repository:
		<code>data_model.md</code>, <code>sharing_model.md</code>,
		<code>THREATS.md</code>, <code>STACK.md</code>.
	</p>

	{#if invites.length > 0}
		<section class="invites">
			<h2>Pending invites</h2>
			<p class="muted">
				Graphs other accounts have invited you to. Invites are unnamed on purpose — the graph's
				title is encrypted and only appears after you accept. Decide by who sent it.
			</p>
			<ul class="invite-list">
				{#each invites as inv (inv.roomId)}
					<li>
						<div>
							<strong>{inv.invitedBy ?? 'Unknown account'}</strong>
							<span class="muted">shared an encrypted graph with you</span>
						</div>
						<div class="invite-actions">
							<button
								type="button"
								class="cta"
								onclick={() => handleAcceptInvite(inv.roomId)}
								disabled={inviteWorking === inv.roomId}
							>
								{inviteWorking === inv.roomId ? 'Joining…' : 'Accept'}
							</button>
							<button
								type="button"
								class="cta secondary"
								onclick={() => handleDeclineInvite(inv.roomId)}
								disabled={inviteWorking === inv.roomId}
							>
								Decline
							</button>
						</div>
					</li>
				{/each}
			</ul>
			{#if inviteError}
				<p class="error">{inviteError}</p>
			{/if}
		</section>
	{/if}

	<h2>
		Your graphs
		<span class="cta-group">
			<button type="button" class="cta secondary" onclick={() => importInput.click()}>
				Import
			</button>
			<a class="cta" href="/graphs/new">+ new graph</a>
		</span>
	</h2>
	<input
		type="file"
		accept="application/json,.json"
		bind:this={importInput}
		onchange={handleImport}
		hidden
	/>
	{#if importError}
		<p class="error">Import failed: {importError}</p>
	{/if}
	{#if canMigrate}
		<aside class="migrate-prompt" role="status">
			<span>
				{localOnly.length}
				{localOnly.length === 1 ? 'graph is' : 'graphs are'} still stored unencrypted in this browser.
				Move {localOnly.length === 1 ? 'it' : 'them'} into your encrypted Matrix account?
			</span>
			<button type="button" class="cta" onclick={handleMigrate} disabled={migrating}>
				{migrating ? 'Moving…' : 'Move to encrypted storage'}
			</button>
		</aside>
		{#if migrateError}
			<p class="error">{migrateError}</p>
		{/if}
	{/if}
	{#if userGraphs.length === 0}
		<p class="muted">
			No graphs yet. Create one — it's stored locally on this device for now; Matrix-backed sharing
			comes later.
		</p>
	{:else}
		<ul class="graph-list">
			{#each userGraphs as graph (graph.id)}
				<li>
					<a href="/graphs/{graph.id}">
						<strong>{graph.name}</strong>
						<span class="muted">— {summarize(graph)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<h2>Fixtures</h2>
	<p class="muted">Canonical test cases — see <code>data_model.md</code> §12.</p>
	<ul class="graph-list">
		{#each fixtureGraphs as graph (graph.id)}
			<li>
				<a href="/graphs/{graph.id}">
					<strong>{graph.name}</strong>
					<span class="muted">— {summarize(graph)}</span>
				</a>
			</li>
		{/each}
	</ul>

	<h2>
		Palettes <a class="see-all" href="/palettes">see all {palettes.length} →</a>
	</h2>
	<p class="muted">Queer flag colour schemes you can apply to any graph.</p>
	<div class="palette-row">
		{#each featuredPalettes as palette (palette.id)}
			<a class="palette-tile" href="/palettes/{palette.id}">
				<PaletteSwatch {palette} height={80} />
				<span class="palette-name">{palette.name}</span>
			</a>
		{/each}
	</div>
</main>

<style>
	main {
		max-width: 80ch;
	}
	h2 {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
		font-size: 1.25rem;
		margin-top: var(--space-5);
		color: var(--color-accent);
	}
	.cta,
	.see-all {
		font-size: 0.85rem;
		font-weight: normal;
		color: var(--color-muted);
		text-decoration: none;
	}
	.cta {
		padding: var(--space-1) var(--space-3);
		background: rgba(201, 138, 255, 0.15);
		border-radius: 4px;
		color: var(--color-accent);
		border: none;
		font: inherit;
		cursor: pointer;
	}
	.cta:hover {
		background: rgba(201, 138, 255, 0.25);
	}
	.cta.secondary {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
	}
	.cta.secondary:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-accent);
	}
	.cta-group {
		display: inline-flex;
		gap: var(--space-2);
	}
	.invites {
		margin-top: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: rgba(120, 200, 255, 0.06);
		border: 1px solid rgba(120, 200, 255, 0.2);
		border-radius: 6px;
	}
	.invites h2 {
		display: block;
		margin: 0 0 var(--space-1);
		font-size: 1.05rem;
	}
	.invite-list {
		list-style: none;
		padding: 0;
		margin: var(--space-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.invite-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
	}
	.invite-actions {
		display: inline-flex;
		gap: var(--space-2);
	}
	.migrate-prompt {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		margin: var(--space-3) 0;
		background: rgba(201, 138, 255, 0.08);
		border: 1px solid rgba(201, 138, 255, 0.2);
		border-radius: 4px;
		font-size: 0.9em;
	}
	.migrate-prompt span {
		flex: 1;
		color: var(--color-fg);
	}
	.migrate-prompt button {
		white-space: nowrap;
	}
	.error {
		padding: var(--space-2) var(--space-3);
		background: rgba(255, 100, 100, 0.1);
		border: 1px solid rgba(255, 100, 100, 0.3);
		color: rgba(255, 180, 180, 1);
		border-radius: 4px;
		font-size: 0.9em;
		margin-top: var(--space-2);
	}
	.see-all:hover {
		color: var(--color-accent);
	}
	.graph-list {
		list-style: none;
		padding: 0;
		margin-top: var(--space-3);
	}
	.graph-list li {
		margin-bottom: var(--space-2);
	}
	.graph-list a {
		display: block;
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
		color: var(--color-fg);
		text-decoration: none;
		transition: background 0.15s;
	}
	.graph-list a:hover {
		background: rgba(255, 255, 255, 0.07);
	}
	.graph-list strong {
		color: var(--color-accent);
	}
	.muted {
		color: var(--color-muted);
	}
	.palette-row {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.palette-tile {
		display: block;
		text-decoration: none;
		color: inherit;
		padding: var(--space-2);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
		transition:
			background 0.15s,
			transform 0.15s;
	}
	.palette-tile:hover {
		background: rgba(255, 255, 255, 0.06);
		transform: translateY(-1px);
	}
	.palette-name {
		display: block;
		margin-top: var(--space-1);
		font-size: 0.85em;
		text-align: center;
	}
</style>
