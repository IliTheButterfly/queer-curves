<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import SpectrumHistoryChart from '$lib/graphs/spectrum/SpectrumHistoryChart.svelte';
	import { activeViews } from '$lib/graphs/spectrum/views.js';
	import NetworkChart from '$lib/graphs/network/NetworkChart.svelte';
	import OccurrenceChart from '$lib/graphs/occurrence/OccurrenceChart.svelte';
	import { defaultBucketOf } from '$lib/graphs/occurrence/aggregate.js';
	import OccurrenceQuickAdd from '$lib/ui/OccurrenceQuickAdd.svelte';
	import OccurrenceForm from '$lib/ui/OccurrenceForm.svelte';
	import OccurrenceTimeline from '$lib/ui/OccurrenceTimeline.svelte';
	import GraphStats from '$lib/ui/GraphStats.svelte';
	import SpectrumDatapointForm from '$lib/ui/SpectrumDatapointForm.svelte';
	import SpectrumDatapointList from '$lib/ui/SpectrumDatapointList.svelte';
	import NetworkNodeForm from '$lib/ui/NetworkNodeForm.svelte';
	import NetworkNodeList from '$lib/ui/NetworkNodeList.svelte';
	import NetworkEdgeForm from '$lib/ui/NetworkEdgeForm.svelte';
	import NetworkEdgeList from '$lib/ui/NetworkEdgeList.svelte';
	import ShareSection from '$lib/ui/ShareSection.svelte';
	import { deleteUserGraph, getUserGraph, isOwnGraph, saveUserGraph } from '$lib/store/graphs.js';
	import { downloadGraphAsJson } from '$lib/store/io.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';
	import type {
		Graph,
		NetworkEdge,
		NetworkGraph,
		NetworkNode,
		Occurrence,
		OccurrenceBucket,
		OccurrenceGraph,
		SpectrumDatapoint,
		SpectrumGraph
	} from '$lib/types.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// `loaded` holds the graph once it's known. The SvelteKit loader supplies
	// it for fixtures and any Matrix room already in the local sync cache;
	// for rooms that haven't synced yet `data.graph` starts null and we
	// re-fetch reactively below as matrixStore.roomsEpoch bumps. The lint
	// rule below wants $derived, but the value is *both* derived from data
	// and written from the network — that's $state + $effect.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let loaded = $state<Graph | null>(data.graph);
	const graph = $derived(loaded);
	const isUserGraph = $derived(data.isUserGraph);
	// Editable when it's a fixture-less user graph AND we're the owner.
	// For Matrix-backed graphs, ownership is the room creator; an invitee
	// who joined sees the data read-only so they can't accidentally
	// overwrite the inviter's history.
	const isEditable = $derived(
		isUserGraph && graph !== null && (matrixStore.roomsEpoch, isOwnGraph(graph.id))
	);

	$effect(() => {
		// Adopt whatever the loader produced (e.g. when the route param changes
		// between routes that share this layout).
		loaded = data.graph;
	});

	$effect(() => {
		// React to roomsEpoch: as sync delivers the room and decrypts its
		// snapshots, re-fetch and swap in the freshest version. We keep
		// re-fetching even after a graph is loaded because a later snapshot
		// may decrypt seconds after an earlier one — `findLatestGraph` skips
		// undecryptable events, so the first hit may be stale.
		void matrixStore.roomsEpoch;
		if (!data.pendingId) return;
		const id = data.pendingId;
		(async () => {
			try {
				const g = await getUserGraph(id);
				if (!g) return;
				// Only swap if the new snapshot is newer than what we have —
				// avoids clobbering optimistic local state with a stale read.
				if (!loaded || (g.modified_at ?? '') > (loaded.modified_at ?? '')) {
					loaded = g;
				}
			} catch (e) {
				console.warn('getUserGraph retry failed', e);
			}
		})();
	});

	// View selector state — only meaningful for spectrum graphs. The dropdown
	// is hidden when there's only one view available (1D, or a custom-views
	// list of length 1).
	const spectrumViews = $derived(graph?.type === 'spectrum' ? activeViews(graph) : []);
	let selectedViewId = $state<string | null>(null);
	const activeView = $derived(
		spectrumViews.find((v) => v.id === selectedViewId) ?? spectrumViews[0]
	);

	// Bucket selector state — occurrence graphs only. Starts unset so the
	// graph's own configured default wins until the user picks otherwise.
	let selectedBucket = $state<OccurrenceBucket | null>(null);
	// Survives the invalidateAll() that follows each add.
	let manualEntryOpen = $state(false);
	const activeBucket = $derived(
		graph?.type === 'occurrence' ? (selectedBucket ?? defaultBucketOf(graph)) : 'day'
	);

	async function persist(updated: Graph) {
		if (isUserGraph) {
			await saveUserGraph(updated);
			await invalidateAll();
		}
	}

	async function handleAddDatapoint(dp: SpectrumDatapoint) {
		if (!graph || graph.type !== 'spectrum') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			datapoints: [...graph.datapoints, dp]
		} satisfies SpectrumGraph);
	}

	async function handleAddNode(node: NetworkNode) {
		if (!graph || graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			nodes: [...graph.nodes, node]
		} satisfies NetworkGraph);
	}

	async function handleAddEdge(edge: NetworkEdge) {
		if (!graph || graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			edges: [...graph.edges, edge]
		} satisfies NetworkGraph);
	}

	async function handleRemoveDatapoint(id: string) {
		if (!graph || graph.type !== 'spectrum') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			datapoints: graph.datapoints.filter((dp) => dp.id !== id)
		} satisfies SpectrumGraph);
	}

	async function handleRemoveNode(id: string) {
		if (!graph || graph.type !== 'network') return;
		// Cascade: removing a person also removes all their connections.
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			nodes: graph.nodes.filter((n) => n.id !== id),
			edges: graph.edges.filter((e) => e.source !== id && e.target !== id)
		} satisfies NetworkGraph);
	}

	async function handleRemoveEdge(id: string) {
		if (!graph || graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			edges: graph.edges.filter((e) => e.id !== id)
		} satisfies NetworkGraph);
	}

	async function handleEditDatapoint(updated: SpectrumDatapoint) {
		if (!graph || graph.type !== 'spectrum') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			datapoints: graph.datapoints.map((dp) => (dp.id === updated.id ? updated : dp))
		} satisfies SpectrumGraph);
	}

	async function handleEditNode(updated: NetworkNode) {
		if (!graph || graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			nodes: graph.nodes.map((n) => (n.id === updated.id ? updated : n))
		} satisfies NetworkGraph);
	}

	async function handleEditEdge(updated: NetworkEdge) {
		if (!graph || graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			edges: graph.edges.map((e) => (e.id === updated.id ? updated : e))
		} satisfies NetworkGraph);
	}

	async function handleNetworkPositions(positions: Record<string, { x: number; y: number }>) {
		if (!graph || graph.type !== 'network') return;
		// Skip persistence when nothing meaningfully changed (e.g. tiny
		// floating-point jitter). Saves a round-trip when a drag ends without
		// movement.
		const changed = graph.nodes.some((n) => {
			const p = positions[n.id];
			if (!p) return false;
			if (!n.position) return true;
			return n.position.x !== p.x || n.position.y !== p.y;
		});
		if (!changed) return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			nodes: graph.nodes.map((n) => {
				const p = positions[n.id];
				return p ? { ...n, position: { x: p.x, y: p.y } } : n;
			})
		} satisfies NetworkGraph);
	}

	async function handleAddOccurrence(o: Occurrence) {
		if (!graph || graph.type !== 'occurrence') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			occurrences: [...graph.occurrences, o]
		} satisfies OccurrenceGraph);
	}

	async function handleRemoveOccurrence(id: string) {
		if (!graph || graph.type !== 'occurrence') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			occurrences: graph.occurrences.filter((o) => o.id !== id)
		} satisfies OccurrenceGraph);
	}

	async function handleEditOccurrence(updated: Occurrence) {
		if (!graph || graph.type !== 'occurrence') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			occurrences: graph.occurrences.map((o) => (o.id === updated.id ? updated : o))
		} satisfies OccurrenceGraph);
	}

	async function handleDelete() {
		if (!graph) return;
		if (!confirm(`Delete "${graph.name}"? This can't be undone.`)) return;
		await deleteUserGraph(graph.id);
		await goto('/');
	}

	function pluralize(n: number, singular: string): string {
		return `${n} ${n === 1 ? singular : singular + 's'}`;
	}
