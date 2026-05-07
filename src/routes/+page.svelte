<script lang="ts">
	import { fixtures, type Graph } from '$lib';

	const graphs: Graph[] = fixtures.allFixtures;

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
	<p>
		Privacy-respecting graphs for tracking and sharing identity over time.
	</p>
	<p>
		Pre-development. See the design docs in the repository:
		<code>data_model.md</code>, <code>sharing_model.md</code>,
		<code>THREATS.md</code>, <code>STACK.md</code>.
	</p>

	<h2>Canonical fixtures</h2>
	<p class="muted">
		The data model's test cases — see <code>data_model.md</code> §11.
	</p>
	<ul>
		{#each graphs as graph (graph.id)}
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
</style>
