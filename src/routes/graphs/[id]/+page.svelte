<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import SpectrumHistoryChart from '$lib/graphs/spectrum/SpectrumHistoryChart.svelte';
	import NetworkChart from '$lib/graphs/network/NetworkChart.svelte';
	import SpectrumDatapointForm from '$lib/ui/SpectrumDatapointForm.svelte';
	import NetworkNodeForm from '$lib/ui/NetworkNodeForm.svelte';
	import NetworkEdgeForm from '$lib/ui/NetworkEdgeForm.svelte';
	import { deleteUserGraph, saveUserGraph } from '$lib/store/graphs.js';
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

	// Local mutable copy. Re-seeded when navigating to a different graph,
	// preserved across in-page edits.
	let graph = $state<Graph>(untrack(() => data.graph));
	$effect(() => {
		if (data.graph.id !== graph.id) {
			graph = data.graph;
		}
	});

	const isUserGraph = $derived(data.isUserGraph);

	function persist(updated: Graph) {
		graph = updated;
		if (isUserGraph) saveUserGraph(updated);
	}

	function handleAddDatapoint(dp: SpectrumDatapoint) {
		if (graph.type !== 'spectrum') return;
		const updated: SpectrumGraph = {
			...graph,
			modified_at: new Date().toISOString(),
			datapoints: [...graph.datapoints, dp]
		};
		persist(updated);
	}

	function handleAddNode(node: NetworkNode) {
		if (graph.type !== 'network') return;
		const updated: NetworkGraph = {
			...graph,
			modified_at: new Date().toISOString(),
			nodes: [...graph.nodes, node]
		};
		persist(updated);
	}

	function handleAddEdge(edge: NetworkEdge) {
		if (graph.type !== 'network') return;
		const updated: NetworkGraph = {
			...graph,
			modified_at: new Date().toISOString(),
			edges: [...graph.edges, edge]
		};
		persist(updated);
	}

	async function handleDelete() {
		if (!confirm(`Delete "${graph.name}"? This can't be undone.`)) return;
		deleteUserGraph(graph.id);
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
		{#if isUserGraph}
			<button type="button" class="danger-ghost" onclick={handleDelete}>Delete</button>
		{/if}
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

	<div class="chart">
		{#if graph.type === 'spectrum'}
			<SpectrumHistoryChart {graph} />
		{:else}
			<NetworkChart {graph} />
		{/if}
	</div>

	{#if isUserGraph}
		<section class="editors">
			{#if graph.type === 'spectrum'}
				<SpectrumDatapointForm {graph} onsubmit={handleAddDatapoint} />
			{:else}
				<NetworkNodeForm {graph} onsubmit={handleAddNode} />
				<NetworkEdgeForm {graph} onsubmit={handleAddEdge} />
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
