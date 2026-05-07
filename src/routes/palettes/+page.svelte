<script lang="ts">
	import { palettes } from '$lib/presets/palettes.js';
	import PaletteCard from '$lib/ui/PaletteCard.svelte';
</script>

<svelte:head>
	<title>Palettes – queer-curves</title>
</svelte:head>

<main>
	<p class="back"><a href="/">← home</a></p>
	<h1>Palettes</h1>
	<p>
		Queer flag colour schemes you can apply to any graph. Click a palette to preview it against the
		fixture graphs.
	</p>

	<div class="grid">
		{#each palettes as palette (palette.id)}
			<PaletteCard {palette} href="/palettes/{palette.id}" />
		{/each}
	</div>

	<p class="footnote">
		Hex values are sourced from each flag's most contemporary widely-recognized variant. If you find
		an inaccuracy or want a flag added, see
		<code>src/lib/presets/palettes.ts</code>.
	</p>
</main>

<style>
	main {
		max-width: 100ch;
	}
	.back a {
		color: var(--color-muted);
		text-decoration: none;
	}
	.back a:hover {
		color: var(--color-accent);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
	.footnote {
		margin-top: var(--space-5);
		color: var(--color-muted);
		font-size: 0.85em;
	}
</style>
