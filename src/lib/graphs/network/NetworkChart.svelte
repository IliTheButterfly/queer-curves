<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type cytoscape from 'cytoscape';
	import type { NetworkGraph } from '$lib/types.js';

	let { graph }: { graph: NetworkGraph } = $props();

	let containerEl: HTMLDivElement;
	let cy: cytoscape.Core | null = null;

	const layout: cytoscape.LayoutOptions = {
		name: 'cose',
		animate: false,
		padding: 40
	} as cytoscape.LayoutOptions;

	onMount(async () => {
		// Lazy-load cytoscape — ~250KB, only network-graph users pay the cost.
		// Per STACK.md §5 "Charting and rendering".
		const cytoscapeFn = (await import('cytoscape')).default;
		cy = cytoscapeFn({
			container: containerEl,
			elements: buildElements(graph),
			style: buildStyle(),
			layout
		});
	});

	$effect(() => {
		// Re-render when prop changes after mount. Reuse the instance rather
		// than tearing down — cheaper, preserves any pan/zoom state.
		const g = graph;
		if (cy) {
			cy.elements().remove();
			cy.add(buildElements(g));
			cy.layout(layout).run();
		}
	});

	onDestroy(() => {
		cy?.destroy();
		cy = null;
	});

	function buildElements(g: NetworkGraph): cytoscape.ElementDefinition[] {
		const edgeTypes = new Map(g.schema.edge_types.map((et) => [et.id, et]));
		const palette = g.customization.theme.palette;
		const defaultNodeColor = g.customization.node_style?.default_color ?? palette[0] ?? '#c98aff';

		return [
			...g.nodes.map((n) => ({
				data: {
					id: n.id,
					label: n.label,
					color: n.color ?? defaultNodeColor
				}
			})),
			...g.edges.map((e) => {
				const et = edgeTypes.get(e.type_id);
				return {
					data: {
						id: e.id,
						source: e.source,
						target: e.target,
						label: e.label_override ?? et?.label ?? '',
						color: et?.color ?? '#998aaa'
					}
				};
			})
		];
	}

	function buildStyle(): cytoscape.StylesheetStyle[] {
		return [
			{
				selector: 'node',
				style: {
					'background-color': 'data(color)',
					label: 'data(label)',
					color: '#e8d8f5',
					'text-valign': 'bottom',
					'text-halign': 'center',
					'text-margin-y': 8,
					'font-family': 'system-ui, sans-serif',
					'font-size': 13,
					width: 40,
					height: 40,
					'border-color': '#1a1424',
					'border-width': 2
				} as cytoscape.Css.Node
			},
			{
				selector: 'edge',
				style: {
					'line-color': 'data(color)',
					'curve-style': 'bezier',
					width: 3,
					opacity: 0.85,
					label: 'data(label)',
					color: 'data(color)',
					'font-size': 10,
					'text-rotation': 'autorotate',
					'text-margin-y': -10,
					'text-background-color': '#1a1424',
					'text-background-opacity': 0.85,
					'text-background-padding': '2px'
				} as cytoscape.Css.Edge
			}
		];
	}
</script>

<div bind:this={containerEl} class="cy-container"></div>
{#if graph.customization.legend?.position !== 'hidden' && graph.schema.edge_types.length > 0}
	<div class="legend">
		{#each graph.schema.edge_types as et (et.id)}
			<span class="legend-item">
				<span class="swatch" style:background-color={et.color}></span>
				{et.label}
			</span>
		{/each}
	</div>
{/if}

<style>
	.cy-container {
		width: 100%;
		height: 500px;
		background: rgba(255, 255, 255, 0.02);
		border-radius: 4px;
	}
	.legend {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-top: var(--space-2);
		font-size: 0.9em;
		color: var(--color-muted);
	}
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.swatch {
		display: inline-block;
		width: 16px;
		height: 4px;
		border-radius: 2px;
	}
</style>
