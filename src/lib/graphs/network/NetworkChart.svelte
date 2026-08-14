<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import type cytoscape from 'cytoscape';
	import type { NetworkGraph, UserRef } from '$lib/types.js';
	import { displayLabels } from './privacy.js';

	let {
		graph,
		onPositionsChange,
		reveal = false,
		selfUserId = null
	}: {
		graph: NetworkGraph;
		// Fires when the user drags a node to rest, or when an explicit
		// re-layout finishes. Keys are node ids; values are layout
		// coordinates from cytoscape (not viewport pixels).
		onPositionsChange?: (positions: Record<string, { x: number; y: number }>) => void;
		// Show real names instead of "Person N" placeholders. Held true only
		// while the viewer holds the reveal button down — see privacy.ts.
		reveal?: boolean;
		// Matrix id of the signed-in user, so a node linked to that account
		// counts as "you" and keeps its name.
		selfUserId?: UserRef | null;
	} = $props();

	let containerEl: HTMLDivElement;
	let cy: cytoscape.Core | null = null;

	// fcose's force-directed core is markedly better at avoiding edge
	// crossings on small dense graphs than the built-in `cose` — random
	// initial placement matters a lot, and fcose's quality:'proof' setting
	// runs more iterations to converge consistently.
	const fcoseLayout: cytoscape.LayoutOptions = {
		name: 'fcose',
		animate: false,
		padding: 40,
		quality: 'proof',
		randomize: true,
		nodeRepulsion: 8000,
		idealEdgeLength: 90,
		nodeSeparation: 90
	} as cytoscape.LayoutOptions;

	// Pick the right layout for the current graph state:
	// - all nodes positioned → 'preset' (use the saved coords as-is).
	// - some positioned → fcose with the positioned nodes pinned, so
	//   placing a new node doesn't shuffle the user's existing layout.
	// - none → fresh fcose.
	function pickLayout(g: NetworkGraph): cytoscape.LayoutOptions {
		if (g.nodes.length === 0) return fcoseLayout;
		const positioned = g.nodes.filter((n) => n.position);
		if (positioned.length === g.nodes.length) {
			return { name: 'preset' } as cytoscape.LayoutOptions;
		}
		if (positioned.length > 0) {
			// fcose-specific options aren't in cytoscape's stock type union; cast
			// through unknown so TS doesn't reject `fixedNodeConstraint`.
			return {
				...fcoseLayout,
				randomize: false,
				fixedNodeConstraint: positioned.map((n) => ({
					nodeId: n.id,
					position: { x: n.position!.x, y: n.position!.y }
				}))
			} as unknown as cytoscape.LayoutOptions;
		}
		return fcoseLayout;
	}

	function emitPositions() {
		if (!cy || !onPositionsChange) return;
		const positions: Record<string, { x: number; y: number }> = {};
		cy.nodes().forEach((node) => {
			const pos = node.position();
			positions[node.id()] = { x: pos.x, y: pos.y };
		});
		onPositionsChange(positions);
	}

	function relayout() {
		if (!cy) return;
		const l = cy.layout({ ...fcoseLayout, randomize: true } as cytoscape.LayoutOptions);
		l.one('layoutstop', () => emitPositions());
		l.run();
	}

	onMount(async () => {
		// Lazy-load cytoscape — ~250KB, only network-graph users pay the cost.
		// Per STACK.md §5 "Charting and rendering".
		const [cytoscapeMod, fcoseMod] = await Promise.all([
			import('cytoscape'),
			import('cytoscape-fcose')
		]);
		const cytoscapeFn = cytoscapeMod.default;
		cytoscapeFn.use(fcoseMod.default);
		const initialLayout = pickLayout(graph);
		cy = cytoscapeFn({
			container: containerEl,
			elements: buildElements(graph, currentLabels()),
			style: buildStyle(),
			layout: initialLayout,
			// Default of 1.0 zooms uncomfortably fast on most trackpads/wheels.
			wheelSensitivity: 0.2
		});
		// Persist manual positioning when the user lets go of a node.
		cy.on('dragfree', 'node', () => emitPositions());
		// If we computed positions for unpositioned nodes (initial layout
		// wasn't 'preset'), persist the result so subsequent renders skip
		// the layout pass entirely.
		if (initialLayout.name !== 'preset') {
			emitPositions();
		}
	});

	function recenter() {
		// `fit` zooms+pans so all elements are visible; falls back to `center`
		// when there's nothing to fit (so the call is harmless on empty graphs).
		if (!cy) return;
		if (cy.elements().length === 0) cy.center();
		else cy.fit(undefined, 40);
	}

	$effect(() => {
		// Re-render when prop changes after mount. Reuse the instance rather
		// than tearing down — cheaper, preserves any pan/zoom state.
		const g = graph;
		if (cy) {
			cy.elements().remove();
			// untrack: `reveal` must not re-trigger this effect. Toggling names
			// is a label swap (below), never a re-layout — the graph jumping
			// around every time you press the reveal button would be awful.
			cy.add(buildElements(g, untrack(currentLabels)));
			cy.layout(pickLayout(g)).run();
		}
	});

	$effect(() => {
		// Swap labels in place when reveal flips. No layout, no re-add.
		const labels = displayLabels(graph, { reveal, selfUserId });
		if (!cy) return;
		applyLabels(labels);
	});

	function currentLabels(): Record<string, string> {
		return displayLabels(graph, { reveal, selfUserId });
	}

	function applyLabels(labels: Record<string, string>) {
		if (!cy) return;
		cy.batch(() => {
			cy!.nodes().forEach((n) => {
				const label = labels[n.id()];
				if (label !== undefined) n.data('label', label);
			});
		});
	}

	// Render the graph to a PNG data URI **with real names visible**,
	// regardless of the current reveal state. Callers are responsible for
	// the consent gate in front of this (see NetworkExportDialog) — an
	// exported image is the one artefact that leaves the app's control
	// entirely, so it is never produced without an explicit confirmation.
	export function exportPng(): string | null {
		if (!cy) return null;
		const wasRevealed = displayLabels(graph, { reveal, selfUserId });
		try {
			applyLabels(displayLabels(graph, { reveal: true, selfUserId }));
			return cy.png({
				full: true,
				scale: 2,
				// Matches --color-bg; a transparent PNG renders as black-on-black
				// text in most viewers.
				bg: '#1a1424'
			});
		} finally {
			// Restore whatever the on-screen state was, so exporting while
			// masked doesn't leave names on screen.
			applyLabels(wasRevealed);
		}
	}

	onDestroy(() => {
		cy?.destroy();
		cy = null;
	});

	function buildElements(
		g: NetworkGraph,
		labels: Record<string, string>
	): cytoscape.ElementDefinition[] {
		const edgeTypes = new Map(g.schema.edge_types.map((et) => [et.id, et]));
		const palette = g.customization.theme.palette;
		const defaultNodeColor = g.customization.node_style?.default_color ?? palette[0] ?? '#c98aff';

		return [
			...g.nodes.map((n): cytoscape.ElementDefinition => {
				const elem: cytoscape.ElementDefinition = {
					data: {
						// Never the raw label — masking is the default, and the
						// only source of truth for what's on screen is privacy.ts.
						id: n.id,
						label: labels[n.id] ?? '',
						color: n.color ?? defaultNodeColor
					}
				};
				if (n.position) elem.position = { x: n.position.x, y: n.position.y };
				return elem;
			}),
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

<div class="cy-wrap">
	<div bind:this={containerEl} class="cy-container"></div>
	<div class="overlay-btns">
		<button
			type="button"
			class="overlay-btn"
			onclick={relayout}
			title="re-run the layout — your previous arrangement is replaced"
			aria-label="re-run layout"
		>
			Re-layout
		</button>
		<button
			type="button"
			class="overlay-btn"
			onclick={recenter}
			title="recenter the view on the network"
			aria-label="recenter view"
		>
			Recenter
		</button>
	</div>
</div>
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
	.cy-wrap {
		position: relative;
	}
	.cy-container {
		width: 100%;
		height: 500px;
		background: rgba(255, 255, 255, 0.02);
		border-radius: 4px;
	}
	.overlay-btns {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		display: flex;
		gap: var(--space-2);
	}
	.overlay-btn {
		background: rgba(0, 0, 0, 0.55);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-3);
		border-radius: 4px;
		font: inherit;
		font-size: 0.85em;
		cursor: pointer;
		backdrop-filter: blur(4px);
	}
	.overlay-btn:hover {
		border-color: var(--color-accent);
		background: rgba(0, 0, 0, 0.7);
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
