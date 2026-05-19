<script lang="ts">
	import type { Axis, SpectrumDatapoint, SpectrumGraph, SpectrumView } from '$lib/types.js';
	import SpectrumDatapointForm from './SpectrumDatapointForm.svelte';

	let {
		datapoints,
		axes,
		graph,
		onremove,
		onedit,
		view
	}: {
		datapoints: SpectrumDatapoint[];
		axes: Axis[];
		graph: SpectrumGraph;
		onremove: (id: string) => void;
		onedit: (dp: SpectrumDatapoint) => void;
		// Forwarded to inline edit forms so picker layout matches the chart.
		view?: SpectrumView;
	} = $props();

	const sorted = $derived([...datapoints].sort((a, b) => b.timestamp.localeCompare(a.timestamp)));

	let editingId = $state<string | null>(null);

	function formatCoords(dp: SpectrumDatapoint): string {
		return dp.coordinates
			.map((c, i) => `${axes[i]?.name ?? `axis ${i + 1}`}: ${c.toFixed(2)}`)
			.join(' · ');
	}

	function formatTime(ts: string): string {
		return new Date(ts).toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function handleSave(dp: SpectrumDatapoint) {
		onedit(dp);
		editingId = null;
	}
</script>

{#if sorted.length > 0}
	<div class="dp-list">
		<h3>
			Datapoints <small class="muted">({sorted.length})</small>
		</h3>
		<ul>
			{#each sorted as dp (dp.id)}
				<li class="dp-row">
					{#if editingId === dp.id}
						<SpectrumDatapointForm
							{graph}
							{view}
							initial={dp}
							onsubmit={handleSave}
							oncancel={() => (editingId = null)}
						/>
					{:else}
						<div class="dp-info">
							<div class="primary-line">
								<span class="time">{formatTime(dp.timestamp)}</span>
								<span class="coords">{formatCoords(dp)}</span>
							</div>
							{#if dp.notes}
								<div class="notes">{dp.notes}</div>
							{/if}
						</div>
						<div class="row-actions">
							<button
								type="button"
								class="edit"
								onclick={() => (editingId = dp.id)}
								aria-label="edit datapoint"
							>
								Edit
							</button>
							<button
								type="button"
								class="remove"
								onclick={() => onremove(dp.id)}
								aria-label="remove datapoint"
							>
								×
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.dp-list {
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
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.dp-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2);
		background: rgba(0, 0, 0, 0.15);
		border-radius: 4px;
	}
	.dp-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.primary-line {
		display: flex;
		gap: var(--space-3);
		align-items: baseline;
		flex-wrap: wrap;
	}
	.time {
		color: var(--color-muted);
		font-size: 0.85em;
	}
	.coords {
		color: var(--color-fg);
		font-family: var(--font-mono);
		font-size: 0.9em;
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
