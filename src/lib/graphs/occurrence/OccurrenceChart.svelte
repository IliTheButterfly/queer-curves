<script lang="ts">
	// Bar chart of occurrences rolled up per day/week/month, stacked (or
	// grouped) by counter. Bars rather than a line: occurrences are discrete
	// counts inside a period, and a line between them would imply the
	// in-between values existed.
	import * as d3 from 'd3';
	import type { OccurrenceBucket, OccurrenceGraph } from '$lib/types.js';
	import {
		buildBuckets,
		chartWindow,
		counterColor,
		defaultBucketOf,
		formatAmount,
		formatBucketLabel,
		rollingMean,
		type Bucket
	} from './aggregate.js';

	let {
		graph,
		bucket
	}: {
		graph: OccurrenceGraph;
		bucket?: OccurrenceBucket;
	} = $props();

	let svgEl: SVGSVGElement;

	const activeBucket = $derived(bucket ?? defaultBucketOf(graph));
	const series = $derived(buildBuckets(graph, activeBucket));
	// Charts show a trailing window; the full dense series stays available to
	// stats, which legitimately want all of history.
	const window_ = $derived(chartWindow(series));

	const W = 800;
	const H = 400;

	$effect(() => {
		if (!svgEl) return;
		render(svgEl, graph, window_.buckets, activeBucket);
	});

	function render(
		el: SVGSVGElement,
		g: OccurrenceGraph,
		buckets: Bucket[],
		bucketKind: OccurrenceBucket
	) {
		const root = d3.select(el);
		root.selectAll('*').remove();

		if (buckets.length === 0) {
			root
				.append('text')
				.attr('x', 16)
				.attr('y', 32)
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 13)
				.text('No occurrences logged yet — tap a counter below to start.');
			return;
		}

		const counters = g.schema.counters;
		const palette = g.customization.theme.palette;
		const grouped = g.customization.bar_style?.mode === 'grouped';
		const showTargets = g.customization.show_targets !== false;

		const margin = { top: 16, right: 16, bottom: 48, left: 48 };
		const iw = W - margin.left - margin.right;
		const ih = H - margin.top - margin.bottom;

		const inner = root.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

		const x = d3
			.scaleBand<string>()
			.domain(buckets.map((b) => b.key))
			.range([0, iw])
			.padding(buckets.length > 60 ? 0.05 : 0.2);

		// Cap how wide a bar can get. With one or two buckets the band scale
		// would otherwise hand each bar half the chart, which reads as a
		// filled area rather than a count.
		const MAX_BAR = 64;
		const barW = Math.min(x.bandwidth(), MAX_BAR);
		const barInset = (x.bandwidth() - barW) / 2;

		// Grouped mode splits each band between counters that actually have
		// data — reserving a slot for an unused counter just adds whitespace.
		const activeCounterIds = counters
			.map((c) => c.id)
			.filter((id) => buckets.some((b) => (b.totals[id] ?? 0) !== 0));
		const xInner = d3
			.scaleBand<string>()
			.domain(activeCounterIds.length > 0 ? activeCounterIds : [''])
			.range([0, barW])
			.padding(0.08);

		// In stacked mode the ceiling is the tallest stack; in grouped mode
		// it's the tallest single bar. Targets can also exceed both, and a
		// target line off the top of the chart is useless.
		const stackMax = d3.max(buckets, (b) => b.total) ?? 0;
		const singleMax =
			d3.max(buckets, (b) => d3.max(counters, (c) => b.totals[c.id] ?? 0) ?? 0) ?? 0;
		const targetMax = showTargets
			? (d3.max(
					counters.filter((c) => c.target?.period === bucketKind),
					(c) => c.target!.amount
				) ?? 0)
			: 0;
		const yMax = Math.max(grouped ? singleMax : stackMax, targetMax, 1);

		const y = d3.scaleLinear().domain([0, yMax]).nice().range([ih, 0]);

		// Gridlines first so bars sit on top of them.
		inner
			.append('g')
			.attr('class', 'grid')
			.selectAll('line')
			.data(y.ticks(5))
			.join('line')
			.attr('x1', 0)
			.attr('x2', iw)
			.attr('y1', (d) => y(d))
			.attr('y2', (d) => y(d))
			.attr('stroke', 'rgba(255,255,255,0.06)');

		// Thin out x labels so a year of daily bars stays readable.
		const labelStride = Math.max(1, Math.ceil(buckets.length / 12));
		const xAxis = inner
			.append('g')
			.attr('transform', `translate(0,${ih})`)
			.call(
				d3
					.axisBottom(x)
					.tickValues(buckets.filter((_, i) => i % labelStride === 0).map((b) => b.key))
					.tickFormat((key) => {
						const b = buckets.find((bb) => bb.key === key);
						return b ? formatBucketLabel(b.start, bucketKind) : '';
					})
					.tickSizeOuter(0)
			);
		xAxis.selectAll('text').attr('fill', 'var(--color-muted)').attr('font-size', 10);
		xAxis.selectAll('line,path').attr('stroke', 'rgba(255,255,255,0.2)');

		const yAxis = inner.append('g').call(d3.axisLeft(y).ticks(5).tickSizeOuter(0));
		yAxis.selectAll('text').attr('fill', 'var(--color-muted)').attr('font-size', 10);
		yAxis.selectAll('line,path').attr('stroke', 'rgba(255,255,255,0.2)');

		for (const [ci, counter] of counters.entries()) {
			const color = counterColor(counter, ci, palette);
			const withValue = buckets.filter((b) => (b.totals[counter.id] ?? 0) !== 0);
			if (withValue.length === 0) continue;

			inner
				.append('g')
				.selectAll('rect')
				.data(withValue)
				.join('rect')
				.attr('x', (b) => {
					const base = (x(b.key) ?? 0) + barInset;
					return grouped ? base + (xInner(counter.id) ?? 0) : base;
				})
				.attr('width', grouped ? xInner.bandwidth() : barW)
				.attr('y', (b) => {
					const v = b.totals[counter.id] ?? 0;
					if (grouped) return y(v);
					// Stack: offset by everything drawn below this counter.
					let below = 0;
					for (let j = 0; j < ci; j++) below += b.totals[counters[j].id] ?? 0;
					return y(below + v);
				})
				.attr('height', (b) => {
					const v = b.totals[counter.id] ?? 0;
					return Math.max(0, y(0) - y(v));
				})
				.attr('fill', color)
				.attr('opacity', 0.85)
				.append('title')
				.text(
					(b) =>
						`${formatBucketLabel(b.start, bucketKind)} — ${counter.label}: ` +
						`${formatAmount(b.totals[counter.id] ?? 0)} ${counter.unit} ` +
						`(${b.counts[counter.id] ?? 0}×)`
				);

			// Target line, only when the target's period matches what's on the
			// x axis — a weekly limit drawn across daily bars would read as a
			// daily limit and mislead badly.
			if (showTargets && counter.target && counter.target.period === bucketKind) {
				const ty = y(counter.target.amount);
				inner
					.append('line')
					.attr('x1', 0)
					.attr('x2', iw)
					.attr('y1', ty)
					.attr('y2', ty)
					.attr('stroke', color)
					.attr('stroke-width', 1.5)
					.attr('stroke-dasharray', '6 4')
					.attr('opacity', 0.9);
				inner
					.append('text')
					.attr('x', iw - 4)
					.attr('y', ty - 4)
					.attr('text-anchor', 'end')
					.attr('fill', color)
					.attr('font-size', 10)
					.text(
						`${counter.target.direction === 'at_most' ? 'limit' : 'goal'} ` +
							`${formatAmount(counter.target.amount)}`
					);
			}
		}

		// Rolling mean of the combined total — the trend line that tells you
		// whether a bad week was a blip.
		const window = graph.customization.bar_style?.rolling_window ?? 0;
		if (window >= 2 && buckets.length >= window) {
			const means = rollingMean(buckets, window);
			const line = d3
				.line<{ i: number; v: number | null }>()
				.defined((d) => d.v !== null)
				.x((d) => (x(buckets[d.i].key) ?? 0) + x.bandwidth() / 2)
				.y((d) => y(d.v as number));
			inner
				.append('path')
				.datum(means.map((v, i) => ({ i, v })))
				.attr('fill', 'none')
				.attr('stroke', 'var(--color-fg)')
				.attr('stroke-width', 1.5)
				.attr('opacity', 0.6)
				.attr('d', line);
		}

		// Say when the visible bars aren't the most recent ones — an axis that
		// stops at May while today is August must not be read as "up to now".
		if (window_.slid) {
			const last = buckets[buckets.length - 1];
			inner
				.append('text')
				.attr('x', 0)
				.attr('y', -4)
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 10)
				.text(`nothing logged since ${formatBucketLabel(last.start, bucketKind)}`);
		} else if (window_.clipped) {
			inner
				.append('text')
				.attr('x', 0)
				.attr('y', -4)
				.attr('fill', 'var(--color-muted)')
				.attr('font-size', 10)
				.text(`last ${buckets.length} ${bucketKind}s`);
		}
	}

	const legendEntries = $derived(
		graph.schema.counters.map((c, i) => ({
			id: c.id,
			label: c.label,
			unit: c.unit,
			color: counterColor(c, i, graph.customization.theme.palette)
		}))
	);

	const legendPosition = $derived(graph.customization.legend?.position ?? 'bottom');
</script>

<div class="occ-chart">
	<svg
		bind:this={svgEl}
		viewBox="0 0 {W} {H}"
		role="img"
		aria-label="occurrences per {activeBucket}"
	></svg>
	{#if legendPosition !== 'hidden' && legendEntries.length > 0}
		<ul class="legend">
			{#each legendEntries as e (e.id)}
				<li>
					<span class="swatch" style:background={e.color}></span>
					<span>{e.label}</span>
					<small class="muted">{e.unit}</small>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.occ-chart {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	svg {
		width: 100%;
		height: auto;
		max-width: 100%;
	}
	.legend {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding: 0;
		margin: 0;
		font-size: 0.85em;
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.legend .swatch {
		width: 12px;
		height: 12px;
		border-radius: 3px;
	}
	.muted {
		color: var(--color-muted);
	}
</style>
