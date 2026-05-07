<script lang="ts">
	import type { Palette } from '$lib/presets/palettes.js';

	let {
		palette,
		height = 56,
		rounded = true
	}: { palette: Palette; height?: number; rounded?: boolean } = $props();

	// Build a CSS linear-gradient with hard stops between adjacent colors
	// — this gives sharp flag-style stripes. Each color owns 1/N of the bar.
	const gradient = $derived(buildHardStripes(palette.colors));

	function buildHardStripes(colors: string[]): string {
		if (colors.length === 0) return '#000';
		if (colors.length === 1) return colors[0];
		const steps: string[] = [];
		const slice = 100 / colors.length;
		for (let i = 0; i < colors.length; i++) {
			const start = i * slice;
			const end = (i + 1) * slice;
			steps.push(`${colors[i]} ${start.toFixed(2)}%`);
			steps.push(`${colors[i]} ${end.toFixed(2)}%`);
		}
		return `linear-gradient(to right, ${steps.join(', ')})`;
	}
</script>

<div
	class="swatch"
	class:rounded
	style:height="{height}px"
	style:background={gradient}
	role="img"
	aria-label="{palette.name} palette: {palette.colors.join(', ')}"
></div>

<style>
	.swatch {
		width: 100%;
		display: block;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
	}
	.swatch.rounded {
		border-radius: 4px;
	}
</style>
