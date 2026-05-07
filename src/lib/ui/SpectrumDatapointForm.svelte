<script lang="ts">
	import { untrack } from 'svelte';
	import type { Axis, SpectrumDatapoint, SpectrumGraph } from '$lib/types.js';
	import SpectrumPointPicker from './SpectrumPointPicker.svelte';

	let { graph, onsubmit }: { graph: SpectrumGraph; onsubmit: (dp: SpectrumDatapoint) => void } =
		$props();

	function nowLocal(): string {
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function midpoint(axis: Axis): number {
		return (axis.range[0] + axis.range[1]) / 2;
	}

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

		// Reset for the next entry. Keep coords so consecutive datapoints
		// nudge from the last position rather than snapping back.
		timestamp = nowLocal();
		notes = '';
	}
</script>

<form onsubmit={handleSubmit} class="dp-form">
	<h3>Add datapoint</h3>
	<p class="hint">Click anywhere on the picker, or drag the marker.</p>

	<div class="picker-wrap">
		<SpectrumPointPicker {graph} bind:coordinates={coords} />
	</div>

	<div class="coord-readout" aria-live="polite">
		{#each graph.schema.axes as axis, i (i)}
			<span class="coord">
				<span class="muted">{axis.name}:</span>
				<code>{coords[i]?.toFixed(2)}</code>
			</span>
		{/each}
	</div>

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

	<button type="submit" class="primary">+ commit datapoint</button>
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
	.hint {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.85em;
	}
	.picker-wrap {
		padding: var(--space-2);
		background: rgba(0, 0, 0, 0.2);
		border-radius: 4px;
	}
	.coord-readout {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		font-size: 0.85em;
	}
	.coord code {
		color: var(--color-accent);
	}
	.muted {
		color: var(--color-muted);
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
	.field input:focus {
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
