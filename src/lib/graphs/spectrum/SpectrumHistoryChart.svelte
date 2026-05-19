<script lang="ts">
	import * as d3 from 'd3';
	import type {
		Axis,
		AxisRef,
		SpectrumDatapoint,
		SpectrumGraph,
		SpectrumView
	} from '$lib/types.js';
	import { buildColorRamp, type ColorRamp } from './colorRamp.js';
	import { activeViews } from './views.js';

	let { graph, view }: { graph: SpectrumGraph; view?: SpectrumView } = $props();

	let svgEl: SVGSVGElement;

	const resolvedView = $derived(view ?? activeViews(graph)[0]);

	const dims = $derived(computeDims(graph, resolvedView));

	function computeDims(g: SpectrumGraph, v: SpectrumView | undefined): { W: number; H: number } {
		if (g.schema.dimensions === 1) return { W: 800, H: 400 };
		if (!v) return { W: 660, H: 600 };
		// Polar layout (and radial+pie which routes through it) uses the
		// dedicated circular renderer. Cartesian and radial+circle use the
		// cartesian dims (radial+circle just adds an overlay).
		const usesPolar = v.layout === 'polar' || (v.layout === 'radial' && v.shape === 'pie');
		if (usesPolar) return { W: v.color !== undefined ? 760 : 600, H: 600 };
		return v.color !== undefined ? { W: 820, H: 600 } : { W: 660, H: 600 };
	}

	$effect(() => {
		if (!svgEl) return;
		render(svgEl, graph, resolvedView);
	});

	function render(el: SVGSVGElement, g: SpectrumGraph, v: SpectrumView | undefined) {
		const root = d3.select(el);
		root.selectAll('*').remove();

		if (g.schema.dimensions === 1) {
			render1D(root, g);
			return;
		}
		if (!v) {
			root
				.append('text')
				.attr('x', 16)
				.attr('y', 32)
				.attr('fill', 'var(--color-muted)')
				.text('no view selected');
			return;
		}
		// Time always reads more naturally on the x-axis (left-to-right is the
		// universal "later" convention), so swap any cartesian view whose
		// user/preset config put time on y. Affects rendering only — the
		// stored view config is unchanged.
		const view = normalizeView(v);
		// Hot path: when the active view is the natural cartesian one for this
		// dimensionality, use the dedicated render2D/render3D — they're tuned
		// for region/waypoint placement on the spatial axes. Anything else
		// (time projection, axis swap, radial) goes through the generic path.
		const isDefaultCartesian2D =
			g.schema.dimensions === 2 &&
			view.layout === 'cartesian' &&
			view.x === 0 &&
			view.y === 1 &&
			view.color === undefined;
		const isDefaultCartesian3D =
			g.schema.dimensions === 3 &&
			view.layout === 'cartesian' &&
			view.x === 0 &&
			view.y === 1 &&
			view.color === 2;
		// `radial + shape='pie'` is the polar-conversion-with-pie display: it
		// remaps points by length/angle and draws a pie-sector frame.
		// `radial + shape='circle'` is the cartesian-positions-with-overlay
		// display.
		const usesPolar = view.layout === 'polar' || (view.layout === 'radial' && view.shape === 'pie');
		if (isDefaultCartesian2D) render2D(root, g);
		else if (isDefaultCartesian3D) render3D(root, g);
		else if (usesPolar) renderPolarView(root, g, view);
		else if (view.layout === 'cartesian' || view.layout === 'radial')
			renderCartesianView(root, g, view);
	}

	function normalizeView(v: SpectrumView): SpectrumView {
		if (v.layout === 'cartesian' && v.y === 'time' && v.x !== 'time') {
			return { ...v, x: v.y, y: v.x };
		}
		return v;
	}

	// Per-point color: explicit override wins; otherwise cycle through the
	// palette by time-order index.
	function colorOf(g: SpectrumGraph, dp: SpectrumDatapoint, idx: number): string {
		if (dp.color) return dp.color;
		const palette = g.customization.theme.palette;
		if (!palette || palette.length === 0) return '#c98aff';
		return palette[idx % palette.length];
	}

	function clamp(v: number, lo: number, hi: number): number {
		return Math.max(lo, Math.min(hi, v));
	}

	// Tick values that always pin min and max and add zero whenever zero
	// falls within the range (defensively also if it equals one of the
	// bounds — Set deduping prevents a doubled label).
	function signedTickValues(min: number, max: number): number[] {
		const set = new Set<number>([min, max]);
		if (min <= 0 && max >= 0) set.add(0);
		return [...set].sort((a, b) => a - b);
	}

	// Resolve a view's AxisRef into the bits the renderers need: a numeric
	// domain, an extractor for datapoints, and (for non-time) the underlying
	// Axis with its labels. 'time' maps to the datapoints' timestamp extent.
	type ChannelResolution = {
		ref: AxisRef;
		isTime: boolean;
		axis?: Axis;
		// Numeric domain (timestamp millis for time axes).
		domain: [number, number];
		// For time axes only — the d3-friendly Date pair, used to build a
		// scaleTime with proper tick formatting.
		timeDomain?: [Date, Date];
		// Returns the value to use on a scale (Date for time, number otherwise).
		extract: (dp: SpectrumDatapoint) => number | Date;
		// Returns the numeric value (used by colour ramps which always work
		// in number space).
		extractNum: (dp: SpectrumDatapoint) => number;
		label: string;
	};

	function resolveChannel(
		ref: AxisRef,
		g: SpectrumGraph,
		points: SpectrumDatapoint[]
	): ChannelResolution {
		if (ref === 'time') {
			const extent = d3.extent(points, (p) => new Date(p.timestamp)) as [Date, Date];
			const lo = extent[0] ?? new Date();
			const hi = extent[1] ?? new Date();
			return {
				ref: 'time',
				isTime: true,
				domain: [lo.getTime(), hi.getTime()],
				timeDomain: [lo, hi],
				extract: (dp) => new Date(dp.timestamp),
				extractNum: (dp) => new Date(dp.timestamp).getTime(),
				label: 'time'
			};
		}
		const axis = g.schema.axes[ref];
		return {
			ref,
			isTime: false,
			axis,
			domain: axis.range,
			extract: (dp) => dp.coordinates[ref],
			extractNum: (dp) => dp.coordinates[ref],
			label: axis.name
		};
	}

	type Selection = d3.Selection<SVGSVGElement, unknown, null, undefined>;

	function render1D(root: Selection, g: SpectrumGraph) {
		const W = 800;
		const H = 400;
		// Wider left margin so numeric tick labels (close to axis) and
		// textual endpoint labels (further out) don't stack on each other,
		// and so longer pole labels (e.g. "non-binary", "genderqueer") fit
		// without clipping at the SVG edge.
		const M = { top: 20, right: 100, bottom: 40, left: 140 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const points = [...g.datapoints].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
		if (points.length === 0) {
			emptyMessage(inner, iw / 2, ih / 2);
			return;
		}

		const xExtent = d3.extent(points, (p) => new Date(p.timestamp)) as [Date, Date];
		const xScale = d3.scaleTime().domain(xExtent).range([0, iw]).nice();

		const axis = g.schema.axes[0];
		const yScale = d3.scaleLinear().domain(axis.range).range([ih, 0]);

		// Regions render under everything else.
		for (const r of g.schema.regions) {
			if (r.shape.type !== 'range') continue;
			const top = yScale(r.shape.max);
			const bottom = yScale(r.shape.min);
			inner
				.append('rect')
				.attr('x', 0)
				.attr('y', top)
				.attr('width', iw)
				.attr('height', bottom - top)
				.attr('fill', r.color)
				.attr('opacity', r.opacity ?? 0.25);

			inner
				.append('text')
				.attr('x', iw - 6)
				.attr('y', (top + bottom) / 2)
				.attr('text-anchor', 'end')
				.attr('dominant-baseline', 'middle')
				.attr('font-size', 11)
				.attr('fill', 'var(--color-fg)')
				.attr('opacity', 0.7)
				.text(r.label);
		}

		for (const wp of axis.waypoints ?? []) {
			const y = yScale(wp.position);
			inner
				.append('line')
				.attr('x1', 0)
				.attr('x2', iw)
				.attr('y1', y)
				.attr('y2', y)
				.attr('stroke', wp.color ?? 'var(--color-muted)')
				.attr('stroke-dasharray', '3 5')
				.attr('opacity', 0.6);
			inner
				.append('text')
				.attr('x', iw + 6)
				.attr('y', y)
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 12)
				.text(wp.label);
		}

		// Endpoint labels on the y-axis — pushed past the numeric tick labels
		// so the textual pole names don't pile onto the numbers.
		inner
			.append('text')
			.attr('x', -36)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(axis.min_label);
		inner
			.append('text')
			.attr('x', -36)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(axis.max_label);
		// Optional textual name for the zero crossing — only when it sits
		// strictly inside the range and the user has named it.
		if (axis.zero_label && axis.range[0] < 0 && axis.range[1] > 0) {
			inner
				.append('text')
				.attr('x', -36)
				.attr('y', yScale(0))
				.attr('text-anchor', 'end')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(axis.zero_label);
		}

		// Time axis crosses at the value-zero line when 0 ∈ value range, so a
		// signed range like [-1, 1] reads naturally with the axis through the
		// middle. Falls back to clamping at top/bottom if 0 is outside range.
		const xAxisYpx = clamp(yScale(0), 0, ih);
		inner
			.append('g')
			.attr('transform', `translate(0,${xAxisYpx})`)
			.attr('color', 'var(--color-muted)')
			.call(d3.axisBottom(xScale).ticks(5).tickSizeOuter(0));

		// Y-axis ticks always include min and max; add zero when it's strictly
		// between them so signed ranges show a labeled crossing.
		const yTickVals = signedTickValues(axis.range[0], axis.range[1]);
		inner
			.append('g')
			.attr('color', 'var(--color-muted)')
			.call(d3.axisLeft(yScale).tickValues(yTickVals).tickSizeOuter(0));

		// Gradient trail: per-segment straight lines, each with a
		// linearGradient interpolating between its endpoints' colors.
		const defs1d = root.append('defs');
		const gradPrefix1d = `histgrad1d-${g.id}-`;
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i];
			const b = points[i + 1];
			const ax = xScale(new Date(a.timestamp));
			const ay = yScale(a.coordinates[0]);
			const bx = xScale(new Date(b.timestamp));
			const by = yScale(b.coordinates[0]);
			const id = `${gradPrefix1d}${i}`;
			const grad = defs1d
				.append('linearGradient')
				.attr('id', id)
				.attr('gradientUnits', 'userSpaceOnUse')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by);
			grad
				.append('stop')
				.attr('offset', '0%')
				.attr('stop-color', colorOf(g, a, i));
			grad
				.append('stop')
				.attr('offset', '100%')
				.attr('stop-color', colorOf(g, b, i + 1));
			inner
				.append('line')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by)
				.attr('stroke', `url(#${id})`)
				.attr('stroke-width', 2);
		}

		inner
			.selectAll<SVGCircleElement, SpectrumDatapoint>('circle.dp')
			.data(points)
			.join('circle')
			.attr('class', 'dp')
			.attr('cx', (p) => xScale(new Date(p.timestamp)))
			.attr('cy', (p) => yScale(p.coordinates[0]))
			.attr('r', 5)
			.attr('fill', (p, i) => colorOf(g, p, i))
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 2);
	}

	function render2D(root: Selection, g: SpectrumGraph) {
		const W = 660;
		const H = 600;
		// Generous bottom/left margins so numeric tick labels (close to the
		// axis) and textual endpoint labels (further out) can both breathe.
		// Longer pole labels (10+ chars) need ~140px of room to the left of
		// the plot.
		const M = { top: 24, right: 30, bottom: 80, left: 140 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const points = [...g.datapoints].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
		if (points.length === 0) {
			emptyMessage(inner, iw / 2, ih / 2);
			return;
		}

		const ax0 = g.schema.axes[0];
		const ax1 = g.schema.axes[1];
		const xScale = d3.scaleLinear().domain(ax0.range).range([0, iw]);
		const yScale = d3.scaleLinear().domain(ax1.range).range([ih, 0]);

		// Plot frame.
		inner
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'none')
			.attr('stroke', 'var(--color-muted)')
			.attr('opacity', 0.5);

		// Numeric axes at the value-zero crossing, drawn early so foreground
		// content (waypoints, datapoints, trail) renders on top and a
		// waypoint at (0, 0) isn't occluded by an axis tick.
		const xAxisYpx = clamp(yScale(0), 0, ih);
		const yAxisXpx = clamp(xScale(0), 0, iw);
		inner
			.append('g')
			.attr('class', 'numeric-axis')
			.attr('transform', `translate(0,${xAxisYpx})`)
			.attr('color', 'var(--color-muted)')
			.call(
				d3
					.axisBottom(xScale)
					.tickValues(signedTickValues(ax0.range[0], ax0.range[1]))
					.tickSizeOuter(0)
			);
		inner
			.append('g')
			.attr('class', 'numeric-axis')
			.attr('transform', `translate(${yAxisXpx},0)`)
			.attr('color', 'var(--color-muted)')
			.call(
				d3
					.axisLeft(yScale)
					.tickValues(signedTickValues(ax1.range[0], ax1.range[1]))
					.tickSizeOuter(0)
			);

		for (const r of g.schema.regions) {
			if (r.shape.type === 'box') {
				const [x0, y0] = r.shape.min;
				const [x1, y1] = r.shape.max;
				inner
					.append('rect')
					.attr('x', xScale(x0))
					.attr('y', yScale(y1))
					.attr('width', xScale(x1) - xScale(x0))
					.attr('height', yScale(y0) - yScale(y1))
					.attr('fill', r.color)
					.attr('opacity', r.opacity ?? 0.25);
			} else if (r.shape.type === 'polygon') {
				const d =
					'M ' + r.shape.vertices.map(([x, y]) => `${xScale(x)},${yScale(y)}`).join(' L ') + ' Z';
				inner
					.append('path')
					.attr('d', d)
					.attr('fill', r.color)
					.attr('opacity', r.opacity ?? 0.25);
			}
		}

		for (const wp of ax0.waypoints ?? []) {
			const x = xScale(wp.position);
			inner
				.append('line')
				.attr('x1', x)
				.attr('x2', x)
				.attr('y1', 0)
				.attr('y2', ih)
				.attr('stroke', wp.color ?? 'var(--color-muted)')
				.attr('stroke-dasharray', '3 5')
				.attr('opacity', 0.6);
			inner
				.append('text')
				.attr('x', x)
				.attr('y', -6)
				.attr('text-anchor', 'middle')
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 11)
				.text(wp.label);
		}
		for (const wp of ax1.waypoints ?? []) {
			const y = yScale(wp.position);
			inner
				.append('line')
				.attr('x1', 0)
				.attr('x2', iw)
				.attr('y1', y)
				.attr('y2', y)
				.attr('stroke', wp.color ?? 'var(--color-muted)')
				.attr('stroke-dasharray', '3 5')
				.attr('opacity', 0.6);
			inner
				.append('text')
				.attr('x', iw + 6)
				.attr('y', y)
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 11)
				.text(wp.label);
		}

		// Point-in-2D-space waypoints — drawn as crosses to stay visually
		// distinct from filled-circle datapoints.
		for (const pw of g.schema.point_waypoints ?? []) {
			if (pw.coordinates.length < 2) continue;
			const x = xScale(pw.coordinates[0]);
			const y = yScale(pw.coordinates[1]);
			const color = pw.color ?? 'var(--color-muted)';
			const r = 6;
			const marker = inner.append('g').attr('opacity', 0.85);
			marker
				.append('line')
				.attr('x1', x - r)
				.attr('x2', x + r)
				.attr('y1', y)
				.attr('y2', y)
				.attr('stroke', color)
				.attr('stroke-width', 1.5);
			marker
				.append('line')
				.attr('x1', x)
				.attr('x2', x)
				.attr('y1', y - r)
				.attr('y2', y + r)
				.attr('stroke', color)
				.attr('stroke-width', 1.5);
			marker
				.append('text')
				.attr('x', x + r + 4)
				.attr('y', y)
				.attr('dominant-baseline', 'middle')
				.attr('fill', color)
				.attr('font-size', 11)
				.text(pw.label);
		}

		// Axis-endpoint labels — pushed clearly past the numeric tick labels
		// so they read as separate "name" annotations, not stacked on top of
		// the numbers.
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', ih + 38)
			.attr('text-anchor', 'start')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax0.min_label);
		inner
			.append('text')
			.attr('x', iw)
			.attr('y', ih + 38)
			.attr('text-anchor', 'end')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax0.max_label);
		if (ax0.zero_label && ax0.range[0] < 0 && ax0.range[1] > 0) {
			inner
				.append('text')
				.attr('x', xScale(0))
				.attr('y', ih + 38)
				.attr('text-anchor', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(ax0.zero_label);
		}
		inner
			.append('text')
			.attr('x', -36)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax1.min_label);
		inner
			.append('text')
			.attr('x', -36)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax1.max_label);
		if (ax1.zero_label && ax1.range[0] < 0 && ax1.range[1] > 0) {
			inner
				.append('text')
				.attr('x', -36)
				.attr('y', yScale(0))
				.attr('text-anchor', 'end')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(ax1.zero_label);
		}

		// Axis names along their respective edges, furthest out.
		inner
			.append('text')
			.attr('x', iw / 2)
			.attr('y', ih + 60)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text(ax0.name);
		inner
			.append('text')
			.attr('transform', `translate(-64, ${ih / 2}) rotate(-90)`)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text(ax1.name);

		// Trajectory trail in time order — per-segment straight lines, each
		// with a linearGradient fading between its endpoints' colors.
		const defs2d = root.append('defs');
		const gradPrefix2d = `histgrad2d-${g.id}-`;
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i];
			const b = points[i + 1];
			const ax = xScale(a.coordinates[0]);
			const ay = yScale(a.coordinates[1]);
			const bx = xScale(b.coordinates[0]);
			const by = yScale(b.coordinates[1]);
			const id = `${gradPrefix2d}${i}`;
			const grad = defs2d
				.append('linearGradient')
				.attr('id', id)
				.attr('gradientUnits', 'userSpaceOnUse')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by);
			grad
				.append('stop')
				.attr('offset', '0%')
				.attr('stop-color', colorOf(g, a, i));
			grad
				.append('stop')
				.attr('offset', '100%')
				.attr('stop-color', colorOf(g, b, i + 1));
			inner
				.append('line')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by)
				.attr('stroke', `url(#${id})`)
				.attr('stroke-width', 1.5)
				.attr('opacity', 0.5);
		}

		// Datapoint cloud — older points dimmer, latest emphasized.
		const lastIdx = points.length - 1;
		inner
			.selectAll<SVGCircleElement, SpectrumDatapoint>('circle.dp')
			.data(points)
			.join('circle')
			.attr('class', 'dp')
			.attr('cx', (p) => xScale(p.coordinates[0]))
			.attr('cy', (p) => yScale(p.coordinates[1]))
			.attr('r', (_, i) => (i === lastIdx ? 7 : 4))
			.attr('fill', (p, i) => colorOf(g, p, i))
			.attr('opacity', (_, i) => 0.35 + 0.65 * (i / Math.max(1, lastIdx)))
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 2);
	}

	// 3D = 2D scatter where the third axis is encoded as color via a ramp
	// derived from the graph's palette. A colour-bar legend on the right
	// labels the ramp's min/zero/max so the value-color mapping is readable.
	function render3D(root: Selection, g: SpectrumGraph) {
		const W = 820;
		const H = 600;
		// Wide right margin makes room for the colour-bar legend (gradient +
		// numeric ticks + textual pole labels + rotated axis name); left is
		// generous for long pole labels on the y-axis.
		const M = { top: 24, right: 200, bottom: 80, left: 140 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const points = [...g.datapoints].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
		const ax0 = g.schema.axes[0];
		const ax1 = g.schema.axes[1];
		const ax2 = g.schema.axes[2];
		const xScale = d3.scaleLinear().domain(ax0.range).range([0, iw]);
		const yScale = d3.scaleLinear().domain(ax1.range).range([ih, 0]);
		const ramp = buildColorRamp(g.customization.theme.palette, ax2.range);

		// Plot frame (drawn even when empty so the empty-state message has
		// context, and so the colour-bar legend doesn't float alone).
		inner
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'none')
			.attr('stroke', 'var(--color-muted)')
			.attr('opacity', 0.5);

		// Numeric axes through zero, drawn early so foreground content sits on
		// top.
		const xAxisYpx = clamp(yScale(0), 0, ih);
		const yAxisXpx = clamp(xScale(0), 0, iw);
		inner
			.append('g')
			.attr('transform', `translate(0,${xAxisYpx})`)
			.attr('color', 'var(--color-muted)')
			.call(
				d3
					.axisBottom(xScale)
					.tickValues(signedTickValues(ax0.range[0], ax0.range[1]))
					.tickSizeOuter(0)
			);
		inner
			.append('g')
			.attr('transform', `translate(${yAxisXpx},0)`)
			.attr('color', 'var(--color-muted)')
			.call(
				d3
					.axisLeft(yScale)
					.tickValues(signedTickValues(ax1.range[0], ax1.range[1]))
					.tickSizeOuter(0)
			);

		// Endpoint + zero textual labels — same layout as render2D.
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', ih + 38)
			.attr('text-anchor', 'start')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax0.min_label);
		inner
			.append('text')
			.attr('x', iw)
			.attr('y', ih + 38)
			.attr('text-anchor', 'end')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax0.max_label);
		if (ax0.zero_label && ax0.range[0] < 0 && ax0.range[1] > 0) {
			inner
				.append('text')
				.attr('x', xScale(0))
				.attr('y', ih + 38)
				.attr('text-anchor', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(ax0.zero_label);
		}
		inner
			.append('text')
			.attr('x', -36)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax1.min_label);
		inner
			.append('text')
			.attr('x', -36)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax1.max_label);
		if (ax1.zero_label && ax1.range[0] < 0 && ax1.range[1] > 0) {
			inner
				.append('text')
				.attr('x', -36)
				.attr('y', yScale(0))
				.attr('text-anchor', 'end')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(ax1.zero_label);
		}

		// Axis names along their respective edges.
		inner
			.append('text')
			.attr('x', iw / 2)
			.attr('y', ih + 60)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text(ax0.name);
		inner
			.append('text')
			.attr('transform', `translate(-64, ${ih / 2}) rotate(-90)`)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text(ax1.name);

		// Color-bar legend for axis 2.
		drawColorBar(root, ramp, ax2, { x: M.left + iw + 30, y: M.top, height: ih });

		if (points.length === 0) {
			emptyMessage(inner, iw / 2, ih / 2);
			return;
		}

		// Per-point color: explicit override > ramp(axis2). Trails interpolate
		// between adjacent points' colours via per-segment linearGradient.
		const dpColor = (dp: SpectrumDatapoint) =>
			dp.color ?? ramp(dp.coordinates[2] ?? ramp.domain[0]);

		const defs = root.append('defs');
		const gradPrefix = `histgrad3d-${g.id}-`;
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i];
			const b = points[i + 1];
			const ax = xScale(a.coordinates[0]);
			const ay = yScale(a.coordinates[1]);
			const bx = xScale(b.coordinates[0]);
			const by = yScale(b.coordinates[1]);
			const id = `${gradPrefix}${i}`;
			const grad = defs
				.append('linearGradient')
				.attr('id', id)
				.attr('gradientUnits', 'userSpaceOnUse')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by);
			grad.append('stop').attr('offset', '0%').attr('stop-color', dpColor(a));
			grad.append('stop').attr('offset', '100%').attr('stop-color', dpColor(b));
			inner
				.append('line')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by)
				.attr('stroke', `url(#${id})`)
				.attr('stroke-width', 1.5)
				.attr('opacity', 0.5);
		}

		const lastIdx = points.length - 1;
		inner
			.selectAll<SVGCircleElement, SpectrumDatapoint>('circle.dp')
			.data(points)
			.join('circle')
			.attr('class', 'dp')
			.attr('cx', (p) => xScale(p.coordinates[0]))
			.attr('cy', (p) => yScale(p.coordinates[1]))
			.attr('r', (_, i) => (i === lastIdx ? 7 : 4))
			.attr('fill', (p) => dpColor(p))
			.attr('opacity', (_, i) => 0.45 + 0.55 * (i / Math.max(1, lastIdx)))
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 2);

		// Optional point waypoints, rendered as crosses with their stored
		// label. For 3D waypoints with a `coords[2]` value, the cross tints
		// to the same ramp colour the scatter would use at that position so
		// the landmark reads as part of the colour-axis space; an explicit
		// `pw.color` always wins.
		for (const pw of g.schema.point_waypoints ?? []) {
			if (pw.coordinates.length < 2) continue;
			const x = xScale(pw.coordinates[0]);
			const y = yScale(pw.coordinates[1]);
			const color =
				pw.color ?? (pw.coordinates.length >= 3 ? ramp(pw.coordinates[2]) : 'var(--color-muted)');
			const r = 6;
			const marker = inner.append('g').attr('opacity', 0.85);
			marker
				.append('line')
				.attr('x1', x - r)
				.attr('x2', x + r)
				.attr('y1', y)
				.attr('y2', y)
				.attr('stroke', color)
				.attr('stroke-width', 1.5);
			marker
				.append('line')
				.attr('x1', x)
				.attr('x2', x)
				.attr('y1', y - r)
				.attr('y2', y + r)
				.attr('stroke', color)
				.attr('stroke-width', 1.5);
			marker
				.append('text')
				.attr('x', x + r + 4)
				.attr('y', y)
				.attr('dominant-baseline', 'middle')
				.attr('fill', color)
				.attr('font-size', 11)
				.text(pw.label);
		}
	}

	// Generic cartesian renderer used for non-default views: time projections,
	// axis swaps on 3D, etc. The two natural-default views go through the
	// dedicated render2D/render3D, which know how to place regions and axis
	// waypoints in their original spatial layout.
	function renderCartesianView(root: Selection, g: SpectrumGraph, view: SpectrumView) {
		const hasColor = view.color !== undefined;
		const W = hasColor ? 820 : 660;
		const H = 600;
		const M = { top: 24, right: hasColor ? 200 : 30, bottom: 80, left: 140 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);
		const points = [...g.datapoints].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

		// Plot frame (drawn even when empty so the colour-bar legend has
		// context).
		inner
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'none')
			.attr('stroke', 'var(--color-muted)')
			.attr('opacity', 0.5);

		if (points.length === 0) {
			emptyMessage(inner, iw / 2, ih / 2);
			return;
		}

		const xCh = resolveChannel(view.x, g, points);
		const yCh = resolveChannel(view.y, g, points);

		const xScale = xCh.isTime
			? d3.scaleTime().domain(xCh.timeDomain!).range([0, iw]).nice()
			: d3.scaleLinear().domain(xCh.domain).range([0, iw]);
		const yScale = yCh.isTime
			? d3.scaleTime().domain(yCh.timeDomain!).range([ih, 0]).nice()
			: d3.scaleLinear().domain(yCh.domain).range([ih, 0]);

		// Numeric / time axes — for non-time, drawn through the value-zero
		// crossing (clamped to the chart edges); for time, anchored at
		// bottom/left since "time = 0" isn't meaningful.
		const xAxisYpx = yCh.isTime ? ih : clamp(yScale(0) as number, 0, ih);
		const yAxisXpx = xCh.isTime ? 0 : clamp(xScale(0) as number, 0, iw);

		const xAxisGen = xCh.isTime
			? d3
					.axisBottom(xScale as d3.ScaleTime<number, number>)
					.ticks(5)
					.tickSizeOuter(0)
			: d3
					.axisBottom(xScale as d3.ScaleLinear<number, number>)
					.tickValues(signedTickValues(xCh.domain[0], xCh.domain[1]))
					.tickSizeOuter(0);
		inner
			.append('g')
			.attr('transform', `translate(0,${xAxisYpx})`)
			.attr('color', 'var(--color-muted)')
			.call(xAxisGen as never);

		const yAxisGen = yCh.isTime
			? d3
					.axisLeft(yScale as d3.ScaleTime<number, number>)
					.ticks(5)
					.tickSizeOuter(0)
			: d3
					.axisLeft(yScale as d3.ScaleLinear<number, number>)
					.tickValues(signedTickValues(yCh.domain[0], yCh.domain[1]))
					.tickSizeOuter(0);
		inner
			.append('g')
			.attr('transform', `translate(${yAxisXpx},0)`)
			.attr('color', 'var(--color-muted)')
			.call(yAxisGen as never);

		// Endpoint textual labels for non-time axes (time axes get their own
		// formatted ticks). Match the offsets used by the default 2D/3D
		// renderers so layouts feel consistent.
		if (!xCh.isTime && xCh.axis) {
			inner
				.append('text')
				.attr('x', 0)
				.attr('y', ih + 38)
				.attr('text-anchor', 'start')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(xCh.axis.min_label);
			inner
				.append('text')
				.attr('x', iw)
				.attr('y', ih + 38)
				.attr('text-anchor', 'end')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(xCh.axis.max_label);
			if (xCh.axis.zero_label && xCh.axis.range[0] < 0 && xCh.axis.range[1] > 0) {
				inner
					.append('text')
					.attr('x', (xScale as d3.ScaleLinear<number, number>)(0))
					.attr('y', ih + 38)
					.attr('text-anchor', 'middle')
					.attr('fill', 'var(--color-fg)')
					.attr('font-weight', 'bold')
					.text(xCh.axis.zero_label);
			}
		}
		if (!yCh.isTime && yCh.axis) {
			inner
				.append('text')
				.attr('x', -36)
				.attr('y', ih)
				.attr('text-anchor', 'end')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(yCh.axis.min_label);
			inner
				.append('text')
				.attr('x', -36)
				.attr('y', 0)
				.attr('text-anchor', 'end')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(yCh.axis.max_label);
			if (yCh.axis.zero_label && yCh.axis.range[0] < 0 && yCh.axis.range[1] > 0) {
				inner
					.append('text')
					.attr('x', -36)
					.attr('y', (yScale as d3.ScaleLinear<number, number>)(0))
					.attr('text-anchor', 'end')
					.attr('dominant-baseline', 'middle')
					.attr('fill', 'var(--color-fg)')
					.attr('font-weight', 'bold')
					.text(yCh.axis.zero_label);
			}
		}

		// Channel names — view's overrides take precedence so a "Side"
		// projection can be relabelled e.g. "elapsed time" without renaming
		// the underlying datapoint timestamps.
		inner
			.append('text')
			.attr('x', iw / 2)
			.attr('y', ih + 60)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text(view.x_label ?? xCh.label);
		inner
			.append('text')
			.attr('transform', `translate(-64, ${ih / 2}) rotate(-90)`)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text(view.y_label ?? yCh.label);

		// Regions — only project when the view's spatial channels are exactly
		// {axis 0, axis 1}. Regions are stored against those two axes; views
		// that show a different pair (e.g. axis 0 × axis 2 in 3D) or that
		// involve the time channel can't place a region meaningfully.
		const regionXIdx = typeof view.x === 'number' && (view.x === 0 || view.x === 1) ? view.x : null;
		const regionYIdx = typeof view.y === 'number' && (view.y === 0 || view.y === 1) ? view.y : null;
		const regionsApplicable =
			regionXIdx !== null && regionYIdx !== null && regionXIdx !== regionYIdx;
		if (regionsApplicable) {
			for (const r of g.schema.regions) {
				if (r.shape.type === 'box') {
					const x0 = (xScale as d3.ScaleLinear<number, number>)(r.shape.min[regionXIdx!]);
					const x1 = (xScale as d3.ScaleLinear<number, number>)(r.shape.max[regionXIdx!]);
					const y0 = (yScale as d3.ScaleLinear<number, number>)(r.shape.min[regionYIdx!]);
					const y1 = (yScale as d3.ScaleLinear<number, number>)(r.shape.max[regionYIdx!]);
					inner
						.append('rect')
						.attr('x', Math.min(x0, x1))
						.attr('y', Math.min(y0, y1))
						.attr('width', Math.abs(x1 - x0))
						.attr('height', Math.abs(y1 - y0))
						.attr('fill', r.color)
						.attr('opacity', r.opacity ?? 0.25);
				} else if (r.shape.type === 'polygon') {
					const path =
						'M ' +
						r.shape.vertices
							.map(
								(v) =>
									`${(xScale as d3.ScaleLinear<number, number>)(v[regionXIdx!])},${(yScale as d3.ScaleLinear<number, number>)(v[regionYIdx!])}`
							)
							.join(' L ') +
						' Z';
					inner
						.append('path')
						.attr('d', path)
						.attr('fill', r.color)
						.attr('opacity', r.opacity ?? 0.25);
				}
			}
		}

		// Per-axis waypoints — render whichever map to a visual channel as
		// dashed guide lines. Time channels carry no waypoints, so they
		// silently produce nothing here.
		for (let ai = 0; ai < g.schema.axes.length; ai++) {
			const axisDef = g.schema.axes[ai];
			if (!axisDef.waypoints) continue;
			for (const wp of axisDef.waypoints) {
				if (view.x === ai && !xCh.isTime) {
					const px = (xScale as d3.ScaleLinear<number, number>)(wp.position);
					inner
						.append('line')
						.attr('x1', px)
						.attr('x2', px)
						.attr('y1', 0)
						.attr('y2', ih)
						.attr('stroke', wp.color ?? 'var(--color-muted)')
						.attr('stroke-dasharray', '3 5')
						.attr('opacity', 0.6);
					inner
						.append('text')
						.attr('x', px)
						.attr('y', -6)
						.attr('text-anchor', 'middle')
						.attr('fill', 'var(--color-muted)')
						.attr('font-size', 11)
						.text(wp.label);
				} else if (view.y === ai && !yCh.isTime) {
					const py = (yScale as d3.ScaleLinear<number, number>)(wp.position);
					inner
						.append('line')
						.attr('x1', 0)
						.attr('x2', iw)
						.attr('y1', py)
						.attr('y2', py)
						.attr('stroke', wp.color ?? 'var(--color-muted)')
						.attr('stroke-dasharray', '3 5')
						.attr('opacity', 0.6);
					inner
						.append('text')
						.attr('x', iw + 6)
						.attr('y', py)
						.attr('dominant-baseline', 'middle')
						.attr('fill', 'var(--color-muted)')
						.attr('font-size', 11)
						.text(wp.label);
				}
			}
		}

		// Point waypoints — landmarks at specific (axis 0, …) coordinates.
		// Skip when any spatial channel is time (no time component on the
		// waypoint itself); render at the channels' projected positions
		// otherwise.
		const pointWaypointsApplicable = typeof view.x === 'number' && typeof view.y === 'number';
		if (pointWaypointsApplicable) {
			for (const pw of g.schema.point_waypoints ?? []) {
				const cxv = pw.coordinates[view.x as number];
				const cyv = pw.coordinates[view.y as number];
				if (cxv === undefined || cyv === undefined) continue;
				const px = (xScale as d3.ScaleLinear<number, number>)(cxv);
				const py = (yScale as d3.ScaleLinear<number, number>)(cyv);
				const ramp2 =
					view.color !== undefined && typeof view.color === 'number'
						? buildColorRamp(g.customization.theme.palette, g.schema.axes[view.color].range)
						: undefined;
				const tint =
					pw.color ??
					(ramp2 && pw.coordinates[view.color as number] !== undefined
						? ramp2(pw.coordinates[view.color as number])
						: 'var(--color-muted)');
				const marker = inner.append('g').attr('opacity', 0.85);
				marker
					.append('line')
					.attr('x1', px - 6)
					.attr('x2', px + 6)
					.attr('y1', py)
					.attr('y2', py)
					.attr('stroke', tint)
					.attr('stroke-width', 1.5);
				marker
					.append('line')
					.attr('x1', px)
					.attr('x2', px)
					.attr('y1', py - 6)
					.attr('y2', py + 6)
					.attr('stroke', tint)
					.attr('stroke-width', 1.5);
				marker
					.append('text')
					.attr('x', px + 10)
					.attr('y', py)
					.attr('dominant-baseline', 'middle')
					.attr('fill', tint)
					.attr('font-size', 11)
					.text(pw.label);
			}
		}

		// Radial overlay — when the view's layout is 'radial', draw
		// concentric "length" ellipses centred at axis-zero plus angle
		// spokes through the same origin. Points stay at their cartesian
		// pixel positions; only the gridlines change. The overlay only
		// renders when both spatial channels are axis indices (not time)
		// and the centre projects to a real point in the plot.
		if (view.layout === 'radial' && !xCh.isTime && !yCh.isTime && xCh.axis && yCh.axis) {
			drawRadialOverlay(inner, {
				xScale: xScale as d3.ScaleLinear<number, number>,
				yScale: yScale as d3.ScaleLinear<number, number>,
				xRange: xCh.axis.range,
				yRange: yCh.axis.range,
				iw,
				ih,
				shape: view.shape ?? 'circle'
			});
		}

		// Optional colour ramp from view.color.
		let ramp: ColorRamp | undefined;
		let colorCh: ChannelResolution | undefined;
		if (view.color !== undefined) {
			colorCh = resolveChannel(view.color, g, points);
			ramp = buildColorRamp(g.customization.theme.palette, colorCh.domain);
			if (colorCh.axis) {
				drawColorBar(root, ramp, colorCh.axis, {
					x: M.left + iw + 30,
					y: M.top,
					height: ih
				});
			} else if (colorCh.isTime) {
				drawTimeColorBar(root, ramp, colorCh.timeDomain!, {
					x: M.left + iw + 30,
					y: M.top,
					height: ih
				});
			}
		}

		const dpColor = (dp: SpectrumDatapoint, idx: number): string => {
			if (dp.color) return dp.color;
			if (ramp && colorCh) return ramp(colorCh.extractNum(dp));
			return colorOf(g, dp, idx);
		};

		// Trail with per-segment linearGradient between adjacent points'
		// colours, same approach as render2D/render3D.
		const defs = root.append('defs');
		const gradPrefix = `viewgrad-${view.id}-`;
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i];
			const b = points[i + 1];
			const ax = xScale(xCh.extract(a) as never) as number;
			const ay = yScale(yCh.extract(a) as never) as number;
			const bx = xScale(xCh.extract(b) as never) as number;
			const by = yScale(yCh.extract(b) as never) as number;
			const id = `${gradPrefix}${i}`;
			const grad = defs
				.append('linearGradient')
				.attr('id', id)
				.attr('gradientUnits', 'userSpaceOnUse')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by);
			grad.append('stop').attr('offset', '0%').attr('stop-color', dpColor(a, i));
			grad
				.append('stop')
				.attr('offset', '100%')
				.attr('stop-color', dpColor(b, i + 1));
			inner
				.append('line')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by)
				.attr('stroke', `url(#${id})`)
				.attr('stroke-width', 1.5)
				.attr('opacity', 0.5);
		}

		const lastIdx = points.length - 1;
		inner
			.selectAll<SVGCircleElement, SpectrumDatapoint>('circle.dp')
			.data(points)
			.join('circle')
			.attr('class', 'dp')
			.attr('cx', (p) => xScale(xCh.extract(p) as never) as number)
			.attr('cy', (p) => yScale(yCh.extract(p) as never) as number)
			.attr('r', (_, i) => (i === lastIdx ? 7 : 4))
			.attr('fill', (p, i) => dpColor(p, i))
			.attr('opacity', (_, i) => 0.45 + 0.55 * (i / Math.max(1, lastIdx)))
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 2);
	}

	// Polar conversion: view.x and view.y are read as cartesian axes; each
	// datapoint's (cartesian) coords decompose into a magnitude (length) and
	// an angle, and the datapoint is REPLOTTED at the polar pixel position.
	// Click input does the inverse: pixel-polar → cartesian → axis coords.
	// So coordinates remain stored in axis space, but visual positions
	// differ from the cartesian view (different from `radial`, which keeps
	// cartesian positions and only changes the gridlines).
	function renderPolarView(root: Selection, g: SpectrumGraph, view: SpectrumView) {
		// Polar conversion needs both spatial channels to be axis indices.
		// 'time' would have no cartesian counterpart to combine with.
		if (typeof view.x !== 'number' || typeof view.y !== 'number') return;
		const xIdx = view.x;
		const yIdx = view.y;
		const xAxis = g.schema.axes[xIdx];
		const yAxis = g.schema.axes[yIdx];
		if (!xAxis || !yAxis) return;

		const hasColor = view.color !== undefined;
		const W = hasColor ? 760 : 600;
		const H = 600;
		const M = { top: 30, right: hasColor ? 180 : 30, bottom: 30, left: 30 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;
		const cxPx = iw / 2;
		const cyPx = ih / 2;
		const outerR = Math.min(iw, ih) / 2 - 30;

		// Maximum reachable magnitude given each axis's range. Used as the
		// magnitude scale's domain so a datapoint at the (max-x, max-y)
		// corner sits on the outer reference circle.
		const maxAbsX = Math.max(Math.abs(xAxis.range[0]), Math.abs(xAxis.range[1]));
		const maxAbsY = Math.max(Math.abs(yAxis.range[0]), Math.abs(yAxis.range[1]));
		const maxMag = Math.hypot(maxAbsX, maxAbsY) || 1;
		const magScale = d3.scaleLinear().domain([0, maxMag]).range([0, outerR]);

		const lengthLabel = view.x_label ?? `${xAxis.name} ⊕ ${yAxis.name}`;
		const angleLabel = view.y_label ?? `atan2(${yAxis.name}, ${xAxis.name})`;

		// Pie-frame: when shape='pie' AND the axis ranges don't span the
		// full circle, draw a wedge instead of the full disc. This focuses
		// the plot on just the angular range data can occupy.
		const span = view.shape === 'pie' ? computeAngularSpan(xAxis.range, yAxis.range) : null;
		const isPie = !!span && span.sweep < 2 * Math.PI - 1e-6;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);
		const points = [...g.datapoints].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

		// Outer frame — circle for the standard polar view, pie sector when
		// shape='pie' and the angular range is partial.
		if (isPie) {
			const θ1 = span!.start;
			const θ2 = span!.start + span!.sweep;
			const sx = cxPx + outerR * Math.cos(θ1);
			const sy = cyPx - outerR * Math.sin(θ1);
			const ex = cxPx + outerR * Math.cos(θ2);
			const ey = cyPx - outerR * Math.sin(θ2);
			const largeArc = span!.sweep > Math.PI ? 1 : 0;
			inner
				.append('path')
				.attr(
					'd',
					`M ${cxPx} ${cyPx} L ${sx} ${sy} A ${outerR} ${outerR} 0 ${largeArc} 1 ${ex} ${ey} Z`
				)
				.attr('fill', 'none')
				.attr('stroke', 'var(--color-muted)')
				.attr('opacity', 0.5);
		} else {
			inner
				.append('circle')
				.attr('cx', cxPx)
				.attr('cy', cyPx)
				.attr('r', outerR)
				.attr('fill', 'none')
				.attr('stroke', 'var(--color-muted)')
				.attr('opacity', 0.4);
		}

		// Cartesian (cx, cy) → screen (px, py) via polar conversion.
		function projectCartesian(cx: number, cy: number): [number, number] {
			const mag = Math.hypot(cx, cy);
			const θ = Math.atan2(cy, cx);
			const pixR = magScale(mag);
			return [cxPx + pixR * Math.cos(θ), cyPx - pixR * Math.sin(θ)];
		}

		// Concentric guide rings — full circles for the standard view, arc
		// segments for pie. The outer ring is the frame (already drawn) so
		// we only emit the half-magnitude one here.
		for (const m of [maxMag * 0.5]) {
			const rr = magScale(m);
			if (rr <= 0.5) continue;
			if (isPie) {
				const θ1 = span!.start;
				const θ2 = span!.start + span!.sweep;
				const sx = cxPx + rr * Math.cos(θ1);
				const sy = cyPx - rr * Math.sin(θ1);
				const ex = cxPx + rr * Math.cos(θ2);
				const ey = cyPx - rr * Math.sin(θ2);
				const largeArc = span!.sweep > Math.PI ? 1 : 0;
				inner
					.append('path')
					.attr('d', `M ${sx} ${sy} A ${rr} ${rr} 0 ${largeArc} 1 ${ex} ${ey}`)
					.attr('fill', 'none')
					.attr('stroke', 'var(--color-muted)')
					.attr('stroke-opacity', 0.25);
			} else {
				inner
					.append('circle')
					.attr('cx', cxPx)
					.attr('cy', cyPx)
					.attr('r', rr)
					.attr('fill', 'none')
					.attr('stroke', 'var(--color-muted)')
					.attr('stroke-opacity', 0.25);
			}
			inner
				.append('text')
				.attr('x', cxPx + 4)
				.attr('y', cyPx - rr)
				.attr('font-size', 10)
				.attr('fill', 'var(--color-muted)')
				.text(m.toFixed(2));
		}

		// Spokes at every 45° (8 directions); pie restricts them to the
		// angular range and adds solid boundary spokes.
		const N_ANG = 8;
		const inAngularRange = (θ: number): boolean => {
			if (!isPie) return true;
			const θ1 = span!.start;
			const θ2 = (span!.start + span!.sweep) % (2 * Math.PI);
			if (θ1 <= θ2) return θ >= θ1 && θ <= θ2;
			return θ >= θ1 || θ <= θ2;
		};
		for (let i = 0; i < N_ANG; i++) {
			const θ = (i * 2 * Math.PI) / N_ANG;
			if (!inAngularRange(θ)) continue;
			const ex = cxPx + outerR * Math.cos(θ);
			const ey = cyPx - outerR * Math.sin(θ);
			inner
				.append('line')
				.attr('x1', cxPx)
				.attr('y1', cyPx)
				.attr('x2', ex)
				.attr('y2', ey)
				.attr('stroke', 'var(--color-muted)')
				.attr('stroke-opacity', 0.2);
			const deg = Math.round(((i * 360) / N_ANG) % 360);
			inner
				.append('text')
				.attr('x', cxPx + (outerR + 14) * Math.cos(θ))
				.attr('y', cyPx - (outerR + 14) * Math.sin(θ))
				.attr('text-anchor', 'middle')
				.attr('dominant-baseline', 'middle')
				.attr('font-size', 10)
				.attr('fill', 'var(--color-muted)')
				.text(`${deg}°`);
		}

		// Cardinal-pole labels: at θ=0 (right), π/2 (top), π (left), 3π/2
		// (bottom) we know the underlying cartesian axis pole, so spell it
		// out. Pie shapes skip cardinals outside the angular range.
		const cardinals: { θ: number; axis: typeof xAxis; sign: 'min' | 'max' }[] = [
			{ θ: 0, axis: xAxis, sign: 'max' },
			{ θ: Math.PI / 2, axis: yAxis, sign: 'max' },
			{ θ: Math.PI, axis: xAxis, sign: 'min' },
			{ θ: (3 * Math.PI) / 2, axis: yAxis, sign: 'min' }
		];
		for (const c of cardinals) {
			const lab = c.sign === 'min' ? c.axis.min_label : c.axis.max_label;
			if (!lab) continue;
			if (!inAngularRange(c.θ)) continue;
			const dist = outerR + 32;
			inner
				.append('text')
				.attr('x', cxPx + dist * Math.cos(c.θ))
				.attr('y', cyPx - dist * Math.sin(c.θ))
				.attr('text-anchor', 'middle')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.attr('font-size', 11)
				.text(lab);
		}

		// Polar channel names (overrideable via view.x_label / y_label).
		inner
			.append('text')
			.attr('x', cxPx + 6)
			.attr('y', cyPx + 14)
			.attr('font-size', 11)
			.attr('fill', 'var(--color-muted)')
			.text(`length: ${lengthLabel}`);
		inner
			.append('text')
			.attr('x', cxPx)
			.attr('y', cyPx - outerR - 22)
			.attr('text-anchor', 'middle')
			.attr('font-size', 11)
			.attr('fill', 'var(--color-muted)')
			.text(`angle: ${angleLabel}`);

		if (points.length === 0) {
			emptyMessage(inner, cxPx, cyPx);
			// Fall through so the colour-bar legend still renders for empty
			// graphs in 3D-with-color views (matches the cartesian path).
		}

		// Regions — projected via the same polar conversion. Edges between
		// projected vertices are drawn as straight pixel lines (not true
		// arcs); good enough for small/labelled regions.
		const regionXIdx = xIdx === 0 || xIdx === 1 ? xIdx : null;
		const regionYIdx = yIdx === 0 || yIdx === 1 ? yIdx : null;
		const radialRegionsApplicable =
			regionXIdx !== null && regionYIdx !== null && regionXIdx !== regionYIdx;
		if (radialRegionsApplicable) {
			for (const r of g.schema.regions) {
				if (r.shape.type === 'box') {
					const a0 = r.shape.min[regionXIdx!];
					const a1 = r.shape.max[regionXIdx!];
					const b0 = r.shape.min[regionYIdx!];
					const b1 = r.shape.max[regionYIdx!];
					const corners: [number, number][] = [
						projectCartesian(a0, b0),
						projectCartesian(a1, b0),
						projectCartesian(a1, b1),
						projectCartesian(a0, b1)
					];
					const path = 'M ' + corners.map(([x, y]) => `${x},${y}`).join(' L ') + ' Z';
					inner
						.append('path')
						.attr('d', path)
						.attr('fill', r.color)
						.attr('opacity', r.opacity ?? 0.25);
				} else if (r.shape.type === 'polygon') {
					const proj = r.shape.vertices.map((v) =>
						projectCartesian(v[regionXIdx!], v[regionYIdx!])
					);
					const path = 'M ' + proj.map(([x, y]) => `${x},${y}`).join(' L ') + ' Z';
					inner
						.append('path')
						.attr('d', path)
						.attr('fill', r.color)
						.attr('opacity', r.opacity ?? 0.25);
				}
			}
		}

		// Per-axis waypoints don't have a clean polar locus (a constant-x
		// line in cartesian becomes a hyperbola-shaped curve through polar),
		// so they're skipped in this view. Point waypoints still project.

		// Point waypoints — project (coords[xIdx], coords[yIdx]) to polar.
		for (const pw of g.schema.point_waypoints ?? []) {
			const cx = pw.coordinates[xIdx];
			const cy = pw.coordinates[yIdx];
			if (cx === undefined || cy === undefined) continue;
			const [px, py] = projectCartesian(cx, cy);
			const ramp2 =
				view.color !== undefined && typeof view.color === 'number'
					? buildColorRamp(g.customization.theme.palette, g.schema.axes[view.color].range)
					: undefined;
			const tint =
				pw.color ??
				(ramp2 && pw.coordinates[view.color as number] !== undefined
					? ramp2(pw.coordinates[view.color as number])
					: 'var(--color-muted)');
			const marker = inner.append('g').attr('opacity', 0.85);
			marker
				.append('line')
				.attr('x1', px - 6)
				.attr('x2', px + 6)
				.attr('y1', py)
				.attr('y2', py)
				.attr('stroke', tint)
				.attr('stroke-width', 1.5);
			marker
				.append('line')
				.attr('x1', px)
				.attr('x2', px)
				.attr('y1', py - 6)
				.attr('y2', py + 6)
				.attr('stroke', tint)
				.attr('stroke-width', 1.5);
			marker
				.append('text')
				.attr('x', px + 10)
				.attr('y', py)
				.attr('dominant-baseline', 'middle')
				.attr('fill', tint)
				.attr('font-size', 11)
				.text(pw.label);
		}

		// Optional colour ramp from view.color, with a legend tucked into the
		// extra right margin reserved when hasColor is true. The plot itself
		// stays circular; the bar sits to its right.
		let ramp: ColorRamp | undefined;
		let colorCh: ChannelResolution | undefined;
		if (view.color !== undefined) {
			colorCh = resolveChannel(view.color, g, points);
			ramp = buildColorRamp(g.customization.theme.palette, colorCh.domain);
			if (colorCh.axis) {
				drawColorBar(root, ramp, colorCh.axis, {
					x: M.left + iw + 30,
					y: M.top,
					height: ih
				});
			} else if (colorCh.isTime) {
				drawTimeColorBar(root, ramp, colorCh.timeDomain!, {
					x: M.left + iw + 30,
					y: M.top,
					height: ih
				});
			}
		}
		const dpColor = (dp: SpectrumDatapoint, idx: number): string => {
			if (dp.color) return dp.color;
			if (ramp && colorCh) return ramp(colorCh.extractNum(dp));
			return colorOf(g, dp, idx);
		};

		function projectDp(dp: SpectrumDatapoint): [number, number] | null {
			const cx = dp.coordinates[xIdx];
			const cy = dp.coordinates[yIdx];
			if (cx === undefined || cy === undefined) return null;
			return projectCartesian(cx, cy);
		}

		// Trail with gradient — polar-projected per datapoint.
		const defs = root.append('defs');
		const gradPrefix = `radgrad-${view.id}-`;
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i];
			const b = points[i + 1];
			const aP = projectDp(a);
			const bP = projectDp(b);
			if (!aP || !bP) continue;
			const [ax, ay] = aP;
			const [bx, by] = bP;
			const id = `${gradPrefix}${i}`;
			const grad = defs
				.append('linearGradient')
				.attr('id', id)
				.attr('gradientUnits', 'userSpaceOnUse')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by);
			grad.append('stop').attr('offset', '0%').attr('stop-color', dpColor(a, i));
			grad
				.append('stop')
				.attr('offset', '100%')
				.attr('stop-color', dpColor(b, i + 1));
			inner
				.append('line')
				.attr('x1', ax)
				.attr('y1', ay)
				.attr('x2', bx)
				.attr('y2', by)
				.attr('stroke', `url(#${id})`)
				.attr('stroke-width', 1.5)
				.attr('opacity', 0.5);
		}

		const lastIdx = points.length - 1;
		inner
			.selectAll<SVGCircleElement, SpectrumDatapoint>('circle.dp')
			.data(points.filter((p) => projectDp(p) !== null))
			.join('circle')
			.attr('class', 'dp')
			.attr('cx', (p) => projectDp(p)![0])
			.attr('cy', (p) => projectDp(p)![1])
			.attr('r', (_, i) => (i === lastIdx ? 7 : 4))
			.attr('fill', (p, i) => dpColor(p, i))
			.attr('opacity', (_, i) => 0.45 + 0.55 * (i / Math.max(1, lastIdx)))
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 2);
	}

	// Angular range reachable from the origin given the axis-space rect.
	// Returns null when no direction reaches any rect point (e.g. degenerate
	// rect at origin); returns sweep === 2π when the origin is strictly
	// inside (every angle reachable). Otherwise the smallest CCW sweep
	// covering all four corners.
	function computeAngularSpan(
		xRange: [number, number],
		yRange: [number, number]
	): { start: number; sweep: number } | null {
		const insideX = xRange[0] < 0 && xRange[1] > 0;
		const insideY = yRange[0] < 0 && yRange[1] > 0;
		if (insideX && insideY) return { start: 0, sweep: 2 * Math.PI };

		const corners: [number, number][] = [
			[xRange[0], yRange[0]],
			[xRange[1], yRange[0]],
			[xRange[1], yRange[1]],
			[xRange[0], yRange[1]]
		];
		const angles: number[] = [];
		for (const [x, y] of corners) {
			if (x === 0 && y === 0) continue;
			let a = Math.atan2(y, x);
			if (a < 0) a += 2 * Math.PI;
			angles.push(a);
		}
		if (angles.length === 0) return null;
		angles.sort((a, b) => a - b);

		let maxGap = 0;
		let gapStart = 0;
		for (let i = 0; i < angles.length; i++) {
			const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
			const gap = next - angles[i];
			if (gap > maxGap) {
				maxGap = gap;
				gapStart = angles[i];
			}
		}
		const start = (gapStart + maxGap) % (2 * Math.PI);
		const sweep = 2 * Math.PI - maxGap;
		return { start, sweep };
	}

	// Radial overlay: concentric "length" ellipses + angle spokes drawn on
	// top of a cartesian plot. shape='circle' draws full ellipses and 360°
	// of spokes. shape='pie' restricts both to the angular range reachable
	// by the axis ranges (e.g. only the upper semicircle when the y-axis is
	// non-negative), and adds boundary spokes at the start/end angles.
	function drawRadialOverlay(
		inner: d3.Selection<SVGGElement, unknown, null, undefined>,
		opts: {
			xScale: d3.ScaleLinear<number, number>;
			yScale: d3.ScaleLinear<number, number>;
			xRange: [number, number];
			yRange: [number, number];
			iw: number;
			ih: number;
			shape: 'circle' | 'pie';
		}
	) {
		const { xScale, yScale, xRange, yRange, iw, ih, shape } = opts;
		const ox = xScale(0);
		const oy = yScale(0);
		const pxPerXUnit = xScale(1) - xScale(0) || 1;
		const pxPerYUnit = yScale(0) - yScale(1) || 1;
		const absPxPerXUnit = Math.abs(pxPerXUnit);
		const absPxPerYUnit = Math.abs(pxPerYUnit);

		const maxAbsX = Math.max(Math.abs(xRange[0]), Math.abs(xRange[1]));
		const maxAbsY = Math.max(Math.abs(yRange[0]), Math.abs(yRange[1]));
		const maxLen = Math.hypot(maxAbsX, maxAbsY) || 1;

		const span = shape === 'pie' ? computeAngularSpan(xRange, yRange) : null;
		const isPie = !!span && span.sweep < 2 * Math.PI - 1e-6;

		const clipId = `radial-overlay-clip-${Math.random().toString(36).slice(2, 8)}`;
		const defs = inner.append('defs');
		defs
			.append('clipPath')
			.attr('id', clipId)
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', iw)
			.attr('height', ih);
		const overlay = inner
			.append('g')
			.attr('class', 'radial-overlay')
			.attr('clip-path', `url(#${clipId})`)
			.attr('pointer-events', 'none');

		// Concentric rings at quarter-magnitudes — full ellipses for circle
		// shape, arc segments for pie.
		for (let i = 1; i <= 4; i++) {
			const L = (maxLen * i) / 4;
			const rx = L * absPxPerXUnit;
			const ry = L * absPxPerYUnit;
			if (!isPie) {
				overlay
					.append('ellipse')
					.attr('cx', ox)
					.attr('cy', oy)
					.attr('rx', rx)
					.attr('ry', ry)
					.attr('fill', 'none')
					.attr('stroke', 'var(--color-muted)')
					.attr('stroke-opacity', 0.25)
					.attr('stroke-dasharray', '2 4');
				overlay
					.append('text')
					.attr('x', ox + 3)
					.attr('y', oy - ry - 2)
					.attr('font-size', 10)
					.attr('fill', 'var(--color-muted)')
					.text(L.toFixed(2));
			} else {
				const θ1 = span!.start;
				const θ2 = span!.start + span!.sweep;
				const sx = ox + rx * Math.cos(θ1);
				const sy = oy - ry * Math.sin(θ1);
				const ex = ox + rx * Math.cos(θ2);
				const ey = oy - ry * Math.sin(θ2);
				const largeArc = span!.sweep > Math.PI ? 1 : 0;
				overlay
					.append('path')
					.attr('d', `M ${sx} ${sy} A ${rx} ${ry} 0 ${largeArc} 1 ${ex} ${ey}`)
					.attr('fill', 'none')
					.attr('stroke', 'var(--color-muted)')
					.attr('stroke-opacity', 0.25)
					.attr('stroke-dasharray', '2 4');
				const midθ = θ1 + span!.sweep / 2;
				overlay
					.append('text')
					.attr('x', ox + rx * Math.cos(midθ) + 3)
					.attr('y', oy - ry * Math.sin(midθ) - 2)
					.attr('font-size', 10)
					.attr('fill', 'var(--color-muted)')
					.text(L.toFixed(2));
			}
		}

		// Angle spokes — every 30° within the angular range; pie shape adds
		// solid boundary spokes at the start/end angles.
		const N_ANG = 12;
		const inRange = (θ: number): boolean => {
			if (!isPie) return true;
			const θ1 = span!.start;
			const θ2 = (span!.start + span!.sweep) % (2 * Math.PI);
			if (θ1 <= θ2) return θ >= θ1 && θ <= θ2;
			return θ >= θ1 || θ <= θ2;
		};
		const labelRadiusFraction = 0.95;
		for (let i = 0; i < N_ANG; i++) {
			const θ = (i * 2 * Math.PI) / N_ANG;
			if (!inRange(θ)) continue;
			const reach = Math.hypot(iw, ih);
			const ex = ox + reach * Math.cos(θ);
			const ey = oy - reach * Math.sin(θ);
			overlay
				.append('line')
				.attr('x1', ox)
				.attr('y1', oy)
				.attr('x2', ex)
				.attr('y2', ey)
				.attr('stroke', 'var(--color-muted)')
				.attr('stroke-opacity', 0.18)
				.attr('stroke-dasharray', '2 4');
			if (i === 0) continue;
			const lr = labelRadiusFraction * maxLen;
			const lx = ox + lr * absPxPerXUnit * Math.cos(θ);
			const ly = oy - lr * absPxPerYUnit * Math.sin(θ);
			const deg = Math.round(((i * 360) / N_ANG) % 360);
			overlay
				.append('text')
				.attr('x', lx)
				.attr('y', ly)
				.attr('text-anchor', 'middle')
				.attr('dominant-baseline', 'middle')
				.attr('font-size', 9)
				.attr('fill', 'var(--color-muted)')
				.text(`${deg}°`);
		}

		if (isPie) {
			// Solid boundary spokes mark the angular limits of the data.
			const θ1 = span!.start;
			const θ2 = span!.start + span!.sweep;
			for (const θ of [θ1, θ2]) {
				const ex = ox + maxLen * absPxPerXUnit * Math.cos(θ);
				const ey = oy - maxLen * absPxPerYUnit * Math.sin(θ);
				overlay
					.append('line')
					.attr('x1', ox)
					.attr('y1', oy)
					.attr('x2', ex)
					.attr('y2', ey)
					.attr('stroke', 'var(--color-muted)')
					.attr('stroke-opacity', 0.5);
			}
		}
	}

	// Time-channel variant of drawColorBar — formats the legend ticks as
	// dates rather than the axis-textual labels drawColorBar emits.
	function drawTimeColorBar(
		root: Selection,
		ramp: ColorRamp,
		domain: [Date, Date],
		geom: { x: number; y: number; height: number }
	) {
		const barWidth = 18;
		const defs = root.append('defs');
		const gradId = `timebar-${Math.random().toString(36).slice(2, 8)}`;
		const grad = defs
			.append('linearGradient')
			.attr('id', gradId)
			.attr('x1', 0)
			.attr('y1', 1)
			.attr('x2', 0)
			.attr('y2', 0);
		for (const stop of ramp.stops) {
			grad
				.append('stop')
				.attr('offset', `${stop.offset * 100}%`)
				.attr('stop-color', stop.color);
		}
		const g = root.append('g').attr('transform', `translate(${geom.x},${geom.y})`);
		g.append('rect')
			.attr('width', barWidth)
			.attr('height', geom.height)
			.attr('fill', `url(#${gradId})`)
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-opacity', 0.4);
		const ys = d3.scaleTime().domain(domain).range([geom.height, 0]);
		g.append('g')
			.attr('transform', `translate(${barWidth},0)`)
			.attr('color', 'var(--color-muted)')
			.call(d3.axisRight(ys).ticks(4).tickSizeOuter(0));
		g.append('text')
			.attr('transform', `translate(${barWidth + 56}, ${geom.height / 2}) rotate(90)`)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text('time');
	}

	function drawColorBar(
		root: Selection,
		ramp: ColorRamp,
		axis: SpectrumGraph['schema']['axes'][number],
		geom: { x: number; y: number; height: number }
	) {
		const barWidth = 18;
		const labelGap = 8;
		const axisNameGap = 56;

		const defs = root.append('defs');
		const gradId = `colorbar-${Math.random().toString(36).slice(2, 8)}`;
		const grad = defs
			.append('linearGradient')
			.attr('id', gradId)
			.attr('x1', 0)
			.attr('y1', 1)
			.attr('x2', 0)
			.attr('y2', 0);
		for (const stop of ramp.stops) {
			grad
				.append('stop')
				.attr('offset', `${stop.offset * 100}%`)
				.attr('stop-color', stop.color);
		}

		const g = root.append('g').attr('transform', `translate(${geom.x},${geom.y})`);
		g.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', barWidth)
			.attr('height', geom.height)
			.attr('fill', `url(#${gradId})`)
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-opacity', 0.4);

		const [min, max] = ramp.domain;
		const ys = d3.scaleLinear().domain([min, max]).range([geom.height, 0]);
		g.append('g')
			.attr('transform', `translate(${barWidth},0)`)
			.attr('color', 'var(--color-muted)')
			.call(d3.axisRight(ys).tickValues(signedTickValues(min, max)).tickSizeOuter(0));

		// Endpoint textual labels (e.g. axis poles) line up with the bar so
		// readers can see "min_label corresponds to the bottom hue".
		g.append('text')
			.attr('x', barWidth + labelGap + 28)
			.attr('y', geom.height)
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(axis.min_label);
		g.append('text')
			.attr('x', barWidth + labelGap + 28)
			.attr('y', 0)
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(axis.max_label);
		if (axis.zero_label && min < 0 && max > 0) {
			g.append('text')
				.attr('x', barWidth + labelGap + 28)
				.attr('y', ys(0))
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.text(axis.zero_label);
		}

		g.append('text')
			.attr('transform', `translate(${barWidth + axisNameGap + 32}, ${geom.height / 2}) rotate(90)`)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text(axis.name);
	}

	function emptyMessage(
		sel: d3.Selection<SVGGElement, unknown, null, undefined>,
		x: number,
		y: number
	) {
		sel
			.append('text')
			.attr('x', x)
			.attr('y', y)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.text('no datapoints yet');
	}
</script>

<svg bind:this={svgEl} viewBox="0 0 {dims.W} {dims.H}" preserveAspectRatio="xMidYMid meet"></svg>

<style>
	svg {
		width: 100%;
		height: auto;
		max-height: 600px;
		display: block;
	}
</style>
