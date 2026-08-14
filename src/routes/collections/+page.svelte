<script lang="ts">
	import { listCollections } from '$lib/store/collections.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';
	import type { GraphCollection } from '$lib/types.js';

	let collections = $state<GraphCollection[]>([]);

	// Same reactivity contract as the landing page: re-list as the session
	// changes backend and as roomsEpoch bumps while sync trickles rooms in.
	$effect(() => {
		void matrixStore.session;
		void matrixStore.cryptoStatus;
		void matrixStore.roomsEpoch;
		if (!matrixStore.hydrated) return;
		(async () => {
			try {
				collections = await listCollections();
			} catch (e) {
				console.warn('listCollections failed', e);
				collections = [];
			}
		})();
	});
</script>

<svelte:head>
	<title>Collections · queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← back</a></p>
	<h1>
		Collections
		<a class="cta" href="/collections/new">+ new collection</a>
	</h1>
	<p class="muted">
		A collection plots several graphs on one chart without combining them. Each member keeps its own
		history, its own sharing, and its own edits — the collection only remembers which graphs to show
		together and what colour each one gets.
	</p>
	<p class="muted">
		If you'd rather end up with a single graph, <a href="/graphs/merge">merge them</a> instead.
	</p>

	{#if collections.length === 0}
		<p class="muted empty">No collections yet.</p>
	{:else}
		<ul class="list">
			{#each collections as c (c.id)}
				<li>
					<a href="/collections/{c.id}">
						<strong>{c.name}</strong>
						<span class="muted">
							— {c.members.length}
							{c.members.length === 1 ? 'graph' : 'graphs'}
						</span>
					</a>
				</li>
			{/each}
		</ul>
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
	h1 {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
	}
	.cta {
		font-size: 0.85rem;
		font-weight: normal;
		padding: var(--space-1) var(--space-3);
		background: rgba(201, 138, 255, 0.15);
		border-radius: 4px;
		color: var(--color-accent);
		text-decoration: none;
	}
	.cta:hover {
		background: rgba(201, 138, 255, 0.25);
	}
	.muted {
		color: var(--color-muted);
	}
	.empty {
		margin-top: var(--space-4);
	}
	.list {
		list-style: none;
		padding: 0;
		margin-top: var(--space-4);
	}
	.list li {
		margin-bottom: var(--space-2);
	}
	.list a {
		display: block;
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
		color: var(--color-fg);
		text-decoration: none;
		transition: background 0.15s;
	}
	.list a:hover {
		background: rgba(255, 255, 255, 0.07);
	}
</style>
