<script lang="ts">
	// The tap surface. Counting apps are used one-handed, in the moment, and
	// mostly *not* by someone who wants to fill in a form — so each counter
	// gets a big "+step" button plus a chip per preset, and the full form
	// (backdating, notes, tags) stays available underneath for corrections.
	import type { Occurrence, OccurrenceGraph } from '$lib/types.js';
	import {
		counterColor,
		currentBucketTotal,
		formatAmount,
		formatElapsed,
		msSinceLast,
		stepOf,
		targetStatuses
	} from '$lib/graphs/occurrence/aggregate.js';

	let {
		graph,
		onadd
	}: {
		graph: OccurrenceGraph;
		onadd: (occurrence: Occurrence) => void;
	} = $props();

	// Re-read the clock after each add so "time since last" and today's
	// totals move without a page reload.
	let clock = $state(Date.now());

	const now = $derived(new Date(clock));

	const statuses = $derived(targetStatuses(graph, now));

	const rows = $derived(
		graph.schema.counters.map((counter, i) => {
			const status = statuses.find((s) => s.counter.id === counter.id) ?? null;
			const since = msSinceLast(graph, counter.id, now);
			return {
				counter,
				color: counterColor(counter, i, graph.customization.theme.palette),
				step: stepOf(counter),
				today: currentBucketTotal(graph, counter.id, 'day', now),
				status,
				since
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
			// Quick adds are always "now" — that's the whole point. Anything
			// else goes through the form below.
			timestamp: new Date().toISOString(),
			amount
		});
		clock = Date.now();
	}
</script>

{#if rows.length === 0}
	<p class="hint">
		No counters yet — <strong>Edit</strong> this graph to add what you want to count.
	</p>
{:else}
	<section class="quick-add">
		<h3>Log</h3>
		<div class="counters">
			{#each rows as row (row.counter.id)}
				<div class="counter" style:--counter-color={row.color}>
					<div class="counter-head">
						<span class="dot" style:background={row.color}></span>
						<strong>{row.counter.label}</strong>
						<span class="today">
							{formatAmount(row.today)}
							<small class="muted">{row.counter.unit} today</small>
						</span>
					</div>

					<div class="taps">
						<button
							type="button"
							class="tap primary-tap"
							onclick={() => add(row.counter.id, row.step)}
						>
							+{formatAmount(row.step)}
						</button>
						{#each row.counter.presets ?? [] as preset (preset.id)}
							<button
								type="button"
								class="tap"
								onclick={() => add(row.counter.id, preset.amount)}
								title="{preset.label} — {formatAmount(preset.amount)} {row.counter.unit}"
							>
								{preset.label}
								<small>+{formatAmount(preset.amount)}</small>
							</button>
						{/each}
					</div>

					<div class="counter-meta">
						{#if row.status}
							<span class="target" class:over={!row.status.ok}>
								{row.status.direction === 'at_most' ? 'limit' : 'goal'}
								{formatAmount(row.status.current)}/{formatAmount(row.status.target)}
								per {row.status.period}
							</span>
							{#if row.status.streak > 0}
								<span class="streak">
									{row.status.streak}
									{row.status.period}{row.status.streak === 1 ? '' : 's'} on track
									{#if row.status.bestStreak > row.status.streak}
										<small class="muted">(best {row.status.bestStreak})</small>
									{/if}
								</span>
							{/if}
						{/if}
						<span class="muted since">
							{#if row.since === null}
								never logged
							{:else if row.since < 60_000}
								<!-- "last just now ago" is not a sentence. -->
								just logged
							{:else}
								last {formatElapsed(row.since)} ago
							{/if}
						</span>
					</div>
				</div>
			{/each}
		</div>
	</section>
{/if}

<style>
	.quick-add {
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
	.counters {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.counter {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: rgba(0, 0, 0, 0.18);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-left: 3px solid var(--counter-color);
		border-radius: 4px;
	}
	.counter-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}
	.counter-head .dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.today {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 1.15em;
		color: var(--color-fg);
	}
	.today small {
		font-family: inherit;
		font-size: 0.65em;
	}
	.taps {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	button.tap {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: var(--space-2) var(--space-3);
		border-radius: 999px;
		font: inherit;
		cursor: pointer;
		display: inline-flex;
		gap: var(--space-1);
		align-items: baseline;
	}
	button.tap small {
		color: var(--color-muted);
		font-size: 0.8em;
	}
	button.tap:hover {
		border-color: var(--counter-color);
		background: rgba(255, 255, 255, 0.09);
	}
	button.tap.primary-tap {
		background: var(--counter-color);
		border-color: var(--counter-color);
		color: #1a0a2a;
		font-weight: 600;
		min-width: 60px;
		justify-content: center;
	}
	button.tap.primary-tap:hover {
		filter: brightness(1.12);
	}
	.counter-meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		font-size: 0.8em;
		align-items: baseline;
	}
	.target {
		color: var(--color-fg);
		font-family: var(--font-mono);
	}
	.target.over {
		color: rgba(255, 150, 150, 1);
	}
	.streak {
		color: rgb(150, 230, 180);
	}
	.since {
		margin-left: auto;
	}
	.muted {
		color: var(--color-muted);
	}
	.hint {
		color: var(--color-muted);
		font-size: 0.9em;
	}
</style>