</script>

<svelte:head>
	<title>{graph ? graph.name + ' – queer-curves' : 'Loading… – queer-curves'}</title>
</svelte:head>

{#if !graph}
	<main>
		<p class="back"><a href="/">← all graphs</a></p>
		<p class="muted">Loading graph…</p>
	</main>
{:else}
	<main>
		<p class="back"><a href="/">← all graphs</a></p>
		<div class="header-row">
			<h1>{graph.name}</h1>
			<div class="header-actions">
				<button type="button" class="ghost-link" onclick={() => downloadGraphAsJson(graph)}>
					Export
				</button>
				{#if isEditable}
					<a class="ghost-link" href="/graphs/{graph.id}/edit">Edit</a>
					<button type="button" class="danger-ghost" onclick={handleDelete}>Delete</button>
				{/if}
			</div>
		</div>
		{#if isUserGraph && !isEditable}
			<p class="read-only-tag">
				Shared with you — read-only. Only the original creator can change this graph.
			</p>
		{/if}
		{#if graph.description}
			<p class="muted">{graph.description}</p>
		{/if}
		<p class="meta">
			{#if graph.type === 'spectrum'}
				{graph.schema.dimensions}D spectrum · {pluralize(graph.datapoints.length, 'datapoint')}
			{:else if graph.type === 'occurrence'}
				occurrence · {pluralize(graph.schema.counters.length, 'counter')} ·
				{graph.occurrences.length}
				{graph.occurrences.length === 1 ? 'entry' : 'entries'}
			{:else}
				network · {pluralize(graph.nodes.length, 'node')} · {pluralize(graph.edges.length, 'edge')}
			{/if}
			{#if !isUserGraph}
				<span class="fixture-tag">fixture</span>
			{/if}
		</p>

		{#if graph.type === 'spectrum' && spectrumViews.length > 1}
			<div class="view-selector">
				<label>
					<span class="muted">View:</span>
					<select
						value={selectedViewId ?? spectrumViews[0]?.id ?? ''}
						onchange={(e) => (selectedViewId = (e.currentTarget as HTMLSelectElement).value)}
					>
						{#each spectrumViews as v (v.id)}
							<option value={v.id}>{v.name}</option>
						{/each}
					</select>
				</label>
			</div>
		{/if}

		<!-- Logging comes first for occurrence graphs: the reason to open one is
		     almost always to add to it, and the chart is what you look at
		     afterwards. -->
		{#if graph.type === 'occurrence' && isEditable}
			<div class="quick-add-slot">
				<OccurrenceQuickAdd {graph} onadd={handleAddOccurrence} />
			</div>
		{/if}

		{#if graph.type === 'occurrence'}
			<div class="view-selector">
				<label>
					<span class="muted">Roll up by:</span>
					<select
						value={activeBucket}
						onchange={(e) =>
							(selectedBucket = (e.currentTarget as HTMLSelectElement).value as OccurrenceBucket)}
					>
						<option value="day">day</option>
						<option value="week">week</option>
						<option value="month">month</option>
					</select>
				</label>
			</div>
		{/if}

		<div class="chart">
			{#if graph.type === 'spectrum'}
				<SpectrumHistoryChart {graph} view={activeView} />
			{:else if graph.type === 'occurrence'}
				<OccurrenceChart {graph} bucket={activeBucket} />
			{:else}
				<NetworkChart {graph} onPositionsChange={handleNetworkPositions} />
			{/if}
		</div>

		<GraphStats {graph} />

		<!-- The history is worth seeing on a graph shared with you, so the
		     timeline renders read-only rather than disappearing. -->
		{#if graph.type === 'occurrence'}
			<div class="timeline-slot">
				<OccurrenceTimeline
					{graph}
					editable={isEditable}
					onremove={handleRemoveOccurrence}
					onedit={handleEditOccurrence}
				/>
			</div>
		{/if}

		{#if isEditable}
			<section class="editors">
				{#if graph.type === 'spectrum'}
					<SpectrumDatapointForm {graph} view={activeView} onsubmit={handleAddDatapoint} />
					<SpectrumDatapointList
						{graph}
						view={activeView}
						datapoints={graph.datapoints}
						axes={graph.schema.axes}
						onremove={handleRemoveDatapoint}
						onedit={handleEditDatapoint}
					/>
				{:else if graph.type === 'occurrence'}
					<!-- Backdating and notes are the exception, not the norm, so the
					     full form stays folded away instead of dominating the page.
					     `open` is bound to page state because each add triggers
					     invalidateAll(), which would otherwise snap the disclosure
					     shut between two backdated entries. -->
					<details class="manual-entry" bind:open={manualEntryOpen}>
						<summary>Add a past entry</summary>
						<OccurrenceForm {graph} onsubmit={handleAddOccurrence} />
					</details>
				{:else}
					<NetworkNodeForm {graph} onsubmit={handleAddNode} />
					<NetworkNodeList {graph} onremove={handleRemoveNode} onedit={handleEditNode} />
					<NetworkEdgeForm {graph} onsubmit={handleAddEdge} />
					<NetworkEdgeList {graph} onremove={handleRemoveEdge} onedit={handleEditEdge} />
				{/if}
			</section>
			<ShareSection graphId={graph.id} />
		{/if}
	</main>
{/if}

<style>
	main {
		max-width: 80ch;
	}
	.back a {
		color: var(--color-muted);
		text-decoration: none;
	}
	.back a:hover {
		color: var(--color-accent);
	}
	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
	}
	.muted {
		color: var(--color-muted);
	}
	.meta {
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.fixture-tag {
		display: inline-block;
		margin-left: var(--space-2);
		padding: 2px 8px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 999px;
		font-size: 0.75em;
		color: var(--color-muted);
	}
	.read-only-tag {
		margin: var(--space-2) 0 0;
		padding: var(--space-2) var(--space-3);
		background: rgba(120, 200, 255, 0.08);
		border: 1px solid rgba(120, 200, 255, 0.2);
		border-radius: 4px;
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.view-selector {
		margin-top: var(--space-3);
		font-size: 0.9em;
	}
	.view-selector label {
		display: inline-flex;
		gap: var(--space-2);
		align-items: center;
	}
	.view-selector select {
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.quick-add-slot,
	.timeline-slot {
		margin-top: var(--space-3);
	}
	.manual-entry summary {
		cursor: pointer;
		color: var(--color-muted);
		font-size: 0.9em;
		padding: var(--space-1) 0;
	}
	.manual-entry summary:hover {
		color: var(--color-accent);
	}
	.manual-entry[open] summary {
		margin-bottom: var(--space-2);
	}
	.chart {
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
	}
	.editors {
		margin-top: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.header-actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.ghost-link {
		display: inline-block;
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-3);
		border-radius: 4px;
		font: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	.ghost-link:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-accent);
	}
	button.danger-ghost {
		background: transparent;
		border: 1px solid rgba(255, 100, 100, 0.3);
		color: rgba(255, 150, 150, 1);
		padding: var(--space-1) var(--space-3);
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}
	button.danger-ghost:hover {
		background: rgba(255, 100, 100, 0.1);
		border-color: rgba(255, 100, 100, 0.6);
	}
</style>
