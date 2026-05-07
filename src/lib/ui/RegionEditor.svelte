<script lang="ts">
	import type { Axis, Region } from '$lib/types.js';

	let {
		regions = $bindable(),
		axes,
		defaultColor = '#c98aff'
	}: { regions: Region[]; axes: Axis[]; defaultColor?: string } = $props();

	const dimensions = $derived(axes.length);

	function addRegion() {
		const id = `region-${regions.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
		if (dimensions === 1) {
			const axis = axes[0];
			const span = axis.range[1] - axis.range[0];
			regions.push({
				id,
				label: '',
				shape: {
					type: 'range',
					min: axis.range[0] + span * 0.6,
					max: axis.range[1]
				},
				color: defaultColor,
				opacity: 0.3
			});
		} else if (dimensions === 2) {
			const ax0 = axes[0];
			const ax1 = axes[1];
			const span0 = ax0.range[1] - ax0.range[0];
			const span1 = ax1.range[1] - ax1.range[0];
			regions.push({
				id,
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
	}

	function removeRegion(idx: number) {
		regions = regions.filter((_, i) => i !== idx);
	}
</script>

<div class="region-editor">
	<div class="header">
		<span class="title">Regions <small>(optional)</small></span>
		<button type="button" class="ghost" onclick={addRegion}>+ add region</button>
	</div>
	<p class="hint">Labelled bands or boxes — e.g. "sex feels attractive within this range".</p>

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
		align-items: center;
		padding: var(--space-2);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
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
