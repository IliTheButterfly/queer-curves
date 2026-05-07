<script lang="ts">
	import { fixtures, type Graph } from '$lib';
	import PaletteSwatch from '$lib/ui/PaletteSwatch.svelte';
	import SpectrumHistoryChart from '$lib/graphs/spectrum/SpectrumHistoryChart.svelte';
	import NetworkChart from '$lib/graphs/network/NetworkChart.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const palette = $derived(data.palette);

	// Apply the palette to each fixture, returning new graphs we can render.
	const previewed = $derived<Graph[]>(
		fixtures.allFixtures.map((g) => applyPalette(g, palette.colors))
	);

	function applyPalette(graph: Graph, colors: string[]): Graph {
		// Stable shallow clone with palette swapped. Background also gets the
		// last color of the palette tinted dark — gives a flag-themed feel
		// without sacrificing legibility.
		return {
			...graph,
			customization: {
				...graph.customization,
				theme: { ...graph.customization.theme, palette: colors }
			}
		} as Graph;
	}
</script>

<svelte:head>
	<title>{palette.name} palette – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/palettes">← all palettes</a></p>
	<h1>{palette.name}</h1>
	{#if palette.flag}
		<p class="flag">{palette.flag}</p>
	{/if}
	{#if palette.description}
		<p class="description">{palette.description}</p>
	{/if}

	<div class="hero-swatch">
		<PaletteSwatch {palette} height={120} />
	</div>

	<div class="hex-list" aria-label="Hex values">
		{#each palette.colors as color (color)}
			<span class="hex-chip">
				<span class="dot" style:background={color}></span>
				<code>{color}</code>
			</span>
		{/each}
	</div>

	<h2>Previews</h2>
	<p class="muted">Each fixture rendered with this palette.</p>

	{#each previewed as graph (graph.id)}
		<section class="preview">
			<h3>{graph.name}</h3>
			<div class="chart">
				{#if graph.type === 'spectrum'}
					<SpectrumHistoryChart {graph} />
				{:else}
					<NetworkChart {graph} />
				{/if}
			</div>
		</section>
	{/each}
</main>

<style>
	main {
		max-width: 90ch;
	}
	.back a {
		color: var(--color-muted);
		text-decoration: none;
	}
	.back a:hover {
		color: var(--color-accent);
	}
	.flag {
		margin-top: calc(var(--space-1) * -1);
		color: var(--color-muted);
	}
	.description {
		margin-top: var(--space-2);
	}
	.muted {
		color: var(--color-muted);
	}
	.hero-swatch {
		margin: var(--space-4) 0 var(--space-3);
	}
	.hex-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}
	.hex-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 4px 10px;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 999px;
	}
	.dot {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
	}
	h2 {
		font-size: 1.25rem;
		margin-top: var(--space-5);
		color: var(--color-accent);
	}
	.preview {
		margin-top: var(--space-4);
	}
	.preview h3 {
		font-size: 1rem;
		margin: 0 0 var(--space-2);
	}
	.chart {
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
	}
</style>
