<script lang="ts">
	import { untrack } from 'svelte';
	import type { Axis, SpectrumDatapoint, SpectrumGraph } from '$lib/types.js';

	let { graph, onsubmit }: { graph: SpectrumGraph; onsubmit: (dp: SpectrumDatapoint) => void } =
		$props();

	function nowLocal(): string {
		// datetime-local format: YYYY-MM-DDTHH:MM in the user's local zone.
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function midpoint(axis: Axis): number {
		return (axis.range[0] + axis.range[1]) / 2;
	}

	function axisStep(axis: Axis): number {
		const span = axis.range[1] - axis.range[0];
		return Math.max(span / 100, 0.001);
	}

	// Coords seeded from the schema once at mount. The schema doesn't change
	// during the form's lifetime — only the parent graph's data does — so we
	// untrack the initial read to make that explicit.
	let coords = $state<number[]>(untrack(() => graph.schema.axes.map(midpoint)));
	let timestamp = $state(nowLocal());
	let notes = $state('');

	function generateId(): string {
		return 'dp_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const dp: SpectrumDatapoint = {
			id: generateId(),
			coordinates: [...coords],
			timestamp: new Date(timestamp).toISOString()
		};
		const trimmed = notes.trim();
		if (trimmed) dp.notes = trimmed;

		onsubmit(dp);

		// Reset for the next entry; keep coords (often you're tracking small
		// shifts) but bump the timestamp forward and clear notes.
		timestamp = nowLocal();
		notes = '';
	}
</script>

<form onsubmit={handleSubmit} class="dp-form">
	<h3>Add datapoint</h3>

	{#each graph.schema.axes as axis, i (i)}
		<div class="axis-row">
			<div class="axis-label">{axis.name}</div>
			<div class="slider">
				<span class="endpoint">{axis.min_label}</span>
				<input
					type="range"
					min={axis.range[0]}
					max={axis.range[1]}
					step={axisStep(axis)}
					bind:value={coords[i]}
					aria-label={axis.name}
				/>
				<span class="endpoint">{axis.max_label}</span>
			</div>
			<input
				type="number"
				step={axisStep(axis)}
				min={axis.range[0]}
				max={axis.range[1]}
				bind:value={coords[i]}
				class="coord"
			/>
		</div>
	{/each}

	<div class="row">
		<label class="field">
			<span class="label">Timestamp</span>
			<input type="datetime-local" bind:value={timestamp} required />
		</label>
		<label class="field">
			<span class="label">Notes <small>(optional)</small></span>
			<input type="text" bind:value={notes} maxlength="200" />
		</label>
	</div>

	<button type="submit" class="primary">+ add datapoint</button>
</form>

<style>
	.dp-form {
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

	.axis-row {
		display: grid;
		grid-template-columns: 100px 1fr 80px;
		gap: var(--space-3);
		align-items: center;
	}
	.axis-label {
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.slider {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.slider input[type='range'] {
		flex: 1;
		accent-color: var(--color-accent);
	}
	.endpoint {
		color: var(--color-muted);
		font-size: 0.8em;
		white-space: nowrap;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.coord {
		text-align: right;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.field .label {
		font-size: 0.85em;
		color: var(--color-muted);
	}
	.field input {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.field input:focus,
	.coord:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	button.primary {
		align-self: flex-start;
		background: var(--color-accent);
		color: #1a0a2a;
		border: none;
		padding: var(--space-2) var(--space-4);
		border-radius: 4px;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button.primary:hover {
		filter: brightness(1.1);
	}
</style>
