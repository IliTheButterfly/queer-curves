<script lang="ts">
	import type { Palette } from '$lib/presets/palettes.js';
	import PaletteSwatch from './PaletteSwatch.svelte';

	let { palette, href }: { palette: Palette; href?: string } = $props();
</script>

{#if href}
	<a class="card" {href}>
		<div class="meta">
			<strong>{palette.name}</strong>
			{#if palette.flag}
				<span class="flag">{palette.flag}</span>
			{/if}
		</div>
		<PaletteSwatch {palette} />
		{#if palette.description}
			<p class="description">{palette.description}</p>
		{/if}
		<p class="count">
			{palette.colors.length} colour{palette.colors.length === 1 ? '' : 's'}
		</p>
	</a>
{:else}
	<div class="card">
		<div class="meta">
			<strong>{palette.name}</strong>
			{#if palette.flag}
				<span class="flag">{palette.flag}</span>
			{/if}
		</div>
		<PaletteSwatch {palette} />
		{#if palette.description}
			<p class="description">{palette.description}</p>
		{/if}
		<p class="count">
			{palette.colors.length} colour{palette.colors.length === 1 ? '' : 's'}
		</p>
	</div>
{/if}

<style>
	.card {
		display: block;
		padding: var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid transparent;
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
		transition:
			background 0.15s,
			border-color 0.15s,
			transform 0.15s;
	}
	a.card:hover,
	a.card:focus-visible {
		background: rgba(255, 255, 255, 0.06);
		border-color: var(--color-accent);
		transform: translateY(-1px);
	}
	.meta {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.meta strong {
		color: var(--color-accent);
		font-size: 1.05em;
	}
	.flag {
		color: var(--color-muted);
		font-size: 0.8em;
		text-align: right;
	}
	.description {
		margin: var(--space-2) 0 0;
		color: var(--color-muted);
		font-size: 0.9em;
		line-height: 1.4;
	}
	.count {
		margin: var(--space-1) 0 0;
		color: var(--color-muted);
		font-size: 0.8em;
	}
</style>
