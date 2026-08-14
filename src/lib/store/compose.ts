// Composing several graphs into one.
//
// Two features share this core:
//
//   * **Merge** — the user picks N graphs and gets a brand new, persisted
//     graph containing all of their data. Non-destructive: the sources are
//     never modified or deleted.
//   * **Collections** (multi-graph views) — a saved list of graph ids that is
//     composed *live* on every open into a throwaway graph, which is then
//     handed to the ordinary renderers. Nothing is duplicated on disk; the
//     member graphs stay independently editable and independently shared.
//
// Composition is a pure function of its inputs. Ids and timestamps are
// passed in rather than generated here so the result is deterministic and
// testable, and so the Matrix path can substitute a room id.
//
// Provenance is preserved *inside the model* rather than in a side table:
// composed spectrum datapoints get a `from:<name>` tag and composed network
// nodes/edges keep the first source's fields. That keeps a merged graph a
// perfectly ordinary v1 graph — no schema bump, importable by any client
// that can read the sources (data_model.md §8).

import {
	type Axis,
	type AxisWaypoint,
	type EdgeType,
	type Graph,
	type NetworkEdge,
	type NetworkGraph,
	type NetworkNode,
	type PointWaypoint,
	type Region,
	SCHEMA_VERSION,
	type SpectrumDatapoint,
	type SpectrumGraph,
	type SpectrumView,
	type Timestamp,
	type UserRef
} from '$lib/types.js';

/** One input to a composition, with the presentation overrides it carries. */
export interface ComposeSource {
	graph: Graph;
	/**
	 * Colour to tint this source's datapoints/nodes with when
	 * `colorBySource` is on. Collections assign these from the palette so
	 * every member is distinguishable in a combined view.
	 */
	color?: string;
	/** Display name override; defaults to the graph's own name. */
	label?: string;
}

export interface ComposeOptions {
	/** Id for the result. Callers pass a fresh local id, or a room id. */
	id: string;
	name: string;
	owner: UserRef;
	description?: string;
	/** ISO timestamp used for created_at/modified_at. */
	now: Timestamp;
	/**
	 * Override each datapoint/node colour with its source's colour. On for
	 * collection views (the colour *is* the legend); off for merges, where
	 * the user is making one graph and per-point colours would freeze the
	 * seam into the data.
	 */
	colorBySource?: boolean;
	/**
	 * Tag each spectrum datapoint with `from:<source label>`. Defaults to
	 * true whenever there is more than one source.
	 */
	tagSource?: boolean;
}

export type IssueLevel = 'error' | 'warning';

/**
 * Machine-readable reason, so callers can react to a specific problem
 * without matching on prose. Collections use this to downgrade
 * `dimension-mismatch` from an error to a warning: members with different
 * axis counts can't share the *combined* mode, but they plot fine in the
 * custom-axes mode, which reads named axes (crossplot.ts).
 */
export type IssueCode =
	| 'empty'
	| 'type-mismatch'
	| 'unsupported-type'
	| 'dimension-mismatch'
	| 'axis-name-mismatch'
	| 'axis-pole-mismatch'
	| 'axis-range-mismatch'
	| 'foreign-owner'
	| 'edge-type-conflict';

export interface ComposeIssue {
	level: IssueLevel;
	code: IssueCode;
	message: string;
}

// ─── Compatibility ──────────────────────────────────────────────────────────

/**
 * What would go wrong (or merely be lossy) if these graphs were composed.
 * `error` entries make composition impossible and must block the UI;
 * `warning` entries are things the user should see before committing but
 * that compose handles on its own.
 *
 * Callers should surface every issue — silently reconciling mismatched axes
 * is exactly the kind of quiet data mangling that makes a merge untrustworthy.
 */
