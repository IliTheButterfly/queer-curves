<script lang="ts">
	import type { NetworkGraph, NetworkNode } from '$lib/types.js';
	import NetworkNodeForm from './NetworkNodeForm.svelte';

	let {
		graph,
		onremove,
		onedit
	}: {
		graph: NetworkGraph;
		onremove: (id: string) => void;
		onedit: (node: NetworkNode) => void;
	} = $props();

	let editingId = $state<string | null>(null);

	function edgeCountFor(nodeId: string): number {
		return graph.edges.filter((e) => e.source === nodeId || e.target === nodeId).length;
	}

	function handleRemove(node: NetworkNode) {
		const edges = edgeCountFor(node.id);
		if (edges > 0) {
			const ok = confirm(
				`Remove "${node.label}"? This will also remove ${edges} connection${edges === 1 ? '' : 's'}.`
			);
			if (!ok) return;
		}
		onremove(node.id);
	}

	function handleSave(updated: NetworkNode) {
		onedit(updated);
		editingId = null;
	}
</script>

{#if graph.nodes.length > 0}
	<div class="list">
		<h3>People <small class="muted">({graph.nodes.length})</small></h3>
		<ul>
			{#each graph.nodes as node (node.id)}
				<li class="row">
					{#if editingId === node.id}
						<NetworkNodeForm
							{graph}
							initial={node}
							onsubmit={handleSave}
							oncancel={() => (editingId = null)}
						/>
					{:else}
						<div class="info">
							{#if node.color}
								<span class="dot" style:background={node.color}></span>
							{/if}
							<span class="label">{node.label}</span>
							{#if edgeCountFor(node.id) > 0}
								<span class="muted">
									— {edgeCountFor(node.id)} connection{edgeCountFor(node.id) === 1 ? '' : 's'}
								</span>
							{/if}
						</div>
						<div class="row-actions">
							<button
								type="button"
								class="edit"
								onclick={() => (editingId = node.id)}
								aria-label="edit person"
							>
								Edit
							</button>
							<button
								type="button"
								class="remove"
								onclick={() => handleRemove(node)}
								aria-label="remove person"
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
		align-items: center;
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
