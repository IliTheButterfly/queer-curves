<script lang="ts">
	// Ordered multi-select over the user's graphs (plus fixtures, which are
	// handy for trying a combined view without owning two graphs yet).
	//
	// Order matters downstream: composition takes axis names, labels and
	// customization from the first selection, so the list shows the picked
	// order and lets the user promote an entry to first.
	import type { Graph } from '$lib/types.js';

	let {
		graphs,
		selected = $bindable<string[]>([]),
		// Once something is picked, anything that can't be composed with it is
		// disabled rather than hidden — a greyed-out row with a reason teaches
		// why, an absent row just looks like a bug.
		disabledReason = () => null
	}: {
		graphs: Graph[];
		selected: string[];
		disabledReason?: (g: Graph) => string | null;
	} = $props();

	const byId = $derived(new Map(graphs.map((g) => [g.id, g])));
	const chosen = $derived(selected.map((id) => byId.get(id)).filter((g): g is Graph => Boolean(g)));

	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	}

	function promote(id: string) {
		selected = [id, ...selected.filter((x) => x !== id)];
	}

	function summarize(g: Graph): string {
		if (g.type === 'spectrum') {
			const n = g.datapoints.length;
			return `${g.schema.dimensions}D spectrum · ${n} point${n === 1 ? '' : 's'}`;
		}
		return `network · ${g.nodes.length} nodes · ${g.edges.length} edges`;
	}
</script>

{#if graphs.length === 0}
	<p class="muted">No graphs to choose from yet.</p>
{:else}
	<ul class="picker">
		{#each graphs as graph (graph.id)}
			{@const reason = selected.includes(graph.id) ? null : disabledReason(graph)}
			<li class:disabled={reason !== null}>
				<label>
					<input
						type="checkbox"
						checked={selected.includes(graph.id)}
						disabled={reason !== null}
						onchange={() => toggle(graph.id)}
					/>
					<span class="name">{graph.name}</span>
					<span class="muted">— {summarize(graph)}</span>
				</label>
				{#if reason}
					<span class="reason">{reason}</span>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if chosen.length > 1}
	<p class="order-note muted">
		Order matters: axis names, labels and theme come from
		<strong>{chosen[0].name}</strong>.
	</p>
	<ol class="order">
		{#each chosen as graph, i (graph.id)}
			<li>
				<span>{graph.name}</span>
				{#if i > 0}
					<button type="button" class="promote" onclick={() => promote(graph.id)}>
						use as base
					</button>
				{:else}
					<span class="badge">base</span>
				{/if}
			</li>
		{/each}
	</ol>
{/if}

<style>
	.picker {
		list-style: none;
		padding: 0;
		margin: var(--space-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.picker li {
		padding: var(--space-2) var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
	}
	.picker li.disabled {
		opacity: 0.55;
	}
	.picker label {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		cursor: pointer;
	}
	.picker li.disabled label {
		cursor: not-allowed;
	}
	.name {
		font-weight: 600;
	}
	.reason {
		display: block;
		margin-top: var(--space-1);
		padding-left: 1.75rem;
		font-size: 0.85em;
		color: var(--color-muted);
	}
	.order-note {
		margin-top: var(--space-3);
		font-size: 0.9em;
	}
	.order {
		margin: var(--space-1) 0 0;
		padding-left: 1.5rem;
	}
	.order li {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
	}
	.promote {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 0.85em;
		color: var(--color-accent);
		cursor: pointer;
		text-decoration: underline;
	}
	.badge {
		font-size: 0.75em;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted);
	}
	.muted {
		color: var(--color-muted);
	}
</style>
