<script lang="ts">
	import { onMount } from 'svelte';
	import * as d3 from 'd3';
	import type { SpectrumDatapoint, SpectrumGraph } from '$lib/types.js';
	import { buildColorRamp } from '$lib/graphs/spectrum/colorRamp.js';

	let {
		graph,
		coordinates = $bindable(),
		excludeDatapointId
	}: {
		graph: SpectrumGraph;
		coordinates: number[];
		// When editing an existing datapoint, omit it from the rendered history
		// so the active marker isn't doubled up by a static dot.
		excludeDatapointId?: string;
	} = $props();

	const historyPoints = $derived(
		[...graph.datapoints]
			.filter((dp) => dp.id !== excludeDatapointId)
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
	);

	// Per-point color: explicit override wins; otherwise cycle through the
	// palette by time-order index so the user can read progression by hue.
	function colorOf(dp: SpectrumDatapoint, idx: number): string {
		if (dp.color) return dp.color;
		const palette = graph.customization.theme.palette;
		if (!palette || palette.length === 0) return '#c98aff';
		return palette[idx % palette.length];
	}

	let svgEl: SVGSVGElement;

	type Linear = d3.ScaleLinear<number, number>;
	let xScale: Linear | undefined;
	let yScale: Linear | undefined;

	const dims = $derived(
		graph.schema.dimensions === 2
			? { W: 600, H: 600 }
			: graph.schema.dimensions === 3
				? { W: 720, H: 600 }
				: { W: 800, H: 160 }
	);

	function rebuild() {
		if (!svgEl) return;
		if (graph.schema.dimensions === 1) setup1D();
		else if (graph.schema.dimensions === 2) setup2D();
		else if (graph.schema.dimensions === 3) setup3D();
	}

	// Rebuild the picker when the set of historical datapoints changes —
	// otherwise a freshly-committed point doesn't show up in the dimmed
	// history until the form is closed and reopened. Keyed off length plus
	// dimension so the same effect handles dim flips too.
	const datapointsKey = $derived(`${graph.datapoints.length}|${graph.schema.dimensions}`);
	const lastSetupKey: { current: string } = { current: '' };
	$effect(() => {
		if (!svgEl) return;
		if (datapointsKey === lastSetupKey.current) return;
		lastSetupKey.current = datapointsKey;
		rebuild();
	});

	onMount(() => {
		if (svgEl) {
			lastSetupKey.current = datapointsKey;
			rebuild();
		}
	});

	// External coordinate changes (e.g. parent form reset) move the marker.
	// Drag-during-update isn't an issue because the drag handler only writes
	// coordinates on drag-end, not on every drag event.
	$effect(() => {
		const xs = xScale;
		const ys = yScale;
		if (!svgEl || !xs) return;
		const sel = d3.select(svgEl).select<SVGCircleElement>('circle.marker');
		if (sel.empty()) return;
		sel.attr('cx', xs(coordinates[0]));
		if (
			(graph.schema.dimensions === 2 || graph.schema.dimensions === 3) &&
			ys &&
			coordinates.length > 1
		) {
			sel.attr('cy', ys(coordinates[1]));
		}
		if (graph.schema.dimensions === 3 && coordinates.length > 2) {
			const ax2 = graph.schema.axes[2];
			if (ax2) {
				const ramp = buildColorRamp(graph.customization.theme.palette, ax2.range);
				sel.attr('fill', ramp(coordinates[2]));
			}
		}
	});

	function clamp(v: number, lo: number, hi: number): number {
		return Math.max(lo, Math.min(hi, v));
	}

	function setup1D() {
		const root = d3.select(svgEl);
		root.selectAll('*').remove();

		const W = 800;
		const H = 160;
		const M = { top: 36, right: 60, bottom: 56, left: 60 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const axis = graph.schema.axes[0];
		const xs: Linear = d3.scaleLinear().domain(axis.range).range([0, iw]);
		xScale = xs;

		const lineY = ih / 2;

		// Hit target — covers the whole interactive area. Press anywhere to
		// teleport the marker; drag continues to move it without lifting.
		const hitTarget = inner
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'transparent')
			.attr('cursor', 'crosshair');
		hitTarget.call(
			d3
				.drag<SVGRectElement, unknown>()
				.clickDistance(0)
				.on('start', (event) => {
					const x = clamp(event.x, 0, iw);
					d3.select(svgEl).select<SVGCircleElement>('circle.marker').attr('cx', x);
				})
				.on('drag', (event) => {
					const x = clamp(event.x, 0, iw);
					d3.select(svgEl).select<SVGCircleElement>('circle.marker').attr('cx', x);
				})
				.on('end', (event) => {
					const x = clamp(event.x, 0, iw);
					coordinates = [clamp(xs.invert(x), axis.range[0], axis.range[1])];
				})
		);

		// Regions render under the line as a band centered on it.
		for (const r of graph.schema.regions) {
			if (r.shape.type !== 'range') continue;
			inner
				.append('rect')
				.attr('x', xs(r.shape.min))
				.attr('y', lineY - 16)
				.attr('width', xs(r.shape.max) - xs(r.shape.min))
				.attr('height', 32)
				.attr('fill', r.color)
				.attr('opacity', r.opacity ?? 0.3)
				.attr('pointer-events', 'none');
			inner
				.append('text')
				.attr('x', (xs(r.shape.min) + xs(r.shape.max)) / 2)
				.attr('y', lineY - 22)
				.attr('text-anchor', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('opacity', 0.75)
				.attr('font-size', 11)
				.attr('pointer-events', 'none')
				.text(r.label);
		}

		inner
			.append('line')
			.attr('x1', 0)
			.attr('x2', iw)
			.attr('y1', lineY)
			.attr('y2', lineY)
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-width', 2)
			.attr('pointer-events', 'none');

		// Endpoint labels, below the line.
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', lineY + 36)
			.attr('text-anchor', 'start')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(axis.min_label);
		inner
			.append('text')
			.attr('x', iw)
			.attr('y', lineY + 36)
			.attr('text-anchor', 'end')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(axis.max_label);

		// Waypoints rendered as ticks crossing the line, with labels above.
		for (const wp of axis.waypoints ?? []) {
			const x = xs(wp.position);
			inner
				.append('line')
				.attr('x1', x)
				.attr('x2', x)
				.attr('y1', lineY - 14)
				.attr('y2', lineY + 14)
				.attr('stroke', wp.color ?? 'var(--color-muted)')
				.attr('stroke-width', 1.5)
				.attr('opacity', 0.6)
				.attr('pointer-events', 'none');
			inner
				.append('text')
				.attr('x', x)
				.attr('y', lineY - 18)
				.attr('text-anchor', 'middle')
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 11)
				.attr('pointer-events', 'none')
				.text(wp.label);
		}

		const seriesColor = graph.customization.theme.palette[0] ?? '#c98aff';

		// Existing datapoints, dimmed and time-ramped (older = fainter). Each
		// point uses its explicit color or the next palette slot.
		const lastIdx = historyPoints.length - 1;
		for (let i = 0; i < historyPoints.length; i++) {
			const dp = historyPoints[i];
			const cx = xs(dp.coordinates[0]);
			if (cx === undefined || Number.isNaN(cx)) continue;
			const opacity = lastIdx === 0 ? 0.45 : 0.15 + 0.3 * (i / lastIdx);
			inner
				.append('circle')
				.attr('class', 'dp-history')
				.attr('cx', cx)
				.attr('cy', lineY)
				.attr('r', 5)
				.attr('fill', colorOf(dp, i))
				.attr('opacity', opacity)
				.attr('pointer-events', 'none');
		}

		const marker = inner
			.append('circle')
			.attr('class', 'marker')
			.attr('cx', xs(coordinates[0] ?? 0))
			.attr('cy', lineY)
			.attr('r', 11)
			.attr('fill', seriesColor)
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 3)
			.attr('cursor', 'grab')
			.style('filter', 'drop-shadow(0 2px 5px rgba(0,0,0,0.45))');

		const drag = d3
			.drag<SVGCircleElement, unknown>()
			.on('start', function () {
				d3.select(this).attr('cursor', 'grabbing');
			})
			.on('drag', function (event) {
				// Update SVG position in real time. Don't write Svelte state
				// here — it'd trigger the marker-update $effect which would
				// fight with this same handler.
				const x = clamp(event.x, 0, iw);
				d3.select(this).attr('cx', x);
			})
			.on('end', function (event) {
				const x = clamp(event.x, 0, iw);
				const coord = clamp(xs.invert(x), axis.range[0], axis.range[1]);
				coordinates = [coord];
				d3.select(this).attr('cursor', 'grab');
			});

		marker.call(drag);
	}

	function setup2D() {
		const root = d3.select(svgEl);
		root.selectAll('*').remove();

		const W = 600;
		const H = 600;
		const M = { top: 30, right: 30, bottom: 60, left: 60 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const ax0 = graph.schema.axes[0];
		const ax1 = graph.schema.axes[1];
		const xs: Linear = d3.scaleLinear().domain(ax0.range).range([0, iw]);
		const ys: Linear = d3.scaleLinear().domain(ax1.range).range([ih, 0]);
		xScale = xs;
		yScale = ys;

		// Plot frame doubles as the hit target. Press anywhere to teleport
		// the marker; drag continues to move it without lifting.
		const frame = inner
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'rgba(255,255,255,0.02)')
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-opacity', 0.4)
			.attr('cursor', 'crosshair');
		frame.call(
			d3
				.drag<SVGRectElement, unknown>()
				.clickDistance(0)
				.on('start', (event) => {
					const x = clamp(event.x, 0, iw);
					const y = clamp(event.y, 0, ih);
					d3.select(svgEl).select<SVGCircleElement>('circle.marker').attr('cx', x).attr('cy', y);
				})
				.on('drag', (event) => {
					const x = clamp(event.x, 0, iw);
					const y = clamp(event.y, 0, ih);
					d3.select(svgEl).select<SVGCircleElement>('circle.marker').attr('cx', x).attr('cy', y);
				})
				.on('end', (event) => {
					const x = clamp(event.x, 0, iw);
					const y = clamp(event.y, 0, ih);
					coordinates = [
						clamp(xs.invert(x), ax0.range[0], ax0.range[1]),
						clamp(ys.invert(y), ax1.range[0], ax1.range[1])
					];
				})
		);

		for (const r of graph.schema.regions) {
			if (r.shape.type === 'box') {
				const [x0, y0] = r.shape.min;
				const [x1, y1] = r.shape.max;
				inner
					.append('rect')
					.attr('x', xs(x0))
					.attr('y', ys(y1))
					.attr('width', xs(x1) - xs(x0))
					.attr('height', ys(y0) - ys(y1))
					.attr('fill', r.color)
					.attr('opacity', r.opacity ?? 0.3)
					.attr('pointer-events', 'none');
				inner
					.append('text')
					.attr('x', (xs(x0) + xs(x1)) / 2)
					.attr('y', (ys(y0) + ys(y1)) / 2)
					.attr('text-anchor', 'middle')
					.attr('dominant-baseline', 'middle')
					.attr('fill', 'var(--color-fg)')
					.attr('opacity', 0.75)
					.attr('font-size', 11)
					.attr('pointer-events', 'none')
					.text(r.label);
			} else if (r.shape.type === 'polygon') {
				const path =
					'M ' + r.shape.vertices.map(([x, y]) => `${xs(x)},${ys(y)}`).join(' L ') + ' Z';
				inner
					.append('path')
					.attr('d', path)
					.attr('fill', r.color)
					.attr('opacity', r.opacity ?? 0.3)
					.attr('pointer-events', 'none');
			}
		}

		for (const wp of ax0.waypoints ?? []) {
			const x = xs(wp.position);
			inner
				.append('line')
				.attr('x1', x)
				.attr('x2', x)
				.attr('y1', 0)
				.attr('y2', ih)
				.attr('stroke', wp.color ?? 'var(--color-muted)')
				.attr('stroke-dasharray', '3 5')
				.attr('opacity', 0.6)
				.attr('pointer-events', 'none');
			inner
				.append('text')
				.attr('x', x)
				.attr('y', -8)
				.attr('text-anchor', 'middle')
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 11)
				.attr('pointer-events', 'none')
				.text(wp.label);
		}
		for (const wp of ax1.waypoints ?? []) {
			const y = ys(wp.position);
			inner
				.append('line')
				.attr('x1', 0)
				.attr('x2', iw)
				.attr('y1', y)
				.attr('y2', y)
				.attr('stroke', wp.color ?? 'var(--color-muted)')
				.attr('stroke-dasharray', '3 5')
				.attr('opacity', 0.6)
				.attr('pointer-events', 'none');
			inner
				.append('text')
				.attr('x', -8)
				.attr('y', y)
				.attr('text-anchor', 'end')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 11)
				.attr('pointer-events', 'none')
				.text(wp.label);
		}

		// Endpoint labels at corners.
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', ih + 22)
			.attr('text-anchor', 'start')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(ax0.min_label);
		inner
			.append('text')
			.attr('x', iw)
			.attr('y', ih + 22)
			.attr('text-anchor', 'end')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(ax0.max_label);
		inner
			.append('text')
			.attr('x', -8)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(ax1.min_label);
		inner
			.append('text')
			.attr('x', -8)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(ax1.max_label);

		const seriesColor = graph.customization.theme.palette[0] ?? '#c98aff';

		// Existing datapoints, dimmed and time-ramped (older = fainter), with
		// a per-segment color-fading trail to convey trajectory direction. The
		// trail uses straight segments so a per-segment <linearGradient> can
		// interpolate cleanly between adjacent point colors.
		const lastIdx = historyPoints.length - 1;
		if (historyPoints.length > 1) {
			const defs = root.append('defs');
			const gradPrefix = `pickgrad-${Math.random().toString(36).slice(2, 8)}-`;
			for (let i = 0; i < historyPoints.length - 1; i++) {
				const a = historyPoints[i];
				const b = historyPoints[i + 1];
				const ax = xs(a.coordinates[0]);
				const ay = ys(a.coordinates[1]);
				const bx = xs(b.coordinates[0]);
				const by = ys(b.coordinates[1]);
				const id = `${gradPrefix}${i}`;
				const grad = defs
					.append('linearGradient')
					.attr('id', id)
					.attr('gradientUnits', 'userSpaceOnUse')
					.attr('x1', ax)
					.attr('y1', ay)
					.attr('x2', bx)
					.attr('y2', by);
				grad.append('stop').attr('offset', '0%').attr('stop-color', colorOf(a, i));
				grad
					.append('stop')
					.attr('offset', '100%')
					.attr('stop-color', colorOf(b, i + 1));
				inner
					.append('line')
					.attr('x1', ax)
					.attr('y1', ay)
					.attr('x2', bx)
					.attr('y2', by)
					.attr('stroke', `url(#${id})`)
					.attr('stroke-width', 1.5)
					.attr('opacity', 0.4)
					.attr('pointer-events', 'none');
			}
		}
		for (let i = 0; i < historyPoints.length; i++) {
			const dp = historyPoints[i];
			const cx = xs(dp.coordinates[0]);
			const cy = ys(dp.coordinates[1]);
			if (cx === undefined || cy === undefined || Number.isNaN(cx) || Number.isNaN(cy)) continue;
			const opacity = lastIdx === 0 ? 0.45 : 0.15 + 0.3 * (i / lastIdx);
			inner
				.append('circle')
				.attr('class', 'dp-history')
				.attr('cx', cx)
				.attr('cy', cy)
				.attr('r', 4)
				.attr('fill', colorOf(dp, i))
				.attr('opacity', opacity)
				.attr('pointer-events', 'none');
		}

		const cx0 = xs(coordinates[0] ?? 0);
		const cy0 = ys(coordinates[1] ?? 0);

		const marker = inner
			.append('circle')
			.attr('class', 'marker')
			.attr('cx', cx0)
			.attr('cy', cy0)
			.attr('r', 11)
			.attr('fill', seriesColor)
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 3)
			.attr('cursor', 'grab')
			.style('filter', 'drop-shadow(0 2px 5px rgba(0,0,0,0.45))');

		const drag = d3
			.drag<SVGCircleElement, unknown>()
			.on('start', function () {
				d3.select(this).attr('cursor', 'grabbing');
			})
			.on('drag', function (event) {
				const x = clamp(event.x, 0, iw);
				const y = clamp(event.y, 0, ih);
				d3.select(this).attr('cx', x).attr('cy', y);
			})
			.on('end', function (event) {
				const x = clamp(event.x, 0, iw);
				const y = clamp(event.y, 0, ih);
				coordinates = [
					clamp(xs.invert(x), ax0.range[0], ax0.range[1]),
					clamp(ys.invert(y), ax1.range[0], ax1.range[1])
				];
				d3.select(this).attr('cursor', 'grab');
			});

		marker.call(drag);
	}

	// 3D = 2D pad for (axis 0, axis 1) plus a vertical slider for axis 2 with
	// the palette ramp painted on the track. The active marker on the pad
	// mirrors the slider's current colour so the user can read the third
	// coord visually without checking the slider every time.
	function setup3D() {
		const root = d3.select(svgEl);
		root.selectAll('*').remove();

		const W = 720;
		const H = 600;
		// Slider on the right gets its own column; the pad keeps roughly
		// square proportions so axes 0/1 stay readable.
		const M = { top: 30, right: 30, bottom: 60, left: 60 };
		const sliderColumn = 90;
		const padWidth = W - M.left - M.right - sliderColumn;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const ax0 = graph.schema.axes[0];
		const ax1 = graph.schema.axes[1];
		const ax2 = graph.schema.axes[2];
		const xs: Linear = d3.scaleLinear().domain(ax0.range).range([0, padWidth]);
		const ys: Linear = d3.scaleLinear().domain(ax1.range).range([ih, 0]);
		xScale = xs;
		yScale = ys;

		const ramp = buildColorRamp(graph.customization.theme.palette, ax2.range);

		// --- 2D pad (axes 0/1) — same hit-target + drag-anywhere model as 2D.
		const frame = inner
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', padWidth)
			.attr('height', ih)
			.attr('fill', 'rgba(255,255,255,0.02)')
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-opacity', 0.4)
			.attr('cursor', 'crosshair');
		frame.call(
			d3
				.drag<SVGRectElement, unknown>()
				.clickDistance(0)
				.on('start', (event) => {
					const x = clamp(event.x, 0, padWidth);
					const y = clamp(event.y, 0, ih);
					d3.select(svgEl).select<SVGCircleElement>('circle.marker').attr('cx', x).attr('cy', y);
				})
				.on('drag', (event) => {
					const x = clamp(event.x, 0, padWidth);
					const y = clamp(event.y, 0, ih);
					d3.select(svgEl).select<SVGCircleElement>('circle.marker').attr('cx', x).attr('cy', y);
				})
				.on('end', (event) => {
					const x = clamp(event.x, 0, padWidth);
					const y = clamp(event.y, 0, ih);
					coordinates = [
						clamp(xs.invert(x), ax0.range[0], ax0.range[1]),
						clamp(ys.invert(y), ax1.range[0], ax1.range[1]),
						coordinates[2] ?? (ax2.range[0] + ax2.range[1]) / 2
					];
				})
		);

		// Axis-waypoint guide lines for axes 0 & 1.
		for (const wp of ax0.waypoints ?? []) {
			const x = xs(wp.position);
			inner
				.append('line')
				.attr('x1', x)
				.attr('x2', x)
				.attr('y1', 0)
				.attr('y2', ih)
				.attr('stroke', wp.color ?? 'var(--color-muted)')
				.attr('stroke-dasharray', '3 5')
				.attr('opacity', 0.6)
				.attr('pointer-events', 'none');
			inner
				.append('text')
				.attr('x', x)
				.attr('y', -8)
				.attr('text-anchor', 'middle')
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 11)
				.attr('pointer-events', 'none')
				.text(wp.label);
		}
		for (const wp of ax1.waypoints ?? []) {
			const y = ys(wp.position);
			inner
				.append('line')
				.attr('x1', 0)
				.attr('x2', padWidth)
				.attr('y1', y)
				.attr('y2', y)
				.attr('stroke', wp.color ?? 'var(--color-muted)')
				.attr('stroke-dasharray', '3 5')
				.attr('opacity', 0.6)
				.attr('pointer-events', 'none');
			inner
				.append('text')
				.attr('x', -8)
				.attr('y', y)
				.attr('text-anchor', 'end')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 11)
				.attr('pointer-events', 'none')
				.text(wp.label);
		}

		// Endpoint labels for the pad axes.
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', ih + 22)
			.attr('text-anchor', 'start')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(ax0.min_label);
		inner
			.append('text')
			.attr('x', padWidth)
			.attr('y', ih + 22)
			.attr('text-anchor', 'end')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(ax0.max_label);
		inner
			.append('text')
			.attr('x', -8)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(ax1.min_label);
		inner
			.append('text')
			.attr('x', -8)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-weight', 'bold')
			.attr('pointer-events', 'none')
			.text(ax1.max_label);

		// History points dimmed under the active marker, coloured by their
		// recorded axis-2 value via the ramp.
		const lastIdx = historyPoints.length - 1;
		for (let i = 0; i < historyPoints.length; i++) {
			const dp = historyPoints[i];
			const cx = xs(dp.coordinates[0]);
			const cy = ys(dp.coordinates[1]);
			if (cx === undefined || cy === undefined || Number.isNaN(cx) || Number.isNaN(cy)) continue;
			const color = dp.color ?? ramp(dp.coordinates[2] ?? ramp.domain[0]);
			const opacity = lastIdx === 0 ? 0.45 : 0.15 + 0.3 * (i / lastIdx);
			inner
				.append('circle')
				.attr('class', 'dp-history')
				.attr('cx', cx)
				.attr('cy', cy)
				.attr('r', 4)
				.attr('fill', color)
				.attr('opacity', opacity)
				.attr('pointer-events', 'none');
		}

		const cx0 = xs(coordinates[0] ?? 0);
		const cy0 = ys(coordinates[1] ?? 0);
		const z0 = coordinates[2] ?? (ax2.range[0] + ax2.range[1]) / 2;

		const marker = inner
			.append('circle')
			.attr('class', 'marker')
			.attr('cx', cx0)
			.attr('cy', cy0)
			.attr('r', 11)
			.attr('fill', ramp(z0))
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 3)
			.attr('cursor', 'grab')
			.style('filter', 'drop-shadow(0 2px 5px rgba(0,0,0,0.45))');

		marker.call(
			d3
				.drag<SVGCircleElement, unknown>()
				.on('start', function () {
					d3.select(this).attr('cursor', 'grabbing');
				})
				.on('drag', function (event) {
					const x = clamp(event.x, 0, padWidth);
					const y = clamp(event.y, 0, ih);
					d3.select(this).attr('cx', x).attr('cy', y);
				})
				.on('end', function (event) {
					const x = clamp(event.x, 0, padWidth);
					const y = clamp(event.y, 0, ih);
					coordinates = [
						clamp(xs.invert(x), ax0.range[0], ax0.range[1]),
						clamp(ys.invert(y), ax1.range[0], ax1.range[1]),
						coordinates[2] ?? (ax2.range[0] + ax2.range[1]) / 2
					];
					d3.select(this).attr('cursor', 'grab');
				})
		);

		// --- Axis-2 slider (right column).
		const sliderX = padWidth + 30;
		const sliderWidth = 22;
		const slider = inner.append('g').attr('transform', `translate(${sliderX},0)`);
		const zScale = d3.scaleLinear().domain(ax2.range).range([ih, 0]);

		const sliderGradId = `picker3d-ramp-${Math.random().toString(36).slice(2, 8)}`;
		const grad = root
			.append('defs')
			.append('linearGradient')
			.attr('id', sliderGradId)
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
		const sliderTrack = slider
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', sliderWidth)
			.attr('height', ih)
			.attr('fill', `url(#${sliderGradId})`)
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-opacity', 0.4)
			.attr('cursor', 'crosshair');

		// Slider tick labels (min/zero/max) on the right side.
		slider
			.append('g')
			.attr('transform', `translate(${sliderWidth},0)`)
			.attr('color', 'var(--color-muted)')
			.attr('pointer-events', 'none')
			.call(
				d3
					.axisRight(zScale)
					.tickValues(
						ax2.range[0] < 0 && ax2.range[1] > 0
							? [ax2.range[0], 0, ax2.range[1]]
							: [ax2.range[0], ax2.range[1]]
					)
					.tickSizeOuter(0)
			);

		// Endpoint pole names below/above the slider — clipped to the slider
		// gutter so they don't drift into the pad.
		slider
			.append('text')
			.attr('x', sliderWidth / 2)
			.attr('y', ih + 20)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-size', 11)
			.attr('pointer-events', 'none')
			.text(ax2.min_label);
		slider
			.append('text')
			.attr('x', sliderWidth / 2)
			.attr('y', -8)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-fg)')
			.attr('font-size', 11)
			.attr('pointer-events', 'none')
			.text(ax2.max_label);

		// Slider handle: a horizontal bar at the current axis-2 value.
		const handleY = zScale(z0);
		const sliderHandle = slider
			.append('rect')
			.attr('class', 'z-handle')
			.attr('x', -4)
			.attr('y', handleY - 5)
			.attr('width', sliderWidth + 8)
			.attr('height', 10)
			.attr('fill', 'var(--color-bg)')
			.attr('stroke', 'var(--color-accent)')
			.attr('stroke-width', 2)
			.attr('cursor', 'grab');

		function commitZ(yPx: number) {
			const v = clamp(zScale.invert(yPx), ax2.range[0], ax2.range[1]);
			coordinates = [
				coordinates[0] ?? (ax0.range[0] + ax0.range[1]) / 2,
				coordinates[1] ?? (ax1.range[0] + ax1.range[1]) / 2,
				v
			];
			marker.attr('fill', ramp(v));
		}

		sliderTrack.call(
			d3
				.drag<SVGRectElement, unknown>()
				.clickDistance(0)
				.on('start', (event) => {
					const y = clamp(event.y, 0, ih);
					sliderHandle.attr('y', y - 5);
					marker.attr('fill', ramp(zScale.invert(y)));
				})
				.on('drag', (event) => {
					const y = clamp(event.y, 0, ih);
					sliderHandle.attr('y', y - 5);
					marker.attr('fill', ramp(zScale.invert(y)));
				})
				.on('end', (event) => {
					const y = clamp(event.y, 0, ih);
					commitZ(y);
				})
		);

		sliderHandle.call(
			d3
				.drag<SVGRectElement, unknown>()
				.on('start', function () {
					d3.select(this).attr('cursor', 'grabbing');
				})
				.on('drag', function (event) {
					const y = clamp(event.y, 0, ih);
					d3.select(this).attr('y', y - 5);
					marker.attr('fill', ramp(zScale.invert(y)));
				})
				.on('end', function (event) {
					const y = clamp(event.y, 0, ih);
					commitZ(y);
					d3.select(this).attr('cursor', 'grab');
				})
		);

		// Axis-2 name annotated below the pole label.
		slider
			.append('text')
			.attr('x', sliderWidth / 2)
			.attr('y', ih + 38)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--color-muted)')
			.attr('font-size', 10)
			.attr('pointer-events', 'none')
			.text(ax2.name);
	}
</script>

<svg
	bind:this={svgEl}
	viewBox="0 0 {dims.W} {dims.H}"
	preserveAspectRatio="xMidYMid meet"
	role="application"
	aria-label="Pick a position on the {graph.schema.dimensions}D spectrum"
></svg>

<style>
	svg {
		width: 100%;
		height: auto;
		display: block;
		user-select: none;
		touch-action: none;
	}
</style>
