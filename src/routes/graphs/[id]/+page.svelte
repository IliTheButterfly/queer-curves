<script lang="ts">
	import SpectrumHistoryChart from '$lib/graphs/spectrum/SpectrumHistoryChart.svelte';
	import NetworkChart from '$lib/graphs/network/NetworkChart.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const graph = $derived(data.graph);
</script>

<svelte:head>
	<title>{graph.name} – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← all graphs</a></p>
	<h1>{graph.name}</h1>
	{#if graph.description}
		<p class="muted">{graph.description}</p>
	{/if}
	<p class="meta">
		{#if graph.type === 'spectrum'}
			{graph.schema.dimensions}D spectrum · {graph.datapoints.length} datapoints
		{:else}
			network · {graph.nodes.length} nodes · {graph.edges.length} edges
		{/if}
	</p>

	<div class="chart">
		{#if graph.type === 'spectrum'}
			<SpectrumHistoryChart {graph} />
		{:else}
			<NetworkChart {graph} />
		{/if}
	</div>
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
	.muted {
		color: var(--color-muted);
	}
	.meta {
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.chart {
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
	}
</style>
