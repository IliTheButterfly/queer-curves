<script lang="ts">
	import * as d3 from 'd3';
	import type { SpectrumDatapoint, SpectrumGraph } from '$lib/types.js';

	let { graph }: { graph: SpectrumGraph } = $props();

	let svgEl: SVGSVGElement;

	const dims = $derived(graph.schema.dimensions === 2 ? { W: 600, H: 600 } : { W: 800, H: 400 });

	$effect(() => {
		if (!svgEl) return;
		render(svgEl, graph);
	});

	function render(el: SVGSVGElement, g: SpectrumGraph) {
		const root = d3.select(el);
		root.selectAll('*').remove();

		if (g.schema.dimensions === 1) {
			render1D(root, g);
		} else if (g.schema.dimensions === 2) {
			render2D(root, g);
		} else {
			root
				.append('text')
				.attr('x', 16)
				.attr('y', 32)
				.attr('fill', 'var(--color-muted)')
				.text(`${g.schema.dimensions}D history rendering not yet implemented`);
		}
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

	type Selection = d3.Selection<SVGSVGElement, unknown, null, undefined>;

	function render1D(root: Selection, g: SpectrumGraph) {
		const W = 800;
		const H = 400;
		// Wider left margin so numeric tick labels (close to axis) and
		// textual endpoint labels (further out) don't stack on each other.
		const M = { top: 20, right: 100, bottom: 40, left: 80 };
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
			grad.append('stop').attr('offset', '0%').attr('stop-color', colorOf(g, a, i));
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
		const W = 600;
		const H = 600;
		// Generous bottom/left margins so numeric tick labels (close to the
		// axis) and textual endpoint labels (further out) can both breathe.
		const M = { top: 24, right: 30, bottom: 80, left: 80 };
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
			grad.append('stop').attr('offset', '0%').attr('stop-color', colorOf(g, a, i));
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
