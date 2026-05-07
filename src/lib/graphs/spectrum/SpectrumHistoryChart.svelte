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

	type Selection = d3.Selection<SVGSVGElement, unknown, null, undefined>;

	function render1D(root: Selection, g: SpectrumGraph) {
		const W = 800;
		const H = 400;
		const M = { top: 20, right: 100, bottom: 40, left: 50 };
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

		// Endpoint labels on the y-axis.
		inner
			.append('text')
			.attr('x', -8)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(axis.min_label);
		inner
			.append('text')
			.attr('x', -8)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(axis.max_label);

		inner
			.append('g')
			.attr('transform', `translate(0,${ih})`)
			.attr('color', 'var(--color-muted)')
			.call(d3.axisBottom(xScale).ticks(5).tickSizeOuter(0));

		inner
			.append('g')
			.attr('color', 'var(--color-muted)')
			.call(d3.axisLeft(yScale).ticks(5).tickSizeOuter(0));

		const seriesColor = g.customization.theme.palette[0] ?? '#c98aff';

		const lineGen = d3
			.line<SpectrumDatapoint>()
			.x((p) => xScale(new Date(p.timestamp)))
			.y((p) => yScale(p.coordinates[0]))
			.curve(d3.curveMonotoneX);

		inner
			.append('path')
			.attr('d', lineGen(points))
			.attr('fill', 'none')
			.attr('stroke', seriesColor)
			.attr('stroke-width', 2);

		inner
			.selectAll<SVGCircleElement, SpectrumDatapoint>('circle.dp')
			.data(points)
			.join('circle')
			.attr('class', 'dp')
			.attr('cx', (p) => xScale(new Date(p.timestamp)))
			.attr('cy', (p) => yScale(p.coordinates[0]))
			.attr('r', 5)
			.attr('fill', seriesColor)
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 2);
	}

	function render2D(root: Selection, g: SpectrumGraph) {
		const W = 600;
		const H = 600;
		const M = { top: 20, right: 24, bottom: 60, left: 60 };
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

		// Axis-endpoint labels.
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', ih + 20)
			.attr('text-anchor', 'start')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax0.min_label);
		inner
			.append('text')
			.attr('x', iw)
			.attr('y', ih + 20)
			.attr('text-anchor', 'end')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax0.max_label);
		inner
			.append('text')
			.attr('x', -8)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax1.min_label);
		inner
			.append('text')
			.attr('x', -8)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.text(ax1.max_label);

		// Axis names along their respective edges.
		inner
			.append('text')
			.attr('x', iw / 2)
			.attr('y', ih + 44)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text(ax0.name);
		inner
			.append('text')
			.attr('transform', `translate(-44, ${ih / 2}) rotate(-90)`)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 11)
			.text(ax1.name);

		// Trajectory trail in time order.
		const seriesColor = g.customization.theme.palette[0] ?? '#c98aff';

		const lineGen = d3
			.line<SpectrumDatapoint>()
			.x((p) => xScale(p.coordinates[0]))
			.y((p) => yScale(p.coordinates[1]))
			.curve(d3.curveCatmullRom);

		inner
			.append('path')
			.attr('d', lineGen(points))
			.attr('fill', 'none')
			.attr('stroke', seriesColor)
			.attr('stroke-width', 1.5)
			.attr('opacity', 0.4);

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
			.attr('fill', seriesColor)
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
