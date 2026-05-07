<script lang="ts">
	import { untrack } from 'svelte';
	import {
		SCHEMA_VERSION,
		type Axis,
		type EdgeType,
		type Graph,
		type NetworkGraph,
		type Region,
		type SpectrumGraph
	} from '$lib/types.js';
	import { palettes, type Palette } from '$lib/presets/palettes.js';
	import { generateGraphId } from '$lib/store/graphs.js';
	import ColorPickerWithPalette from '$lib/ui/ColorPickerWithPalette.svelte';
	import PaletteSwatch from '$lib/ui/PaletteSwatch.svelte';
	import RegionEditor from '$lib/ui/RegionEditor.svelte';

	type GraphType = 'spectrum' | 'network';

	let {
		initial,
		onsubmit,
		cancelHref = '/'
	}: {
		initial?: Graph;
		onsubmit: (graph: Graph) => void;
		cancelHref?: string;
	} = $props();

	const isEdit = $derived(initial !== undefined);
	const submitLabel = $derived(isEdit ? 'Save changes' : 'Create graph');

	// Type can't change after creation — moving spectrum data into a network
	// shape (or vice-versa) is too destructive to support.
	// Dimensions can't change once a spectrum has datapoints — they'd all
	// have wrong-length coordinates.
	const dimensionsLocked = $derived(
		isEdit && initial?.type === 'spectrum' && initial.datapoints.length > 0
	);

	// Initial values read once at mount — `untrack` makes that explicit.
	let type = $state<GraphType>(untrack(() => initial?.type ?? 'spectrum'));
	let name = $state(untrack(() => initial?.name ?? ''));
	let description = $state(untrack(() => initial?.description ?? ''));
	let dimensions = $state<1 | 2>(
		untrack(() => (initial?.type === 'spectrum' && initial.schema.dimensions === 2 ? 2 : 1))
	);

	function initialAxes(): Axis[] {
		if (initial?.type === 'spectrum') {
			const padded = initial.schema.axes.map(cloneAxis);
			while (padded.length < 2) {
				padded.push({
					name: `axis ${padded.length + 1}`,
					min_label: '',
					max_label: '',
					range: [0, 1],
					waypoints: []
				});
			}
			return padded;
		}
		return [
			{ name: 'axis 1', min_label: '', max_label: '', range: [0, 1], waypoints: [] },
			{ name: 'axis 2', min_label: '', max_label: '', range: [0, 1], waypoints: [] }
		];
	}

	function cloneAxis(a: Axis): Axis {
		return {
			name: a.name,
			min_label: a.min_label,
			max_label: a.max_label,
			range: [a.range[0], a.range[1]],
			waypoints: a.waypoints?.map((w) => ({ ...w })) ?? []
		};
	}

	let axes = $state<Axis[]>(untrack(() => initialAxes()));

	let regions = $state<Region[]>(
		untrack(() => (initial?.type === 'spectrum' ? initial.schema.regions.map(cloneRegion) : []))
	);

	function cloneRegion(r: Region): Region {
		// Deep clone the shape to keep the form's edits isolated from the
		// original until we save.
		const shape =
			r.shape.type === 'box'
				? { type: 'box' as const, min: [...r.shape.min], max: [...r.shape.max] }
				: r.shape.type === 'range'
					? { type: 'range' as const, min: r.shape.min, max: r.shape.max }
					: {
							type: 'polygon' as const,
							vertices: r.shape.vertices.map((v) => [...v] as [number, number])
						};
		return { ...r, shape };
	}

	let edgeTypes = $state<EdgeType[]>(
		untrack(() =>
			initial?.type === 'network'
				? initial.schema.edge_types.map((e) => ({ ...e }))
				: [{ id: 'edge-1', label: 'connected', color: '#c98aff' }]
		)
	);

	function findMatchingPalette(colors: string[]): string {
		for (const p of palettes) {
			if (
				p.colors.length === colors.length &&
				p.colors.every((c, i) => c.toLowerCase() === colors[i].toLowerCase())
			) {
				return p.id;
			}
		}
		return '__current';
	}

	const customPaletteOption: Palette | null = $derived(
		initial && findMatchingPalette(initial.customization.theme.palette) === '__current'
			? {
					id: '__current',
					name: 'Currently used',
					colors: initial.customization.theme.palette,
					flag: 'unchanged'
				}
			: null
	);

	const paletteOptions = $derived(
		customPaletteOption ? [customPaletteOption, ...palettes] : palettes
	);

	let paletteId = $state<string>(
		untrack(() => (initial ? findMatchingPalette(initial.customization.theme.palette) : 'pride'))
	);

	const selectedPalette = $derived(
		paletteId === '__current' && customPaletteOption
			? customPaletteOption
			: (palettes.find((p) => p.id === paletteId) ?? palettes[0])
	);

	const activeAxes = $derived(axes.slice(0, dimensions));

	function addWaypoint(axisIdx: number) {
		const wps = axes[axisIdx].waypoints ?? [];
		axes[axisIdx].waypoints = [...wps, { position: 0.5, label: '' }];
	}

	function removeWaypoint(axisIdx: number, wpIdx: number) {
		const wps = axes[axisIdx].waypoints ?? [];
		axes[axisIdx].waypoints = wps.filter((_, i) => i !== wpIdx);
	}

	function addEdgeType() {
		const id = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		edgeTypes.push({
			id,
			label: '',
			color: selectedPalette.colors[edgeTypes.length % selectedPalette.colors.length]
		});
	}

	function removeEdgeType(idx: number) {
		edgeTypes = edgeTypes.filter((_, i) => i !== idx);
	}

	function buildGraph(): Graph {
		const now = new Date().toISOString();
		const colors = selectedPalette.colors;

		if (type === 'spectrum') {
			const cleanedAxes = axes.slice(0, dimensions).map((a) => ({
				...a,
				waypoints: a.waypoints?.filter((w) => w.label.trim() !== '')
			}));
			const validRegions = regions.filter((r) => {
				if (r.label.trim() === '') return false;
				if (dimensions === 1) return r.shape.type === 'range';
				if (dimensions === 2) return r.shape.type === 'box' || r.shape.type === 'polygon';
				return false;
			});

			if (initial?.type === 'spectrum') {
				return {
					...initial,
					name,
					description: description || undefined,
					modified_at: now,
					schema_version: SCHEMA_VERSION,
					schema: { dimensions, axes: cleanedAxes, regions: validRegions },
					customization: {
						...initial.customization,
						theme: { ...initial.customization.theme, palette: colors },
						title: { show: true, text: name }
					}
				} satisfies SpectrumGraph;
			}

			return {
				id: generateGraphId(),
				type: 'spectrum',
				name,
				description: description || undefined,
				created_at: now,
				modified_at: now,
				schema_version: SCHEMA_VERSION,
				owner: '@local:queer-curves',
				editors: [],
				schema: { dimensions, axes: cleanedAxes, regions: validRegions },
				customization: {
					theme: { palette: colors },
					title: { show: true, text: name }
				},
				datapoints: []
			} satisfies SpectrumGraph;
		}

		const validEdgeTypes = edgeTypes.filter((et) => et.label.trim() !== '');

		if (initial?.type === 'network') {
			return {
				...initial,
				name,
				description: description || undefined,
				modified_at: now,
				schema_version: SCHEMA_VERSION,
				schema: { edge_types: validEdgeTypes },
				customization: {
					...initial.customization,
					theme: { ...initial.customization.theme, palette: colors },
					title: { show: true, text: name }
				}
			} satisfies NetworkGraph;
		}

		return {
			id: generateGraphId(),
			type: 'network',
			name,
			description: description || undefined,
			created_at: now,
			modified_at: now,
			schema_version: SCHEMA_VERSION,
			owner: '@local:queer-curves',
			editors: [],
			schema: { edge_types: validEdgeTypes },
			customization: {
				theme: { palette: colors },
				title: { show: true, text: name },
				legend: { position: 'right' }
			},
			nodes: [],
			edges: []
		} satisfies NetworkGraph;
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		onsubmit(buildGraph());
	}
