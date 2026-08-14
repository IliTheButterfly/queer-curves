<script lang="ts">
	import { untrack } from 'svelte';
	import {
		SCHEMA_VERSION,
		type Axis,
		type AxisRef,
		type EdgeType,
		type Graph,
		type NetworkGraph,
		type PointWaypoint,
		type PreferenceLevel,
		type PronounsGraph,
		type Region,
		type SpectrumGraph,
		type SpectrumView,
		type TermGroup
	} from '$lib/types.js';
	import { palettes, type Palette } from '$lib/presets/palettes.js';
	import { generateGraphId } from '$lib/store/graphs.js';
	import { DEFAULT_LEVELS, DEFAULT_TERM_GROUPS } from '$lib/graphs/pronouns/defaults.js';
	import ColorPickerWithPalette from '$lib/ui/ColorPickerWithPalette.svelte';
	import PaletteSwatch from '$lib/ui/PaletteSwatch.svelte';
	import RegionEditor from '$lib/ui/RegionEditor.svelte';

	type GraphType = 'spectrum' | 'network' | 'pronouns';

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
	let dimensions = $state<1 | 2 | 3>(
		untrack(() => {
			if (initial?.type === 'spectrum') {
				const d = initial.schema.dimensions;
				if (d === 2 || d === 3) return d;
			}
			return 1;
		})
	);

	function initialAxes(): Axis[] {
		if (initial?.type === 'spectrum') {
			const padded = initial.schema.axes.map(cloneAxis);
			// Pad to 3 so switching dimensions up to 3D doesn't lose user
			// edits made on the third axis fieldset.
			while (padded.length < 3) {
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
			{ name: 'axis 2', min_label: '', max_label: '', range: [0, 1], waypoints: [] },
			{ name: 'axis 3', min_label: '', max_label: '', range: [0, 1], waypoints: [] }
		];
	}

	function cloneAxis(a: Axis): Axis {
		return {
			name: a.name,
			min_label: a.min_label,
			max_label: a.max_label,
			range: [a.range[0], a.range[1]],
			waypoints: a.waypoints?.map((w) => ({ ...w })) ?? [],
			zero_label: a.zero_label
		};
	}

	let axes = $state<Axis[]>(untrack(() => initialAxes()));

	let regions = $state<Region[]>(
		untrack(() => (initial?.type === 'spectrum' ? initial.schema.regions.map(cloneRegion) : []))
	);

	// Form-state shape: color is always defined here so we can `bind:value`
	// to it. On save we strip the field before persisting so the schema's
	// optional-color semantics are preserved.
	type EditablePointWaypoint = {
		id: string;
		label: string;
		coordinates: number[];
		color: string;
	};

	let pointWaypoints = $state<EditablePointWaypoint[]>(
		untrack(() =>
			initial?.type === 'spectrum'
				? (initial.schema.point_waypoints ?? []).map((p) => ({
						id: p.id,
						label: p.label,
						coordinates: [...p.coordinates],
						color: p.color ?? '#c98aff'
					}))
				: []
		)
	);

	function newPointWaypointId(): string {
		return `pwp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	}

	function addPointWaypoint() {
		const palette = selectedPalette.colors;
		const defaultColor = palette[pointWaypoints.length % palette.length] ?? '#c98aff';
		const coords: number[] = [];
		for (let i = 0; i < dimensions; i++) {
			const ax = axes[i];
			coords.push((ax.range[0] + ax.range[1]) / 2);
		}
		pointWaypoints.push({
			id: newPointWaypointId(),
			label: '',
			coordinates: coords,
			color: defaultColor
		});
	}

	function removePointWaypoint(idx: number) {
		pointWaypoints = pointWaypoints.filter((_, i) => i !== idx);
	}

	// Custom views — when this list is non-empty on save, it overrides the
	// auto-generated presets. While the form's `dimensions` is in flux the
	// existing views' channels may reference an axis index that's no longer
	// valid; the buildGraph step clamps/validates before persisting.
	let customViews = $state<SpectrumView[]>(
		untrack(() =>
			initial?.type === 'spectrum' ? (initial.customization.views ?? []).map(cloneView) : []
		)
	);

	function cloneView(v: SpectrumView): SpectrumView {
		return {
			id: v.id,
			name: v.name,
			layout: v.layout,
			x: v.x,
			y: v.y,
			color: v.color,
			x_label: v.x_label,
			y_label: v.y_label,
			shape: v.shape
		};
	}

	function newViewId(): string {
		return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	}

	function addCustomView() {
		customViews.push({
			id: newViewId(),
			name: 'New view',
			layout: 'cartesian',
			x: 0,
			y: dimensions >= 2 ? 1 : 'time'
		});
	}

	function removeCustomView(idx: number) {
		customViews = customViews.filter((_, i) => i !== idx);
	}

	// AxisRef <-> string-code translations so native <select> bindings work.
	function refToCode(ref: AxisRef | undefined): string {
		if (ref === undefined) return 'none';
		if (ref === 'time') return 'time';
		return `axis-${ref}`;
	}
	function codeToRef(code: string): AxisRef | undefined {
		if (code === 'none') return undefined;
		if (code === 'time') return 'time';
		const m = /^axis-(\d+)$/.exec(code);
		if (m) return parseInt(m[1], 10);
		return undefined;
	}

	// If a view references axis i but dimensions has dropped to <= i, fall
	// back to axis 0 so we never persist an out-of-range index.
	function clampRef(ref: AxisRef, dim: number): AxisRef {
		if (ref === 'time') return ref;
		if (ref >= 0 && ref < dim) return ref;
		return 0;
	}

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

	// ─── Pronoun-card form state ──────────────────────────────────────────
	//
	// The scale and the term groups are the card's schema: entries reference
	// them by id, so ids are generated once and preserved across edits. A
	// level or group can be removed while entries still point at it — the
	// card keeps those entries visible under an "unsorted"/"ungrouped"
	// heading rather than dropping user data (see graphs/pronouns/defaults).
	let levels = $state<PreferenceLevel[]>(
		untrack(() =>
			initial?.type === 'pronouns'
				? initial.schema.levels.map((l) => ({ ...l }))
				: DEFAULT_LEVELS.map((l) => ({ ...l }))
		)
	);

	let termGroups = $state<TermGroup[]>(
		untrack(() =>
			initial?.type === 'pronouns'
				? initial.schema.term_groups.map((g) => ({ ...g }))
				: DEFAULT_TERM_GROUPS.map((g) => ({ ...g }))
		)
	);

	let displayName = $state(
		untrack(() => (initial?.type === 'pronouns' ? (initial.display_name ?? '') : ''))
	);
	let pronounsLayout = $state<'level' | 'flat'>(
		untrack(() =>
			initial?.type === 'pronouns' ? (initial.customization.layout ?? 'level') : 'level'
		)
	);
	let showExamples = $state(
		untrack(() =>
			initial?.type === 'pronouns' ? initial.customization.show_examples !== false : true
		)
	);

	function slugId(prefix: string, label: string, used: Set<string>): string {
		const base =
			label
				.toLowerCase()
				.normalize('NFKD')
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '') || prefix;
		let id = base;
		let n = 2;
		while (used.has(id)) id = `${base}-${n++}`;
		return id;
	}

	function addLevel() {
		const used = new Set(levels.map((l) => l.id));
		levels.push({
			id: slugId('level', `level ${levels.length + 1}`, used),
			label: '',
			color: selectedPalette.colors[levels.length % selectedPalette.colors.length]
		});
	}

	function removeLevel(idx: number) {
		levels = levels.filter((_, i) => i !== idx);
	}

	function addTermGroup() {
		const used = new Set(termGroups.map((g) => g.id));
		termGroups.push({ id: slugId('group', `group ${termGroups.length + 1}`, used), label: '' });
	}

	function removeTermGroup(idx: number) {
		termGroups = termGroups.filter((_, i) => i !== idx);
	}

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
			const cleanedAxes = axes.slice(0, dimensions).map((a) => {
				const out: Axis = {
					...a,
					waypoints: a.waypoints?.filter((w) => w.label.trim() !== '')
				};
				// Drop zero_label if it's empty or no longer relevant (range
				// doesn't straddle zero). Keeps saved data tidy and prevents
				// stale labels from re-appearing if the user later signs the
				// axis again with a new label in mind.
				const trimmed = a.zero_label?.trim();
				if (!trimmed || a.range[0] >= 0 || a.range[1] <= 0) delete out.zero_label;
				else out.zero_label = trimmed;
				return out;
			});
			const validRegions = regions.filter((r) => {
				if (r.label.trim() === '') return false;
				if (dimensions === 1) return r.shape.type === 'range';
				if (dimensions === 2) return r.shape.type === 'box' || r.shape.type === 'polygon';
				return false;
			});
			// Drop waypoints in 1D (axis waypoints handle that case) and trim
			// coords to the current dimensionality so a downsize from 3D→2D
			// doesn't leak a now-meaningless third coordinate.
			const validPointWaypoints: PointWaypoint[] | undefined =
				dimensions >= 2
					? pointWaypoints
							.filter((p) => p.label.trim() !== '')
							.map((p) => ({
								id: p.id,
								label: p.label,
								coordinates: p.coordinates.slice(0, dimensions),
								color: p.color
							}))
					: undefined;

			const spectrumSchema = {
				dimensions,
				axes: cleanedAxes,
				regions: validRegions,
				...(validPointWaypoints && validPointWaypoints.length > 0
					? { point_waypoints: validPointWaypoints }
					: {})
			};

			// Strip unnamed views and clamp any axis refs that point past the
			// current dimensionality (can happen if the user shrinks dims
			// after adding views referencing the now-dropped axis).
			const validViews: SpectrumView[] = customViews
				.filter((v) => v.name.trim() !== '')
				.map((v) => {
					const out: SpectrumView = {
						id: v.id,
						name: v.name.trim(),
						layout: v.layout,
						x: clampRef(v.x, dimensions),
						y: clampRef(v.y, dimensions)
					};
					if (v.color !== undefined) out.color = clampRef(v.color, dimensions);
					const xL = v.x_label?.trim();
					const yL = v.y_label?.trim();
					if (xL) out.x_label = xL;
					if (yL) out.y_label = yL;
					// Shape only matters for radial / polar layouts, and 'circle'
					// is the default — keep saved data lean by stripping it.
					if ((v.layout === 'radial' || v.layout === 'polar') && v.shape && v.shape !== 'circle') {
						out.shape = v.shape;
					}
					return out;
				});

			if (initial?.type === 'spectrum') {
				return {
					...initial,
					name,
					description: description || undefined,
					modified_at: now,
					schema_version: SCHEMA_VERSION,
					schema: spectrumSchema,
					customization: {
						...initial.customization,
						theme: { ...initial.customization.theme, palette: colors },
						title: { show: true, text: name },
						...(validViews.length > 0 ? { views: validViews } : { views: undefined })
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
				schema: spectrumSchema,
				customization: {
					theme: { palette: colors },
					title: { show: true, text: name },
					...(validViews.length > 0 ? { views: validViews } : {})
				},
				datapoints: []
			} satisfies SpectrumGraph;
		}

		if (type === 'pronouns') {
			// Unlabeled rows are the editor's blank "+ add" state, not data.
			const validLevels = levels
				.filter((l) => l.label.trim() !== '')
				.map((l) => ({ ...l, label: l.label.trim() }));
			const validGroups = termGroups
				.filter((g) => g.label.trim() !== '')
				.map((g) => ({ ...g, label: g.label.trim() }));
			// A card with no scale can't classify anything, so fall back to the
			// defaults rather than persisting an unusable schema.
			const schema = {
				levels: validLevels.length > 0 ? validLevels : DEFAULT_LEVELS.map((l) => ({ ...l })),
				term_groups: validGroups
			};
			const trimmedName = displayName.trim();

			if (initial?.type === 'pronouns') {
				return {
					...initial,
					name,
					description: description || undefined,
					modified_at: now,
					schema_version: SCHEMA_VERSION,
					schema,
					...(trimmedName ? { display_name: trimmedName } : { display_name: undefined }),
					customization: {
						...initial.customization,
						theme: { ...initial.customization.theme, palette: colors },
						title: { show: true, text: name },
						layout: pronounsLayout,
						show_examples: showExamples
					}
				} satisfies PronounsGraph;
			}

			return {
				id: generateGraphId(),
				type: 'pronouns',
				name,
				description: description || undefined,
				created_at: now,
				modified_at: now,
				schema_version: SCHEMA_VERSION,
				owner: '@local:queer-curves',
				editors: [],
				schema,
				...(trimmedName ? { display_name: trimmedName } : {}),
				customization: {
					theme: { palette: colors },
					title: { show: true, text: name },
					layout: pronounsLayout,
					show_examples: showExamples
				},
				pronouns: [],
				terms: []
			} satisfies PronounsGraph;
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
			<label class="radio">
				<input type="radio" bind:group={type} value="pronouns" />
				<span>
					<strong>Pronoun card</strong>
					<small>
						Pronouns and gender/address words, each rated on your own scale — a card you can share.
					</small>
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
				<label class="radio compact">
					<input type="radio" bind:group={dimensions} value={3} />
					<span
						><strong>3D</strong> <small>third axis encoded as colour on the 2D plane</small></span
					>
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
							<input type="number" step="any" bind:value={axis.range[0]} />
						</label>
						<label class="field">
							<span class="label">Range max</span>
							<input type="number" step="any" bind:value={axis.range[1]} />
						</label>
					</div>
					{#if axis.range[0] < 0 && axis.range[1] > 0}
						<label class="field">
							<span class="label">
								Zero label <small>(optional — names the neutral midpoint)</small>
							</span>
							<input type="text" bind:value={axis.zero_label} placeholder="e.g. neutral, none" />
						</label>
					{/if}
					<div class="waypoints">
						<div class="waypoints-header">
							<span class="label">Waypoints</span>
							<button type="button" class="ghost" onclick={() => addWaypoint(i)}> + add </button>
						</div>
						{#each axis.waypoints ?? [] as wp, wpIdx (wpIdx)}
							<div class="waypoint-row">
								<input
									type="number"
									step="any"
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

		{#if dimensions !== 3}
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
			<p class="hint">
				Regions in 3D are deferred — for v1, use point waypoints or per-datapoint colors to annotate
				the colour-ramped scatter.
			</p>
		{/if}

		{#if dimensions >= 2}
			<fieldset class="point-waypoints-fieldset">
				<legend>{dimensions}D waypoints</legend>
				<p class="hint">
					Labelled landmarks at a specific
					{#if dimensions === 2}(x, y) — e.g. "gendervoid" at (0.2, 0.3).
					{:else}(x, y, z) — colour-tinted by the third axis on the 3D scatter.
					{/if}
					Drawn as crosses on the chart to stay distinct from datapoints.
				</p>
				{#each pointWaypoints as pw, i (pw.id)}
					<div class="pwp-row" class:pwp-row-3d={dimensions === 3}>
						<input
							type="text"
							bind:value={pw.label}
							placeholder="label (e.g. gendervoid)"
							maxlength="60"
							class="pwp-label"
						/>
						<input
							type="number"
							step="any"
							bind:value={pw.coordinates[0]}
							placeholder={axes[0]?.name ?? 'x'}
							class="pwp-coord"
							aria-label="{axes[0]?.name ?? 'x'} coordinate"
						/>
						<input
							type="number"
							step="any"
							bind:value={pw.coordinates[1]}
							placeholder={axes[1]?.name ?? 'y'}
							class="pwp-coord"
							aria-label="{axes[1]?.name ?? 'y'} coordinate"
						/>
						{#if dimensions === 3}
							<input
								type="number"
								step="any"
								bind:value={pw.coordinates[2]}
								placeholder={axes[2]?.name ?? 'z'}
								class="pwp-coord"
								aria-label="{axes[2]?.name ?? 'z'} coordinate"
							/>
						{/if}
						<ColorPickerWithPalette
							bind:value={pointWaypoints[i].color}
							paletteColors={selectedPalette.colors}
							ariaLabel="waypoint colour"
						/>
						<button
							type="button"
							class="ghost remove"
							onclick={() => removePointWaypoint(i)}
							aria-label="remove waypoint"
						>
							×
						</button>
					</div>
				{/each}
				<button type="button" class="ghost" onclick={addPointWaypoint}>+ add waypoint</button>
			</fieldset>
		{/if}

		{#if dimensions >= 2}
			<fieldset class="views-fieldset">
				<legend>Views <small>(optional)</small></legend>
				<p class="hint">
					Custom views appear in the chart's view selector alongside the built-in presets — pick a
					layout and assign each axis (or time) to x, y, and optionally colour.
				</p>
				{#each customViews as v, i (v.id)}
					<div class="view-row">
						<input
							type="text"
							class="view-name"
							bind:value={v.name}
							placeholder="view name"
							maxlength="40"
						/>
						<select
							class="view-layout"
							value={v.layout}
							onchange={(e) => {
								const next = (e.currentTarget as HTMLSelectElement).value;
								if (next === 'cartesian' || next === 'radial' || next === 'polar') {
									v.layout = next;
								}
							}}
						>
							<option value="cartesian">Cartesian</option>
							<option value="radial">Radial (overlay)</option>
							<option value="polar">Polar (warped)</option>
						</select>
						{#if v.layout === 'radial' || v.layout === 'polar'}
							<select
								class="view-layout"
								title="frame / overlay shape"
								value={v.shape ?? 'circle'}
								onchange={(e) => {
									const next = (e.currentTarget as HTMLSelectElement).value;
									v.shape = next === 'pie' ? 'pie' : 'circle';
								}}
							>
								<option value="circle">Circle</option>
								<option value="pie">Pie</option>
							</select>
						{/if}
						<label class="view-channel">
							<span class="muted">{v.layout === 'polar' ? 'length' : 'x'}</span>
							<select
								value={refToCode(v.x)}
								onchange={(e) => {
									const r = codeToRef((e.currentTarget as HTMLSelectElement).value);
									if (r !== undefined) v.x = r;
								}}
							>
								{#each Array(dimensions) as _, axIdx (axIdx)}
									<option value={`axis-${axIdx}`}>{axes[axIdx]?.name || `axis ${axIdx + 1}`}</option
									>
								{/each}
								<option value="time">time</option>
							</select>
							<input
								type="text"
								class="view-label"
								bind:value={v.x_label}
								placeholder="label"
								maxlength="32"
								title="optional override for the x / length channel name"
							/>
						</label>
						<label class="view-channel">
							<span class="muted">{v.layout === 'polar' ? 'angle' : 'y'}</span>
							<select
								value={refToCode(v.y)}
								onchange={(e) => {
									const r = codeToRef((e.currentTarget as HTMLSelectElement).value);
									if (r !== undefined) v.y = r;
								}}
							>
								{#each Array(dimensions) as _, axIdx (axIdx)}
									<option value={`axis-${axIdx}`}>{axes[axIdx]?.name || `axis ${axIdx + 1}`}</option
									>
								{/each}
								<option value="time">time</option>
							</select>
							<input
								type="text"
								class="view-label"
								bind:value={v.y_label}
								placeholder="label"
								maxlength="32"
								title="optional override for the y / angle channel name"
							/>
						</label>
						<label class="view-channel">
							<span class="muted">colour</span>
							<select
								value={refToCode(v.color)}
								onchange={(e) => {
									v.color = codeToRef((e.currentTarget as HTMLSelectElement).value);
								}}
							>
								<option value="none">(none)</option>
								{#each Array(dimensions) as _, axIdx (axIdx)}
									<option value={`axis-${axIdx}`}>{axes[axIdx]?.name || `axis ${axIdx + 1}`}</option
									>
								{/each}
								<option value="time">time</option>
							</select>
						</label>
						<button
							type="button"
							class="ghost remove"
							onclick={() => removeCustomView(i)}
							aria-label="remove view"
						>
							×
						</button>
					</div>
				{/each}
				<button type="button" class="ghost" onclick={addCustomView}>+ add view</button>
			</fieldset>
		{/if}
	{:else if type === 'pronouns'}
		<label class="field">
			<span class="label">
				Name to use in examples <small>(optional)</small>
			</span>
			<input type="text" bind:value={displayName} placeholder="Ada" maxlength="60" />
			<small class="hint">
				Used in generated example sentences. Leave empty to keep the card name-free.
			</small>
		</label>

		<fieldset>
			<legend>Preference scale</legend>
			<p class="hint">
				The steps you'll sort pronouns and words into, strongest first. Yours to name — the defaults
				follow the scale pronoun cards usually use.
			</p>
			{#each levels as level, i (level.id)}
				<div class="level-row">
					<input type="text" bind:value={level.label} placeholder="favourite" maxlength="40" />
					<input
						type="text"
						bind:value={level.description}
						placeholder="description (optional)"
						maxlength="120"
					/>
					<ColorPickerWithPalette
						bind:value={levels[i].color}
						paletteColors={selectedPalette.colors}
						ariaLabel="level colour"
					/>
					{#if levels.length > 1}
						<button
							type="button"
							class="ghost remove"
							onclick={() => removeLevel(i)}
							aria-label="remove level">×</button
						>
					{/if}
				</div>
			{/each}
			<button type="button" class="ghost" onclick={addLevel}>+ add level</button>
		</fieldset>

		<fieldset>
			<legend>Word groups</legend>
			<p class="hint">
				Sections for the non-pronoun words on the card — identity words, ways to address you,
				relationship words. Remove any you don't want.
			</p>
			{#each termGroups as group, i (group.id)}
				<div class="group-row">
					<input type="text" bind:value={group.label} placeholder="identity words" maxlength="40" />
					<input
						type="text"
						bind:value={group.description}
						placeholder="description (optional)"
						maxlength="120"
					/>
					<button
						type="button"
						class="ghost remove"
						onclick={() => removeTermGroup(i)}
						aria-label="remove group">×</button
					>
				</div>
			{/each}
			<button type="button" class="ghost" onclick={addTermGroup}>+ add group</button>
		</fieldset>

		<fieldset>
			<legend>Card display</legend>
			<label class="radio compact">
				<input type="radio" bind:group={pronounsLayout} value="level" />
				<span><strong>Grouped</strong> <small>one section per preference level</small></span>
			</label>
			<label class="radio compact">
				<input type="radio" bind:group={pronounsLayout} value="flat" />
				<span><strong>Flat</strong> <small>authored order, level shown per entry</small></span>
			</label>
			<label class="checkfield">
				<input type="checkbox" bind:checked={showExamples} />
				<span>
					Show example sentences
					<small>— generated from each set's forms, e.g. "They go to the parade every year."</small>
				</span>
			</label>
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

	.level-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto auto;
		gap: var(--space-2);
		align-items: center;
	}
	.group-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto;
		gap: var(--space-2);
		align-items: center;
	}
	.level-row input[type='text'],
	.group-row input[type='text'] {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.level-row input[type='text']:focus,
	.group-row input[type='text']:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.checkfield {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		padding: var(--space-2);
	}
	.checkfield small {
		color: var(--color-muted);
	}

	.pwp-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 90px 90px auto auto;
		gap: var(--space-2);
		align-items: center;
	}
	.pwp-row.pwp-row-3d {
		grid-template-columns: minmax(0, 1fr) 80px 80px 80px auto auto;
	}

	.view-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		padding: var(--space-2);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
	}
	.view-row .view-name {
		flex: 1 1 140px;
		min-width: 100px;
	}
	.view-row .view-layout {
		flex: 0 0 auto;
	}
	.view-row .view-name,
	.view-row .view-layout,
	.view-row .view-channel input.view-label,
	.view-row .view-channel select {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.view-channel {
		display: inline-flex;
		gap: var(--space-1);
		align-items: center;
		font-size: 0.85em;
	}
	.view-channel .muted {
		color: var(--color-muted);
		min-width: 12px;
	}
	.view-channel input.view-label {
		width: 90px;
	}
	.pwp-row input {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.pwp-row input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.pwp-coord {
		width: 100%;
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
