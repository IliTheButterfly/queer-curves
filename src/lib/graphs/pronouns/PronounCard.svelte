<script lang="ts">
	// The pronoun card view (data_model.md §5). Deliberately plain DOM — a
	// card is type, colour, and grouping, so it needs neither d3 nor
	// cytoscape, and staying DOM-only keeps it selectable and screen-reader
	// friendly (the other two chart types are canvas/SVG islands).
	import type { GenderTerm, PronounSet, PronounsGraph } from '$lib/types.js';
	import { entryColor, groupByLevel, termGroupById } from './defaults.js';
	import { DEFAULT_EXAMPLE_TEMPLATES, formsToSlashString, renderExamples } from './sentences.js';

	let { graph }: { graph: PronounsGraph } = $props();

	const flat = $derived(graph.customization.layout === 'flat');
	const showExamples = $derived(graph.customization.show_examples !== false);
	const templates = $derived(graph.schema.examples ?? DEFAULT_EXAMPLE_TEMPLATES);

	const pronounGroups = $derived(groupByLevel(graph.schema.levels, graph.pronouns));

	// Terms are grouped twice over: by their group (a section) and, inside
	// each section, by preference level. Groups with no terms are skipped so
	// an unused default group doesn't render an empty heading.
	const termSections = $derived(
		graph.schema.term_groups
			.map((group) => ({
				group,
				groups: groupByLevel(
					graph.schema.levels,
					graph.terms.filter((t) => t.group_id === group.id)
				)
			}))
			.filter((s) => s.groups.length > 0)
	);

	// Terms pointing at a group that no longer exists still belong on the
	// card — same reasoning as orphaned levels in groupByLevel.
	const orphanTerms = $derived(
		graph.terms.filter((t) => termGroupById(graph, t.group_id) === undefined)
	);

	function levelLabel(entry: PronounSet | GenderTerm): string {
		return graph.schema.levels.find((l) => l.id === entry.level_id)?.label ?? 'unsorted';
	}

	function examplesFor(set: PronounSet): string[] {
		if (!showExamples || !set.forms) return [];
		return renderExamples(set.forms, templates, graph.display_name);
	}

	function slashFor(set: PronounSet): string | null {
		if (!set.forms) return null;
		const slash = formsToSlashString(set.forms);
		// Don't repeat the label back at the user when they're the same
		// string (the common "she/her" case with only two forms filled).
		return slash && slash !== set.label ? slash : null;
	}
</script>

