<script lang="ts">
	import { untrack } from 'svelte';
	import type { NetworkGraph, NetworkNode } from '$lib/types.js';
	import ColorPickerWithPalette from './ColorPickerWithPalette.svelte';

	let {
		graph,
		initial,
		oncancel,
		onsubmit
	}: {
		graph: NetworkGraph;
		initial?: NetworkNode;
		oncancel?: () => void;
		onsubmit: (node: NetworkNode) => void;
	} = $props();

	const isEdit = $derived(initial !== undefined);

	let label = $state(untrack(() => initial?.label ?? ''));
	let color = $state(untrack(() => initial?.color ?? ''));
	let isSelf = $state(untrack(() => initial?.is_self ?? false));

	// Only one node can be you. Warn rather than silently reassigning — the
	// owner should see which node currently holds the flag.
	const existingSelf = $derived(graph.nodes.find((n) => n.is_self && n.id !== initial?.id));

	const paletteColors = $derived(graph.customization.theme.palette);

	function generateId(existing: NetworkNode[]): string {
		const used = new Set(existing.map((n) => n.id));
		for (let i = 1; i < 1000; i++) {
			const id = `n${i}`;
			if (!used.has(id)) return id;
		}
		return 'n_' + Math.random().toString(36).slice(2, 8);
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const node: NetworkNode = {
			id: initial?.id ?? generateId(graph.nodes),
			label: label.trim()
		};
		if (color) node.color = color;
		if (isSelf && !existingSelf) node.is_self = true;
		// Preserve fields we don't edit here.
		if (initial?.avatar_ref) node.avatar_ref = initial.avatar_ref;
		if (initial?.subject_ref) node.subject_ref = initial.subject_ref;
		if (initial?.link_status) node.link_status = initial.link_status;
		if (initial?.position) node.position = initial.position;

		onsubmit(node);

		if (!isEdit) {
			label = '';
			color = '';
		}
	}
</script>

<form onsubmit={handleSubmit} class="node-form">
	<h3>{isEdit ? 'Edit person' : 'Add person'}</h3>
	<div class="row">
		<label class="field">
			<span class="label">Name</span>
			<input type="text" bind:value={label} required placeholder="Alex" maxlength="60" />
		</label>
		<div class="field colorfield">
			<span class="label">Colour <small>(optional)</small></span>
			<ColorPickerWithPalette bind:value={color} {paletteColors} ariaLabel="person colour" />
		</div>
	</div>
	<label class="selfrow" class:disabled={Boolean(existingSelf)}>
		<input type="checkbox" bind:checked={isSelf} disabled={Boolean(existingSelf)} />
		<span>
			This is me
			{#if existingSelf}
				<small>— “{existingSelf.label}” is already marked as you</small>
			{:else}
				<small>— your own name stays visible; everyone else's is hidden by default</small>
			{/if}
		</span>
	</label>
	<div class="actions">
		{#if oncancel}
			<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
		{/if}
		<button type="submit" class="primary">
			{isEdit ? 'Save changes' : '+ add person'}
		</button>
	</div>
</form>

<style>
	.node-form {
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
		grid-template-columns: 1fr auto;
		gap: var(--space-3);
		align-items: end;
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
	.field input[type='text'] {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.field input[type='text']:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.selfrow {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: 0.9em;
	}
	.selfrow small {
		color: var(--color-muted);
	}
	.selfrow.disabled {
		opacity: 0.6;
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
