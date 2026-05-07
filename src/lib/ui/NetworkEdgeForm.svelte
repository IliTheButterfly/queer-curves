<script lang="ts">
	import { untrack } from 'svelte';
	import type { NetworkEdge, NetworkGraph } from '$lib/types.js';

	let {
		graph,
		initial,
		oncancel,
		onsubmit
	}: {
		graph: NetworkGraph;
		initial?: NetworkEdge;
		oncancel?: () => void;
		onsubmit: (edge: NetworkEdge) => void;
	} = $props();

	const isEdit = $derived(initial !== undefined);

	let source = $state(untrack(() => initial?.source ?? ''));
	let target = $state(untrack(() => initial?.target ?? ''));
	let typeId = $state(untrack(() => initial?.type_id ?? ''));
	let labelOverride = $state(untrack(() => initial?.label_override ?? ''));

	const canSubmit = $derived(source !== '' && target !== '' && source !== target && typeId !== '');

	function generateId(existing: NetworkEdge[]): string {
		const used = new Set(existing.map((e) => e.id));
		for (let i = 1; i < 10000; i++) {
			const id = `e${i}`;
			if (!used.has(id)) return id;
		}
		return 'e_' + Math.random().toString(36).slice(2, 8);
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		const edge: NetworkEdge = {
			id: initial?.id ?? generateId(graph.edges),
			source,
			target,
			type_id: typeId
		};
		const trimmed = labelOverride.trim();
		if (trimmed) edge.label_override = trimmed;
		if (initial?.directed !== undefined) edge.directed = initial.directed;

		onsubmit(edge);

		if (!isEdit) {
			labelOverride = '';
			// Keep source/target/type — common to add multiple edges between
			// the same pair (e.g. romantic AND sexual within a polycule).
		}
	}
</script>

{#if !isEdit && graph.nodes.length < 2}
	<p class="muted gated">Add at least two people before connecting them.</p>
{:else}
	<form onsubmit={handleSubmit} class="edge-form">
		<h3>{isEdit ? 'Edit connection' : 'Add connection'}</h3>
		<div class="row">
			<label class="field">
				<span class="label">From</span>
				<select bind:value={source} required>
					<option value="" disabled>—</option>
					{#each graph.nodes as node (node.id)}
						<option value={node.id}>{node.label}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="label">To</span>
				<select bind:value={target} required>
					<option value="" disabled>—</option>
					{#each graph.nodes as node (node.id)}
						<option value={node.id}>{node.label}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="label">Type</span>
				<select bind:value={typeId} required>
					<option value="" disabled>—</option>
					{#each graph.schema.edge_types as et (et.id)}
						<option value={et.id}>{et.label}</option>
					{/each}
				</select>
			</label>
		</div>
		<label class="field">
			<span class="label">Label override <small>(optional)</small></span>
			<input
				type="text"
				bind:value={labelOverride}
				maxlength="60"
				placeholder="leave blank to use the type label"
			/>
		</label>
		<div class="actions">
			{#if oncancel}
				<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
			{/if}
			<button type="submit" class="primary" disabled={!canSubmit}>
				{isEdit ? 'Save changes' : '+ add connection'}
			</button>
		</div>
		{#if source !== '' && source === target}
			<p class="hint">From and to are the same person.</p>
		{/if}
	</form>
{/if}

<style>
	.edge-form {
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
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
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
	.field input,
	.field select {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.field input:focus,
	.field select:focus {
		outline: none;
		border-color: var(--color-accent);
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
	button.primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	button.primary:not(:disabled):hover {
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
	.hint {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.85em;
	}
	.muted {
		color: var(--color-muted);
	}
	.gated {
		padding: var(--space-3) var(--space-4);
		background: rgba(255, 255, 255, 0.02);
		border: 1px dashed rgba(255, 255, 255, 0.08);
		border-radius: 6px;
	}
</style>
