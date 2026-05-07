<script lang="ts">
	import type { NetworkGraph, NetworkNode } from '$lib/types.js';

	let { graph, onsubmit }: { graph: NetworkGraph; onsubmit: (node: NetworkNode) => void } =
		$props();

	let label = $state('');
	let color = $state('');

	function generateId(existing: NetworkNode[]): string {
		// Find the smallest unused n_X id.
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
			id: generateId(graph.nodes),
			label: label.trim()
		};
		if (color) node.color = color;
		onsubmit(node);
		label = '';
		color = '';
	}
</script>

<form onsubmit={handleSubmit} class="node-form">
	<h3>Add person</h3>
	<div class="row">
		<label class="field">
			<span class="label">Name</span>
			<input type="text" bind:value={label} required placeholder="Alex" maxlength="60" />
		</label>
		<label class="field colorfield">
			<span class="label">Colour <small>(optional)</small></span>
			<input type="color" bind:value={color} />
		</label>
	</div>
	<button type="submit" class="primary">+ add person</button>
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
	.colorfield input[type='color'] {
		width: 60px;
		height: 38px;
		padding: 0;
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		cursor: pointer;
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
