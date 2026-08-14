<script lang="ts">
	// Merge several graphs into one new graph.
	//
	// Non-destructive by design: the sources are untouched, so the escape
	// hatch from a merge the user regrets is "delete the result". The page
	// says so explicitly, because "merge" in most tools means the inputs go
	// away.
	import { goto } from '$app/navigation';
	import { fixtures, type Graph } from '$lib';
	import { listUserGraphs } from '$lib/store/graphs.js';
	import { checkComposable, composeGraphs, type ComposeSource } from '$lib/store/compose.js';
	import { mergeIntoNewGraph, suggestMergeName } from '$lib/store/merge.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';
	import GraphMultiSelect from '$lib/ui/GraphMultiSelect.svelte';
	import ComposeIssues from '$lib/ui/ComposeIssues.svelte';

	let userGraphs = $state<Graph[]>([]);
	let selected = $state<string[]>([]);
	let name = $state('');
	let nameTouched = $state(false);
	let working = $state(false);
	let error = $state<string | null>(null);

	const available = $derived([...userGraphs, ...fixtures.allFixtures]);
	const byId = $derived(new Map(available.map((g) => [g.id, g])));
	const sources = $derived<ComposeSource[]>(
		selected
			.map((id) => byId.get(id))
			.filter((g): g is Graph => Boolean(g))
			.map((graph) => ({ graph }))
	);

	const viewer = $derived(matrixStore.session?.userId ?? undefined);
	const issues = $derived(sources.length > 0 ? checkComposable(sources, viewer) : []);
	const blocked = $derived(issues.some((i) => i.level === 'error'));
	const suggested = $derived(sources.length > 0 ? suggestMergeName(sources) : '');
	const effectiveName = $derived(nameTouched && name.trim() ? name.trim() : suggested);

	// Live preview of what the merge would produce, without saving anything.
	// The id/owner here are throwaway — mergeIntoNewGraph mints the real ones.
	const preview = $derived.by(() => {
		if (sources.length === 0 || blocked) return null;
		try {
			return composeGraphs(sources, {
				id: 'preview',
				name: effectiveName || 'Merged graph',
				owner: viewer ?? 'local',
				now: new Date(0).toISOString()
			});
		} catch {
			return null;
		}
	});

	$effect(() => {
		void matrixStore.session;
		void matrixStore.cryptoStatus;
		void matrixStore.roomsEpoch;
		if (!matrixStore.hydrated) return;
		(async () => {
			try {
				userGraphs = await listUserGraphs();
			} catch (e) {
				console.warn('listUserGraphs failed', e);
			}
		})();
	});

	// Once a first graph is picked, disable everything it can't combine with.
	function disabledReason(g: Graph): string | null {
		if (sources.length === 0) return null;
		const trial = checkComposable([...sources, { graph: g }], viewer);
		const err = trial.find((i) => i.level === 'error');
		return err ? err.message : null;
	}

	async function handleMerge() {
		if (working || sources.length < 2 || blocked) return;
		error = null;
		working = true;
		try {
			const merged = await mergeIntoNewGraph({
				sources,
				name: effectiveName || 'Merged graph',
				owner: viewer ?? 'local'
			});
			await goto(`/graphs/${merged.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			working = false;
		}
	}
</script>

<svelte:head>
	<title>Merge graphs · queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← back</a></p>
	<h1>Merge graphs</h1>
	<p class="muted">
		Combines the data from several graphs into one new graph. The originals are left exactly as they
		are — nothing is moved or deleted, so you can undo a merge by deleting the result.
	</p>
	<p class="muted">
		Want to see graphs side by side without committing to one? Make a
		<a href="/collections">collection</a> instead — it plots them together and keeps them separate.
	</p>

	<h2>Pick graphs</h2>
	<GraphMultiSelect graphs={available} bind:selected {disabledReason} />

	{#if sources.length > 0}
		<ComposeIssues {issues} />
	{/if}

	{#if sources.length >= 2 && !blocked}
		<h2>Name</h2>
		<input
			type="text"
			value={nameTouched ? name : suggested}
			placeholder={suggested}
			oninput={(e) => {
				nameTouched = true;
				name = e.currentTarget.value;
			}}
		/>

		{#if preview}
			<h2>Result</h2>
			<ul class="preview">
				{#if preview.type === 'spectrum'}
					<li>{preview.datapoints.length} datapoints</li>
					<li>{preview.schema.regions.length} regions</li>
					<li>
						axes: {preview.schema.axes
							.map((a) => `${a.name} [${a.range[0]}, ${a.range[1]}]`)
							.join(' · ')}
					</li>
				{:else if preview.type === 'network'}
					<li>{preview.nodes.length} nodes</li>
					<li>{preview.edges.length} edges</li>
					<li>{preview.schema.edge_types.length} edge types</li>
				{/if}
			</ul>
		{/if}

		<div class="actions">
			<button type="button" class="cta" onclick={handleMerge} disabled={working}>
				{working ? 'Merging…' : `Create merged graph`}
			</button>
		</div>
	{:else if sources.length === 1}
		<p class="muted">Pick at least one more graph to merge with.</p>
	{/if}

	{#if error}
		<p class="error">{error}</p>
	{/if}
</main>

<style>
	main {
		max-width: 80ch;
	}
	.back a {
		color: var(--color-muted);
		text-decoration: none;
		font-size: 0.9em;
	}
	.back a:hover {
		color: var(--color-accent);
	}
	h2 {
		font-size: 1.1rem;
		margin-top: var(--space-5);
		color: var(--color-accent);
	}
	.muted {
		color: var(--color-muted);
	}
	input[type='text'] {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		margin-top: var(--space-2);
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 4px;
		color: var(--color-fg);
		font: inherit;
	}
	input[type='text']:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.preview {
		margin-top: var(--space-2);
		padding-left: 1.25rem;
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.actions {
		margin-top: var(--space-4);
	}
	.cta {
		padding: var(--space-2) var(--space-4);
		background: rgba(201, 138, 255, 0.15);
		border: none;
		border-radius: 4px;
		color: var(--color-accent);
		font: inherit;
		cursor: pointer;
	}
	.cta:hover:not(:disabled) {
		background: rgba(201, 138, 255, 0.25);
	}
	.cta:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.error {
		padding: var(--space-2) var(--space-3);
		margin-top: var(--space-3);
		background: rgba(255, 100, 100, 0.1);
		border: 1px solid rgba(255, 100, 100, 0.3);
		color: rgba(255, 180, 180, 1);
		border-radius: 4px;
		font-size: 0.9em;
	}
</style>
