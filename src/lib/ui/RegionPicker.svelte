<script lang="ts">
	import { onMount } from 'svelte';
	import * as d3 from 'd3';
	import type { Axis, Region } from '$lib/types.js';

	let { region = $bindable(), axes }: { region: Region; axes: Axis[] } = $props();

	let svgEl: SVGSVGElement;

	const dims = $derived(axes.length === 2 ? { W: 360, H: 360 } : { W: 600, H: 90 });

	// Re-setup on structural changes (shape type, polygon vertex count, color).
	// Coordinate changes during drag don't trigger this — drag handlers
	// imperatively update SVG and write to state on drag-end. Pure-coord
	// state changes (e.g. another component updates the region) would not
	// reflect here in v1; the editor is the only mutator in practice.
	const structuralKey = $derived(structuralKeyOf(region));

	function structuralKeyOf(r: Region): string {
		const base = `${r.shape.type}|${r.color}|${r.opacity ?? 0.3}`;
		if (r.shape.type === 'polygon') return `${base}|${r.shape.vertices.length}`;
		return base;
	}

	// Track the last applied structural key so the effect knows whether to
	// rebuild. A plain (non-reactive) ref is intentional — we don't want the
	// gate variable itself to participate in Svelte's reactivity.
	const lastKeyRef: { current: string } = { current: '' };

	$effect(() => {
		if (!svgEl) return;
		if (structuralKey === lastKeyRef.current) return;
		lastKeyRef.current = structuralKey;
		setup();
	});

	onMount(() => {
		if (svgEl) {
			lastKeyRef.current = structuralKey;
			setup();
		}
	});

	function setup() {
		if (!svgEl) return;
		const root = d3.select(svgEl);
		root.selectAll('*').remove();
		if (region.shape.type === 'range') setupRange();
		else if (region.shape.type === 'box') setupBox();
		else if (region.shape.type === 'polygon') setupPolygon();
	}

	function clamp(v: number, lo: number, hi: number): number {
		return Math.max(lo, Math.min(hi, v));
	}

	function setupRange() {
		if (region.shape.type !== 'range') return;
		const shape = region.shape;
		const root = d3.select(svgEl);

		const W = 600;
		const H = 90;
		const M = { top: 22, right: 30, bottom: 28, left: 30 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const axis = axes[0];
		const xs: d3.ScaleLinear<number, number> = d3.scaleLinear().domain(axis.range).range([0, iw]);
		const lineY = ih / 2;

		// Endpoint labels
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', lineY + 22)
			.attr('text-anchor', 'start')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(axis.min_label);
		inner
			.append('text')
			.attr('x', iw)
			.attr('y', lineY + 22)
			.attr('text-anchor', 'end')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(axis.max_label);

		// Backbone line
		inner
			.append('line')
			.attr('x1', 0)
			.attr('x2', iw)
			.attr('y1', lineY)
			.attr('y2', lineY)
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-width', 1.5)
			.attr('opacity', 0.5)
			.attr('pointer-events', 'none');

		// Waypoints (faded)
		for (const wp of axis.waypoints ?? []) {
			const x = xs(wp.position);
			inner
				.append('line')
				.attr('x1', x)
				.attr('x2', x)
				.attr('y1', lineY - 8)
				.attr('y2', lineY + 8)
				.attr('stroke', 'var(--color-muted)')
				.attr('opacity', 0.4)
				.attr('pointer-events', 'none');
			inner
				.append('text')
				.attr('x', x)
				.attr('y', lineY - 12)
				.attr('text-anchor', 'middle')
				.attr('font-size', 9)
				.attr('fill', 'var(--color-muted)')
				.attr('opacity', 0.7)
				.attr('pointer-events', 'none')
				.text(wp.label);
		}

		// Region bar
		const bar = inner
			.append('rect')
			.attr('y', lineY - 12)
			.attr('height', 24)
			.attr('fill', region.color)
			.attr('opacity', 0.45)
			.attr('cursor', 'grab');

		// Initial position
		updateBar();

		function updateBar() {
			const x0 = xs(shape.min);
			const x1 = xs(shape.max);
			bar.attr('x', Math.min(x0, x1)).attr('width', Math.abs(x1 - x0));
		}

		// Move-whole-range drag on the bar.
		const barDrag = d3
			.drag<SVGRectElement, unknown>()
			.on('start', function (event) {
				d3.select(this).attr('cursor', 'grabbing');
				const center = (xs(shape.min) + xs(shape.max)) / 2;
				const span = shape.max - shape.min;
				d3.select(this).datum({ offset: event.x - center, span });
			})
			.on('drag', function (event) {
				const datum = d3.select(this).datum() as { offset: number; span: number };
				const newCenterPx = clamp(event.x - datum.offset, 0, iw);
				const newCenterVal = xs.invert(newCenterPx);
				const half = datum.span / 2;
				let lo = newCenterVal - half;
				let hi = newCenterVal + half;
				// Clamp without resizing
				if (lo < axis.range[0]) {
					hi += axis.range[0] - lo;
					lo = axis.range[0];
				} else if (hi > axis.range[1]) {
					lo -= hi - axis.range[1];
					hi = axis.range[1];
				}
				bar.attr('x', xs(lo)).attr('width', xs(hi) - xs(lo));
				minHandle.attr('cx', xs(lo));
				maxHandle.attr('cx', xs(hi));
			})
			.on('end', function () {
				d3.select(this).attr('cursor', 'grab');
				const x = +bar.attr('x');
				const w = +bar.attr('width');
				shape.min = clamp(xs.invert(x), axis.range[0], axis.range[1]);
				shape.max = clamp(xs.invert(x + w), axis.range[0], axis.range[1]);
			});
		bar.call(barDrag);

		// Min/max handles (declared together so updateBar can reference them).
		const minHandle = inner
			.append('circle')
			.attr('cy', lineY)
			.attr('r', 7)
			.attr('fill', region.color)
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 2)
			.attr('cursor', 'ew-resize');
		const maxHandle = inner
			.append('circle')
			.attr('cy', lineY)
			.attr('r', 7)
			.attr('fill', region.color)
			.attr('stroke', 'var(--color-bg)')
			.attr('stroke-width', 2)
			.attr('cursor', 'ew-resize');

		minHandle.attr('cx', xs(shape.min));
		maxHandle.attr('cx', xs(shape.max));

		const minDrag = d3
			.drag<SVGCircleElement, unknown>()
			.on('drag', function (event) {
				const x = clamp(event.x, 0, iw);
				d3.select(this).attr('cx', x);
				const otherX = +maxHandle.attr('cx');
				bar.attr('x', Math.min(x, otherX)).attr('width', Math.abs(x - otherX));
			})
			.on('end', function (event) {
				const x = clamp(event.x, 0, iw);
				const v = clamp(xs.invert(x), axis.range[0], axis.range[1]);
				const other = shape.max;
				shape.min = Math.min(v, other);
				shape.max = Math.max(v, other);
			});
		const maxDrag = d3
			.drag<SVGCircleElement, unknown>()
			.on('drag', function (event) {
				const x = clamp(event.x, 0, iw);
				d3.select(this).attr('cx', x);
				const otherX = +minHandle.attr('cx');
				bar.attr('x', Math.min(x, otherX)).attr('width', Math.abs(x - otherX));
			})
			.on('end', function (event) {
				const x = clamp(event.x, 0, iw);
				const v = clamp(xs.invert(x), axis.range[0], axis.range[1]);
				const other = shape.min;
				shape.min = Math.min(v, other);
				shape.max = Math.max(v, other);
			});
		minHandle.call(minDrag);
		maxHandle.call(maxDrag);
	}

	function setupBox() {
		if (region.shape.type !== 'box') return;
		const shape = region.shape;
		const root = d3.select(svgEl);

		const W = 360;
		const H = 360;
		const M = { top: 18, right: 18, bottom: 36, left: 36 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const ax0 = axes[0];
		const ax1 = axes[1];
		const xs = d3.scaleLinear().domain(ax0.range).range([0, iw]);
		const ys = d3.scaleLinear().domain(ax1.range).range([ih, 0]);

		// Plot frame
		inner
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'rgba(255,255,255,0.02)')
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-opacity', 0.3)
			.attr('pointer-events', 'none');

		// Axis labels
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', ih + 16)
			.attr('text-anchor', 'start')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(ax0.min_label);
		inner
			.append('text')
			.attr('x', iw)
			.attr('y', ih + 16)
			.attr('text-anchor', 'end')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(ax0.max_label);
		inner
			.append('text')
			.attr('x', -6)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(ax1.min_label);
		inner
			.append('text')
			.attr('x', -6)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'hanging')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(ax1.max_label);

		// Waypoint guide lines
		for (const wp of ax0.waypoints ?? []) {
			const x = xs(wp.position);
			inner
				.append('line')
				.attr('x1', x)
				.attr('x2', x)
				.attr('y1', 0)
				.attr('y2', ih)
				.attr('stroke', 'var(--color-muted)')
				.attr('stroke-dasharray', '2 4')
				.attr('opacity', 0.4)
				.attr('pointer-events', 'none');
		}
		for (const wp of ax1.waypoints ?? []) {
			const y = ys(wp.position);
			inner
				.append('line')
				.attr('x1', 0)
				.attr('x2', iw)
				.attr('y1', y)
				.attr('y2', y)
				.attr('stroke', 'var(--color-muted)')
				.attr('stroke-dasharray', '2 4')
				.attr('opacity', 0.4)
				.attr('pointer-events', 'none');
		}

		// Box rectangle
		const rect = inner
			.append('rect')
			.attr('fill', region.color)
			.attr('opacity', 0.35)
			.attr('cursor', 'grab');

		function updateRect() {
			const x0 = xs(shape.min[0]);
			const x1 = xs(shape.max[0]);
			const y1 = ys(shape.max[1]); // top
			const y0 = ys(shape.min[1]); // bottom
			rect.attr('x', Math.min(x0, x1)).attr('width', Math.abs(x1 - x0));
			rect.attr('y', Math.min(y0, y1)).attr('height', Math.abs(y1 - y0));
		}
		updateRect();

		// Center drag — moves whole box
		const centerDrag = d3
			.drag<SVGRectElement, unknown>()
			.on('start', function (event) {
				d3.select(this).attr('cursor', 'grabbing');
				const cx = (xs(shape.min[0]) + xs(shape.max[0])) / 2;
				const cy = (ys(shape.min[1]) + ys(shape.max[1])) / 2;
				d3.select(this).datum({
					offX: event.x - cx,
					offY: event.y - cy,
					spanX: shape.max[0] - shape.min[0],
					spanY: shape.max[1] - shape.min[1]
				});
			})
			.on('drag', function (event) {
				const d = d3.select(this).datum() as {
					offX: number;
					offY: number;
					spanX: number;
					spanY: number;
				};
				const ncx = clamp(event.x - d.offX, 0, iw);
				const ncy = clamp(event.y - d.offY, 0, ih);
				const cxVal = xs.invert(ncx);
				const cyVal = ys.invert(ncy);
				let xLo = cxVal - d.spanX / 2;
				let xHi = cxVal + d.spanX / 2;
				let yLo = cyVal - d.spanY / 2;
				let yHi = cyVal + d.spanY / 2;
				if (xLo < ax0.range[0]) {
					xHi += ax0.range[0] - xLo;
					xLo = ax0.range[0];
				} else if (xHi > ax0.range[1]) {
					xLo -= xHi - ax0.range[1];
					xHi = ax0.range[1];
				}
				if (yLo < ax1.range[0]) {
					yHi += ax1.range[0] - yLo;
					yLo = ax1.range[0];
				} else if (yHi > ax1.range[1]) {
					yLo -= yHi - ax1.range[1];
					yHi = ax1.range[1];
				}
				rect
					.attr('x', xs(xLo))
					.attr('y', ys(yHi))
					.attr('width', xs(xHi) - xs(xLo))
					.attr('height', ys(yLo) - ys(yHi));
				updateCornerPositions(xLo, yLo, xHi, yHi);
			})
			.on('end', function () {
				d3.select(this).attr('cursor', 'grab');
				const x = +rect.attr('x');
				const y = +rect.attr('y');
				const w = +rect.attr('width');
				const h = +rect.attr('height');
				shape.min = [
					clamp(xs.invert(x), ax0.range[0], ax0.range[1]),
					clamp(ys.invert(y + h), ax1.range[0], ax1.range[1])
				];
				shape.max = [
					clamp(xs.invert(x + w), ax0.range[0], ax0.range[1]),
					clamp(ys.invert(y), ax1.range[0], ax1.range[1])
				];
			});
		rect.call(centerDrag);

		// Corner handles (TL, TR, BL, BR by axis-coord). Identified by which
		// (xMin/xMax, yMin/yMax) they sit on, so dragging one resizes the
		// right edge of the box.
		type Corner = { id: string; cornerX: 'min' | 'max'; cornerY: 'min' | 'max' };
		const corners: Corner[] = [
			{ id: 'tl', cornerX: 'min', cornerY: 'max' },
			{ id: 'tr', cornerX: 'max', cornerY: 'max' },
			{ id: 'bl', cornerX: 'min', cornerY: 'min' },
			{ id: 'br', cornerX: 'max', cornerY: 'min' }
		];

		const cornerHandles = corners.map((c) => {
			const handle = inner
				.append('circle')
				.attr('class', `handle handle-${c.id}`)
				.attr('r', 7)
				.attr('fill', region.color)
				.attr('stroke', 'var(--color-bg)')
				.attr('stroke-width', 2)
				.attr('cursor', 'crosshair');
			handle.call(makeCornerDrag(c));
			return { c, handle };
		});

		function updateCornerPositions(xLo: number, yLo: number, xHi: number, yHi: number) {
			for (const { c, handle } of cornerHandles) {
				const x = c.cornerX === 'min' ? xs(xLo) : xs(xHi);
				const y = c.cornerY === 'min' ? ys(yLo) : ys(yHi);
				handle.attr('cx', x).attr('cy', y);
			}
		}
		updateCornerPositions(shape.min[0], shape.min[1], shape.max[0], shape.max[1]);

		function makeCornerDrag(c: Corner) {
			return d3
				.drag<SVGCircleElement, unknown>()
				.on('drag', function (event) {
					const x = clamp(event.x, 0, iw);
					const y = clamp(event.y, 0, ih);
					d3.select(this).attr('cx', x).attr('cy', y);
					// Resize rect: keep the OPPOSITE corner anchored, move this one.
					const otherX = c.cornerX === 'min' ? xs(shape.max[0]) : xs(shape.min[0]);
					const otherY = c.cornerY === 'min' ? ys(shape.max[1]) : ys(shape.min[1]);
					const xMin = Math.min(x, otherX);
					const xMax = Math.max(x, otherX);
					const yTop = Math.min(y, otherY);
					const yBot = Math.max(y, otherY);
					rect
						.attr('x', xMin)
						.attr('y', yTop)
						.attr('width', xMax - xMin)
						.attr('height', yBot - yTop);
				})
				.on('end', function (event) {
					const x = clamp(event.x, 0, iw);
					const y = clamp(event.y, 0, ih);
					const newVal: [number, number] = [
						clamp(xs.invert(x), ax0.range[0], ax0.range[1]),
						clamp(ys.invert(y), ax1.range[0], ax1.range[1])
					];
					const otherX = c.cornerX === 'min' ? shape.max[0] : shape.min[0];
					const otherY = c.cornerY === 'min' ? shape.max[1] : shape.min[1];
					shape.min = [Math.min(newVal[0], otherX), Math.min(newVal[1], otherY)];
					shape.max = [Math.max(newVal[0], otherX), Math.max(newVal[1], otherY)];
				});
		}
	}

	function setupPolygon() {
		if (region.shape.type !== 'polygon') return;
		const shape = region.shape;
		const root = d3.select(svgEl);

		const W = 360;
		const H = 360;
		const M = { top: 18, right: 18, bottom: 36, left: 36 };
		const iw = W - M.left - M.right;
		const ih = H - M.top - M.bottom;

		const inner = root.append('g').attr('transform', `translate(${M.left},${M.top})`);

		const ax0 = axes[0];
		const ax1 = axes[1];
		const xs = d3.scaleLinear().domain(ax0.range).range([0, iw]);
		const ys = d3.scaleLinear().domain(ax1.range).range([ih, 0]);

		// Plot frame
		inner
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'rgba(255,255,255,0.02)')
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-opacity', 0.3)
			.attr('pointer-events', 'none');

		// Axis labels (compact)
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', ih + 16)
			.attr('text-anchor', 'start')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(ax0.min_label);
		inner
			.append('text')
			.attr('x', iw)
			.attr('y', ih + 16)
			.attr('text-anchor', 'end')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(ax0.max_label);
		inner
			.append('text')
			.attr('x', -6)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(ax1.min_label);
		inner
			.append('text')
			.attr('x', -6)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'hanging')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.text(ax1.max_label);

		// Waypoint guide lines
		for (const wp of ax0.waypoints ?? []) {
			const x = xs(wp.position);
			inner
				.append('line')
				.attr('x1', x)
				.attr('x2', x)
				.attr('y1', 0)
				.attr('y2', ih)
				.attr('stroke', 'var(--color-muted)')
				.attr('stroke-dasharray', '2 4')
				.attr('opacity', 0.4)
				.attr('pointer-events', 'none');
		}
		for (const wp of ax1.waypoints ?? []) {
			const y = ys(wp.position);
			inner
				.append('line')
				.attr('x1', 0)
				.attr('x2', iw)
				.attr('y1', y)
				.attr('y2', y)
				.attr('stroke', 'var(--color-muted)')
				.attr('stroke-dasharray', '2 4')
				.attr('opacity', 0.4)
				.attr('pointer-events', 'none');
		}

		// Polygon path
		const polyPath = inner
			.append('path')
			.attr('fill', region.color)
			.attr('opacity', 0.35)
			.attr('stroke', region.color)
			.attr('stroke-opacity', 0.7)
			.attr('stroke-width', 1.5)
			.attr('pointer-events', 'none');

		function pathFromVertices(): string {
			return 'M ' + shape.vertices.map(([x, y]) => `${xs(x)},${ys(y)}`).join(' L ') + ' Z';
		}
		polyPath.attr('d', pathFromVertices());

		// Vertex handles
		const vertexHandles = shape.vertices.map((_, i) => {
			const h = inner
				.append('circle')
				.attr('class', `handle vertex-${i}`)
				.attr('r', 7)
				.attr('fill', region.color)
				.attr('stroke', 'var(--color-bg)')
				.attr('stroke-width', 2)
				.attr('cursor', 'grab')
				.attr('cx', xs(shape.vertices[i][0]))
				.attr('cy', ys(shape.vertices[i][1]));
			h.call(makeVertexDrag(i));
			return h;
		});

		function rebuildPath() {
			const pts = vertexHandles.map((h) => `${+h.attr('cx')},${+h.attr('cy')}`);
			polyPath.attr('d', `M ${pts.join(' L ')} Z`);
		}

		function makeVertexDrag(i: number) {
			return d3
				.drag<SVGCircleElement, unknown>()
				.on('start', function () {
					d3.select(this).attr('cursor', 'grabbing');
				})
				.on('drag', function (event) {
					const x = clamp(event.x, 0, iw);
					const y = clamp(event.y, 0, ih);
					d3.select(this).attr('cx', x).attr('cy', y);
					rebuildPath();
				})
				.on('end', function (event) {
					d3.select(this).attr('cursor', 'grab');
					const x = clamp(event.x, 0, iw);
					const y = clamp(event.y, 0, ih);
					const xVal = clamp(xs.invert(x), ax0.range[0], ax0.range[1]);
					const yVal = clamp(ys.invert(y), ax1.range[0], ax1.range[1]);
					shape.vertices[i] = [xVal, yVal];
				});
		}
	}
</script>

<svg
	bind:this={svgEl}
	viewBox="0 0 {dims.W} {dims.H}"
	preserveAspectRatio="xMidYMid meet"
	role="application"
	aria-label="Drag to edit region bounds"
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
