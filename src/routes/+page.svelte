<script lang="ts">
	import { fixtures, type Graph } from '$lib';

	const graphs: Graph[] = fixtures.allFixtures;

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

	<h2>Fixtures</h2>
	<p class="muted">Canonical test cases — see <code>data_model.md</code> §11.</p>
	<ul class="graph-list">
		{#each graphs as graph (graph.id)}
			<li>
				<a href="/graphs/{graph.id}">
					<strong>{graph.name}</strong>
					<span class="muted">— {summarize(graph)}</span>
				</a>
			</li>
		{/each}
	</ul>
</main>

<style>
	main {
		max-width: 80ch;
	}
	h2 {
		font-size: 1.25rem;
		margin-top: var(--space-5);
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
</style>
