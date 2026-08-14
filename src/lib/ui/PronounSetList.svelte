<script lang="ts">
	import type { PronounSet, PronounsGraph } from '$lib/types.js';
	import { entryColor, levelById } from '$lib/graphs/pronouns/defaults.js';
	import { formsToSlashString } from '$lib/graphs/pronouns/sentences.js';
	import PronounSetForm from './PronounSetForm.svelte';

	let {
		graph,
		onremove,
		onedit,
		onreorder
	}: {
		graph: PronounsGraph;
		onremove: (id: string) => void;
		onedit: (set: PronounSet) => void;
		onreorder: (ids: string[]) => void;
	} = $props();

	let editingId = $state<string | null>(null);

	function handleSave(updated: PronounSet) {
		onedit(updated);
		editingId = null;
	}

	// Order within the card is authored order, so the list offers explicit
	// move controls rather than relying on drag (which the network chart
	// needs but a text list doesn't).
	function move(id: string, delta: number) {
		const ids = graph.pronouns.map((p) => p.id);
		const i = ids.indexOf(id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		onreorder(ids);
	}
</script>

{#if graph.pronouns.length > 0}
	<div class="list">
		<h3>Pronouns <small class="muted">({graph.pronouns.length})</small></h3>
		<ul>
			{#each graph.pronouns as set, i (set.id)}
				<li class="row">
					{#if editingId === set.id}
						<PronounSetForm
							{graph}
							initial={set}
							onsubmit={handleSave}
							oncancel={() => (editingId = null)}
						/>
					{:else}
						<div class="info">
							<span class="dot" style:background={entryColor(graph, set)}></span>
							<span class="label">{set.label}</span>
							<span class="muted level">{levelById(graph, set.level_id)?.label ?? 'unsorted'}</span>
							{#if set.forms}
								<span class="muted forms">{formsToSlashString(set.forms)}</span>
							{/if}
							{#if set.notes}
								<span class="muted">— {set.notes}</span>
							{/if}
						</div>
						<div class="row-actions">
							<button
								type="button"
								class="edit"
								onclick={() => move(set.id, -1)}
								disabled={i === 0}
								aria-label="move up">↑</button
							>
							<button
								type="button"
								class="edit"
								onclick={() => move(set.id, 1)}
								disabled={i === graph.pronouns.length - 1}
								aria-label="move down">↓</button
							>
							<button
								type="button"
								class="edit"
								onclick={() => (editingId = set.id)}
								aria-label="edit pronoun set">Edit</button
							>
							<button
								type="button"
								class="remove"
								onclick={() => onremove(set.id)}
								aria-label="remove pronoun set">×</button
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
	.level,
	.forms {
		font-size: 0.85em;
	}
	.forms {
		font-family: var(--font-mono);
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
	button.edit:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-accent);
	}
	button.edit:disabled {
		opacity: 0.35;
		cursor: default;
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
