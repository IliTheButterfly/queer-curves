<script lang="ts">
	import { goto } from '$app/navigation';
	import { fixtures, type Graph } from '$lib';
	import { listUserGraphs } from '$lib/store/graphs.js';
	import type { ComposeSource } from '$lib/store/compose.js';
	import {
		checkCollectionMembers,
		newCollection,
		saveCollection,
		seriesColor
	} from '$lib/store/collections.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';
	import GraphMultiSelect from '$lib/ui/GraphMultiSelect.svelte';
	import ComposeIssues from '$lib/ui/ComposeIssues.svelte';

	let userGraphs = $state<Graph[]>([]);
	let selected = $state<string[]>([]);
	let name = $state('');
	let working = $state(false);
	let error = $state<string | null>(null);

	const available = $derived([...userGraphs, ...fixtures.allFixtures]);
	const byId = $derived(new Map(available.map((g) => [g.id, g])));
	const sources = $derived<ComposeSource[]>(
		selected
			.map((id) => byId.get(id))
			.filter((g): g is Graph => Boolean(g))
			.map((graph) => ({ graph }))
	);
	const viewer = $derived(matrixStore.session?.userId ?? undefined);
	// Collections tolerate more than merges do: members with different axis
	// counts are fine, because the custom-axes view plots named axes rather
	// than shared ones.
	const issues = $derived(sources.length > 0 ? checkCollectionMembers(sources, viewer) : []);
	const blocked = $derived(issues.some((i) => i.level === 'error'));
	const canSave = $derived(name.trim().length > 0 && selected.length > 0 && !blocked);

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
			}
		})();
	});

	function disabledReason(g: Graph): string | null {
		if (sources.length === 0) return null;
		const err = checkCollectionMembers([...sources, { graph: g }], viewer).find(
			(i) => i.level === 'error'
		);
		return err ? err.message : null;
	}

	async function handleCreate() {
		if (working || !canSave) return;
		error = null;
		working = true;
		try {
			const collection = newCollection(name.trim(), viewer ?? 'local');
			collection.members = selected.map((graph_id, i) => ({
				graph_id,
				color: seriesColor(i)
			}));
			const saved = await saveCollection(collection);
			await goto(`/collections/${saved.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			working = false;
		}
	}
</script>

<svelte:head>
	<title>New collection · queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/collections">← collections</a></p>
	<h1>New collection</h1>
	<p class="muted">
		Pick the graphs you want to see on one chart. The collection stores only their ids — your graphs
		aren't copied, and deleting the collection later deletes nothing else.
	</p>

	<h2>Name</h2>
	<input type="text" bind:value={name} placeholder="e.g. me and Sam" />

	<h2>Graphs</h2>
	<GraphMultiSelect graphs={available} bind:selected {disabledReason} />

	{#if sources.length > 0}
		<ComposeIssues {issues} />
	{/if}

	<div class="actions">
		<button type="button" class="cta" onclick={handleCreate} disabled={!canSave || working}>
			{working ? 'Creating…' : 'Create collection'}
		</button>
	</div>

	{#if error}
		<p class="error">{error}</p>
	{/if}
</main>

<style>
	main {
		max-width: 80ch;
	}
	.back a {
		color: var(--color-muted);
		text-decoration: none;
		font-size: 0.9em;
	}
	.back a:hover {
		color: var(--color-accent);
	}
	h2 {
		font-size: 1.1rem;
		margin-top: var(--space-5);
		color: var(--color-accent);
	}
	.muted {
		color: var(--color-muted);
	}
	input[type='text'] {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		margin-top: var(--space-2);
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 4px;
		color: var(--color-fg);
		font: inherit;
	}
	input[type='text']:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.actions {
		margin-top: var(--space-4);
	}
	.cta {
		padding: var(--space-2) var(--space-4);
		background: rgba(201, 138, 255, 0.15);
		border: none;
		border-radius: 4px;
		color: var(--color-accent);
		font: inherit;
		cursor: pointer;
	}
	.cta:hover:not(:disabled) {
		background: rgba(201, 138, 255, 0.25);
	}
	.cta:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.error {
		padding: var(--space-2) var(--space-3);
		margin-top: var(--space-3);
		background: rgba(255, 100, 100, 0.1);
		border: 1px solid rgba(255, 100, 100, 0.3);
		color: rgba(255, 180, 180, 1);
		border-radius: 4px;
		font-size: 0.9em;
	}
</style>
