<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import SpectrumHistoryChart from '$lib/graphs/spectrum/SpectrumHistoryChart.svelte';
	import { activeViews } from '$lib/graphs/spectrum/views.js';
	import NetworkChart from '$lib/graphs/network/NetworkChart.svelte';
	import GraphStats from '$lib/ui/GraphStats.svelte';
	import SpectrumDatapointForm from '$lib/ui/SpectrumDatapointForm.svelte';
	import SpectrumDatapointList from '$lib/ui/SpectrumDatapointList.svelte';
	import NetworkNodeForm from '$lib/ui/NetworkNodeForm.svelte';
	import NetworkNodeList from '$lib/ui/NetworkNodeList.svelte';
	import NetworkEdgeForm from '$lib/ui/NetworkEdgeForm.svelte';
	import NetworkEdgeList from '$lib/ui/NetworkEdgeList.svelte';
	import { deleteUserGraph, saveUserGraph } from '$lib/store/graphs.js';
	import { downloadGraphAsJson } from '$lib/store/io.js';
	import type {
		Graph,
		NetworkEdge,
		NetworkGraph,
		NetworkNode,
		SpectrumDatapoint,
		SpectrumGraph
	} from '$lib/types.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// `data.graph` is the single source of truth. Mutations save to localStorage
	// and call invalidateAll() so SvelteKit re-runs the loader and re-reads
	// fresh data — no separate local mutable copy to keep in sync.
	const graph = $derived(data.graph);
	const isUserGraph = $derived(data.isUserGraph);

	// View selector state — only meaningful for spectrum graphs. The dropdown
	// is hidden when there's only one view available (1D, or a custom-views
	// list of length 1).
	const spectrumViews = $derived(graph.type === 'spectrum' ? activeViews(graph) : []);
	let selectedViewId = $state<string | null>(null);
	const activeView = $derived(
		spectrumViews.find((v) => v.id === selectedViewId) ?? spectrumViews[0]
	);

	async function persist(updated: Graph) {
		if (isUserGraph) {
			await saveUserGraph(updated);
			await invalidateAll();
		}
	}

	async function handleAddDatapoint(dp: SpectrumDatapoint) {
		if (graph.type !== 'spectrum') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			datapoints: [...graph.datapoints, dp]
		} satisfies SpectrumGraph);
	}

	async function handleAddNode(node: NetworkNode) {
		if (graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			nodes: [...graph.nodes, node]
		} satisfies NetworkGraph);
	}

	async function handleAddEdge(edge: NetworkEdge) {
		if (graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			edges: [...graph.edges, edge]
		} satisfies NetworkGraph);
	}

	async function handleRemoveDatapoint(id: string) {
		if (graph.type !== 'spectrum') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			datapoints: graph.datapoints.filter((dp) => dp.id !== id)
		} satisfies SpectrumGraph);
	}

	async function handleRemoveNode(id: string) {
		if (graph.type !== 'network') return;
		// Cascade: removing a person also removes all their connections.
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			nodes: graph.nodes.filter((n) => n.id !== id),
			edges: graph.edges.filter((e) => e.source !== id && e.target !== id)
		} satisfies NetworkGraph);
	}

	async function handleRemoveEdge(id: string) {
		if (graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			edges: graph.edges.filter((e) => e.id !== id)
		} satisfies NetworkGraph);
	}

	async function handleEditDatapoint(updated: SpectrumDatapoint) {
		if (graph.type !== 'spectrum') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			datapoints: graph.datapoints.map((dp) => (dp.id === updated.id ? updated : dp))
		} satisfies SpectrumGraph);
	}

	async function handleEditNode(updated: NetworkNode) {
		if (graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			nodes: graph.nodes.map((n) => (n.id === updated.id ? updated : n))
		} satisfies NetworkGraph);
	}

	async function handleEditEdge(updated: NetworkEdge) {
		if (graph.type !== 'network') return;
		await persist({
			...graph,
			modified_at: new Date().toISOString(),
			edges: graph.edges.map((e) => (e.id === updated.id ? updated : e))
		} satisfies NetworkGraph);
	}

	async function handleNetworkPositions(positions: Record<string, { x: number; y: number }>) {
		if (graph.type !== 'network') return;
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

	async function handleDelete() {
		if (!confirm(`Delete "${graph.name}"? This can't be undone.`)) return;
		await deleteUserGraph(graph.id);
		await goto('/');
	}
</script>

<svelte:head>
	<title>{graph.name} – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← all graphs</a></p>
	<div class="header-row">
		<h1>{graph.name}</h1>
		<div class="header-actions">
			<button type="button" class="ghost-link" onclick={() => downloadGraphAsJson(graph)}>
				Export
			</button>
			{#if isUserGraph}
				<a class="ghost-link" href="/graphs/{graph.id}/edit">Edit</a>
				<button type="button" class="danger-ghost" onclick={handleDelete}>Delete</button>
			{/if}
		</div>
	</div>
	{#if graph.description}
		<p class="muted">{graph.description}</p>
	{/if}
	<p class="meta">
		{#if graph.type === 'spectrum'}
			{graph.schema.dimensions}D spectrum · {graph.datapoints.length} datapoints
		{:else}
			network · {graph.nodes.length} nodes · {graph.edges.length} edges
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

	<div class="chart">
		{#if graph.type === 'spectrum'}
			<SpectrumHistoryChart {graph} view={activeView} />
		{:else}
			<NetworkChart {graph} onPositionsChange={handleNetworkPositions} />
		{/if}
	</div>

	<GraphStats {graph} />

	{#if isUserGraph}
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
			{:else}
				<NetworkNodeForm {graph} onsubmit={handleAddNode} />
				<NetworkNodeList {graph} onremove={handleRemoveNode} onedit={handleEditNode} />
				<NetworkEdgeForm {graph} onsubmit={handleAddEdge} />
				<NetworkEdgeList {graph} onremove={handleRemoveEdge} onedit={handleEditEdge} />
			{/if}
		</section>
	{/if}
</main>

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
