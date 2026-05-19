<script lang="ts">
	import { onMount } from 'svelte';
	import * as d3 from 'd3';
	import type { SpectrumDatapoint, SpectrumGraph, SpectrumView } from '$lib/types.js';
	import { buildColorRamp } from '$lib/graphs/spectrum/colorRamp.js';

	let {
		graph,
		coordinates = $bindable(),
		excludeDatapointId,
		view
	}: {
		graph: SpectrumGraph;
		coordinates: number[];
		// When editing an existing datapoint, omit it from the rendered history
		// so the active marker isn't doubled up by a static dot.
		excludeDatapointId?: string;
		// Active view, used to render the picker in the same layout as the
		// chart. For now only 2D radial views switch picker mode; cartesian
		// views (default or with axis swaps / time channels) use the standard
		// 2D pad — input is in axis space regardless.
		view?: SpectrumView;
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

	// Polar layout uses its own circular pad (setupPolar2D) where input is
	// pixel-polar → cartesian. Radial layout reuses the cartesian pad and
	// just overlays radial gridlines. Cartesian and everything else stay
	// with the standard 2D / 3D pads.
	// `polar` layout always uses the polar pad. `radial + pie` routes
	// through the same pad because semantically it's the polar conversion
	// with a pie-sector frame. `radial + circle` (or unset shape) uses the
	// standard cartesian pad with a radial overlay.
	const isPolar2D = $derived(
		graph.schema.dimensions === 2 &&
			(view?.layout === 'polar' || (view?.layout === 'radial' && view?.shape === 'pie')) &&
			typeof view?.x === 'number' &&
			typeof view?.y === 'number'
	);
	const isRadialOverlay2D = $derived(
		graph.schema.dimensions === 2 && view?.layout === 'radial' && view?.shape !== 'pie'
	);

	const dims = $derived(
		graph.schema.dimensions === 1
			? { W: 800, H: 160 }
			: graph.schema.dimensions === 3
				? { W: 720, H: 600 }
				: { W: 600, H: 600 }
	);

	function rebuild() {
		if (!svgEl) return;
		if (graph.schema.dimensions === 1) setup1D();
		else if (graph.schema.dimensions === 2) {
			if (isPolar2D) setupPolar2D();
			else setup2D();
		} else if (graph.schema.dimensions === 3) setup3D();
	}

	// Rebuild the picker when the set of historical datapoints changes —
	// otherwise a freshly-committed point doesn't show up in the dimmed
	// history until the form is closed and reopened. Keyed off length plus
	// dimension plus view-layout so the same effect handles flips between
	// cartesian and radial layouts too.
	const datapointsKey = $derived(
		`${graph.datapoints.length}|${graph.schema.dimensions}|${view?.layout ?? 'default'}|${view?.x ?? '-'}|${view?.y ?? '-'}`
	);
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
		// Polar picker manages its marker internally because xScale/yScale
		// are reused as polar scales and don't map directly to pixel x/y.
		if (isPolar2D) return;
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

		// Optional radial overlay — concentric "length" ellipses (or arcs
		// for shape='pie') + angle spokes drawn on top of the cartesian pad
		// when the active view asks for the radial layout. Decorations
		// only; doesn't change click semantics.
		if (isRadialOverlay2D) {
			drawRadialOverlay2D(inner, {
				xs,
				ys,
				xRange: ax0.range,
				yRange: ax1.range,
				iw,
				ih,
				shape: view?.shape ?? 'circle'
			});
		}

		marker.call(drag);
	}

	// Compute the angular range reachable from the origin given the axis-
	// space rect — same algorithm as the chart helper. Returns null when
	// no direction is reachable; sweep === 2π when origin is strictly
	// inside.
	function pickerAngularSpan(
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
		return { start: (gapStart + maxGap) % (2 * Math.PI), sweep: 2 * Math.PI - maxGap };
	}

	function drawRadialOverlay2D(
		inner: d3.Selection<SVGGElement, unknown, null, undefined>,
		opts: {
			xs: Linear;
			ys: Linear;
			xRange: [number, number];
			yRange: [number, number];
			iw: number;
			ih: number;
			shape: 'circle' | 'pie';
		}
	) {
		const { xs, ys, xRange, yRange, iw, ih, shape } = opts;
		const ox = xs(0);
		const oy = ys(0);
		const pxPerXUnit = xs(1) - xs(0) || 1;
		const pxPerYUnit = ys(0) - ys(1) || 1;
		const absPxPerXUnit = Math.abs(pxPerXUnit);
		const absPxPerYUnit = Math.abs(pxPerYUnit);
		const maxAbsX = Math.max(Math.abs(xRange[0]), Math.abs(xRange[1]));
		const maxAbsY = Math.max(Math.abs(yRange[0]), Math.abs(yRange[1]));
		const maxLen = Math.hypot(maxAbsX, maxAbsY) || 1;

		const span = shape === 'pie' ? pickerAngularSpan(xRange, yRange) : null;
		const isPie = !!span && span.sweep < 2 * Math.PI - 1e-6;

		const clipId = `picker-radial-clip-${Math.random().toString(36).slice(2, 8)}`;
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

		const N_ANG = 12;
		const inRange = (θ: number): boolean => {
			if (!isPie) return true;
			const θ1 = span!.start;
			const θ2 = (span!.start + span!.sweep) % (2 * Math.PI);
			if (θ1 <= θ2) return θ >= θ1 && θ <= θ2;
			return θ >= θ1 || θ <= θ2;
		};
		const reach = Math.hypot(iw, ih);
		for (let i = 0; i < N_ANG; i++) {
			const θ = (i * 2 * Math.PI) / N_ANG;
			if (!inRange(θ)) continue;
			overlay
				.append('line')
				.attr('x1', ox)
				.attr('y1', oy)
				.attr('x2', ox + reach * Math.cos(θ))
				.attr('y2', oy - reach * Math.sin(θ))
				.attr('stroke', 'var(--color-muted)')
				.attr('stroke-opacity', 0.18)
				.attr('stroke-dasharray', '2 4');
			if (i === 0) continue;
			const lr = 0.95 * maxLen;
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

	// 2D polar picker — circular pad with polar conversion. The view's two
	// numeric axes are read as cartesian channels: clicks at (px, py) map to
	// pixel polar (pixR, θ), then to magnitude/angle, then back to cartesian
	// coords (cx, cy). Coordinates remain stored in axis space, so a "click
	// at 3 o'clock half-out" stores e.g. coords[xIdx]≈0.7, coords[yIdx]≈0
	// rather than some derived radius/angle.
	function setupPolar2D() {
		if (!view) return;
		// Reachable from layout='polar' OR layout='radial'+shape='pie'.
		const isPolarLayout =
			view.layout === 'polar' || (view.layout === 'radial' && view.shape === 'pie');
		if (!isPolarLayout) return;
		if (typeof view.x !== 'number' || typeof view.y !== 'number') return;
		const xIdx = view.x;
		const yIdx = view.y;
		const xAxis = graph.schema.axes[xIdx];
		const yAxis = graph.schema.axes[yIdx];
		if (!xAxis || !yAxis) return;

		const root = d3.select(svgEl);
		root.selectAll('*').remove();

		const W = 600;
		const H = 600;
		const M = { top: 30, right: 30, bottom: 30, left: 30 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;
		const cxPx = iw / 2;
		const cyPx = ih / 2;
		const outerR = Math.min(iw, ih) / 2 - 30;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const maxAbsX = Math.max(Math.abs(xAxis.range[0]), Math.abs(xAxis.range[1]));
		const maxAbsY = Math.max(Math.abs(yAxis.range[0]), Math.abs(yAxis.range[1]));
		const maxMag = Math.hypot(maxAbsX, maxAbsY) || 1;
		const magScale: Linear = d3.scaleLinear().domain([0, maxMag]).range([0, outerR]);

		// Reuse xScale/yScale slots so the marker-sync $effect at script
		// top-level can read them, but polar mode handles its own marker
		// positioning (the effect early-returns when isPolar2D).
		xScale = magScale;
		yScale = magScale;

		const lengthLabel = view.x_label ?? `${xAxis.name} ⊕ ${yAxis.name}`;
		const angleLabel = view.y_label ?? `atan2(${yAxis.name}, ${xAxis.name})`;

		function projectCartesian(cx: number, cy: number): [number, number] {
			const mag = Math.hypot(cx, cy);
			const θ = Math.atan2(cy, cx);
			const pixR = magScale(mag);
			return [cxPx + pixR * Math.cos(θ), cyPx - pixR * Math.sin(θ)];
		}

		function unproject(px: number, py: number): { cx: number; cy: number } {
			const dx = px - cxPx;
			const dy = py - cyPx;
			let pixR = Math.hypot(dx, dy);
			if (pixR > outerR) pixR = outerR;
			const θ = Math.atan2(-dy, dx);
			const mag = magScale.invert(pixR);
			const cxRaw = mag * Math.cos(θ);
			const cyRaw = mag * Math.sin(θ);
			// Clamp to each axis's stored range. Negative-only ranges or
			// positive-only ranges will pin clicks beyond the axis's
			// reachable area to the boundary (intentional — it's better to
			// commit a valid value than to silently swallow the gesture).
			return {
				cx: clamp(cxRaw, xAxis.range[0], xAxis.range[1]),
				cy: clamp(cyRaw, yAxis.range[0], yAxis.range[1])
			};
		}

		// Pie-frame variant: when shape='pie' and the angular range from the
		// axis ranges doesn't span the full circle, the click target is a
		// pie-sector path and the rings/spokes are bounded to that wedge.
		const span = view.shape === 'pie' ? pickerAngularSpan(xAxis.range, yAxis.range) : null;
		const isPie = !!span && span.sweep < 2 * Math.PI - 1e-6;

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
				.attr('class', 'frame')
				.attr(
					'd',
					`M ${cxPx} ${cyPx} L ${sx} ${sy} A ${outerR} ${outerR} 0 ${largeArc} 1 ${ex} ${ey} Z`
				)
				.attr('fill', 'rgba(255,255,255,0.02)')
				.attr('stroke', 'var(--color-muted)')
				.attr('stroke-opacity', 0.5)
				.attr('cursor', 'crosshair');
		} else {
			inner
				.append('circle')
				.attr('class', 'frame')
				.attr('cx', cxPx)
				.attr('cy', cyPx)
				.attr('r', outerR)
				.attr('fill', 'rgba(255,255,255,0.02)')
				.attr('stroke', 'var(--color-muted)')
				.attr('stroke-opacity', 0.4)
				.attr('cursor', 'crosshair');
		}

		// Inner half-magnitude ring — arc when pie, full circle otherwise.
		// (The full-magnitude ring is the frame.)
		{
			const m = maxMag * 0.5;
			const rr = magScale(m);
			if (rr > 0.5) {
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
						.attr('stroke-opacity', 0.25)
						.attr('pointer-events', 'none');
				} else {
					inner
						.append('circle')
						.attr('cx', cxPx)
						.attr('cy', cyPx)
						.attr('r', rr)
						.attr('fill', 'none')
						.attr('stroke', 'var(--color-muted)')
						.attr('stroke-opacity', 0.25)
						.attr('pointer-events', 'none');
				}
				inner
					.append('text')
					.attr('x', cxPx + 4)
					.attr('y', cyPx - rr)
					.attr('font-size', 10)
					.attr('fill', 'var(--color-muted)')
					.attr('pointer-events', 'none')
					.text(m.toFixed(2));
			}
		}

		// Spokes — every 45°, restricted to the angular range when pie.
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
				.attr('stroke-opacity', 0.2)
				.attr('pointer-events', 'none');
			const deg = Math.round(((i * 360) / N_ANG) % 360);
			inner
				.append('text')
				.attr('x', cxPx + (outerR + 14) * Math.cos(θ))
				.attr('y', cyPx - (outerR + 14) * Math.sin(θ))
				.attr('text-anchor', 'middle')
				.attr('dominant-baseline', 'middle')
				.attr('font-size', 10)
				.attr('fill', 'var(--color-muted)')
				.attr('pointer-events', 'none')
				.text(`${deg}°`);
		}

		// Cardinal-pole labels (axis pole at 0°/90°/180°/270°). Pie skips
		// poles outside the angular range.
		const cardinals: { θ: number; label: string }[] = [
			{ θ: 0, label: xAxis.max_label || '' },
			{ θ: Math.PI / 2, label: yAxis.max_label || '' },
			{ θ: Math.PI, label: xAxis.min_label || '' },
			{ θ: (3 * Math.PI) / 2, label: yAxis.min_label || '' }
		];
		for (const c of cardinals) {
			if (!c.label) continue;
			if (!inAngularRange(c.θ)) continue;
			const dist = outerR + 30;
			inner
				.append('text')
				.attr('x', cxPx + dist * Math.cos(c.θ))
				.attr('y', cyPx - dist * Math.sin(c.θ))
				.attr('text-anchor', 'middle')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--color-fg)')
				.attr('font-weight', 'bold')
				.attr('font-size', 11)
				.attr('pointer-events', 'none')
				.text(c.label);
		}

		// Polar channel names.
		inner
			.append('text')
			.attr('x', cxPx + 6)
			.attr('y', cyPx + 14)
			.attr('font-size', 11)
			.attr('fill', 'var(--color-muted)')
			.attr('pointer-events', 'none')
			.text(`length: ${lengthLabel}`);
		inner
			.append('text')
			.attr('x', cxPx)
			.attr('y', cyPx - outerR - 22)
			.attr('text-anchor', 'middle')
			.attr('font-size', 11)
			.attr('fill', 'var(--color-muted)')
			.attr('pointer-events', 'none')
			.text(`angle: ${angleLabel}`);

		const seriesColor = graph.customization.theme.palette[0] ?? '#c98aff';

		// History points (polar-projected).
		const lastIdx = historyPoints.length - 1;
		for (let i = 0; i < historyPoints.length; i++) {
			const dp = historyPoints[i];
			const cx = dp.coordinates[xIdx];
			const cy = dp.coordinates[yIdx];
			if (cx === undefined || cy === undefined) continue;
			const [hx, hy] = projectCartesian(cx, cy);
			const opacity = lastIdx === 0 ? 0.45 : 0.15 + 0.3 * (i / lastIdx);
			inner
				.append('circle')
				.attr('class', 'dp-history')
				.attr('cx', hx)
				.attr('cy', hy)
				.attr('r', 4)
				.attr('fill', colorOf(dp, i))
				.attr('opacity', opacity)
				.attr('pointer-events', 'none');
		}

		// Active marker — uses the current cartesian coords if present,
		// otherwise the midpoint of each axis (matches SpectrumDatapointForm
		// initialisation).
		const initX = coordinates[xIdx] ?? (xAxis.range[0] + xAxis.range[1]) / 2;
		const initY = coordinates[yIdx] ?? (yAxis.range[0] + yAxis.range[1]) / 2;
		const [mx0, my0] = projectCartesian(initX, initY);
		const marker = inner
			.append('circle')
			.attr('class', 'marker')
			.attr('cx', mx0)
			.attr('cy', my0)
			.attr('r', 11)
			.attr('fill', seriesColor)
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 3)
			.attr('cursor', 'grab')
			.style('filter', 'drop-shadow(0 2px 5px rgba(0,0,0,0.45))');

		const padDrag = d3
			.drag<SVGCircleElement, unknown>()
			.clickDistance(0)
			.on('start', function (event) {
				const { cx, cy } = unproject(event.x, event.y);
				const [px, py] = projectCartesian(cx, cy);
				marker.attr('cx', px).attr('cy', py);
			})
			.on('drag', function (event) {
				const { cx, cy } = unproject(event.x, event.y);
				const [px, py] = projectCartesian(cx, cy);
				marker.attr('cx', px).attr('cy', py);
			})
			.on('end', function (event) {
				const { cx, cy } = unproject(event.x, event.y);
				writeCoordsCartesian(cx, cy);
			});

		// Frame is either a circle (full polar) or a path (pie sector); the
		// selector matches both.
		(inner.select('.frame') as unknown as d3.Selection<SVGElement, unknown, null, undefined>).call(
			padDrag as never
		);

		const markerDrag = d3
			.drag<SVGCircleElement, unknown>()
			.on('start', function () {
				d3.select(this).attr('cursor', 'grabbing');
			})
			.on('drag', function (event) {
				const { cx, cy } = unproject(event.x, event.y);
				const [px, py] = projectCartesian(cx, cy);
				d3.select(this).attr('cx', px).attr('cy', py);
			})
			.on('end', function (event) {
				const { cx, cy } = unproject(event.x, event.y);
				writeCoordsCartesian(cx, cy);
				d3.select(this).attr('cursor', 'grab');
			});
		marker.call(markerDrag);

		function writeCoordsCartesian(cx: number, cy: number) {
			const next = [...coordinates];
			while (next.length < graph.schema.dimensions) next.push(0);
			next[xIdx] = cx;
			next[yIdx] = cy;
			coordinates = next;
		}
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
