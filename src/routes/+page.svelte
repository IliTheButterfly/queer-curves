<script lang="ts">
	import { fixtures, type Graph } from '$lib';
	import SpectrumHistoryChart from '$lib/graphs/spectrum/SpectrumHistoryChart.svelte';

	const aceflux = fixtures.acefluxFixture;
	const genderfluid = fixtures.genderfluidFixture;
	const others: Graph[] = fixtures.allFixtures.filter(
		(g) => g.id !== aceflux.id && g.id !== genderfluid.id
	);

	function summarize(g: Graph): string {
		if (g.type === 'spectrum') {
			const n = g.datapoints.length;
			return `${g.schema.dimensions}D spectrum, ${n} datapoint${n === 1 ? '' : 's'}`;
		}
		return `network, ${g.nodes.length} nodes, ${g.edges.length} edges`;
	}
</script>

<svelte:head>
	<title>queer-curves</title>
</svelte:head>

<main>
	<h1>queer-curves</h1>
	<p>Privacy-respecting graphs for tracking and sharing identity over time.</p>
	<p>
		Pre-development. See the design docs in the repository:
		<code>data_model.md</code>, <code>sharing_model.md</code>,
		<code>THREATS.md</code>, <code>STACK.md</code>.
	</p>

	<h2>{aceflux.name}</h2>
	<p class="muted">
		Aceflux 1D spectrum — {aceflux.datapoints.length} datapoints over time.
	</p>
	<div class="chart">
		<SpectrumHistoryChart graph={aceflux} />
	</div>

	<h2>{genderfluid.name}</h2>
	<p class="muted">
		Genderfluid 2D spectrum — trajectory cloud through identity-space.
	</p>
	<div class="chart">
		<SpectrumHistoryChart graph={genderfluid} />
	</div>

	<h2>Other fixtures</h2>
	<ul>
		{#each others as graph (graph.id)}
			<li>
				<strong>{graph.name}</strong>
				<span class="muted">— {summarize(graph)}</span>
			</li>
		{/each}
	</ul>
</main>

<style>
	h2 {
		font-size: 1.25rem;
		margin-top: var(--space-5);
		color: var(--color-accent);
	}
	ul {
		padding-left: var(--space-4);
	}
	li {
		margin-bottom: var(--space-2);
	}
	.muted {
		color: var(--color-muted);
	}
	.chart {
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
	}
	main {
		max-width: 80ch;
	}
</style>
