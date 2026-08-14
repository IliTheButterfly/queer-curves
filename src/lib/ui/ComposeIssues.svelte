<script lang="ts">
	// Every compatibility problem composition found, shown in full.
	//
	// Warnings are never collapsed behind a "details" toggle: combining
	// graphs whose axes disagree, or that belong to someone else, changes
	// what the result *means*, and the user has to be able to see that
	// before they commit (THREATS.md §7 — honest disclosure).
	import type { ComposeIssue } from '$lib/store/compose.js';

	let { issues }: { issues: ComposeIssue[] } = $props();

	const errors = $derived(issues.filter((i) => i.level === 'error'));
	const warnings = $derived(issues.filter((i) => i.level === 'warning'));
</script>

{#if errors.length > 0}
	<ul class="issues error">
		{#each errors as issue, i (i)}
			<li>{issue.message}</li>
		{/each}
	</ul>
{/if}
{#if warnings.length > 0}
	<ul class="issues warning">
		{#each warnings as issue, i (i)}
			<li>{issue.message}</li>
		{/each}
	</ul>
{/if}

<style>
	.issues {
		list-style: none;
		padding: var(--space-2) var(--space-3);
		margin: var(--space-2) 0;
		border-radius: 4px;
		font-size: 0.9em;
	}
	.issues li + li {
		margin-top: var(--space-2);
	}
	.error {
		background: rgba(255, 100, 100, 0.1);
		border: 1px solid rgba(255, 100, 100, 0.3);
		color: rgba(255, 180, 180, 1);
	}
	.warning {
		background: rgba(255, 200, 100, 0.08);
		border: 1px solid rgba(255, 200, 100, 0.25);
		color: rgba(255, 220, 170, 1);
	}
</style>
