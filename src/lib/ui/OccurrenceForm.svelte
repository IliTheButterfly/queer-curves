<script lang="ts">
	// The full entry: which counter, how much, when, and why. Used both for
	// deliberate backdated entries ("I forgot to log Friday") and as the
	// inline editor in the log list.
	import { untrack } from 'svelte';
	import type { Occurrence, OccurrenceGraph } from '$lib/types.js';
	import { formatAmount, stepOf } from '$lib/graphs/occurrence/aggregate.js';

	let {
		graph,
		initial,
		oncancel,
		onsubmit
	}: {
		graph: OccurrenceGraph;
		initial?: Occurrence;
		oncancel?: () => void;
		onsubmit: (occurrence: Occurrence) => void;
	} = $props();

	const isEdit = $derived(initial !== undefined);

	function toDatetimeLocal(d: Date): string {
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function nowLocal(): string {
		return toDatetimeLocal(new Date());
	}

	let counterId = $state(untrack(() => initial?.counter_id ?? graph.schema.counters[0]?.id ?? ''));
	let amount = $state(
		untrack(() => {
			if (initial) return initial.amount;
			const c = graph.schema.counters[0];
			return c ? stepOf(c) : 1;
		})
	);
	let timestamp = $state(
		untrack(() => (initial ? toDatetimeLocal(new Date(initial.timestamp)) : nowLocal()))
	);
	let notes = $state(untrack(() => initial?.notes ?? ''));
	let tagsText = $state(untrack(() => (initial?.tags ?? []).join(', ')));

	const selected = $derived(graph.schema.counters.find((c) => c.id === counterId) ?? null);

	// Switching counters mid-entry should bring that counter's own default
	// amount along — units aren't comparable across counters, so carrying
	// "2.3" from beer over to cigarettes would be nonsense.
	function handleCounterChange(next: string) {
		counterId = next;
		const c = graph.schema.counters.find((x) => x.id === next);
		if (c) amount = stepOf(c);
	}

	function generateId(): string {
		return 'oc_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!counterId) return;
		const occurrence: Occurrence = {
			id: initial?.id ?? generateId(),
			counter_id: counterId,
			timestamp: new Date(timestamp).toISOString(),
			amount: Number.isFinite(amount) ? amount : 0
		};
		const trimmedNotes = notes.trim();
		if (trimmedNotes) occurrence.notes = trimmedNotes;
		const tags = tagsText
			.split(',')
			.map((t) => t.trim())
			.filter((t) => t !== '');
		if (tags.length > 0) occurrence.tags = tags;

		onsubmit(occurrence);

		if (!isEdit) {
			// Reset only the per-entry fields; keep the chosen counter so
			// logging several of the same thing stays quick.
			timestamp = nowLocal();
			notes = '';
			tagsText = '';
		}
	}
</script>

<form onsubmit={handleSubmit} class="occ-form">
	<h3>{isEdit ? 'Edit entry' : 'Add entry'}</h3>
	{#if graph.schema.counters.length === 0}
		<p class="hint">Add a counter in this graph's settings first.</p>
	{:else}
		<div class="row">
			<label class="field">
				<span class="label">Counter</span>
				<select
					value={counterId}
					onchange={(e) => handleCounterChange((e.currentTarget as HTMLSelectElement).value)}
				>
					{#each graph.schema.counters as c (c.id)}
						<option value={c.id}>{c.label}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="label">
					Amount
					{#if selected}<small class="muted">({selected.unit})</small>{/if}
				</span>
				<input type="number" step="any" min="0" bind:value={amount} required />
			</label>
		</div>

		{#if selected && (selected.presets ?? []).length > 0}
			<div class="presets">
				<span class="label">Presets</span>
				<div class="preset-chips">
					{#each selected.presets ?? [] as p (p.id)}
						<button type="button" class="ghost chip" onclick={() => (amount = p.amount)}>
							{p.label}
							<small class="muted">{formatAmount(p.amount)}</small>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<label class="field">
			<span class="label">When</span>
			<input type="datetime-local" bind:value={timestamp} required />
		</label>

		<label class="field">
			<span class="label">Notes <small class="muted">(optional)</small></span>
			<textarea bind:value={notes} rows="2" maxlength="500"></textarea>
		</label>

		<label class="field">
			<span class="label">
				Tags <small class="muted">(optional, comma-separated — e.g. "party, stressed")</small>
			</span>
			<input type="text" bind:value={tagsText} maxlength="200" />
		</label>

		<div class="actions">
			{#if oncancel}
				<button type="button" class="ghost" onclick={oncancel}>Cancel</button>
			{/if}
			<button type="submit" class="primary">{isEdit ? 'Save' : 'Add entry'}</button>
		</div>
	{/if}
</form>

<style>
	.occ-form {
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
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.label {
		font-size: 0.85em;
		color: var(--color-muted);
	}
	input,
	select,
	textarea {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
	}
	input:focus,
	select:focus,
	textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.presets {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.preset-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.muted {
		color: var(--color-muted);
	}
	.hint {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	button.ghost {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-fg);
		padding: var(--space-1) var(--space-3);
		border-radius: 4px;
		font: inherit;
		cursor: pointer;
	}
	button.ghost:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-accent);
	}
	button.chip {
		border-radius: 999px;
		display: inline-flex;
		gap: var(--space-1);
		align-items: baseline;
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
</style>