export function checkComposable(sources: ComposeSource[], viewer?: UserRef): ComposeIssue[] {
	const issues: ComposeIssue[] = [];
	if (sources.length === 0) {
		issues.push({ level: 'error', code: 'empty', message: 'Pick at least one graph.' });
		return issues;
	}

	const types = new Set(sources.map((s) => s.graph.type));
	if (types.size > 1) {
		issues.push({
			level: 'error',
			code: 'type-mismatch',
			message: `These graphs are different kinds (${[...types].sort().join(', ')}) — they have nothing in common to plot. Pick graphs of one kind.`
		});
		return issues;
	}

	// Pronoun cards are deliberately not composable yet. Their preference
	// scale is per-graph and user-labeled precisely so our vocabulary stays
	// out of the user's mouth (data_model.md §13 decision 7), and combining
	// two cards would mean deciding that one card's "okay" is the same step
	// as another's "only if we're close". There is no answer to that which
	// isn't us inventing words for someone. Refusing is the honest option
	// until the user says how they want their own scales reconciled.
	if (sources.some((s) => s.graph.type === 'pronouns')) {
		issues.push({
			level: 'error',
			code: 'unsupported-type',
			message:
				"Pronoun cards can't be combined yet. Each card has its own preference scale in its own words, and merging them would mean guessing that one card's levels mean the same as another's."
		});
		return issues;
	}

	// Composing graphs you don't own copies someone else's data into a graph
	// you control and could then share onward. That's a sharing decision the
	// source's owner never made, so it must be visible, not implicit
	// (THREATS.md §7 — default to least sharing, honest disclosure).
	if (viewer) {
		const foreign = sources.filter((s) => s.graph.owner && s.graph.owner !== viewer);
		if (foreign.length > 0) {
			const names = foreign.map((s) => `"${s.graph.name}"`).join(', ');
			issues.push({
				level: 'warning',
				code: 'foreign-owner',
				message: `${names} ${foreign.length === 1 ? 'belongs' : 'belong'} to someone else. The result is a new graph owned by you — if you later share it, you are re-sharing their data under your own name. Only do this with their agreement.`
			});
		}
	}

	if (sources[0].graph.type === 'spectrum') {
		const spectra = sources.map((s) => s.graph as SpectrumGraph);
		const dims = new Set(spectra.map((g) => g.schema.dimensions));
		if (dims.size > 1) {
			issues.push({
				level: 'error',
				code: 'dimension-mismatch',
				message: `These graphs have different numbers of axes (${[...dims].sort().join(', ')}). Their coordinates aren't comparable, so they can't share a plot.`
			});
			return issues;
		}
		const base = spectra[0];
		for (const g of spectra.slice(1)) {
			base.schema.axes.forEach((axis, i) => {
				const other = g.schema.axes[i];
				if (!other) return;
				if (other.name !== axis.name) {
					issues.push({
						level: 'warning',
						code: 'axis-name-mismatch',
						message: `Axis ${i + 1} is called "${axis.name}" in "${base.name}" but "${other.name}" in "${g.name}". Points are combined by position, so this only makes sense if the axes mean the same thing.`
					});
				}
				if (other.min_label !== axis.min_label || other.max_label !== axis.max_label) {
					issues.push({
						level: 'warning',
						code: 'axis-pole-mismatch',
						message: `Axis ${i + 1} poles differ: "${axis.min_label}↔${axis.max_label}" in "${base.name}" vs "${other.min_label}↔${other.max_label}" in "${g.name}".`
					});
				}
				if (other.range[0] !== axis.range[0] || other.range[1] !== axis.range[1]) {
					issues.push({
						level: 'warning',
						code: 'axis-range-mismatch',
						message: `Axis ${i + 1} ranges differ ([${axis.range.join(', ')}] vs [${other.range.join(', ')}]). The combined axis widens to cover both, so positions keep their raw values and are not rescaled.`
					});
				}
			});
		}
		return issues;
	}

	// Network: the only structural hazard is two graphs using the same edge
	// type id for different relationships. (Pronoun cards returned above, so
	// everything reaching here is a network graph.)
	const networks = sources.map((s) => s.graph as NetworkGraph);
	const seen = new Map<string, { label: string; from: string }>();
	for (const g of networks) {
		for (const t of g.schema.edge_types) {
			const prev = seen.get(t.id);
			if (prev && prev.label !== t.label) {
				issues.push({
					level: 'warning',
					code: 'edge-type-conflict',
					message: `Edge type "${t.id}" means "${prev.label}" in "${prev.from}" but "${t.label}" in "${g.name}". The first definition wins; edges from the other graph will be relabelled.`
				});
			} else if (!prev) {
				seen.set(t.id, { label: t.label, from: g.name });
			}
		}
	}
	return issues;
}

