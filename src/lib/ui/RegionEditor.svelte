<script lang="ts">
	import type { Axis, Region } from '$lib/types.js';

	let {
		regions = $bindable(),
		axes,
		defaultColor = '#c98aff'
	}: { regions: Region[]; axes: Axis[]; defaultColor?: string } = $props();

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
				<input
					type="text"
					bind:value={region.label}
					placeholder="label"
					maxlength="60"
					class="region-label"
				/>

				{#if region.shape.type === 'range'}
					<div class="bounds">
						<label class="num-pair">
							<span class="muted">min</span>
							<input type="number" step="0.01" bind:value={region.shape.min} class="num" />
						</label>
						<label class="num-pair">
							<span class="muted">max</span>
							<input type="number" step="0.01" bind:value={region.shape.max} class="num" />
						</label>
					</div>
				{:else if region.shape.type === 'box'}
					<div class="bounds-2d">
						{#each axes as ax, axIdx (axIdx)}
							<div class="axis-bounds">
								<span class="axis-tag">{ax.name}</span>
								<label class="num-pair">
									<span class="muted">min</span>
									<input
										type="number"
										step="0.01"
										bind:value={region.shape.min[axIdx]}
										class="num"
									/>
								</label>
								<label class="num-pair">
									<span class="muted">max</span>
									<input
										type="number"
										step="0.01"
										bind:value={region.shape.max[axIdx]}
										class="num"
									/>
								</label>
							</div>
						{/each}
					</div>
				{:else if region.shape.type === 'polygon'}
					<div class="polygon-vertices">
						<div class="polygon-header">
							<span class="muted">{region.shape.vertices.length} vertices</span>
							<button type="button" class="ghost-tiny" onclick={() => addVertex(i)}>
								+ vertex
							</button>
						</div>
						{#each region.shape.vertices as vertex, vIdx (vIdx)}
							<div class="vertex-row">
								<span class="muted">v{vIdx + 1}</span>
								<input
									type="number"
									step="0.01"
									bind:value={vertex[0]}
									class="num"
									aria-label="{axes[0]?.name ?? 'x'} of vertex {vIdx + 1}"
								/>
								<input
									type="number"
									step="0.01"
									bind:value={vertex[1]}
									class="num"
									aria-label="{axes[1]?.name ?? 'y'} of vertex {vIdx + 1}"
								/>
								{#if region.shape.vertices.length > 3}
									<button
										type="button"
										class="ghost-tiny remove"
										onclick={() => removeVertex(i, vIdx)}
										aria-label="remove vertex"
									>
										×
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<input type="color" bind:value={region.color} class="color-picker" />
				<button
					type="button"
					class="ghost remove"
					onclick={() => removeRegion(i)}
					aria-label="remove region"
				>
					×
				</button>
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
		display: grid;
		grid-template-columns: 1fr auto 60px auto;
		gap: var(--space-3);
		align-items: start;
		padding: var(--space-2);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
	}
	.header-actions {
		display: inline-flex;
		gap: var(--space-2);
	}
	.polygon-vertices {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: 0.85em;
	}
	.polygon-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-1);
	}
	.vertex-row {
		display: grid;
		grid-template-columns: auto 70px 70px auto;
		gap: var(--space-1);
		align-items: center;
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
	.region-label,
	.num {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.region-label:focus,
	.num:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.num {
		width: 70px;
	}

	.bounds {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.bounds-2d {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: 0.85em;
	}
	.axis-bounds {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.axis-tag {
		color: var(--color-muted);
		min-width: 60px;
	}
	.num-pair {
		display: inline-flex;
		gap: var(--space-1);
		align-items: center;
		font-size: 0.85em;
	}
	.muted {
		color: var(--color-muted);
	}

	.color-picker {
		width: 60px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		cursor: pointer;
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
