<script lang="ts">
	// History as a timeline rather than a table: one row per day, each row a
	// 24-hour track with a marker at the time each entry happened. Position
	// carries information a list can only spell out — that Friday's four
	// drinks were all after 10pm, or that the coffees cluster at 9am.
	//
	// Markers are buttons: tap one to edit or delete that entry. The day's
	// full entry list expands underneath, so nothing is reachable only by
	// hitting a small target.
	import type { Occurrence, OccurrenceGraph } from '$lib/types.js';
	import {
		dayFraction,
		dayStartHourOf,
		formatAmount,
		groupByDay,
		stepOf
	} from '$lib/graphs/occurrence/aggregate.js';
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

	// Days render newest-first and page in, since a daily counter is hundreds
	// of entries within a year.
	const PAGE = 120;
	let shown = $state(PAGE);
	let expandedDay = $state<string | null>(null);
	let editingId = $state<string | null>(null);

	const hour = $derived(dayStartHourOf(graph));
	const groups = $derived(groupByDay(graph, shown));
	const total = $derived(graph.occurrences.length);

	const counterById = $derived(new Map(graph.schema.counters.map((c) => [c.id, c])));
	const colorById = $derived.by(() => {
		const map = new Map<string, string>();
		for (const g of groups) for (const s of g.subtotals) map.set(s.counterId, s.color);
		return map;
	});

	// Marker size scales with amount relative to the counter's step, so a
	// double shows up bigger than a single without a legend explaining it.
	function markerSize(o: Occurrence): number {
		const counter = counterById.get(o.counter_id);
		const step = counter ? stepOf(counter) : 1;
		const ratio = step > 0 ? (o.amount || 0) / step : 1;
		return Math.max(9, Math.min(20, 9 + Math.sqrt(Math.max(0, ratio)) * 4));
	}

	// Hour ticks along the track, labelled at the quarters. Labels follow the
	// graph's own day start, so a 4am-start day reads 4 → 10 → 16 → 22.
	const ticks = $derived(
		[0, 6, 12, 18].map((offset) => ({
			offset,
			fraction: offset / 24,
			label: `${String((hour + offset) % 24).padStart(2, '0')}`
		}))
	);

	function formatDayHeading(start: Date): string {
		const today = new Date();
		const isToday = start.toDateString() === today.toDateString();
		const label = start.toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
		return isToday ? `${label} · today` : label;
	}

	function formatTime(ts: string): string {
		return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	function describe(o: Occurrence): string {
		const counter = counterById.get(o.counter_id);
		const parts = [
			formatTime(o.timestamp),
			`${counter?.label ?? o.counter_id}`,
			`${formatAmount(o.amount)} ${counter?.unit ?? ''}`.trim()
		];
		if (o.notes) parts.push(o.notes);
		return parts.join(' · ');
	}

	function toggleDay(key: string) {
		expandedDay = expandedDay === key ? null : key;
		editingId = null;
	}

	function openEntry(o: Occurrence, dayKey: string) {
		if (!editable) return;
		expandedDay = dayKey;
		editingId = o.id;
	}

	function handleSave(o: Occurrence) {
		onedit?.(o);
		editingId = null;
	}
</script>

{#if total > 0}
	<section class="timeline">
		<div class="timeline-head">
			<h3>Timeline <small class="muted">({total})</small></h3>
			<div class="scale-legend" aria-hidden="true">
				{#each ticks as t (t.offset)}
					<span style:left="{t.fraction * 100}%">{t.label}</span>
				{/each}
			</div>
		</div>

		<ol class="days">
			{#each groups as g (g.key)}
				<li class="day" class:expanded={expandedDay === g.key}>
					<div class="day-row">
						<button
							type="button"
							class="day-label"
							onclick={() => toggleDay(g.key)}
							aria-expanded={expandedDay === g.key}
						>
							<span class="chev" aria-hidden="true">{expandedDay === g.key ? '▾' : '▸'}</span>
							{formatDayHeading(g.start)}
						</button>

						<div class="track">
							<div class="track-line" aria-hidden="true"></div>
							{#each ticks as t (t.offset)}
								<div class="tick" style:left="{t.fraction * 100}%" aria-hidden="true"></div>
							{/each}
							{#each g.entries as o (o.id)}
								{@const size = markerSize(o)}
								<button
									type="button"
									class="marker"
									class:readonly={!editable}
									style:left="{dayFraction(new Date(o.timestamp), hour) * 100}%"
									style:width="{size}px"
									style:height="{size}px"
									style:background={colorById.get(o.counter_id) ?? '#c98aff'}
									title={describe(o)}
									aria-label={editable ? `Edit entry: ${describe(o)}` : describe(o)}
									onclick={() => openEntry(o, g.key)}
								></button>
							{/each}
						</div>

						<div class="day-totals">
							{#each g.subtotals as st (st.counterId)}
								<span class="subtotal" title="{st.label} — {st.unit}">
									<span class="dot" style:background={st.color}></span>
									{formatAmount(st.total)}
								</span>
							{/each}
						</div>
					</div>

					{#if expandedDay === g.key}
						<ul class="entries">
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
											<span class="what"
												>{counterById.get(o.counter_id)?.label ?? o.counter_id}</span
											>
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
					{/if}
				</li>
			{/each}
		</ol>

		{#if shown < total}
			<button type="button" class="ghost more" onclick={() => (shown += PAGE)}>
				Show earlier entries
			</button>
		{/if}
	</section>
{/if}

<style>
	.timeline {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
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

	/* Head mirrors the day-row grid so the hour labels sit over the track. */
	.timeline-head {
		display: grid;
		grid-template-columns: 8.5rem minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: end;
	}
	.scale-legend {
		position: relative;
		height: 1em;
		font-size: 0.7em;
		color: var(--color-muted);
		font-family: var(--font-mono);
	}
	.scale-legend span {
		position: absolute;
		transform: translateX(-50%);
	}

	.days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.day {
		border-top: 1px solid rgba(255, 255, 255, 0.05);
	}
	.day.expanded {
		background: rgba(255, 255, 255, 0.02);
	}
	.day-row {
		display: grid;
		grid-template-columns: 8.5rem minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: center;
		min-height: 2.4rem;
	}

	button.day-label {
		background: none;
		border: none;
		color: var(--color-muted);
		font: inherit;
		font-size: 0.85em;
		text-align: left;
		cursor: pointer;
		padding: var(--space-1) 0;
		display: inline-flex;
		gap: var(--space-1);
		align-items: baseline;
		text-transform: lowercase;
	}
	button.day-label:hover {
		color: var(--color-fg);
	}
	.chev {
		width: 0.7em;
		flex-shrink: 0;
	}

	.track {
		position: relative;
		height: 1.6rem;
	}
	.track-line {
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 1px;
		background: rgba(255, 255, 255, 0.08);
	}
	.tick {
		position: absolute;
		top: 25%;
		bottom: 25%;
		width: 1px;
		background: rgba(255, 255, 255, 0.06);
	}
	button.marker {
		position: absolute;
		top: 50%;
		border: none;
		border-radius: 50%;
		padding: 0;
		cursor: pointer;
		transform: translate(-50%, -50%);
		opacity: 0.85;
		box-shadow: 0 0 0 2px var(--color-bg);
	}
	button.marker:hover,
	button.marker:focus-visible {
		opacity: 1;
		outline: none;
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 3px var(--color-accent);
	}
	button.marker.readonly {
		cursor: default;
	}

	.day-totals {
		display: flex;
		gap: var(--space-2);
		font-family: var(--font-mono);
		font-size: 0.85em;
		justify-content: flex-end;
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

	.entries {
		list-style: none;
		margin: 0 0 var(--space-2) 8.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	/* One row per entry, with the actions inline rather than wrapped onto a
	   line of their own; tags and notes span underneath when present. */
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

	/* Narrow screens: the day label and totals stack above the track rather
	   than squeezing it to nothing. */
	@media (max-width: 640px) {
		.timeline-head {
			grid-template-columns: 1fr;
		}
		.scale-legend {
			display: none;
		}
		.day-row {
			grid-template-columns: 1fr auto;
			grid-template-areas: 'label totals' 'track track';
			gap: var(--space-1) var(--space-2);
			padding: var(--space-1) 0;
		}
		button.day-label {
			grid-area: label;
		}
		.day-totals {
			grid-area: totals;
		}
		.track {
			grid-area: track;
		}
		.entries {
			margin-left: 0;
		}
	}
</style>