<div class="card" style:--card-bg={graph.customization.theme.background ?? 'transparent'}>
	{#if graph.customization.title.show && graph.customization.title.text}
		<h2 class="card-title">{graph.customization.title.text}</h2>
	{/if}
	{#if graph.display_name}
		<p class="display-name">{graph.display_name}</p>
	{/if}
	{#if graph.customization.subtitle}
		<p class="subtitle">{graph.customization.subtitle}</p>
	{/if}

	{#if graph.pronouns.length === 0 && graph.terms.length === 0}
		<p class="empty">
			This card is empty. Add the pronouns you use and any identity or address words you want people
			to know about.
		</p>
	{/if}

	{#if graph.pronouns.length > 0}
		<section class="block">
			<h3>Pronouns</h3>
			{#each pronounGroups as { level, entries } (level?.id ?? '__orphans')}
				<div class="level-group">
					{#if !flat}
						<div class="level-heading">
							<span class="swatch" style:background={level?.color ?? '#998aaa'}></span>
							<span class="level-name">{level?.label ?? 'unsorted'}</span>
							{#if level?.description}
								<span class="level-desc">{level.description}</span>
							{/if}
						</div>
					{/if}
					<ul class="entries">
						{#each entries as set (set.id)}
							<li class="entry" style:--entry-color={entryColor(graph, set)}>
								<div class="entry-head">
									<span class="entry-label">{set.label}</span>
									{#if flat}
										<span class="entry-level">{levelLabel(set)}</span>
									{/if}
								</div>
								{#if slashFor(set)}
									<p class="forms">{slashFor(set)}</p>
								{/if}
								{#if set.notes}
									<p class="notes">{set.notes}</p>
								{/if}
								{#each examplesFor(set) as sentence (sentence)}
									<p class="example">{sentence}</p>
								{/each}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</section>
	{/if}

	{#each termSections as { group, groups } (group.id)}
		<section class="block">
			<h3>{group.label}</h3>
			{#if group.description}
				<p class="group-desc">{group.description}</p>
			{/if}
			{#each groups as { level, entries } (level?.id ?? '__orphans')}
				<div class="level-group">
					{#if !flat}
						<div class="level-heading">
							<span class="swatch" style:background={level?.color ?? '#998aaa'}></span>
							<span class="level-name">{level?.label ?? 'unsorted'}</span>
						</div>
					{/if}
					<ul class="chips">
						{#each entries as term (term.id)}
							<li class="chip" style:--entry-color={entryColor(graph, term)}>
								<span>{term.label}</span>
								{#if flat}
									<span class="entry-level">{levelLabel(term)}</span>
								{/if}
								{#if term.notes}
									<span class="chip-note">{term.notes}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</section>
	{/each}

	{#if orphanTerms.length > 0}
		<section class="block">
			<h3>Ungrouped</h3>
			<ul class="chips">
				{#each orphanTerms as term (term.id)}
					<li class="chip" style:--entry-color={entryColor(graph, term)}>
						<span>{term.label}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if graph.schema.levels.length > 0}
		<section class="legend">
			<h4>Scale</h4>
			<ul>
				{#each graph.schema.levels as level (level.id)}
					<li>
						<span class="swatch" style:background={level.color}></span>
						<span>{level.label}</span>
						{#if level.description}
							<span class="level-desc">— {level.description}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--card-bg);
		border-radius: 6px;
	}
	.card-title {
		margin: 0;
		font-size: 1.3rem;
		color: var(--color-accent);
	}
	.display-name {
		margin: 0;
		font-size: 1.05rem;
		color: var(--color-fg);
	}
	.subtitle,
	.group-desc {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.empty {
		margin: 0;
		color: var(--color-muted);
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-accent);
		text-transform: lowercase;
	}
	h4 {
		margin: 0 0 var(--space-1);
		font-size: 0.85rem;
		color: var(--color-muted);
		text-transform: lowercase;
		letter-spacing: 0.04em;
	}
	.level-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.level-heading {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.85em;
		color: var(--color-muted);
	}
	.level-name {
		color: var(--color-fg);
	}
	.level-desc {
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
	}
	ul.entries,
	ul.chips,
	.legend ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	ul.entries {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--space-2);
	}
	.entry {
		padding: var(--space-2) var(--space-3);
		background: rgba(255, 255, 255, 0.03);
		border-left: 3px solid var(--entry-color);
		border-radius: 4px;
	}
	.entry-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.entry-label {
		font-size: 1.05em;
		color: var(--entry-color);
		font-weight: 600;
	}
	.entry-level {
		font-size: 0.75em;
		color: var(--color-muted);
		text-transform: lowercase;
	}
	.forms {
		margin: 2px 0 0;
		font-family: var(--font-mono);
		font-size: 0.8em;
		color: var(--color-muted);
	}
	.notes {
		margin: var(--space-1) 0 0;
		font-size: 0.85em;
		color: var(--color-fg);
	}
	.example {
		margin: var(--space-1) 0 0;
		font-size: 0.85em;
		font-style: italic;
		color: var(--color-muted);
	}
	ul.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--entry-color);
		border-radius: 999px;
		color: var(--color-fg);
		font-size: 0.9em;
	}
	.chip-note {
		color: var(--color-muted);
		font-size: 0.85em;
	}
	.legend {
		padding-top: var(--space-2);
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		font-size: 0.85em;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 2px 0;
	}
</style>
