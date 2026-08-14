<script lang="ts">
	// Plain reverse-chronological log, grouped by the graph's own day, with a
	// per-counter subtotal per day. BetterCounter keeps its history out of the
	// main screen entirely (it lives behind the chart and an export), so this
	// stays collapsed by default — it exists to correct and delete individual
	// entries, not to be read.
	import type { Occurrence, OccurrenceGraph } from '$lib/types.js';
	import { formatAmount, groupByDay } from '$lib/graphs/occurrence/aggregate.js';
	import OccurrenceForm from './OccurrenceForm.svelte';

	let {
		graph,
		editable = true,
		onremove,
		onedit
	}: {
		graph: OccurrenceGraph;
		editable?: boolean;
		onremove?: (id: string) => void;
		onedit?: (occurrence: Occurrence) => void;
	} = $props();

	const PAGE = 60;
	let shown = $state(PAGE);
	let editingId = $state<string | null>(null);

	const total = $derived(graph.occurrences.length);
	const groups = $derived(groupByDay(graph, shown));
	const counterById = $derived(new Map(graph.schema.counters.map((c) => [c.id, c])));
	const colorById = $derived.by(() => {
		const map = new Map<string, string>();
		for (const g of groups) for (const s of g.subtotals) map.set(s.counterId, s.color);
		return map;
	});

	function formatDay(start: Date): string {
		return start.toLocaleDateString(undefined, {
			weekday: 'short',
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatTime(ts: string): string {
		return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	function handleSave(o: Occurrence) {
		onedit?.(o);
		editingId = null;
	}
</script>

{#if total > 0}
	<div class="history">
		{#each groups as g (g.key)}
			<div class="day">
				<div class="day-head">
					<span class="day-label">{formatDay(g.start)}</span>
					<span class="day-totals">
						{#each g.subtotals as st (st.counterId)}
							<span class="subtotal" title="{st.label} — {st.unit}">
								<span class="dot" style:background={st.color}></span>
								{formatAmount(st.total)}
							</span>
						{/each}
					</span>
				</div>
				<ul>
					{#each g.entries as o (o.id)}
						<li class="entry" class:editing={editable && editingId === o.id}>
							{#if editable && editingId === o.id}
								<OccurrenceForm
									{graph}
									initial={o}
									onsubmit={handleSave}
									oncancel={() => (editingId = null)}
								/>
							{:else}
								<div class="entry-info">
									<span class="time">{formatTime(o.timestamp)}</span>
									<span class="dot" style:background={colorById.get(o.counter_id) ?? '#c98aff'}
									></span>
									<span class="what">{counterById.get(o.counter_id)?.label ?? o.counter_id}</span>
									<span class="amount">
										{formatAmount(o.amount)}
										<small class="muted">{counterById.get(o.counter_id)?.unit ?? ''}</small>
									</span>
								</div>
								{#if o.tags && o.tags.length > 0}
									<div class="tags">
										{#each o.tags as t (t)}<span class="tag">{t}</span>{/each}
									</div>
								{/if}
								{#if o.notes}
									<div class="notes">{o.notes}</div>
								{/if}
								{#if editable}
									<div class="entry-actions">
										<button type="button" class="ghost" onclick={() => (editingId = o.id)}>
											Edit
										</button>
										<button
											type="button"
											class="remove"
											onclick={() => onremove?.(o.id)}
											aria-label="remove entry"
										>
											×
										</button>
									</div>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
		{#if shown < total}
			<button type="button" class="ghost more" onclick={() => (shown += PAGE)}>
				Show earlier entries
			</button>
		{/if}
	</div>
{/if}

<style>
	.history {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.day {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.day-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding-bottom: 2px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.day-label {
		color: var(--color-muted);
		font-size: 0.85em;
		text-transform: lowercase;
		letter-spacing: 0.03em;
	}
	.day-totals {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		font-family: var(--font-mono);
		font-size: 0.85em;
	}
	.subtotal {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		padding: var(--space-2);
		background: rgba(0, 0, 0, 0.18);
		border-radius: 4px;
	}
	.entry.editing {
		display: block;
	}
	.entry-info {
		grid-column: 1;
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		flex-wrap: wrap;
	}
	.entry .tags,
	.entry .notes {
		grid-column: 1 / -1;
	}
	.time {
		color: var(--color-muted);
		font-size: 0.85em;
		font-family: var(--font-mono);
	}
	.what {
		color: var(--color-fg);
	}
	.amount {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
	.tags {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.tag {
		padding: 0 6px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 999px;
		font-size: 0.75em;
		color: var(--color-muted);
	}
	.notes {
		color: var(--color-muted);
		font-size: 0.85em;
		font-style: italic;
	}
	.muted {
		color: var(--color-muted);
	}
	.entry-actions {
		grid-column: 2;
		grid-row: 1;
		display: flex;
		gap: var(--space-1);
		justify-content: flex-end;
	}
	button.ghost {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: 0 var(--space-2);
		border-radius: 4px;
		font: inherit;
		font-size: 0.85em;
		cursor: pointer;
	}
	button.ghost:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-accent);
	}
	button.more {
		align-self: flex-start;
		padding: var(--space-1) var(--space-3);
	}
	button.remove {
		background: transparent;
		border: 1px solid rgba(255, 100, 100, 0.2);
		color: rgba(255, 150, 150, 0.8);
		padding: 0 var(--space-2);
		border-radius: 4px;
		font: inherit;
		cursor: pointer;
	}
	button.remove:hover {
		background: rgba(255, 100, 100, 0.1);
		border-color: rgba(255, 100, 100, 0.6);
		color: rgba(255, 150, 150, 1);
	}
</style>
