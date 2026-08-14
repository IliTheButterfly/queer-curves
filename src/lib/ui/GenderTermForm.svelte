<script lang="ts">
	import { untrack } from 'svelte';
	import type { GenderTerm, PronounsGraph } from '$lib/types.js';
	import ColorPickerWithPalette from './ColorPickerWithPalette.svelte';

	let {
		graph,
		initial,
		oncancel,
		onsubmit
	}: {
		graph: PronounsGraph;
		initial?: GenderTerm;
		oncancel?: () => void;
		onsubmit: (term: GenderTerm) => void;
	} = $props();

	const isEdit = $derived(initial !== undefined);
	const paletteColors = $derived(graph.customization.theme.palette);

	let label = $state(untrack(() => initial?.label ?? ''));
	let groupId = $state(untrack(() => initial?.group_id ?? graph.schema.term_groups[0]?.id ?? ''));
	let levelId = $state(untrack(() => initial?.level_id ?? graph.schema.levels[0]?.id ?? ''));
	let notes = $state(untrack(() => initial?.notes ?? ''));
	let color = $state(untrack(() => initial?.color ?? ''));

	function generateId(existing: GenderTerm[]): string {
		const used = new Set(existing.map((t) => t.id));
		for (let i = 1; i < 1000; i++) {
			const id = `t${i}`;
			if (!used.has(id)) return id;
		}
		return 't_' + Math.random().toString(36).slice(2, 8);
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const term: GenderTerm = {
			id: initial?.id ?? generateId(graph.terms),
			label: label.trim(),
			group_id: groupId,
			level_id: levelId
		};
		if (notes.trim()) term.notes = notes.trim();
		if (color) term.color = color;

		onsubmit(term);

		if (!isEdit) {
			label = '';
			notes = '';
			color = '';
		}
	}
</script>

<form onsubmit={handleSubmit} class="term-form">
	<h3>{isEdit ? 'Edit word' : 'Add word'}</h3>
	<div class="row">
		<label class="field">
			<span class="label">Word</span>
			<input type="text" bind:value={label} required placeholder="nonbinary" maxlength="60" />
		</label>
		<label class="field">
			<span class="label">Group</span>
			<select bind:value={groupId}>
				{#each graph.schema.term_groups as group (group.id)}
					<option value={group.id}>{group.label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			<span class="label">Preference</span>
			<select bind:value={levelId}>
				{#each graph.schema.levels as level (level.id)}
					<option value={level.id}>{level.label}</option>
				{/each}
			</select>
		</label>
		<div class="field colorfield">
			<span class="label">Colour <small>(optional)</small></span>
			<ColorPickerWithPalette bind:value={color} {paletteColors} ariaLabel="word colour" />
		</div>
	</div>
	<label class="field">
		<span class="label">Notes <small>(optional)</small></span>
		<input type="text" bind:value={notes} placeholder="only from close friends" maxlength="200" />
	</label>
	<div class="actions">
		{#if oncancel}
			<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
		{/if}
		<button type="submit" class="primary">{isEdit ? 'Save changes' : '+ add word'}</button>
	</div>
</form>

<style>
	.term-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-accent);
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: end;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.field .label {
		font-size: 0.85em;
		color: var(--color-muted);
	}
	.field input[type='text'],
	.field select {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	.field input[type='text']:focus,
	.field select:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		align-items: center;
	}
	button.primary {
		background: var(--color-accent);
		color: #1a0a2a;
		border: none;
		padding: var(--space-2) var(--space-4);
		border-radius: 4px;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button.primary:hover {
		filter: brightness(1.1);
	}
	button.cancel {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-muted);
		padding: var(--space-2) var(--space-3);
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}
	button.cancel:hover {
		color: var(--color-fg);
		border-color: var(--color-accent);
	}
</style>
