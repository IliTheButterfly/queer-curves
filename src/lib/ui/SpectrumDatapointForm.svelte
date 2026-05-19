<script lang="ts">
	import { untrack } from 'svelte';
	import type { Axis, SpectrumDatapoint, SpectrumGraph, SpectrumView } from '$lib/types.js';
	import SpectrumPointPicker from './SpectrumPointPicker.svelte';
	import ColorPickerWithPalette from './ColorPickerWithPalette.svelte';

	let {
		graph,
		initial,
		oncancel,
		onsubmit,
		view
	}: {
		graph: SpectrumGraph;
		initial?: SpectrumDatapoint;
		oncancel?: () => void;
		onsubmit: (dp: SpectrumDatapoint) => void;
		// Forwarded to the picker so its layout matches the active chart
		// view (e.g. circular pad when the view is radial).
		view?: SpectrumView;
	} = $props();

	const isEdit = $derived(initial !== undefined);

	function nowLocal(): string {
		const d = new Date();
		return toDatetimeLocal(d);
	}

	function toDatetimeLocal(d: Date): string {
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function midpoint(axis: Axis): number {
		return (axis.range[0] + axis.range[1]) / 2;
	}

	let coords = $state<number[]>(
		untrack(() => {
			if (initial) return [...initial.coordinates];
			return graph.schema.axes.map(midpoint);
		})
	);
	let timestamp = $state(
		untrack(() => (initial ? toDatetimeLocal(new Date(initial.timestamp)) : nowLocal()))
	);
	let notes = $state(untrack(() => notes_default()));

	function notes_default(): string {
		return initial?.notes ?? '';
	}

	// Auto-color = next slot in the palette cycle, indexed by where this
	// datapoint sits in the graph's time-ordered history. New points land at
	// the end; edited points use their existing sorted position so toggling
	// "auto" doesn't shift their color around.
	const autoColorIdx = $derived.by(() => {
		const palette = graph.customization.theme.palette;
		if (!palette || palette.length === 0) return 0;
		if (initial) {
			const sorted = [...graph.datapoints].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
			const idx = sorted.findIndex((dp) => dp.id === initial.id);
			return idx >= 0 ? idx : graph.datapoints.length;
		}
		return graph.datapoints.length;
	});
	const autoColor = $derived.by(() => {
		const palette = graph.customization.theme.palette;
		if (!palette || palette.length === 0) return '#c98aff';
		return palette[autoColorIdx % palette.length];
	});

	let colorMode = $state<'auto' | 'custom'>(untrack(() => (initial?.color ? 'custom' : 'auto')));
	let customColor = $state<string>(untrack(() => initial?.color ?? '#c98aff'));

	function generateId(): string {
		return 'dp_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const dp: SpectrumDatapoint = {
			id: initial?.id ?? generateId(),
			coordinates: [...coords],
			timestamp: new Date(timestamp).toISOString()
		};
		const trimmedNotes = notes.trim();
		if (trimmedNotes) dp.notes = trimmedNotes;
		if (initial?.tags) dp.tags = initial.tags;
		if (colorMode === 'custom') dp.color = customColor;

		onsubmit(dp);

		if (!isEdit) {
			// Reset for the next add. Keep coords so consecutive datapoints
			// nudge from the last position rather than snapping back; reset
			// color back to auto so each new point picks up the next palette
			// slot unless the user opts in again.
			timestamp = nowLocal();
			notes = '';
			colorMode = 'auto';
		}
	}
</script>

<form onsubmit={handleSubmit} class="dp-form">
	<h3>{isEdit ? 'Edit datapoint' : 'Add datapoint'}</h3>
	{#if !isEdit}
		<p class="hint">Click anywhere on the picker, or drag the marker.</p>
	{/if}

	<div class="picker-wrap">
		<SpectrumPointPicker
			{graph}
			bind:coordinates={coords}
			excludeDatapointId={initial?.id}
			{view}
		/>
	</div>

	<div class="coord-inputs" aria-label="datapoint coordinates">
		{#each graph.schema.axes as axis, i (i)}
			<label class="coord-field">
				<span class="muted">{axis.name}</span>
				<input
					type="number"
					step="any"
					bind:value={coords[i]}
					min={axis.range[0]}
					max={axis.range[1]}
					aria-label="{axis.name} coordinate"
				/>
			</label>
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

	<fieldset class="color-field">
		<legend class="label">Color</legend>
		<label class="color-mode">
			<input type="radio" bind:group={colorMode} value="auto" />
			<span class="auto-swatch" style:background={autoColor} aria-hidden="true"></span>
			<span>auto <small class="muted">(palette slot {autoColorIdx + 1})</small></span>
		</label>
		<label class="color-mode">
			<input type="radio" bind:group={colorMode} value="custom" />
			<span>custom</span>
		</label>
		{#if colorMode === 'custom'}
			<div class="custom-row">
				<ColorPickerWithPalette
					bind:value={customColor}
					paletteColors={graph.customization.theme.palette}
					ariaLabel="datapoint colour"
				/>
			</div>
		{/if}
	</fieldset>

	<div class="actions">
		{#if oncancel}
			<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
		{/if}
		<button type="submit" class="primary">
			{isEdit ? 'Save changes' : '+ commit datapoint'}
		</button>
	</div>
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
	.coord-inputs {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		font-size: 0.85em;
	}
	.coord-field {
		display: inline-flex;
		gap: var(--space-1);
		align-items: center;
	}
	.coord-field input {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
		width: 90px;
	}
	.coord-field input:focus {
		outline: none;
		border-color: var(--color-accent);
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

	.color-field {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 4px;
		padding: var(--space-2) var(--space-3);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		background: rgba(255, 255, 255, 0.02);
	}
	.color-field legend {
		padding: 0 var(--space-1);
		color: var(--color-muted);
		font-size: 0.85em;
	}
	.color-mode {
		display: inline-flex;
		gap: var(--space-1);
		align-items: center;
		cursor: pointer;
	}
	.auto-swatch {
		display: inline-block;
		width: 16px;
		height: 16px;
		border-radius: 3px;
		border: 1px solid rgba(255, 255, 255, 0.15);
	}
	.custom-row {
		flex-basis: 100%;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		align-items: center;
	}
	button.primary {
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
	button.cancel {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-muted);
		padding: var(--space-2) var(--space-3);
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}
	button.cancel:hover {
		color: var(--color-fg);
		border-color: var(--color-accent);
	}
</style>
