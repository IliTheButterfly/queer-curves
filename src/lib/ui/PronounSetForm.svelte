<script lang="ts">
	import { untrack } from 'svelte';
	import type { PronounForms, PronounSet, PronounsGraph } from '$lib/types.js';
	import { COMMON_PRONOUN_SETS } from '$lib/graphs/pronouns/defaults.js';
	import { renderExamples } from '$lib/graphs/pronouns/sentences.js';
	import ColorPickerWithPalette from './ColorPickerWithPalette.svelte';

	let {
		graph,
		initial,
		oncancel,
		onsubmit
	}: {
		graph: PronounsGraph;
		initial?: PronounSet;
		oncancel?: () => void;
		onsubmit: (set: PronounSet) => void;
	} = $props();

	const isEdit = $derived(initial !== undefined);
	const paletteColors = $derived(graph.customization.theme.palette);

	let label = $state(untrack(() => initial?.label ?? ''));
	let levelId = $state(untrack(() => initial?.level_id ?? graph.schema.levels[0]?.id ?? ''));
	let notes = $state(untrack(() => initial?.notes ?? ''));
	let color = $state(untrack(() => initial?.color ?? ''));

	// Form state keeps the five declensions as plain strings; empty ones are
	// stripped on save so `forms` stays absent for label-only entries like
	// "any pronouns".
	let subject = $state(untrack(() => initial?.forms?.subject ?? ''));
	let object = $state(untrack(() => initial?.forms?.object ?? ''));
	let possessiveDeterminer = $state(untrack(() => initial?.forms?.possessive_determiner ?? ''));
	let possessivePronoun = $state(untrack(() => initial?.forms?.possessive_pronoun ?? ''));
	let reflexive = $state(untrack(() => initial?.forms?.reflexive ?? ''));
	let plural = $state(untrack(() => initial?.forms?.plural === true));

	function buildForms(): PronounForms | undefined {
		const s = subject.trim();
		const o = object.trim();
		// Subject and object are the minimum a declension needs; without both
		// there's nothing to conjugate and the entry is label-only.
		if (!s || !o) return undefined;
		const forms: PronounForms = { subject: s, object: o };
		const pd = possessiveDeterminer.trim();
		const pp = possessivePronoun.trim();
		const rx = reflexive.trim();
		if (pd) forms.possessive_determiner = pd;
		if (pp) forms.possessive_pronoun = pp;
		if (rx) forms.reflexive = rx;
		if (plural) forms.plural = true;
		return forms;
	}

	// Live preview of what the card will show, so users can see the
	// declension working before they save it.
	const preview = $derived.by(() => {
		const forms = buildForms();
		if (!forms) return [];
		return renderExamples(forms, graph.schema.examples, graph.display_name);
	});

	function applyPreset(presetLabel: string) {
		const preset = COMMON_PRONOUN_SETS.find((p) => p.label === presetLabel);
		if (!preset) return;
		label = preset.label;
		subject = preset.forms?.subject ?? '';
		object = preset.forms?.object ?? '';
		possessiveDeterminer = preset.forms?.possessive_determiner ?? '';
		possessivePronoun = preset.forms?.possessive_pronoun ?? '';
		reflexive = preset.forms?.reflexive ?? '';
		plural = preset.forms?.plural === true;
	}

	function generateId(existing: PronounSet[]): string {
		const used = new Set(existing.map((p) => p.id));
		for (let i = 1; i < 1000; i++) {
			const id = `pn${i}`;
			if (!used.has(id)) return id;
		}
		return 'pn_' + Math.random().toString(36).slice(2, 8);
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const set: PronounSet = {
			id: initial?.id ?? generateId(graph.pronouns),
			label: label.trim(),
			level_id: levelId
		};
		const forms = buildForms();
		if (forms) set.forms = forms;
		if (notes.trim()) set.notes = notes.trim();
		if (color) set.color = color;

		onsubmit(set);

		if (!isEdit) {
			label = '';
			notes = '';
			color = '';
			subject = '';
			object = '';
			possessiveDeterminer = '';
			possessivePronoun = '';
			reflexive = '';
			plural = false;
		}
	}
</script>

<form onsubmit={handleSubmit} class="pn-form">
	<h3>{isEdit ? 'Edit pronouns' : 'Add pronouns'}</h3>

	{#if !isEdit}
		<label class="field">
			<span class="label">Start from <small>(optional)</small></span>
			<select
				value=""
				onchange={(e) => {
					const el = e.currentTarget as HTMLSelectElement;
					applyPreset(el.value);
					el.value = '';
				}}
			>
				<option value="">— common sets —</option>
				{#each COMMON_PRONOUN_SETS as preset (preset.label)}
					<option value={preset.label}>{preset.label}</option>
				{/each}
			</select>
		</label>
	{/if}

	<div class="row">
		<label class="field">
			<span class="label">Label</span>
			<input type="text" bind:value={label} required placeholder="she/her" maxlength="60" />
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
			<ColorPickerWithPalette bind:value={color} {paletteColors} ariaLabel="pronoun set colour" />
		</div>
	</div>

	<fieldset class="forms-fieldset">
		<legend>Forms <small>(optional — enables example sentences)</small></legend>
		<div class="forms-grid">
			<label class="field">
				<span class="label">Subject</span>
				<input type="text" bind:value={subject} placeholder="she" maxlength="30" />
			</label>
			<label class="field">
				<span class="label">Object</span>
				<input type="text" bind:value={object} placeholder="her" maxlength="30" />
			</label>
			<label class="field">
				<span class="label">Possessive</span>
				<input
					type="text"
					bind:value={possessiveDeterminer}
					placeholder="her (book)"
					maxlength="30"
				/>
			</label>
			<label class="field">
				<span class="label">Possessive alone</span>
				<input type="text" bind:value={possessivePronoun} placeholder="hers" maxlength="30" />
			</label>
			<label class="field">
				<span class="label">Reflexive</span>
				<input type="text" bind:value={reflexive} placeholder="herself" maxlength="30" />
			</label>
			<label class="checkfield">
				<input type="checkbox" bind:checked={plural} />
				<span>Plural verbs <small>("they are", not "she is")</small></span>
			</label>
		</div>
		{#if preview.length > 0}
			<div class="preview">
				<span class="label">Preview</span>
				{#each preview as sentence (sentence)}
					<p>{sentence}</p>
				{/each}
			</div>
		{/if}
	</fieldset>

	<label class="field">
		<span class="label">Notes <small>(optional)</small></span>
		<input
			type="text"
			bind:value={notes}
			placeholder="fine at work, not with family"
			maxlength="200"
		/>
	</label>

	<div class="actions">
		{#if oncancel}
			<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
		{/if}
		<button type="submit" class="primary">
			{isEdit ? 'Save changes' : '+ add pronouns'}
		</button>
	</div>
</form>

<style>
	.pn-form {
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
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: end;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.field .label,
	.preview .label {
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
	fieldset.forms-fieldset {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 6px;
		padding: var(--space-2) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: rgba(255, 255, 255, 0.02);
	}
	legend {
		padding: 0 var(--space-2);
		color: var(--color-accent);
		font-size: 0.9em;
		font-weight: 600;
	}
	legend small {
		color: var(--color-muted);
		font-weight: normal;
	}
	.forms-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: var(--space-2) var(--space-3);
		align-items: end;
	}
	.checkfield {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		font-size: 0.9em;
	}
	.checkfield small {
		color: var(--color-muted);
	}
	.preview {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.preview p {
		margin: 0;
		font-size: 0.85em;
		font-style: italic;
		color: var(--color-muted);
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
