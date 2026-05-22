<script lang="ts">
	import { goto } from '$app/navigation';
	import { saveUserGraph } from '$lib/store/graphs.js';
	import GraphConfigForm from '$lib/ui/GraphConfigForm.svelte';
	import type { Graph } from '$lib/types.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	async function handleSubmit(graph: Graph) {
		const saved = await saveUserGraph(graph);
		await goto(`/graphs/${saved.id}`);
	}
</script>

<svelte:head>
	<title>Edit {data.graph.name} – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/graphs/{data.graph.id}">← back to graph</a></p>
	<h1>Edit {data.graph.name}</h1>

	<GraphConfigForm
		initial={data.graph}
		onsubmit={handleSubmit}
		cancelHref="/graphs/{data.graph.id}"
	/>
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
