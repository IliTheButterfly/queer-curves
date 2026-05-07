<script lang="ts">
	import { onMount } from 'svelte';
	import { fixtures, type Graph } from '$lib';
	import { palettes } from '$lib/presets/palettes.js';
	import { listUserGraphs } from '$lib/store/graphs.js';
	import PaletteSwatch from '$lib/ui/PaletteSwatch.svelte';

	const fixtureGraphs: Graph[] = fixtures.allFixtures;
	let userGraphs = $state<Graph[]>([]);

	const featuredPalettes = palettes
		.filter((p) => ['pride', 'progress', 'trans', 'bi', 'lesbian', 'nb'].includes(p.id))
		.slice(0, 6);

	onMount(() => {
		userGraphs = listUserGraphs();
	});

	function summarize(g: Graph): string {
		if (g.type === 'spectrum') {
			const n = g.datapoints.length;
			return `${g.schema.dimensions}D spectrum · ${n} datapoint${n === 1 ? '' : 's'}`;
		}
		return `network · ${g.nodes.length} nodes · ${g.edges.length} edges`;
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

	<h2>
		Your graphs
		<a class="cta" href="/graphs/new">+ new graph</a>
	</h2>
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
	<p class="muted">Canonical test cases — see <code>data_model.md</code> §11.</p>
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
	}
	.cta:hover {
		background: rgba(201, 138, 255, 0.25);
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
