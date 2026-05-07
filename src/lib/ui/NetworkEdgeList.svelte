<script lang="ts">
	import type { NetworkEdge, NetworkGraph } from '$lib/types.js';
	import NetworkEdgeForm from './NetworkEdgeForm.svelte';

	let {
		graph,
		onremove,
		onedit
	}: {
		graph: NetworkGraph;
		onremove: (id: string) => void;
		onedit: (edge: NetworkEdge) => void;
	} = $props();

	let editingId = $state<string | null>(null);

	function nodeLabel(id: string): string {
		return graph.nodes.find((n) => n.id === id)?.label ?? `(deleted: ${id})`;
	}

	function edgeTypeLabel(typeId: string): string {
		return graph.schema.edge_types.find((et) => et.id === typeId)?.label ?? `(unknown: ${typeId})`;
	}

	function edgeTypeColor(typeId: string): string | undefined {
		return graph.schema.edge_types.find((et) => et.id === typeId)?.color;
	}

	function handleSave(updated: NetworkEdge) {
		onedit(updated);
		editingId = null;
	}
</script>

{#if graph.edges.length > 0}
	<div class="list">
		<h3>
			Connections <small class="muted">({graph.edges.length})</small>
		</h3>
		<ul>
			{#each graph.edges as edge (edge.id)}
				<li class="row">
					{#if editingId === edge.id}
						<NetworkEdgeForm
							{graph}
							initial={edge}
							onsubmit={handleSave}
							oncancel={() => (editingId = null)}
						/>
					{:else}
						<div class="info">
							<span class="endpoint">{nodeLabel(edge.source)}</span>
							<span class="arrow" style:color={edgeTypeColor(edge.type_id)}>
								{edge.directed ? '→' : '↔'}
							</span>
							<span class="endpoint">{nodeLabel(edge.target)}</span>
							<span class="type" style:color={edgeTypeColor(edge.type_id)}>
								{edge.label_override ?? edgeTypeLabel(edge.type_id)}
							</span>
						</div>
						<div class="row-actions">
							<button
								type="button"
								class="edit"
								onclick={() => (editingId = edge.id)}
								aria-label="edit connection"
							>
								Edit
							</button>
							<button
								type="button"
								class="remove"
								onclick={() => onremove(edge.id)}
								aria-label="remove connection"
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
		align-items: baseline;
		flex-wrap: wrap;
	}
	.endpoint {
		color: var(--color-fg);
	}
	.arrow {
		color: var(--color-muted);
	}
	.type {
		font-size: 0.85em;
		font-weight: 600;
		padding: 2px 8px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 999px;
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
