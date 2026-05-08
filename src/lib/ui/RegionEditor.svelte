<script lang="ts">
	import type { Axis, Region } from '$lib/types.js';
	import ColorPickerWithPalette from './ColorPickerWithPalette.svelte';
	import RegionPicker from './RegionPicker.svelte';

	function summarize(r: Region): string {
		if (r.shape.type === 'range') {
			return `[${r.shape.min.toFixed(2)} → ${r.shape.max.toFixed(2)}]`;
		}
		if (r.shape.type === 'box') {
			return `[${r.shape.min[0].toFixed(2)}, ${r.shape.min[1].toFixed(2)}] → [${r.shape.max[0].toFixed(2)}, ${r.shape.max[1].toFixed(2)}]`;
		}
		return `${r.shape.vertices.length} vertices`;
	}

	let {
		regions = $bindable(),
		axes,
		defaultColor = '#c98aff',
		paletteColors = []
	}: {
		regions: Region[];
		axes: Axis[];
		defaultColor?: string;
		paletteColors?: string[];
	} = $props();

	const dimensions = $derived(axes.length);

	function newId(): string {
		return `region-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	}

	function addRangeRegion() {
		const axis = axes[0];
		const span = axis.range[1] - axis.range[0];
		regions.push({
			id: newId(),
			label: '',
			shape: {
				type: 'range',
				min: axis.range[0] + span * 0.6,
				max: axis.range[1]
			},
			color: defaultColor,
			opacity: 0.3
		});
	}

	function addBoxRegion() {
		const ax0 = axes[0];
		const ax1 = axes[1];
		const span0 = ax0.range[1] - ax0.range[0];
		const span1 = ax1.range[1] - ax1.range[0];
		regions.push({
			id: newId(),
			label: '',
			shape: {
				type: 'box',
				min: [ax0.range[0] + span0 * 0.6, ax1.range[0] + span1 * 0.6],
				max: [ax0.range[1], ax1.range[1]]
			},
			color: defaultColor,
			opacity: 0.3
		});
	}

	function addPolygonRegion() {
		const ax0 = axes[0];
		const ax1 = axes[1];
		const span0 = ax0.range[1] - ax0.range[0];
		const span1 = ax1.range[1] - ax1.range[0];
		// Default triangle near the upper-right corner — easier to nudge into
		// shape than starting from axis-aligned.
		regions.push({
			id: newId(),
			label: '',
			shape: {
				type: 'polygon',
				vertices: [
					[ax0.range[0] + span0 * 0.5, ax1.range[0] + span1 * 0.5],
					[ax0.range[1], ax1.range[0] + span1 * 0.5],
					[ax0.range[0] + span0 * 0.7, ax1.range[1]]
				]
			},
			color: defaultColor,
			opacity: 0.3
		});
	}

	function removeRegion(idx: number) {
		regions = regions.filter((_, i) => i !== idx);
	}

	function addVertex(regionIdx: number) {
		const r = regions[regionIdx];
		if (r.shape.type !== 'polygon') return;
		const last = r.shape.vertices[r.shape.vertices.length - 1];
		r.shape.vertices.push([last[0], last[1]]);
	}

	function removeVertex(regionIdx: number, vertexIdx: number) {
		const r = regions[regionIdx];
		if (r.shape.type !== 'polygon') return;
		// A polygon needs at least 3 vertices to be meaningful.
		if (r.shape.vertices.length <= 3) return;
		r.shape.vertices = r.shape.vertices.filter((_, i) => i !== vertexIdx);
	}

	// Per-region selected-vertex index, kept in sync with RegionPicker via
	// a bindable. Indexed by region.id so adding/removing regions doesn't
	// reset selections on unrelated rows.
	let selectedVertexIdxs = $state<Record<string, number | null>>({});

	function getSelectedIdx(id: string): number | null {
		return selectedVertexIdxs[id] ?? null;
	}

	function setSelectedIdx(id: string, idx: number | null) {
		selectedVertexIdxs = { ...selectedVertexIdxs, [id]: idx };
	}

	function deleteSelectedVertex(regionIdx: number) {
		const r = regions[regionIdx];
		if (r.shape.type !== 'polygon') return;
		const sel = getSelectedIdx(r.id);
		if (sel == null) return;
		if (r.shape.vertices.length <= 3) return;
		r.shape.vertices = r.shape.vertices.filter((_, i) => i !== sel);
		setSelectedIdx(r.id, null);
	}
</script>

<div class="region-editor">
	<div class="header">
		<span class="title">Regions <small>(optional)</small></span>
		<span class="header-actions">
			{#if dimensions === 1}
				<button type="button" class="ghost" onclick={addRangeRegion}>+ add range</button>
			{:else if dimensions === 2}
				<button type="button" class="ghost" onclick={addBoxRegion}>+ add box</button>
				<button type="button" class="ghost" onclick={addPolygonRegion}>+ add polygon</button>
			{/if}
		</span>
	</div>
	<p class="hint">
		Labelled bands, boxes, or polygons — e.g. "sex feels attractive within this range".
	</p>

	{#if regions.length === 0}
		<p class="empty">No regions yet.</p>
	{:else}
		{#each regions as region, i (region.id)}
			<div class="region-row">
				<div class="meta-line">
					<input
						type="text"
						bind:value={region.label}
						placeholder="label"
						maxlength="60"
						class="region-label"
					/>
					<ColorPickerWithPalette
						bind:value={regions[i].color}
						{paletteColors}
						ariaLabel="region colour"
					/>
					{#if region.shape.type === 'polygon'}
						{@const poly = region.shape}
						<button
							type="button"
							class="ghost-tiny"
							onclick={() => addVertex(i)}
							title="add a new vertex (drag it after)"
						>
							+ vertex
						</button>
						{#if poly.vertices.length > 3}
							<button
								type="button"
								class="ghost-tiny remove"
								onclick={() => removeVertex(i, poly.vertices.length - 1)}
								title="remove the last vertex"
							>
								− vertex
							</button>
						{/if}
					{/if}
					<button
						type="button"
						class="ghost remove"
						onclick={() => removeRegion(i)}
						aria-label="remove region"
					>
						×
					</button>
				</div>
				<div class="picker-wrap">
					<RegionPicker
						bind:region={regions[i]}
						{axes}
						selectedVertexIdx={getSelectedIdx(region.id)}
						onSelectedVertexChange={(idx) => setSelectedIdx(region.id, idx)}
					/>
				</div>
				{#if region.shape.type === 'box'}
					{@const boxShape = region.shape}
					<div class="bounds-grid">
						<span class="muted">{axes[0]?.name ?? 'axis 1'}</span>
						<label class="bound-cell">
							<span class="muted">min</span>
							<input
								type="number"
								step="any"
								bind:value={boxShape.min[0]}
								aria-label="{axes[0]?.name ?? 'axis 1'} min"
								class="vertex-coord"
							/>
						</label>
						<label class="bound-cell">
							<span class="muted">max</span>
							<input
								type="number"
								step="any"
								bind:value={boxShape.max[0]}
								aria-label="{axes[0]?.name ?? 'axis 1'} max"
								class="vertex-coord"
							/>
						</label>
						<span class="muted">{axes[1]?.name ?? 'axis 2'}</span>
						<label class="bound-cell">
							<span class="muted">min</span>
							<input
								type="number"
								step="any"
								bind:value={boxShape.min[1]}
								aria-label="{axes[1]?.name ?? 'axis 2'} min"
								class="vertex-coord"
							/>
						</label>
						<label class="bound-cell">
							<span class="muted">max</span>
							<input
								type="number"
								step="any"
								bind:value={boxShape.max[1]}
								aria-label="{axes[1]?.name ?? 'axis 2'} max"
								class="vertex-coord"
							/>
						</label>
					</div>
				{/if}
				{#if region.shape.type === 'polygon'}
					{@const polyShape = region.shape}
					{@const sel = getSelectedIdx(region.id)}
					{#if sel !== null && sel < polyShape.vertices.length}
						<div class="vertex-edit">
							<span class="muted">vertex {sel + 1}:</span>
							<input
								type="number"
								step="any"
								bind:value={polyShape.vertices[sel][0]}
								aria-label="{axes[0]?.name ?? 'x'} coordinate"
								placeholder="x"
								class="vertex-coord"
							/>
							<input
								type="number"
								step="any"
								bind:value={polyShape.vertices[sel][1]}
								aria-label="{axes[1]?.name ?? 'y'} coordinate"
								placeholder="y"
								class="vertex-coord"
							/>
							<button
								type="button"
								class="ghost-tiny remove"
								onclick={() => deleteSelectedVertex(i)}
								disabled={polyShape.vertices.length <= 3}
								title={polyShape.vertices.length <= 3
									? 'a polygon needs at least 3 vertices'
									: 'delete this vertex'}
							>
								delete
							</button>
							<button
								type="button"
								class="ghost-tiny"
								onclick={() => setSelectedIdx(region.id, null)}
								title="deselect"
							>
								×
							</button>
						</div>
					{:else}
						<p class="readout muted">click a vertex to edit / delete it</p>
					{/if}
				{/if}
				<p class="readout muted">{summarize(region)}</p>
			</div>
		{/each}
	{/if}
</div>

<style>
	.region-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.title {
		font-size: 0.95em;
		color: var(--color-accent);
		font-weight: 600;
	}
	.hint,
	.empty {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.85em;
	}
	.empty {
		font-style: italic;
	}

	.region-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
	}
	.meta-line {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
	}
	.region-label {
		flex: 1;
	}
	.picker-wrap {
		padding: var(--space-2);
		background: rgba(0, 0, 0, 0.2);
		border-radius: 4px;
	}
	.vertex-edit {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		font-size: 0.85em;
	}
	.bounds-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) 1fr 1fr;
		gap: var(--space-2);
		align-items: center;
		font-size: 0.85em;
	}
	.bound-cell {
		display: inline-flex;
		gap: var(--space-1);
		align-items: center;
	}
	.vertex-edit .vertex-coord {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
		width: 90px;
	}
	.vertex-edit .vertex-coord:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.vertex-edit button.ghost-tiny:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.readout {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8em;
	}
	.header-actions {
		display: inline-flex;
		gap: var(--space-2);
	}
	button.ghost-tiny {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: 0 var(--space-2);
		border-radius: 3px;
		cursor: pointer;
		font: inherit;
		font-size: 0.85em;
	}
	button.ghost-tiny:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-accent);
	}
	button.ghost-tiny.remove {
		color: rgba(255, 150, 150, 0.7);
		border-color: rgba(255, 100, 100, 0.2);
	}
	button.ghost-tiny.remove:hover {
		background: rgba(255, 100, 100, 0.1);
		border-color: rgba(255, 100, 100, 0.5);
	}
	.region-label {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.region-label:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.muted {
		color: var(--color-muted);
	}

	button.ghost {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-3);
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}
	button.ghost:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-accent);
	}
	button.ghost.remove {
		padding: 0 var(--space-2);
		font-size: 1.1em;
	}
</style>