export function canCompose(sources: ComposeSource[]): boolean {
	return !checkComposable(sources).some((i) => i.level === 'error');
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function sourceLabel(s: ComposeSource): string {
	return s.label ?? s.graph.name;
}

/**
 * Make `id` unique within `taken`, preferring the id unchanged. Only
 * colliding ids get rewritten, so composing a single graph is an identity
 * operation on its element ids and round-trips cleanly.
 */
function uniqueId(id: string, index: number, taken: Set<string>): string {
	if (!taken.has(id)) {
		taken.add(id);
		return id;
	}
	let candidate = `${id}~${index + 1}`;
	let n = 2;
	while (taken.has(candidate)) {
		candidate = `${id}~${index + 1}-${n++}`;
	}
	taken.add(candidate);
	return candidate;
}

function baseFields(opts: ComposeOptions) {
	return {
		id: opts.id,
		name: opts.name,
		description: opts.description,
		created_at: opts.now,
		modified_at: opts.now,
		schema_version: SCHEMA_VERSION,
		owner: opts.owner,
		editors: [] as UserRef[]
	};
}

// ─── Spectrum ───────────────────────────────────────────────────────────────

function mergeAxis(axes: Axis[]): Axis {
	// Names and labels come from the first graph — checkComposable has
	// already warned if they disagree. Ranges take the union so no source's
	// points fall outside the combined axis; coordinates are never rescaled,
	// because rescaling would silently change what a stored position means.
	const base = axes[0];
	const min = Math.min(...axes.map((a) => a.range[0]));
	const max = Math.max(...axes.map((a) => a.range[1]));
	const waypoints: AxisWaypoint[] = [];
	const seen = new Set<string>();
	for (const a of axes) {
		for (const w of a.waypoints ?? []) {
			const key = `${w.position}|${w.label}`;
			if (seen.has(key)) continue;
			seen.add(key);
			waypoints.push(w);
		}
	}
	return {
		...base,
		range: [min, max],
		waypoints: waypoints.length > 0 ? waypoints : undefined,
		zero_label: axes.find((a) => a.zero_label !== undefined)?.zero_label
	};
}

function composeSpectrum(sources: ComposeSource[], opts: ComposeOptions): SpectrumGraph {
	const graphs = sources.map((s) => s.graph as SpectrumGraph);
	const base = graphs[0];
	const tag = opts.tagSource ?? sources.length > 1;

	const axes = base.schema.axes.map((_, i) =>
		mergeAxis(graphs.map((g) => g.schema.axes[i]).filter((a): a is Axis => Boolean(a)))
	);

	const regionIds = new Set<string>();
	const regions: Region[] = [];
	const waypointIds = new Set<string>();
	const pointWaypoints: PointWaypoint[] = [];
	const viewIds = new Set<string>();
	const views: SpectrumView[] = [];
	const dpIds = new Set<string>();
	const dpKeys = new Set<string>();
	const datapoints: SpectrumDatapoint[] = [];

	sources.forEach((source, i) => {
		const g = source.graph as SpectrumGraph;
		const label = sourceLabel(source);

		for (const r of g.schema.regions) {
			regions.push({ ...r, id: uniqueId(r.id, i, regionIds) });
		}
		for (const w of g.schema.point_waypoints ?? []) {
			pointWaypoints.push({ ...w, id: uniqueId(w.id, i, waypointIds) });
		}
		for (const v of g.customization.views ?? []) {
			views.push({
				...v,
				id: uniqueId(v.id, i, viewIds),
				name: sources.length > 1 ? `${v.name} (${label})` : v.name
			});
		}
		for (const dp of g.datapoints) {
			// Identical points recorded in two sources (a graph merged twice,
			// or a copy that was forked) collapse into one — otherwise a
			// re-merge doubles every point.
			const key = `${dp.timestamp}|${dp.coordinates.join(',')}`;
			if (dpKeys.has(key)) continue;
			dpKeys.add(key);
			const tags = tag ? [...new Set([...(dp.tags ?? []), `from:${label}`])] : dp.tags;
			datapoints.push({
				...dp,
				id: uniqueId(dp.id, i, dpIds),
				tags,
				color: opts.colorBySource && source.color ? source.color : dp.color
			});
		}
	});

	datapoints.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

	return {
		...baseFields(opts),
		type: 'spectrum',
		schema: {
			dimensions: base.schema.dimensions,
			axes,
			regions,
			point_waypoints: pointWaypoints.length > 0 ? pointWaypoints : undefined
		},
		customization: {
			...base.customization,
			views: views.length > 0 ? views : undefined
		},
		datapoints
	};
}

// ─── Network ────────────────────────────────────────────────────────────────

/**
 * Two nodes are the same person if they name the same Matrix user; failing
 * that, if they carry the same label. Label matching is how the common case
 * works — two polycules drawn separately both have a "Bea" — and it is
 * case/whitespace-insensitive because those differences are typos, not
 * different people.
 */
function nodeKey(n: NetworkNode): string {
	if (n.subject_ref) return `ref:${n.subject_ref}`;
	return `label:${n.label.trim().toLowerCase()}`;
}

/**
 * Combine the consent state of two nodes for the same person. Deliberately
 * takes the *most restrictive* value: a merge must never manufacture consent
 * the person didn't give in the graph being merged in (THREATS.md §7, and
 * sharing_model.md §12's handshake). A denial anywhere wins outright.
 */
function mergeLinkStatus(
	a: NetworkNode['link_status'],
	b: NetworkNode['link_status']
): NetworkNode['link_status'] {
	if (a === 'denied' || b === 'denied') return 'denied';
	if (a === undefined) return b;
	if (b === undefined) return a;
	if (a === 'confirmed' && b === 'confirmed') return 'confirmed';
	return 'pending';
}

function composeNetwork(sources: ComposeSource[], opts: ComposeOptions): NetworkGraph {
	const base = sources[0].graph as NetworkGraph;

	const edgeTypes: EdgeType[] = [];
	const edgeTypeIds = new Set<string>();
	const nodes: NetworkNode[] = [];
	const nodeIds = new Set<string>();
	// person-key → id in the composed graph
	const nodeByKey = new Map<string, NetworkNode>();
	// (source index, original node id) → id in the composed graph
	const idRemap = new Map<string, string>();
	const edges: NetworkEdge[] = [];
	const edgeIds = new Set<string>();
	const edgeKeys = new Set<string>();

	sources.forEach((source, i) => {
		const g = source.graph as NetworkGraph;

		for (const t of g.schema.edge_types) {
			// First definition of an id wins — checkComposable warned if a
			// later graph disagrees about what it means.
			if (edgeTypeIds.has(t.id)) continue;
			edgeTypeIds.add(t.id);
			edgeTypes.push(t);
		}

		for (const n of g.nodes) {
			const key = nodeKey(n);
			const existing = nodeByKey.get(key);
			if (existing) {
				// Same person seen again: fill in anything the first
				// occurrence lacked, but never overwrite it.
				existing.color ??= n.color;
				existing.avatar_ref ??= n.avatar_ref;
				existing.position ??= n.position;
				if (n.subject_ref && !existing.subject_ref) existing.subject_ref = n.subject_ref;
				if (existing.subject_ref) {
					existing.link_status = mergeLinkStatus(existing.link_status, n.link_status);
				}
				idRemap.set(`${i}|${n.id}`, existing.id);
				continue;
			}
			const merged: NetworkNode = {
				...n,
				id: uniqueId(n.id, i, nodeIds),
				color: opts.colorBySource && source.color ? source.color : n.color
			};
			nodes.push(merged);
			nodeByKey.set(key, merged);
			idRemap.set(`${i}|${n.id}`, merged.id);
		}

		for (const e of g.edges) {
			const src = idRemap.get(`${i}|${e.source}`);
			const tgt = idRemap.get(`${i}|${e.target}`);
			// An edge whose endpoints aren't in the same graph is malformed;
			// drop it rather than emit a dangling reference the renderer
			// would choke on.
			if (!src || !tgt) continue;
			// Undirected edges are the same relationship whichever way they
			// were drawn, so normalise the endpoints before de-duplicating.
			const endpoints = e.directed ? [src, tgt] : [src, tgt].sort();
			const key = `${e.directed ? 'd' : 'u'}|${endpoints.join('|')}|${e.type_id}`;
			if (edgeKeys.has(key)) continue;
			edgeKeys.add(key);
			edges.push({ ...e, id: uniqueId(e.id, i, edgeIds), source: src, target: tgt });
		}
	});

	return {
		...baseFields(opts),
		type: 'network',
		schema: { edge_types: edgeTypes },
		customization: base.customization,
		nodes,
		edges
	};
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Compose several graphs into one. Throws if the sources are incompatible —
 * call `checkComposable` first and show the issues; this is the last line of
 * defence, not the user-facing check.
 */
export function composeGraphs(sources: ComposeSource[], opts: ComposeOptions): Graph {
	const errors = checkComposable(sources).filter((i) => i.level === 'error');
	if (errors.length > 0) {
		throw new Error(errors.map((e) => e.message).join(' '));
	}
	// checkComposable has already rejected mixed and unsupported types, so
	// the first source's type speaks for all of them.
	switch (sources[0].graph.type) {
		case 'spectrum':
			return composeSpectrum(sources, opts);
		case 'network':
			return composeNetwork(sources, opts);
		default:
			throw new Error(`Can't combine graphs of type "${sources[0].graph.type}".`);
	}
}
