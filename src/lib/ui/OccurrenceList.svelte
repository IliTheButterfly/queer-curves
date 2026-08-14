<script lang="ts">
	// The history log, newest first and grouped by the graph's own notion of
	// a day (day_start_hour included) with a per-day subtotal — the shape
	// every counting app's history screen takes, because "how much did I
	// have on Saturday" is the question people actually ask of a log.
	import type { Occurrence, OccurrenceGraph } from '$lib/types.js';
	import {
		counterColor,
		dayStart,
		dayStartHourOf,
		formatAmount
	} from '$lib/graphs/occurrence/aggregate.js';
	import OccurrenceForm from './OccurrenceForm.svelte';

	let {
		graph,
		onremove,
		onedit
	}: {
		graph: OccurrenceGraph;
		onremove: (id: string) => void;
		onedit: (occurrence: Occurrence) => void;
	} = $props();

	let editingId = $state<string | null>(null);
	// The log gets long fast — a daily counter is hundreds of rows in a year,
	// so only the most recent slice renders until asked for more.
	const PAGE = 60;
	let shown = $state(PAGE);

	const counterById = $derived(new Map(graph.schema.counters.map((c) => [c.id, c])));
	const colorById = $derived(
		new Map(
			graph.schema.counters.map((c, i) => [
				c.id,
				counterColor(c, i, graph.customization.theme.palette)
			])
		)
	);

	interface DayGroup {
		key: string;
		start: Date;
		entries: Occurrence[];
		// Subtotal per counter — mixing units into one number would be
		// meaningless, so each counter is totalled separately.
		subtotals: { counterId: string; label: string; unit: string; total: number }[];
	}

	const groups = $derived.by(() => {
		const hour = dayStartHourOf(graph);
		const sorted = [...graph.occurrences].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		const visible = sorted.slice(0, shown);
		const out: DayGroup[] = [];
		const byKey = new Map<string, DayGroup>();
		for (const o of visible) {
			const start = dayStart(new Date(o.timestamp), hour);
			const key = start.toISOString();
			let g = byKey.get(key);
			if (!g) {
				g = { key, start, entries: [], subtotals: [] };
				byKey.set(key, g);
				out.push(g);
			}
			g.entries.push(o);
		}
		for (const g of out) {
			const totals = new Map<string, number>();
			for (const o of g.entries) {
				totals.set(o.counter_id, (totals.get(o.counter_id) ?? 0) + (o.amount ?? 0));
			}
			g.subtotals = [...totals.entries()].map(([counterId, total]) => {
				const c = counterById.get(counterId);
				return {
					counterId,
					label: c?.label ?? counterId,
					unit: c?.unit ?? '',
					total
				};
			});
		}
		return out;
	});

	const total = $derived(graph.occurrences.length);

	function formatDayHeading(start: Date): string {
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
		onedit(o);
		editingId = null;
	}
</script>

{#if total > 0}
	<div class="occ-list">
		<h3>
			History <small class="muted">({total})</small>
		</h3>
		{#each groups as g (g.key)}
			<div class="day">
				<div class="day-head">
					<span class="day-label">{formatDayHeading(g.start)}</span>
					<span class="day-subtotals">
						{#each g.subtotals as st (st.counterId)}
							<span class="subtotal">
								<span class="dot" style:background={colorById.get(st.counterId) ?? '#c98aff'}
								></span>
								{formatAmount(st.total)}
								<small class="muted">{st.unit}</small>
							</span>
						{/each}
					</span>
				</div>
				<ul>
					{#each g.entries as o (o.id)}
						<li class="occ-row">
							{#if editingId === o.id}
								<OccurrenceForm
									{graph}
									initial={o}
									onsubmit={handleSave}
									oncancel={() => (editingId = null)}
								/>
							{:else}
								<div class="occ-info">
									<div class="primary-line">
										<span class="time">{formatTime(o.timestamp)}</span>
										<span class="dot" style:background={colorById.get(o.counter_id) ?? '#c98aff'}
										></span>
										<span class="what">
											{counterById.get(o.counter_id)?.label ?? o.counter_id}
										</span>
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
								</div>
								<div class="row-actions">
									<button
										type="button"
										class="edit"
										onclick={() => (editingId = o.id)}
										aria-label="edit entry"
									>
										Edit
									</button>
									<button
										type="button"
										class="remove"
										onclick={() => onremove(o.id)}
										aria-label="remove entry"
									>
										×
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
		{#if shown < total}
			<button type="button" class="edit more" onclick={() => (shown += PAGE)}>
				Show {Math.min(PAGE, total - shown)} more
			</button>
		{/if}
	</div>
{/if}

<style>
	.occ-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-accent);
	}
	.muted {
		color: var(--color-muted);
		font-weight: normal;
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
	.day-subtotals {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		font-family: var(--font-mono);
		font-size: 0.85em;
	}
	.subtotal {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
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
	.occ-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2);
		background: rgba(0, 0, 0, 0.15);
		border-radius: 4px;
	}
	.occ-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.primary-line {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		flex-wrap: wrap;
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
	.row-actions {
		display: flex;
		gap: var(--space-1);
		align-items: center;
		flex-shrink: 0;
	}
	button.edit {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: 0 var(--space-2);
		border-radius: 4px;
		font: inherit;
		font-size: 0.85em;
		cursor: pointer;
	}
	button.edit:hover {
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
		font-size: 1.1em;
		cursor: pointer;
	}
	button.remove:hover {
		background: rgba(255, 100, 100, 0.1);
		border-color: rgba(255, 100, 100, 0.6);
		color: rgba(255, 150, 150, 1);
	}
</style>
