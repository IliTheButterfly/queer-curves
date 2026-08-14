<script lang="ts">
	import type { Graph } from '$lib/types.js';
	import {
		buildBuckets,
		busiestWeekday,
		counterTotals,
		defaultBucketOf,
		formatAmount,
		formatBucketLabel,
		formatElapsed,
		msSinceLast,
		targetStatuses,
		WEEKDAY_NAMES,
		type Bucket
	} from '$lib/graphs/occurrence/aggregate.js';

	let { graph }: { graph: Graph } = $props();

	function fmtNum(n: number, digits = 2): string {
		if (!Number.isFinite(n)) return '—';
		return n.toFixed(digits);
	}

	function fmtDuration(ms: number): string {
		if (!Number.isFinite(ms) || ms < 0) return '—';
		const seconds = Math.floor(ms / 1000);
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m`;
		return `${seconds}s`;
	}

	// Spectrum stats — computed lazily so a graph that flips between
	// spectrum/network types (impossible at runtime, but sanity) doesn't
	// cause spurious work.
	const spectrumStats = $derived.by(() => {
		if (graph.type !== 'spectrum') return null;
		const points = [...graph.datapoints].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
		const N = points.length;

		const axisStats = graph.schema.axes.map((ax, i) => {
			if (N === 0) return { name: ax.name, min: NaN, max: NaN, mean: NaN, range: ax.range };
			const vals = points.map((p) => p.coordinates[i]).filter((v) => Number.isFinite(v));
			if (vals.length === 0)
				return { name: ax.name, min: NaN, max: NaN, mean: NaN, range: ax.range };
			const min = Math.min(...vals);
			const max = Math.max(...vals);
			const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
			return { name: ax.name, min, max, mean, range: ax.range };
		});

		let timeSpan: number | null = null;
		let avgInterval: number | null = null;
		if (N > 0) {
			const t0 = new Date(points[0].timestamp).getTime();
			const tN = new Date(points[N - 1].timestamp).getTime();
			timeSpan = tN - t0;
			if (N > 1) avgInterval = timeSpan / (N - 1);
		}

		// Trajectory length in raw axis space (sum of Euclidean segment
		// distances). Useful as a comparative figure even if it isn't a true
		// physical distance.
		let trajectoryLen = 0;
		for (let i = 1; i < N; i++) {
			let sumSq = 0;
			for (let d = 0; d < graph.schema.dimensions; d++) {
				const dx = (points[i].coordinates[d] ?? 0) - (points[i - 1].coordinates[d] ?? 0);
				sumSq += dx * dx;
			}
			trajectoryLen += Math.sqrt(sumSq);
		}

		// Also report normalized trajectory length: distance per axis-range
		// unit. Lets users compare graphs with very different axis scales.
		let normalizedLen: number | null = null;
		if (N > 1) {
			let normSum = 0;
			for (let i = 1; i < N; i++) {
				let sumSq = 0;
				for (let d = 0; d < graph.schema.dimensions; d++) {
					const ax = graph.schema.axes[d];
					const span = ax.range[1] - ax.range[0] || 1;
					const dx = ((points[i].coordinates[d] ?? 0) - (points[i - 1].coordinates[d] ?? 0)) / span;
					sumSq += dx * dx;
				}
				normSum += Math.sqrt(sumSq);
			}
			normalizedLen = normSum;
		}

		return { count: N, axes: axisStats, timeSpan, avgInterval, trajectoryLen, normalizedLen };
	});

	// Occurrence stats — the figures a counting app puts on its summary
	// screen: totals, per-period averages, target adherence and streaks.
	const occurrenceStats = $derived.by(() => {
		if (graph.type !== 'occurrence') return null;
		const now = new Date();
		const bucket = defaultBucketOf(graph);
		const series = buildBuckets(graph, bucket, now);
		const totals = counterTotals(graph);
		const N = graph.occurrences.length;

		// Mean per bucket counts the empty buckets too — averaging only the
		// days you drank flatters the number badly.
		const meanPerBucket =
			series.buckets.length > 0
				? series.buckets.reduce((s, b) => s + b.total, 0) / series.buckets.length
				: null;
		const activeBuckets = series.buckets.filter((b) => b.count > 0).length;
		const peak = series.buckets.reduce<Bucket | null>(
			(best, b) => (best === null || b.total > best.total ? b : best),
			null
		);

		return {
			count: N,
			bucket,
			totals,
			meanPerBucket,
			activeBuckets,
			bucketCount: series.buckets.length,
			peak,
			targets: targetStatuses(graph, now),
			since: msSinceLast(graph, null, now),
			busiest: busiestWeekday(graph)
		};
	});

	const networkStats = $derived.by(() => {
		if (graph.type !== 'network') return null;
		const N = graph.nodes.length;
		const E = graph.edges.length;

		const deg = new Map<string, number>();
		for (const e of graph.edges) {
			deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
			deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
		}
		const degrees = graph.nodes.map((n) => deg.get(n.id) ?? 0);
		const maxDeg = degrees.length > 0 ? Math.max(...degrees) : 0;
		const minDeg = degrees.length > 0 ? Math.min(...degrees) : 0;
		const avgDeg = degrees.length > 0 ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0;

		const byType = new Map<string, number>();
		for (const e of graph.edges) {
			byType.set(e.type_id, (byType.get(e.type_id) ?? 0) + 1);
		}
		const edgesByType = graph.schema.edge_types.map((et) => ({
			id: et.id,
			label: et.label,
			color: et.color,
			count: byType.get(et.id) ?? 0
		}));

		const subjects = graph.nodes.filter((n) => n.subject_ref).length;
		const isolatedNodes = degrees.filter((d) => d === 0).length;

		// Connected-component count (treats edges as undirected for the
		// purpose of grouping). Useful as a "is this one polycule or
		// several disjoint groups" signal.
		const adj = new Map<string, string[]>();
		for (const n of graph.nodes) adj.set(n.id, []);
		for (const e of graph.edges) {
			adj.get(e.source)?.push(e.target);
			adj.get(e.target)?.push(e.source);
		}
		const seen = new Set<string>();
		let components = 0;
		for (const n of graph.nodes) {
			if (seen.has(n.id)) continue;
			components++;
			const stack = [n.id];
			while (stack.length > 0) {
				const cur = stack.pop()!;
				if (seen.has(cur)) continue;
				seen.add(cur);
				for (const nbr of adj.get(cur) ?? []) stack.push(nbr);
			}
		}

		// Density: actual edges / max possible undirected edges among N
		// nodes. For multigraphs (pair with multiple edge types between
		// same nodes) this can exceed 1 — clamp display at >100%.
		const maxPossible = N > 1 ? (N * (N - 1)) / 2 : 0;
		const density = maxPossible > 0 ? E / maxPossible : 0;

		return {
			N,
			E,
			maxDeg,
			minDeg,
			avgDeg,
			edgesByType,
			subjects,
			isolatedNodes,
			components,
			density
		};
	});
</script>

{#if graph.type === 'spectrum' && spectrumStats}
	<section class="stats-panel">
		<h3>Stats</h3>
		<dl class="kv">
			<div>
				<dt>Datapoints</dt>
				<dd>{spectrumStats.count}</dd>
			</div>
			{#if spectrumStats.timeSpan !== null}
				<div>
					<dt>Time span</dt>
					<dd>{fmtDuration(spectrumStats.timeSpan)}</dd>
				</div>
			{/if}
			{#if spectrumStats.avgInterval !== null}
				<div>
					<dt>Avg interval</dt>
					<dd>{fmtDuration(spectrumStats.avgInterval)}</dd>
				</div>
			{/if}
			{#if spectrumStats.normalizedLen !== null}
				<div>
					<dt>Trajectory length</dt>
					<dd>
						{fmtNum(spectrumStats.normalizedLen, 2)}
						<small class="muted">(axis-range units)</small>
					</dd>
				</div>
			{/if}
		</dl>

		{#if spectrumStats.count > 0 && spectrumStats.axes.length > 0}
			<table class="axis-table">
				<thead>
					<tr>
						<th>axis</th>
						<th>min</th>
						<th>mean</th>
						<th>max</th>
						<th class="muted">range</th>
					</tr>
				</thead>
				<tbody>
					{#each spectrumStats.axes as a (a.name)}
						<tr>
							<td>{a.name}</td>
							<td>{fmtNum(a.min)}</td>
							<td>{fmtNum(a.mean)}</td>
							<td>{fmtNum(a.max)}</td>
							<td class="muted">[{fmtNum(a.range[0])}, {fmtNum(a.range[1])}]</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
{:else if graph.type === 'occurrence' && occurrenceStats}
	<section class="stats-panel">
		<h3>Stats</h3>
		<dl class="kv">
			<div>
				<dt>Entries</dt>
				<dd>{occurrenceStats.count}</dd>
			</div>
			{#if occurrenceStats.since !== null}
				<div>
					<dt>Since last</dt>
					<dd>{formatElapsed(occurrenceStats.since)}</dd>
				</div>
			{/if}
			{#if occurrenceStats.meanPerBucket !== null}
				<div>
					<dt>Avg per {occurrenceStats.bucket}</dt>
					<dd>{fmtNum(occurrenceStats.meanPerBucket, 2)}</dd>
				</div>
			{/if}
			{#if occurrenceStats.bucketCount > 0}
				<div>
					<dt>{occurrenceStats.bucket}s with entries</dt>
					<dd>
						{occurrenceStats.activeBuckets} / {occurrenceStats.bucketCount}
					</dd>
				</div>
			{/if}
			{#if occurrenceStats.peak && occurrenceStats.peak.total > 0}
				<div>
					<dt>Heaviest {occurrenceStats.bucket}</dt>
					<dd>
						{formatAmount(occurrenceStats.peak.total)}
						<small class="muted">
							({formatBucketLabel(occurrenceStats.peak.start, occurrenceStats.bucket)})
						</small>
					</dd>
				</div>
			{/if}
			{#if occurrenceStats.busiest}
				<div>
					<dt>Busiest weekday</dt>
					<dd>
						{WEEKDAY_NAMES[occurrenceStats.busiest.weekday]}
						<small class="muted">({formatAmount(occurrenceStats.busiest.total)})</small>
					</dd>
				</div>
			{/if}
		</dl>

		{#if occurrenceStats.totals.length > 0}
			<table class="axis-table">
				<thead>
					<tr>
						<th>counter</th>
						<th>entries</th>
						<th>total</th>
						<th>avg each</th>
						<th class="muted">unit</th>
					</tr>
				</thead>
				<tbody>
					{#each occurrenceStats.totals as t (t.counter.id)}
						<tr>
							<td>{t.counter.label}</td>
							<td>{t.count}</td>
							<td>{formatAmount(t.total)}</td>
							<td>{t.mean === null ? '—' : fmtNum(t.mean, 2)}</td>
							<td class="muted">{t.counter.unit}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if occurrenceStats.targets.length > 0}
			<h4>Targets</h4>
			<ul class="type-list">
				{#each occurrenceStats.targets as t (t.counter.id)}
					<li>
						<span>{t.counter.label}</span>
						<span class="target-figure" class:over={!t.ok}>
							{formatAmount(t.current)}/{formatAmount(t.target)}
							<small class="muted">
								{t.direction === 'at_most' ? 'max' : 'min'} per {t.period}
							</small>
						</span>
						<span class="count muted">
							{#if t.streak > 0}
								{t.streak}
								{t.period}{t.streak === 1 ? '' : 's'} on track
								{#if t.bestStreak > t.streak}(best {t.bestStreak}){/if}
							{:else if t.bestStreak > 0}
								best {t.bestStreak}
							{:else}
								—
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{:else if graph.type === 'network' && networkStats}
	<section class="stats-panel">
		<h3>Stats</h3>
		<dl class="kv">
			<div>
				<dt>Nodes</dt>
				<dd>{networkStats.N}</dd>
			</div>
			<div>
				<dt>Edges</dt>
				<dd>{networkStats.E}</dd>
			</div>
			{#if networkStats.N > 0}
				<div>
					<dt>Degree</dt>
					<dd>
						avg {fmtNum(networkStats.avgDeg, 1)} · min {networkStats.minDeg} · max
						{networkStats.maxDeg}
					</dd>
				</div>
				<div>
					<dt>Density</dt>
					<dd>{fmtNum(networkStats.density * 100, 1)}%</dd>
				</div>
				<div>
					<dt>Components</dt>
					<dd>
						{networkStats.components}
						{#if networkStats.isolatedNodes > 0}
							<small class="muted">({networkStats.isolatedNodes} isolated)</small>
						{/if}
					</dd>
				</div>
				{#if networkStats.subjects > 0}
					<div>
						<dt>Linked subjects</dt>
						<dd>{networkStats.subjects}</dd>
					</div>
				{/if}
			{/if}
		</dl>

		{#if networkStats.edgesByType.length > 0}
			<h4>Edges per type</h4>
			<ul class="type-list">
				{#each networkStats.edgesByType as et (et.id)}
					<li>
						<span class="swatch" style:background={et.color}></span>
						<span>{et.label}</span>
						<span class="count muted">{et.count}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.stats-panel {
		margin-top: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
	}
	h3 {
		margin: 0 0 var(--space-2);
		font-size: 1rem;
		color: var(--color-accent);
	}
	h4 {
		margin: var(--space-3) 0 var(--space-1);
		font-size: 0.9rem;
		color: var(--color-muted);
	}
	dl.kv {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: var(--space-2) var(--space-3);
		margin: 0;
	}
	dl.kv > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	dl.kv dt {
		color: var(--color-muted);
		font-size: 0.8em;
		text-transform: lowercase;
		letter-spacing: 0.04em;
	}
	dl.kv dd {
		margin: 0;
		color: var(--color-fg);
		font-family: var(--font-mono);
		font-size: 0.95em;
	}
	.muted {
		color: var(--color-muted);
	}
	.axis-table {
		margin-top: var(--space-2);
		border-collapse: collapse;
		font-size: 0.85em;
		width: 100%;
	}
	.axis-table th,
	.axis-table td {
		padding: var(--space-1) var(--space-2);
		text-align: left;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.axis-table th {
		color: var(--color-muted);
		font-weight: normal;
		font-size: 0.85em;
	}
	.axis-table td {
		font-family: var(--font-mono);
	}
	.type-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: 0.9em;
	}
	.type-list li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.type-list .swatch {
		display: inline-block;
		width: 14px;
		height: 4px;
		border-radius: 2px;
	}
	.type-list .count {
		margin-left: auto;
		font-family: var(--font-mono);
	}
	.target-figure {
		font-family: var(--font-mono);
		color: var(--color-fg);
	}
	.target-figure.over {
		color: rgba(255, 150, 150, 1);
	}
</style>