</script>

<form onsubmit={handleSubmit} class="config-form">
	{#if !isEdit}
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
	{:else}
		<p class="locked-meta">
			Type <strong>{type}</strong>
			<small>— locked after creation</small>
		</p>
	{/if}

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
			{#if dimensionsLocked}
				<p class="locked-inline">
					<strong>{dimensions}D</strong>
					<small>— locked while datapoints exist (delete them to change)</small>
				</p>
			{:else}
				<label class="radio compact">
					<input type="radio" bind:group={dimensions} value={1} />
					<span><strong>1D</strong> <small>single axis</small></span>
				</label>
				<label class="radio compact">
					<input type="radio" bind:group={dimensions} value={2} />
					<span><strong>2D</strong> <small>two-axis plane</small></span>
				</label>
			{/if}
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

		<fieldset class="regions-fieldset">
			<legend>Regions</legend>
			<RegionEditor
				bind:regions
				axes={activeAxes}
				defaultColor={selectedPalette.colors[0] ?? '#c98aff'}
				paletteColors={selectedPalette.colors}
			/>
		</fieldset>
	{:else}
		<fieldset>
			<legend>Edge types</legend>
			<p class="hint">
				What kinds of connections can exist between people. You can collapse them into a single
				"connected" type for redacted views later.
			</p>
			{#each edgeTypes as et, i (et.id)}
				<div class="edge-row">
					<input type="text" bind:value={et.label} placeholder="romantic" />
					<ColorPickerWithPalette
						bind:value={edgeTypes[i].color}
						paletteColors={selectedPalette.colors}
						ariaLabel="edge type colour"
					/>
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
			{#each paletteOptions as p (p.id)}
				<option value={p.id}>{p.name}</option>
			{/each}
		</select>
		<div class="palette-preview">
			<PaletteSwatch palette={selectedPalette} height={32} />
		</div>
	</fieldset>

	<div class="actions">
		<a href={cancelHref} class="cancel">Cancel</a>
		<button type="submit" class="primary">{submitLabel}</button>
	</div>
</form>

<style>
	.config-form {
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

	.locked-meta {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.locked-meta strong {
		color: var(--color-fg);
	}
	.locked-inline {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.locked-inline strong {
		color: var(--color-fg);
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
	.waypoint-row input {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.waypoint-row input.position {
		width: 100%;
	}

	.edge-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
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
