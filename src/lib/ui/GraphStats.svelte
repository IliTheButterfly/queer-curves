<script lang="ts">
	import type { Graph } from '$lib/types.js';
	import { groupByLevel } from '$lib/graphs/pronouns/defaults.js';

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

	const pronounsStats = $derived.by(() => {
		if (graph.type !== 'pronouns') return null;
		const sets = graph.pronouns.length;
		const words = graph.terms.length;
		const declining = graph.pronouns.filter((p) => p.forms !== undefined).length;
		const annotated = [...graph.pronouns, ...graph.terms].filter((e) => e.notes).length;

		// Per-level totals across both entry kinds — the card's headline
		// figure is "how much of this is a yes and how much is a no".
		const byLevel = groupByLevel(graph.schema.levels, [...graph.pronouns, ...graph.terms]).map(
			({ level, entries }) => ({
				id: level?.id ?? '__unsorted',
				label: level?.label ?? 'unsorted',
				color: level?.color ?? '#998aaa',
				count: entries.length
			})
		);

		const byGroup = graph.schema.term_groups
			.map((g) => ({
				id: g.id,
				label: g.label,
				count: graph.terms.filter((t) => t.group_id === g.id).length
			}))
			.filter((g) => g.count > 0);

		return { sets, words, declining, annotated, byLevel, byGroup };
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
{:else if graph.type === 'pronouns' && pronounsStats}
	<section class="stats-panel">
		<h3>Stats</h3>
		<dl class="kv">
			<div>
				<dt>Pronoun sets</dt>
				<dd>{pronounsStats.sets}</dd>
			</div>
			<div>
				<dt>Words</dt>
				<dd>{pronounsStats.words}</dd>
			</div>
			<div>
				<dt>With forms</dt>
				<dd>
					{pronounsStats.declining}
					<small class="muted">of {pronounsStats.sets}</small>
				</dd>
			</div>
			{#if pronounsStats.annotated > 0}
				<div>
					<dt>With notes</dt>
					<dd>{pronounsStats.annotated}</dd>
				</div>
			{/if}
		</dl>

		{#if pronounsStats.byLevel.length > 0}
			<h4>Entries per level</h4>
			<ul class="type-list">
				{#each pronounsStats.byLevel as level (level.id)}
					<li>
						<span class="swatch dot" style:background={level.color}></span>
						<span>{level.label}</span>
						<span class="count muted">{level.count}</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if pronounsStats.byGroup.length > 0}
			<h4>Words per group</h4>
			<ul class="type-list">
				{#each pronounsStats.byGroup as group (group.id)}
					<li>
						<span>{group.label}</span>
						<span class="count muted">{group.count}</span>
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
	.type-list .swatch.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.type-list .count {
		margin-left: auto;
		font-family: var(--font-mono);
	}
</style>
