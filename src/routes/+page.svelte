<script lang="ts">
	import { fixtures } from '$lib';
	import SpectrumHistoryChart from '$lib/graphs/spectrum/SpectrumHistoryChart.svelte';
	import NetworkChart from '$lib/graphs/network/NetworkChart.svelte';

	const aceflux = fixtures.acefluxFixture;
	const genderfluid = fixtures.genderfluidFixture;
	const polycule = fixtures.polyculeFixture;
	const polyculeRedacted = fixtures.polyculeRedactedFixture;
</script>

<svelte:head>
	<title>queer-curves</title>
</svelte:head>

<main>
	<h1>queer-curves</h1>
	<p>Privacy-respecting graphs for tracking and sharing identity over time.</p>
	<p>
		Pre-development. See the design docs in the repository:
		<code>data_model.md</code>, <code>sharing_model.md</code>,
		<code>THREATS.md</code>, <code>STACK.md</code>.
	</p>

	<h2>{aceflux.name}</h2>
	<p class="muted">
		Aceflux 1D spectrum — {aceflux.datapoints.length} datapoints over time.
	</p>
	<div class="chart">
		<SpectrumHistoryChart graph={aceflux} />
	</div>

	<h2>{genderfluid.name}</h2>
	<p class="muted">
		Genderfluid 2D spectrum — trajectory cloud through identity-space.
	</p>
	<div class="chart">
		<SpectrumHistoryChart graph={genderfluid} />
	</div>

	<h2>{polycule.name}</h2>
	<p class="muted">
		Polycule network — full-detail variant shared inside the polycule.
	</p>
	<div class="chart">
		<NetworkChart graph={polycule} />
	</div>

	<h2>{polycule.name} <span class="muted">— redacted variant</span></h2>
	<p class="muted">
		Same polycule, edge types collapsed to "connected" — the variant
		shared with audiences outside the polycule.
		See <code>sharing_model.md</code> §7.
	</p>
	<div class="chart">
		<NetworkChart graph={polyculeRedacted} />
	</div>
</main>

<style>
	h2 {
		font-size: 1.25rem;
		margin-top: var(--space-5);
		color: var(--color-accent);
	}
	.muted {
		color: var(--color-muted);
	}
	.chart {
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
	}
	main {
		max-width: 80ch;
	}
</style>
