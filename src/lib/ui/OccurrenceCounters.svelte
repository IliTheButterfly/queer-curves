<script lang="ts">
	// The counter list, modelled on BetterCounter (data_model.md §4A.7): one
	// row per counter, a big − and + flanking it, and between them the
	// counter's name, its total for its *own* interval, and how long since the
	// last one. That layout is the whole app in BetterCounter, and the reason
	// it works is that the three things you actually want — add one, how many
	// so far, how long since — are all on one line with no navigation.
	//
	// Departures from BetterCounter, both forced by this model rather than
	// chosen: entries carry an amount (a pint is 2.3 units, not 1), so the +
	// row can offer presets; and − removes the most recent entry rather than
	// decrementing a number, because the data is a list of events, not a
	// counter value.
	import type { Occurrence, OccurrenceGraph } from '$lib/types.js';
	import {
		counterColor,
		formatAmount,
		formatElapsed,
		goalProgress,
		INTERVAL_LABELS,
		intervalOf,
		intervalTotal,
		lifetimeAverage,
		msSinceLast,
		stepOf
	} from '$lib/graphs/occurrence/aggregate.js';

	let {
		graph,
		onadd,
		onremove
	}: {
		graph: OccurrenceGraph;
		onadd: (occurrence: Occurrence) => void;
		// Undo: hands back the id of the most recent entry for a counter.
		onremove?: (id: string) => void;
	} = $props();

	// Re-read the clock after each change so "3h ago" and the interval totals
	// move without a reload.
	let clock = $state(Date.now());
	const now = $derived(new Date(clock));

	const rows = $derived(
		graph.schema.counters.map((counter, i) => {
			const interval = intervalOf(counter);
			const mine = graph.occurrences.filter((o) => o.counter_id === counter.id);
			// Newest entry, which is what − takes back.
			let latest: Occurrence | null = null;
			for (const o of mine) if (latest === null || o.timestamp > latest.timestamp) latest = o;
			return {
				counter,
				interval,
				color: counterColor(counter, i, graph.customization.theme.palette),
				step: stepOf(counter),
				total: intervalTotal(graph, counter.id, interval, now),
				since: msSinceLast(graph, counter.id, now),
				average: lifetimeAverage(graph, counter.id, interval, now),
				goal: goalProgress(graph, counter.id, now),
				latest
			};
		})
	);

	function generateId(): string {
		return 'oc_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
	}

	function add(counterId: string, amount: number) {
		onadd({
			id: generateId(),
			counter_id: counterId,
			// A tap always means "now"; anything else goes through the form.
			timestamp: new Date().toISOString(),
			amount
		});
		clock = Date.now();
	}

	function undo(latest: Occurrence | null) {
		if (!latest || !onremove) return;
		onremove(latest.id);
		clock = Date.now();
	}

	function formatAverage(a: { perUnit: number | null; unit: 'hour' | 'day' }): string {
		if (a.perUnit === null) return '—';
		// Below one per unit, "every N days" reads better than "0.14/day" —
		// the same switch BetterCounter makes.
		if (a.perUnit > 0 && a.perUnit < 1) {
			const every = 1 / a.perUnit;
			return `every ${formatAmount(Math.round(every * 10) / 10)} ${a.unit}s`;
		}
		return `${formatAmount(Math.round(a.perUnit * 100) / 100)}/${a.unit}`;
	}
</script>

