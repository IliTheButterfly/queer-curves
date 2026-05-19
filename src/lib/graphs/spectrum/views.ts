// View presets and resolvers for spectrum graphs.
//
// A spectrum graph stores raw datapoints in axis space; views are how those
// points get projected onto the screen. When the user hasn't authored their
// own views (customization.views is empty/unset), we generate a small set of
// presets based on dimensionality so the dropdown always has useful options.

import type { AxisRef, SpectrumGraph, SpectrumView } from '$lib/types.js';

export function defaultViews(g: SpectrumGraph): SpectrumView[] {
	const d = g.schema.dimensions;
	const presets: SpectrumView[] = [];

	if (d === 1) {
		// 1D's natural rendering is a value-vs-time line plot — handled by
		// render1D directly. We expose it as a view for consistency, but no
		// alternatives are typically useful here.
		presets.push({
			id: 'preset-1d-default',
			name: 'Default',
			layout: 'cartesian',
			x: 'time',
			y: 0
		});
		return presets;
	}

	if (d === 2) {
		presets.push({
			id: 'preset-2d-cartesian',
			name: 'Cartesian',
			layout: 'cartesian',
			x: 0,
			y: 1
		});
		presets.push({
			id: 'preset-2d-side',
			name: 'Side (time × axis 2)',
			layout: 'cartesian',
			x: 'time',
			y: 1
		});
		// Time always lives on the x-axis (renderers swap if needed), so the
		// two "look along axis K" projections differ only in which spatial
		// axis remains visible on y.
		presets.push({
			id: 'preset-2d-top',
			name: 'Top (time × axis 1)',
			layout: 'cartesian',
			x: 'time',
			y: 0
		});
		presets.push({
			id: 'preset-2d-radial',
			name: 'Radial (length × angle overlay)',
			layout: 'radial',
			x: 0,
			y: 1
		});
		presets.push({
			id: 'preset-2d-polar',
			name: 'Polar (warped to length × angle)',
			layout: 'polar',
			x: 0,
			y: 1
		});
		return presets;
	}

	if (d === 3) {
		presets.push({
			id: 'preset-3d-cartesian',
			name: 'Cartesian (axes 1 × 2, colour 3)',
			layout: 'cartesian',
			x: 0,
			y: 1,
			color: 2
		});
		presets.push({
			id: 'preset-3d-axes-1-3',
			name: 'Axes 1 × 3, colour 2',
			layout: 'cartesian',
			x: 0,
			y: 2,
			color: 1
		});
		presets.push({
			id: 'preset-3d-axes-2-3',
			name: 'Axes 2 × 3, colour 1',
			layout: 'cartesian',
			x: 1,
			y: 2,
			color: 0
		});
		presets.push({
			id: 'preset-3d-time-side',
			name: 'Side (time × axis 1, colour 3)',
			layout: 'cartesian',
			x: 'time',
			y: 0,
			color: 2
		});
		presets.push({
			id: 'preset-3d-radial',
			name: 'Radial overlay (axes 1 × 2, colour 3)',
			layout: 'radial',
			x: 0,
			y: 1,
			color: 2
		});
		return presets;
	}

	return presets;
}

export function activeViews(g: SpectrumGraph): SpectrumView[] {
	// Presets are always available so adding a custom view doesn't suddenly
	// strip the dropdown of useful starting points. Custom views append at
	// the end of the list. (If a user really wants to hide a preset, they
	// can author a view that supersedes it visually — the preset still
	// shows in the dropdown but the user's named entry is the one they
	// pick by default.)
	const presets = defaultViews(g);
	const custom = g.customization.views ?? [];
	return [...presets, ...custom];
}

export function describeAxisRef(g: SpectrumGraph, ref: AxisRef): string {
	if (ref === 'time') return 'time';
	return g.schema.axes[ref]?.name ?? `axis ${ref + 1}`;
}
