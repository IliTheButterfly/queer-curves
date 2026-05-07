<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		SCHEMA_VERSION,
		type Axis,
		type EdgeType,
		type Graph,
		type NetworkGraph,
		type SpectrumGraph
	} from '$lib/types.js';
	import { generateGraphId, saveUserGraph } from '$lib/store/graphs.js';
	import { palettes } from '$lib/presets/palettes.js';
	import PaletteSwatch from '$lib/ui/PaletteSwatch.svelte';

	type GraphType = 'spectrum' | 'network';

	let type = $state<GraphType>('spectrum');
	let name = $state('');
	let description = $state('');
	let dimensions = $state<1 | 2>(1);
	let paletteId = $state<string>('pride');

	// Always carry two axis slots so binding stays stable when toggling
	// dimensions; we slice to `dimensions` on save.
	let axes = $state<Axis[]>([
		{ name: 'axis 1', min_label: '', max_label: '', range: [0, 1], waypoints: [] },
		{ name: 'axis 2', min_label: '', max_label: '', range: [0, 1], waypoints: [] }
	]);

	let edgeTypes = $state<EdgeType[]>([{ id: 'edge-1', label: 'connected', color: '#c98aff' }]);

	const selectedPalette = $derived(palettes.find((p) => p.id === paletteId) ?? palettes[0]);

	function addWaypoint(axisIdx: number) {
		const wps = axes[axisIdx].waypoints ?? [];
		axes[axisIdx].waypoints = [...wps, { position: 0.5, label: '' }];
	}

	function removeWaypoint(axisIdx: number, wpIdx: number) {
		const wps = axes[axisIdx].waypoints ?? [];
		axes[axisIdx].waypoints = wps.filter((_, i) => i !== wpIdx);
	}

	function addEdgeType() {
		edgeTypes.push({
			id: `edge-${edgeTypes.length + 1}`,
			label: '',
			color: selectedPalette.colors[edgeTypes.length % selectedPalette.colors.length]
		});
	}

	function removeEdgeType(idx: number) {
		edgeTypes = edgeTypes.filter((_, i) => i !== idx);
	}

	function buildGraph(): Graph {
		const now = new Date().toISOString();
		const id = generateGraphId();

		const baseCustomization = {
			theme: { palette: selectedPalette.colors },
			title: { show: true, text: name }
		};

		if (type === 'spectrum') {
			const graph: SpectrumGraph = {
				id,
				type: 'spectrum',
				name,
				description: description || undefined,
				created_at: now,
				modified_at: now,
				schema_version: SCHEMA_VERSION,
				owner: '@local:queer-curves',
				editors: [],
				schema: {
					dimensions,
					axes: axes.slice(0, dimensions).map((a) => ({
						...a,
						waypoints: a.waypoints?.filter((w) => w.label.trim() !== '')
					})),
					regions: []
				},
				customization: baseCustomization,
				datapoints: []
			};
			return graph;
		} else {
			const graph: NetworkGraph = {
				id,
				type: 'network',
				name,
				description: description || undefined,
				created_at: now,
				modified_at: now,
				schema_version: SCHEMA_VERSION,
				owner: '@local:queer-curves',
				editors: [],
				schema: {
					edge_types: edgeTypes.filter((et) => et.label.trim() !== '')
				},
				customization: { ...baseCustomization, legend: { position: 'right' } },
				nodes: [],
				edges: []
			};
			return graph;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const graph = buildGraph();
		saveUserGraph(graph);
		await goto(`/graphs/${graph.id}`);
	}
</script>

<svelte:head>
	<title>New graph – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← home</a></p>
	<h1>New graph</h1>

	<form onsubmit={handleSubmit}>
		<fieldset class="type-fieldset">
			<legend>Type</legend>
			<label class="radio">
				<input type="radio" bind:group={type} value="spectrum" />
				<span>
					<strong>Spectrum</strong>
					<small>1D or 2D position over time — gender, attraction, intensity, etc.</small>
				</span>
			</label>
			<label class="radio">
				<input type="radio" bind:group={type} value="network" />
				<span>
					<strong>Network</strong>
					<small>People and typed connections between them — polycules, friend graphs.</small>
				</span>
			</label>
		</fieldset>

		<label class="field">
			<span class="label">Name</span>
			<input type="text" bind:value={name} required placeholder="my gender" maxlength="80" />
		</label>

		<label class="field">
			<span class="label">Description <small>(optional)</small></span>
			<textarea bind:value={description} rows="2" maxlength="500"></textarea>
		</label>

		{#if type === 'spectrum'}
			<fieldset>
				<legend>Dimensions</legend>
				<label class="radio compact">
					<input type="radio" bind:group={dimensions} value={1} />
					<span><strong>1D</strong> <small>single axis</small></span>
				</label>
				<label class="radio compact">
					<input type="radio" bind:group={dimensions} value={2} />
					<span><strong>2D</strong> <small>two-axis plane</small></span>
				</label>
			</fieldset>

			{#each axes as axis, i (i)}
				{#if i < dimensions}
					<fieldset class="axis-fieldset">
						<legend>Axis {i + 1}</legend>

						<label class="field">
							<span class="label">Name</span>
							<input type="text" bind:value={axis.name} placeholder="attraction" />
						</label>

						<div class="row">
							<label class="field">
								<span class="label">Left/bottom label</span>
								<input type="text" bind:value={axis.min_label} placeholder="ace" />
							</label>
							<label class="field">
								<span class="label">Right/top label</span>
								<input type="text" bind:value={axis.max_label} placeholder="demi" />
							</label>
						</div>

						<div class="row">
							<label class="field">
								<span class="label">Range min</span>
								<input type="number" step="0.01" bind:value={axis.range[0]} />
							</label>
							<label class="field">
								<span class="label">Range max</span>
								<input type="number" step="0.01" bind:value={axis.range[1]} />
							</label>
						</div>

						<div class="waypoints">
							<div class="waypoints-header">
								<span class="label">Waypoints</span>
								<button type="button" class="ghost" onclick={() => addWaypoint(i)}> + add </button>
							</div>
							{#each axis.waypoints ?? [] as wp, wpIdx (wpIdx)}
								<div class="waypoint-row">
									<input
										type="number"
										step="0.01"
										bind:value={wp.position}
										placeholder="position"
										class="position"
									/>
									<input type="text" bind:value={wp.label} placeholder="label (e.g. gray)" />
									<button
										type="button"
										class="ghost remove"
										onclick={() => removeWaypoint(i, wpIdx)}
										aria-label="remove waypoint"
									>
										×
									</button>
								</div>
							{/each}
						</div>
					</fieldset>
				{/if}
			{/each}
		{:else}
			<fieldset>
				<legend>Edge types</legend>
				<p class="hint">
					What kinds of connections can exist between people. You can collapse them into a single
					"connected" type for redacted views later.
				</p>
				{#each edgeTypes as et, i (i)}
					<div class="edge-row">
						<input type="text" bind:value={et.label} placeholder="romantic" />
						<input type="color" bind:value={et.color} class="color" />
						{#if edgeTypes.length > 1}
							<button
								type="button"
								class="ghost remove"
								onclick={() => removeEdgeType(i)}
								aria-label="remove edge type"
							>
								×
							</button>
						{/if}
					</div>
				{/each}
				<button type="button" class="ghost" onclick={addEdgeType}>+ add edge type</button>
			</fieldset>
		{/if}

		<fieldset>
			<legend>Palette</legend>
			<select bind:value={paletteId}>
				{#each palettes as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
			<div class="palette-preview">
				<PaletteSwatch palette={selectedPalette} height={32} />
			</div>
		</fieldset>

		<div class="actions">
			<a href="/" class="cancel">Cancel</a>
			<button type="submit" class="primary">Create graph</button>
		</div>
	</form>
</main>

<style>
	main {
		max-width: 70ch;
	}
	.back a {
		color: var(--color-muted);
		text-decoration: none;
	}
	.back a:hover {
		color: var(--color-accent);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-4);
	}

	fieldset {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 6px;
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: rgba(255, 255, 255, 0.02);
	}
	legend {
		padding: 0 var(--space-2);
		color: var(--color-accent);
		font-weight: 600;
		font-size: 0.95em;
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
	.field textarea,
	select {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.field input:focus,
	.field textarea:focus,
	select:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	.radio {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		padding: var(--space-2);
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.15s;
	}
	.radio:hover {
		background: rgba(255, 255, 255, 0.04);
	}
	.radio input[type='radio'] {
		margin-top: 4px;
	}
	.radio strong {
		display: block;
	}
	.radio small {
		display: block;
		color: var(--color-muted);
		font-size: 0.85em;
		margin-top: 2px;
	}
	.type-fieldset {
		gap: var(--space-1);
	}
	.radio.compact {
		display: inline-flex;
		gap: var(--space-2);
	}
	.radio.compact small {
		display: inline;
	}

	.axis-fieldset {
		gap: var(--space-3);
	}

	.waypoints-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.waypoint-row {
		display: grid;
		grid-template-columns: 100px 1fr auto;
		gap: var(--space-2);
		align-items: center;
	}
	.waypoint-row .position {
		width: 100%;
	}
	.waypoint-row input {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
	}

	.edge-row {
		display: grid;
		grid-template-columns: 1fr 60px auto;
		gap: var(--space-2);
		align-items: center;
	}
	.edge-row input[type='text'] {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.edge-row input.color {
		height: 38px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		background: transparent;
		cursor: pointer;
	}

	.hint {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.85em;
	}

	.palette-preview {
		margin-top: var(--space-2);
	}

	button.ghost {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-3);
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}
	button.ghost:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-accent);
	}
	button.ghost.remove {
		padding: 0 var(--space-2);
		font-size: 1.1em;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
		align-items: center;
	}
	.cancel {
		color: var(--color-muted);
		text-decoration: none;
	}
	.cancel:hover {
		color: var(--color-fg);
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
</style>
