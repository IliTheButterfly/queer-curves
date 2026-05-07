<script lang="ts">
	import { goto } from '$app/navigation';
	import SpectrumHistoryChart from '$lib/graphs/spectrum/SpectrumHistoryChart.svelte';
	import NetworkChart from '$lib/graphs/network/NetworkChart.svelte';
	import { deleteUserGraph } from '$lib/store/graphs.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const graph = $derived(data.graph);
	const isUserGraph = $derived(data.isUserGraph);

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

	{#if isUserGraph && ((graph.type === 'spectrum' && graph.datapoints.length === 0) || (graph.type === 'network' && graph.nodes.length === 0))}
		<p class="muted empty-hint">
			This graph is empty. Datapoint and node editors are coming next — for now the schema is in
			place and you can preview it under different palettes.
		</p>
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
	.empty-hint {
		margin-top: var(--space-4);
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.02);
		border-radius: 4px;
		font-size: 0.9em;
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
