<script lang="ts">
	import { onMount } from 'svelte';
	import * as d3 from 'd3';
	import type { Axis, Region } from '$lib/types.js';

	let {
		region = $bindable(),
		axes,
		selectedVertexIdx = null,
		onSelectedVertexChange
	}: {
		region: Region;
		axes: Axis[];
		// For polygon regions, the index of the vertex the user has clicked
		// on (null when nothing is selected). The parent owns the storage
		// (so it can key by region id) and gets notified via the callback.
		selectedVertexIdx?: number | null;
		onSelectedVertexChange?: (idx: number | null) => void;
	} = $props();

	function setSelectedVertex(idx: number | null) {
		onSelectedVertexChange?.(idx);
	}

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

	// Polygon-only handles to whatever setupPolygon produced — used by the
	// top-level coord-sync and selection effects below so external edits to
	// vertex coords or selection move the on-screen handles without rebuilding
	// the whole SVG.
	type PolygonRefs = {
		handles: d3.Selection<SVGCircleElement, unknown, null, undefined>[];
		halo: d3.Selection<SVGCircleElement, unknown, null, undefined>;
		path: d3.Selection<SVGPathElement, unknown, null, undefined>;
		xs: d3.ScaleLinear<number, number>;
		ys: d3.ScaleLinear<number, number>;
	};
	const polyRefs: { current: PolygonRefs | null } = { current: null };

	type BoxRefs = {
		rect: d3.Selection<SVGRectElement, unknown, null, undefined>;
		handles: { cornerX: 'min' | 'max'; cornerY: 'min' | 'max'; el: d3.Selection<SVGCircleElement, unknown, null, undefined> }[];
		xs: d3.ScaleLinear<number, number>;
		ys: d3.ScaleLinear<number, number>;
	};
	const boxRefs: { current: BoxRefs | null } = { current: null };

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

	// Coord-sync: when the editor's input fields change vertex coords we
	// don't rebuild (the structural key didn't change), so reposition handles
	// imperatively instead. Drag handlers don't write coords mid-drag, so
	// this won't fight live drags.
	const polyVertsKey = $derived(
		region.shape.type === 'polygon'
			? region.shape.vertices.map((v) => `${v[0]},${v[1]}`).join('|')
			: ''
	);
	$effect(() => {
		void polyVertsKey;
		const refs = polyRefs.current;
		if (!refs || region.shape.type !== 'polygon') return;
		const verts = region.shape.vertices;
		if (refs.handles.length !== verts.length) return;
		for (let i = 0; i < verts.length; i++) {
			refs.handles[i].attr('cx', refs.xs(verts[i][0])).attr('cy', refs.ys(verts[i][1]));
		}
		const pts = verts.map(([x, y]) => `${refs.xs(x)},${refs.ys(y)}`);
		refs.path.attr('d', `M ${pts.join(' L ')} Z`);
		updateHaloFromState();
	});

	$effect(() => {
		void selectedVertexIdx;
		updateHaloFromState();
	});

	function updateHaloFromState() {
		const refs = polyRefs.current;
		if (!refs || region.shape.type !== 'polygon') return;
		if (
			selectedVertexIdx == null ||
			selectedVertexIdx < 0 ||
			selectedVertexIdx >= region.shape.vertices.length
		) {
			refs.halo.attr('opacity', 0);
			return;
		}
		const v = region.shape.vertices[selectedVertexIdx];
		refs.halo.attr('cx', refs.xs(v[0])).attr('cy', refs.ys(v[1])).attr('opacity', 1);
	}

	// Coord-sync for box regions: when the editor's input fields write new
	// min/max, reposition the rect and the four corner handles without
	// rebuilding the SVG.
	const boxKey = $derived(
		region.shape.type === 'box'
			? `${region.shape.min[0]},${region.shape.min[1]},${region.shape.max[0]},${region.shape.max[1]}`
			: ''
	);
	$effect(() => {
		void boxKey;
		const refs = boxRefs.current;
		if (!refs || region.shape.type !== 'box') return;
		const shape = region.shape;
		const xLo = Math.min(shape.min[0], shape.max[0]);
		const xHi = Math.max(shape.min[0], shape.max[0]);
		const yLo = Math.min(shape.min[1], shape.max[1]);
		const yHi = Math.max(shape.min[1], shape.max[1]);
		refs.rect
			.attr('x', refs.xs(xLo))
			.attr('y', refs.ys(yHi))
			.attr('width', refs.xs(xHi) - refs.xs(xLo))
			.attr('height', refs.ys(yLo) - refs.ys(yHi));
		for (const h of refs.handles) {
			const cx = h.cornerX === 'min' ? refs.xs(shape.min[0]) : refs.xs(shape.max[0]);
			const cy = h.cornerY === 'min' ? refs.ys(shape.min[1]) : refs.ys(shape.max[1]);
			h.el.attr('cx', cx).attr('cy', cy);
		}
	});

	function setup() {
		if (!svgEl) return;
		const root = d3.select(svgEl);
		root.selectAll('*').remove();
		// Drop any prior shape-specific refs — the active shape's setup will
		// repopulate, while inactive coord-sync effects bail out on null refs.
		polyRefs.current = null;
		boxRefs.current = null;
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

		boxRefs.current = {
			rect,
			handles: cornerHandles.map(({ c, handle }) => ({
				cornerX: c.cornerX,
				cornerY: c.cornerY,
				el: handle
			})),
			xs,
			ys
		};

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
					// Clamp the drag to the half-plane where this corner stays
					// on the correct side of its opposite. Without this, dragging
					// past the opposite corner flips the rect and the corner
					// identities go out of sync with the visual.
					const otherXPx = c.cornerX === 'min' ? xs(shape.max[0]) : xs(shape.min[0]);
					const otherYPx = c.cornerY === 'min' ? ys(shape.max[1]) : ys(shape.min[1]);
					let x = clamp(event.x, 0, iw);
					let y = clamp(event.y, 0, ih);
					if (c.cornerX === 'min') x = Math.min(x, otherXPx);
					else x = Math.max(x, otherXPx);
					// In pixel space, "max" on the y-axis is at the TOP, i.e.
					// a smaller pixel y. So cornerY='max' clamps to <= otherY.
					if (c.cornerY === 'max') y = Math.min(y, otherYPx);
					else y = Math.max(y, otherYPx);

					d3.select(this).attr('cx', x).attr('cy', y);

					const xMin = c.cornerX === 'min' ? x : otherXPx;
					const xMax = c.cornerX === 'max' ? x : otherXPx;
					const yTop = c.cornerY === 'max' ? y : otherYPx;
					const yBot = c.cornerY === 'min' ? y : otherYPx;
					rect
						.attr('x', xMin)
						.attr('y', yTop)
						.attr('width', xMax - xMin)
						.attr('height', yBot - yTop);

					// Update the other three handles so all four track the rect.
					for (const { c: oc, handle } of cornerHandles) {
						if (oc.id === c.id) continue;
						const ox = oc.cornerX === 'min' ? xMin : xMax;
						const oy = oc.cornerY === 'max' ? yTop : yBot;
						handle.attr('cx', ox).attr('cy', oy);
					}
				})
				.on('end', function (event) {
					const otherX = c.cornerX === 'min' ? shape.max[0] : shape.min[0];
					const otherY = c.cornerY === 'min' ? shape.max[1] : shape.min[1];
					const otherXPx = c.cornerX === 'min' ? xs(shape.max[0]) : xs(shape.min[0]);
					const otherYPx = c.cornerY === 'min' ? ys(shape.max[1]) : ys(shape.min[1]);
					let x = clamp(event.x, 0, iw);
					let y = clamp(event.y, 0, ih);
					if (c.cornerX === 'min') x = Math.min(x, otherXPx);
					else x = Math.max(x, otherXPx);
					if (c.cornerY === 'max') y = Math.min(y, otherYPx);
					else y = Math.max(y, otherYPx);
					const newVal: [number, number] = [
						clamp(xs.invert(x), ax0.range[0], ax0.range[1]),
						clamp(ys.invert(y), ax1.range[0], ax1.range[1])
					];
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

		// Plot frame doubles as the add-vertex target — press, optionally drag,
		// then release. A static click still inserts at the press position
		// because d3.drag fires start/end even with zero movement.
		const frame = inner
			.append('rect')
			.attr('x', 0)
			.attr('y', 0)
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'rgba(255,255,255,0.02)')
			.attr('stroke', 'var(--color-muted)')
			.attr('stroke-opacity', 0.3)
			.attr('cursor', 'crosshair');

		// Mid-drag visuals — committed on 'end' so the structural rebuild
		// only fires once and doesn't tear down the d3.drag mid-gesture.
		let pendingIdx = -1;
		let pendingGhost: d3.Selection<SVGCircleElement, unknown, null, undefined> | null = null;
		let pendingGhostPath: d3.Selection<SVGPathElement, unknown, null, undefined> | null = null;

		const insertDrag = d3
			.drag<SVGRectElement, unknown>()
			.clickDistance(0)
			.on('start', function (event) {
				const px = clamp(event.x, 0, iw);
				const py = clamp(event.y, 0, ih);
				const verts = shape.vertices;
				let bestIdx = 0;
				let bestDist = Infinity;
				for (let i = 0; i < verts.length; i++) {
					const a = verts[i];
					const b = verts[(i + 1) % verts.length];
					const d = pointToSegmentDistPx(px, py, xs(a[0]), ys(a[1]), xs(b[0]), ys(b[1]));
					if (d < bestDist) {
						bestDist = d;
						bestIdx = i;
					}
				}
				pendingIdx = bestIdx;
				pendingGhost = inner
					.append('circle')
					.attr('class', 'vertex-ghost')
					.attr('cx', px)
					.attr('cy', py)
					.attr('r', 7)
					.attr('fill', region.color)
					.attr('stroke', 'var(--color-bg)')
					.attr('stroke-width', 2)
					.attr('opacity', 0.85)
					.attr('pointer-events', 'none');
				pendingGhostPath = inner
					.append('path')
					.attr('class', 'vertex-ghost-path')
					.attr('fill', region.color)
					.attr('opacity', 0.2)
					.attr('stroke', region.color)
					.attr('stroke-opacity', 0.5)
					.attr('stroke-dasharray', '3 3')
					.attr('stroke-width', 1.5)
					.attr('pointer-events', 'none');
				updatePendingPath(px, py);
			})
			.on('drag', function (event) {
				if (!pendingGhost) return;
				const x = clamp(event.x, 0, iw);
				const y = clamp(event.y, 0, ih);
				pendingGhost.attr('cx', x).attr('cy', y);
				updatePendingPath(x, y);
			})
			.on('end', function (event) {
				const x = clamp(event.x, 0, iw);
				const y = clamp(event.y, 0, ih);
				pendingGhost?.remove();
				pendingGhostPath?.remove();
				pendingGhost = null;
				pendingGhostPath = null;
				const newVertex: [number, number] = [
					clamp(xs.invert(x), ax0.range[0], ax0.range[1]),
					clamp(ys.invert(y), ax1.range[0], ax1.range[1])
				];
				const insertAt = pendingIdx + 1;
				const nextVerts = [
					...shape.vertices.slice(0, insertAt),
					newVertex,
					...shape.vertices.slice(insertAt)
				];
				setSelectedVertex(insertAt);
				// Replace the array (not mutate in place) so the structuralKey
				// effect re-fires and rebuilds the SVG with a handle on the
				// new vertex.
				shape.vertices = nextVerts;
				pendingIdx = -1;
			});
		frame.call(insertDrag);

		function updatePendingPath(px: number, py: number) {
			if (!pendingGhostPath || pendingIdx < 0) return;
			const insertAt = pendingIdx + 1;
			const verts = shape.vertices;
			const points: [number, number][] = [];
			for (let i = 0; i < verts.length; i++) {
				if (i === insertAt) points.push([px, py]);
				points.push([xs(verts[i][0]), ys(verts[i][1])]);
			}
			if (insertAt >= verts.length) points.push([px, py]);
			const d = 'M ' + points.map(([x, y]) => `${x},${y}`).join(' L ') + ' Z';
			pendingGhostPath.attr('d', d);
		}

		// Axis labels (compact)
		inner
			.append('text')
			.attr('x', 0)
			.attr('y', ih + 16)
			.attr('text-anchor', 'start')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.attr('pointer-events', 'none')
			.text(ax0.min_label);
		inner
			.append('text')
			.attr('x', iw)
			.attr('y', ih + 16)
			.attr('text-anchor', 'end')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.attr('pointer-events', 'none')
			.text(ax0.max_label);
		inner
			.append('text')
			.attr('x', -6)
			.attr('y', ih)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'middle')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.attr('pointer-events', 'none')
			.text(ax1.min_label);
		inner
			.append('text')
			.attr('x', -6)
			.attr('y', 0)
			.attr('text-anchor', 'end')
			.attr('dominant-baseline', 'hanging')
			.attr('font-size', 10)
			.attr('fill', 'var(--color-muted)')
			.attr('pointer-events', 'none')
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

		// Selection halo — rendered under the handles so it doesn't intercept
		// clicks. The top-level selection effect drives its visibility.
		const halo = inner
			.append('circle')
			.attr('class', 'vertex-halo')
			.attr('r', 12)
			.attr('fill', 'none')
			.attr('stroke', 'var(--color-accent)')
			.attr('stroke-width', 2)
			.attr('opacity', 0)
			.attr('pointer-events', 'none');

		// Vertex handles. Plain click selects; shift-click removes (when there
		// are more than 3 left). Drag repositions.
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
			h.on('click', (event) => {
				event.stopPropagation();
				if (event.shiftKey) {
					if (shape.vertices.length <= 3) return;
					if (selectedVertexIdx === i) setSelectedVertex(null);
					else if (selectedVertexIdx != null && selectedVertexIdx > i) {
						setSelectedVertex(selectedVertexIdx - 1);
					}
					shape.vertices = shape.vertices.filter((_, j) => j !== i);
					return;
				}
				setSelectedVertex(selectedVertexIdx === i ? null : i);
			});
			h.call(makeVertexDrag(i));
			return h;
		});

		polyRefs.current = { handles: vertexHandles, halo, path: polyPath, xs, ys };
		updateHaloFromState();

		function rebuildPath() {
			const pts = vertexHandles.map((h) => `${+h.attr('cx')},${+h.attr('cy')}`);
			polyPath.attr('d', `M ${pts.join(' L ')} Z`);
		}

		function makeVertexDrag(i: number) {
			return d3
				.drag<SVGCircleElement, unknown>()
				.on('start', function () {
					d3.select(this).attr('cursor', 'grabbing');
					setSelectedVertex(i);
				})
				.on('drag', function (event) {
					const x = clamp(event.x, 0, iw);
					const y = clamp(event.y, 0, ih);
					d3.select(this).attr('cx', x).attr('cy', y);
					rebuildPath();
					halo.attr('cx', x).attr('cy', y);
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

	function pointToSegmentDistPx(
		px: number,
		py: number,
		ax: number,
		ay: number,
		bx: number,
		by: number
	): number {
		const dx = bx - ax;
		const dy = by - ay;
		const len2 = dx * dx + dy * dy;
		if (len2 === 0) return Math.hypot(px - ax, py - ay);
		let t = ((px - ax) * dx + (py - ay) * dy) / len2;
		t = Math.max(0, Math.min(1, t));
		const cx = ax + t * dx;
		const cy = ay + t * dy;
		return Math.hypot(px - cx, py - cy);
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
