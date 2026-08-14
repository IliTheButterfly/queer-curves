<script lang="ts">
	// A multi-graph view: several graphs composed live onto one chart.
	//
	// Nothing here is stored composed. Every open (and every roomsEpoch bump)
	// re-reads the member graphs and re-composes, so edits to a member show
	// up here immediately and revoking access to one simply makes it drop out
	// with a notice rather than leaving a stale copy behind.
	import { goto } from '$app/navigation';
	import SpectrumHistoryChart from '$lib/graphs/spectrum/SpectrumHistoryChart.svelte';
	import NetworkChart from '$lib/graphs/network/NetworkChart.svelte';
	import { activeViews } from '$lib/graphs/spectrum/views.js';
	import ComposeIssues from '$lib/ui/ComposeIssues.svelte';
	import {
		composeCollection,
		deleteCollection,
		getCollection,
		resolveCollection,
		saveCollection,
		seriesColor,
		type ResolvedCollection
	} from '$lib/store/collections.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';
	import type { GraphCollection } from '$lib/types.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let collection = $state<GraphCollection | null>(null);
	let resolved = $state<ResolvedCollection | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let confirmingDelete = $state(false);

	const viewer = $derived(matrixStore.session?.userId ?? undefined);
	const composed = $derived(resolved ? composeCollection(resolved) : null);
	const spectrumViews = $derived(composed?.type === 'spectrum' ? activeViews(composed) : []);

	let selectedViewId = $state<string | null>(null);
	const activeView = $derived(
		spectrumViews.find((v) => v.id === selectedViewId) ??
			spectrumViews.find((v) => v.id === collection?.view?.id) ??
			spectrumViews[0]
	);

	// The legend: one row per member that actually loaded, in member order,
	// carrying the colour its points are drawn in.
	const legend = $derived(
		(resolved?.sources ?? []).map((s, i) => ({
			id: s.graph.id,
			label: s.label ?? s.graph.name,
			color: s.color ?? seriesColor(i),
			count: s.graph.type === 'spectrum' ? s.graph.datapoints.length : s.graph.nodes.length,
			unit: s.graph.type === 'spectrum' ? 'points' : 'nodes'
		}))
	);

	$effect(() => {
		// Re-resolve as sync delivers member rooms and decrypts their
		// snapshots — a collection is only as fresh as its least-synced
		// member, and those arrive over several catch-up cycles.
		void matrixStore.session;
		void matrixStore.cryptoStatus;
		void matrixStore.roomsEpoch;
		if (!matrixStore.hydrated) return;
		const id = data.collectionId;
		(async () => {
			try {
				const c = await getCollection(id);
				if (!c) {
					collection = null;
					resolved = null;
					return;
				}
				collection = c;
				resolved = await resolveCollection(c, viewer);
			} catch (e) {
				console.warn('resolveCollection failed', e);
				error = e instanceof Error ? e.message : String(e);
			} finally {
				loading = false;
			}
		})();
	});

	async function persist(next: GraphCollection) {
		const saved = await saveCollection({ ...next, modified_at: new Date().toISOString() });
		collection = saved;
		resolved = await resolveCollection(saved, viewer);
	}

	async function removeMember(graphId: string) {
		if (!collection) return;
		await persist({
			...collection,
			members: collection.members.filter((m) => m.graph_id !== graphId)
		});
	}

	async function saveDefaultView() {
		if (!collection || !activeView) return;
		await persist({ ...collection, view: activeView });
	}

	async function handleDelete() {
		if (!collection) return;
		await deleteCollection(collection.id);
		await goto('/collections');
	}
</script>

