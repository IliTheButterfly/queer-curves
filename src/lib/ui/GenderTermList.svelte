<script lang="ts">
	import type { GenderTerm, PronounsGraph } from '$lib/types.js';
	import { entryColor, levelById, termGroupById } from '$lib/graphs/pronouns/defaults.js';
	import GenderTermForm from './GenderTermForm.svelte';

	let {
		graph,
		onremove,
		onedit
	}: {
		graph: PronounsGraph;
		onremove: (id: string) => void;
		onedit: (term: GenderTerm) => void;
	} = $props();

	let editingId = $state<string | null>(null);

	function handleSave(updated: GenderTerm) {
		onedit(updated);
		editingId = null;
	}
</script>

{#if graph.terms.length > 0}
	<div class="list">
		<h3>Words <small class="muted">({graph.terms.length})</small></h3>
		<ul>
			{#each graph.terms as term (term.id)}
				<li class="row">
					{#if editingId === term.id}
						<GenderTermForm
							{graph}
							initial={term}
							onsubmit={handleSave}
							oncancel={() => (editingId = null)}
						/>
					{:else}
						<div class="info">
							<span class="dot" style:background={entryColor(graph, term)}></span>
							<span class="label">{term.label}</span>
							<span class="muted small">
								{termGroupById(graph, term.group_id)?.label ?? 'ungrouped'} ·
								{levelById(graph, term.level_id)?.label ?? 'unsorted'}
							</span>
							{#if term.notes}
								<span class="muted small">— {term.notes}</span>
							{/if}
						</div>
						<div class="row-actions">
							<button
								type="button"
								class="edit"
								onclick={() => (editingId = term.id)}
								aria-label="edit word">Edit</button
							>
							<button
								type="button"
								class="remove"
								onclick={() => onremove(term.id)}
								aria-label="remove word">×</button
							>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.list {
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
	.small {
		font-size: 0.85em;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2);
		background: rgba(0, 0, 0, 0.15);
		border-radius: 4px;
	}
	.info {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		flex-wrap: wrap;
		min-width: 0;
	}
	.dot {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
	}
	.label {
		color: var(--color-fg);
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
