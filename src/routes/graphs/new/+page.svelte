<script lang="ts">
	import { goto } from '$app/navigation';
	import { saveUserGraph } from '$lib/store/graphs.js';
	import GraphConfigForm from '$lib/ui/GraphConfigForm.svelte';
	import type { Graph } from '$lib/types.js';

	async function handleSubmit(graph: Graph) {
		// Matrix path may rewrite graph.id to the new room's id, so route
		// to whatever id the store actually persisted.
		const saved = await saveUserGraph(graph);
		await goto(`/graphs/${saved.id}`);
	}
</script>

<svelte:head>
	<title>New graph – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← home</a></p>
	<h1>New graph</h1>

	<GraphConfigForm onsubmit={handleSubmit} cancelHref="/" />
</main>

<style>
	main {
		max-width: 70ch;
	}
	.back a {
		color: var(--color-muted);
		text-decoration: none;
	}
	.back a:hover {
		color: var(--color-accent);
	}
</style>
