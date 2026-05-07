<script lang="ts">
	let {
		value = $bindable(),
		paletteColors = [],
		ariaLabel = 'colour'
	}: { value: string; paletteColors?: string[]; ariaLabel?: string } = $props();

	function isActive(c: string): boolean {
		return value.toLowerCase() === c.toLowerCase();
	}

	function pick(c: string) {
		value = c;
	}
</script>

<div class="picker">
	{#if paletteColors.length > 0}
		<div class="swatches" role="radiogroup" aria-label="palette colours">
			<!-- Don't key by colour: queer flags often repeat colours (trans
			     has #5BCEFA twice, etc.) and Svelte rejects duplicate keys.
			     Index keying handles repeats just fine. -->
			{#each paletteColors as c, i (i)}
				<button
					type="button"
					class="swatch"
					class:active={isActive(c)}
					style:background={c}
					onclick={() => pick(c)}
					aria-label="use {c}"
					aria-pressed={isActive(c)}
					title={c}
				></button>
			{/each}
		</div>
	{/if}
	<input
		type="color"
		bind:value
		class="custom-picker"
		aria-label="{ariaLabel} (custom)"
		title="pick a custom colour"
	/>
</div>

<style>
	.picker {
		display: inline-flex;
		gap: var(--space-1);
		align-items: center;
		flex-wrap: wrap;
	}
	.swatches {
		display: inline-flex;
		gap: 2px;
	}
	.swatch {
		width: 16px;
		height: 22px;
		border-radius: 3px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		cursor: pointer;
		padding: 0;
		transition:
			transform 0.1s,
			border-color 0.1s;
	}
	.swatch:hover {
		transform: scale(1.15);
		border-color: var(--color-accent);
	}
	.swatch.active {
		border-color: var(--color-bg);
		box-shadow: 0 0 0 2px var(--color-accent);
	}
	.custom-picker {
		width: 32px;
		height: 26px;
		padding: 0;
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		cursor: pointer;
	}
</style>