<svelte:head>
	<title>{collection?.name ?? 'Collection'} · queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/collections">← collections</a></p>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if !collection}
		<h1>Not found</h1>
		<p class="muted">
			No collection with that id on this device. If it lives in your Matrix account, it may still be
			syncing.
		</p>
	{:else}
		<h1>{collection.name}</h1>
		{#if collection.description}
			<p class="muted">{collection.description}</p>
		{/if}
		<p class="muted">
			{collection.members.length}
			{collection.members.length === 1 ? 'graph' : 'graphs'}, plotted together. Each one is still
			its own graph — edit or share them individually.
		</p>

		{#if resolved && resolved.missing.length > 0}
			<p class="warn">
				{resolved.missing.length}
				{resolved.missing.length === 1 ? 'member' : 'members'} couldn't be loaded and
				{resolved.missing.length === 1 ? 'is' : 'are'} not shown: {resolved.missing.join(', ')}.
				They may have been deleted, or shared from an account whose keys haven't arrived yet.
			</p>
		{/if}

		{#if resolved && resolved.issues.length > 0}
			<ComposeIssues issues={resolved.issues} />
		{/if}

		{#if composed}
			{#if composed.type === 'spectrum' && spectrumViews.length > 1}
				<div class="viewbar">
					<label>
						View
						<select bind:value={selectedViewId}>
							{#each spectrumViews as v (v.id)}
								<option value={v.id}>{v.name}</option>
							{/each}
						</select>
					</label>
					{#if activeView && activeView.id !== collection.view?.id}
						<button type="button" class="linkish" onclick={saveDefaultView}>
							remember this view
						</button>
					{/if}
				</div>
			{/if}

			<div class="chart">
				{#if composed.type === 'spectrum'}
					<SpectrumHistoryChart graph={composed} view={activeView} />
				{:else}
					<NetworkChart graph={composed} />
				{/if}
			</div>

			<h2>Legend</h2>
			<ul class="legend">
				{#each legend as entry (entry.id)}
					<li>
						<span class="swatch" style="background: {entry.color}"></span>
						<a href="/graphs/{entry.id}">{entry.label}</a>
						<span class="muted">— {entry.count} {entry.unit}</span>
						<button type="button" class="linkish" onclick={() => removeMember(entry.id)}>
							remove
						</button>
					</li>
				{/each}
			</ul>
		{:else if resolved && resolved.sources.length === 0}
			<p class="muted">Nothing to plot — this collection has no members that could be loaded.</p>
		{/if}

		<h2>Actions</h2>
		<div class="actions">
			<a class="cta secondary" href="/collections/new">New collection</a>
			<a class="cta secondary" href="/graphs/merge">Merge graphs into one</a>
			{#if confirmingDelete}
				<button type="button" class="cta danger" onclick={handleDelete}>
					Really delete this collection
				</button>
				<button type="button" class="cta secondary" onclick={() => (confirmingDelete = false)}>
					Cancel
				</button>
			{:else}
				<button type="button" class="cta secondary" onclick={() => (confirmingDelete = true)}>
					Delete collection
				</button>
			{/if}
		</div>
		<p class="muted fineprint">
			Deleting a collection removes only this list. Every graph in it stays exactly where it is.
		</p>
	{/if}

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
	.fineprint {
		font-size: 0.85em;
		margin-top: var(--space-2);
	}
	.warn {
		padding: var(--space-2) var(--space-3);
		margin: var(--space-3) 0;
		background: rgba(255, 200, 100, 0.08);
		border: 1px solid rgba(255, 200, 100, 0.25);
		color: rgba(255, 220, 170, 1);
		border-radius: 4px;
		font-size: 0.9em;
	}
	.viewbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: var(--space-4) 0 var(--space-2);
	}
	.viewbar select {
		margin-left: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 4px;
		color: var(--color-fg);
		font: inherit;
	}
	.chart {
		margin-top: var(--space-3);
		overflow-x: auto;
	}
	.legend {
		list-style: none;
		padding: 0;
		margin-top: var(--space-2);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) 0;
	}
	.legend a {
		color: var(--color-fg);
	}
	.swatch {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 3px;
		flex: none;
	}
	.linkish {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 0.85em;
		color: var(--color-accent);
		cursor: pointer;
		text-decoration: underline;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.cta {
		padding: var(--space-2) var(--space-3);
		border-radius: 4px;
		border: none;
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
		text-decoration: none;
		background: rgba(201, 138, 255, 0.15);
		color: var(--color-accent);
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
	.cta.danger {
		background: rgba(255, 100, 100, 0.15);
		color: rgba(255, 180, 180, 1);
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