{#if graph.schema.counters.length === 0}
	<p class="hint">
		No counters yet — <strong>Edit</strong> this graph to add what you want to count.
	</p>
{:else}
	<ul class="counters">
		{#each rows as row (row.counter.id)}
			<li class="counter-row" style:--counter-color={row.color}>
				<button
					type="button"
					class="step-button minus"
					onclick={() => undo(row.latest)}
					disabled={row.latest === null || !onremove}
					title={row.latest
						? `Remove the last entry (${formatAmount(row.latest.amount)} ${row.counter.unit})`
						: 'Nothing logged yet'}
					aria-label="Remove the last {row.counter.label} entry"
				>
					−
				</button>

				<div class="body">
					<div class="name">{row.counter.label}</div>
					<div class="count">
						{formatAmount(row.total)}
						<span class="unit">{row.counter.unit}</span>
						<span class="interval">{INTERVAL_LABELS[row.interval]}</span>
					</div>
					<div class="since">
						{#if row.since === null}
							never logged
						{:else if row.since < 60_000}
							just now
						{:else}
							{formatElapsed(row.since)} ago
						{/if}
					</div>

					{#if (row.counter.presets ?? []).length > 0}
						<div class="presets">
							{#each row.counter.presets ?? [] as preset (preset.id)}
								<button
									type="button"
									class="preset"
									onclick={() => add(row.counter.id, preset.amount)}
									title="{preset.label} — {formatAmount(preset.amount)} {row.counter.unit}"
								>
									{preset.label}
									<small>+{formatAmount(preset.amount)}</small>
								</button>
							{/each}
						</div>
					{/if}

					<div class="stats">
						<span title="Rate over the whole recorded span">
							avg {formatAverage(row.average)}
						</span>
						{#if row.goal}
							<span
								class="goal"
								title="{row.goal.reached} of {row.goal.periods} completed {row.goal.target
									.period}s met the target"
							>
								{row.goal.target.direction === 'at_most' ? 'under' : 'hit'}
								{formatAmount(row.goal.target.amount)}/{row.goal.target.period}:
								{row.goal.percent === null
									? 'no full period yet'
									: `${Math.round(row.goal.percent * 10) / 10}%`}
							</span>
						{/if}
					</div>
				</div>

				<button
					type="button"
					class="step-button plus"
					onclick={() => add(row.counter.id, row.step)}
					aria-label="Add {formatAmount(row.step)} {row.counter.unit} to {row.counter.label}"
					title="Add {formatAmount(row.step)} {row.counter.unit}"
				>
					+
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.counters {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* The row is the product: a big target at each end, everything else
	   between them. Both buttons are full height so they stay easy to hit. */
	.counter-row {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr) 4.5rem;
		align-items: stretch;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.07);
		border-left: 3px solid var(--counter-color);
		border-radius: 6px;
		overflow: hidden;
	}

	/* These two are the primary controls on the page, so they read as buttons
	   at a glance rather than as gutters beside the text. */
	button.step-button {
		background: rgba(255, 255, 255, 0.07);
		border: none;
		color: var(--color-fg);
		font: inherit;
		font-size: 2.1rem;
		font-weight: 300;
		line-height: 1;
		cursor: pointer;
		transition:
			background 0.12s,
			color 0.12s;
	}
	button.step-button.plus {
		border-left: 1px solid rgba(255, 255, 255, 0.09);
		color: var(--counter-color);
		background: color-mix(in srgb, var(--counter-color) 16%, transparent);
	}
	button.step-button.minus {
		border-right: 1px solid rgba(255, 255, 255, 0.09);
		color: var(--color-fg);
	}
	button.step-button:hover:not(:disabled) {
		background: color-mix(in srgb, var(--counter-color) 22%, transparent);
	}
	button.step-button.plus:hover:not(:disabled) {
		color: #1a0a2a;
		background: var(--counter-color);
	}
	button.step-button:disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	.body {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--space-3) var(--space-2);
		text-align: center;
		min-width: 0;
	}
	.name {
		font-weight: 600;
	}
	.count {
		font-family: var(--font-mono);
		font-size: 1.6rem;
		line-height: 1.1;
		color: var(--counter-color);
	}
	.count .unit,
	.count .interval {
		font-size: 0.55em;
		color: var(--color-muted);
	}
	.since {
		font-size: 0.8em;
		color: var(--color-muted);
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		justify-content: center;
		margin-top: var(--space-1);
	}
	button.preset {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: 2px var(--space-2);
		border-radius: 999px;
		font: inherit;
		font-size: 0.8em;
		cursor: pointer;
		display: inline-flex;
		gap: 4px;
		align-items: baseline;
	}
	button.preset small {
		color: var(--color-muted);
	}
	button.preset:hover {
		border-color: var(--counter-color);
		background: rgba(255, 255, 255, 0.06);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		justify-content: center;
		margin-top: var(--space-1);
		font-size: 0.75em;
		color: var(--color-muted);
		font-family: var(--font-mono);
	}
	.stats .goal {
		color: var(--color-fg);
	}

	.hint {
		color: var(--color-muted);
		font-size: 0.9em;
	}

	@media (max-width: 480px) {
		.counter-row {
			grid-template-columns: 3.5rem minmax(0, 1fr) 3.5rem;
		}
		button.step-button {
			font-size: 1.5rem;
		}
	}
</style>
