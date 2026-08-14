// Starting scale and groupings for a new pronoun card, plus the lookup
// helpers views share. See data_model.md §5.

import type {
	GenderTerm,
	PreferenceLevel,
	PronounSet,
	PronounsGraph,
	TermGroup
} from '$lib/types.js';

/**
 * The default preference scale, most-preferred first. Colours are chosen to
 * read as a preference gradient on the app's dark chrome rather than to
 * match any particular flag — a graph's palette overrides them when the user
 * picks one in the editor.
 */
export const DEFAULT_LEVELS: readonly PreferenceLevel[] = [
	{ id: 'favourite', label: 'favourite', color: '#c98aff', description: 'please use these' },
	{ id: 'okay', label: 'okay', color: '#80a8ff', description: 'happy to hear these' },
	{
		id: 'close-only',
		label: 'only if we’re close',
		color: '#80ffb0',
		description: 'fine from people I know well'
	},
	{ id: 'avoid', label: 'avoid', color: '#ffb080', description: 'I’d rather you didn’t' },
	{ id: 'never', label: 'never', color: '#ff8aa8', description: 'not okay, ever' }
];

export const DEFAULT_TERM_GROUPS: readonly TermGroup[] = [
	{ id: 'identity', label: 'identity words', description: 'what I am — nonbinary, transfem, …' },
	{ id: 'address', label: 'ways to address me', description: 'how to greet or refer to me' },
	{
		id: 'relationship',
		label: 'relationship words',
		description: 'what to call me to others — partner, datemate, …'
	}
];

/**
 * Common pronoun sets offered as one-click additions in the editor. Users
 * can always author their own; this is a shortcut, not a closed list.
 */
export const COMMON_PRONOUN_SETS: readonly Omit<PronounSet, 'id' | 'level_id'>[] = [
	{
		label: 'she/her',
		forms: {
			subject: 'she',
			object: 'her',
			possessive_determiner: 'her',
			possessive_pronoun: 'hers',
			reflexive: 'herself'
		}
	},
	{
		label: 'he/him',
		forms: {
			subject: 'he',
			object: 'him',
			possessive_determiner: 'his',
			possessive_pronoun: 'his',
			reflexive: 'himself'
		}
	},
	{
		label: 'they/them',
		forms: {
			subject: 'they',
			object: 'them',
			possessive_determiner: 'their',
			possessive_pronoun: 'theirs',
			reflexive: 'themself',
			plural: true
		}
	},
	{
		label: 'ey/em',
		forms: {
			subject: 'ey',
			object: 'em',
			possessive_determiner: 'eir',
			possessive_pronoun: 'eirs',
			reflexive: 'emself'
		}
	},
	{
		label: 'xe/xem',
		forms: {
			subject: 'xe',
			object: 'xem',
			possessive_determiner: 'xyr',
			possessive_pronoun: 'xyrs',
			reflexive: 'xemself'
		}
	},
	{
		label: 'it/its',
		forms: {
			subject: 'it',
			object: 'it',
			possessive_determiner: 'its',
			possessive_pronoun: 'its',
			reflexive: 'itself'
		}
	},
	{ label: 'any pronouns' },
	{ label: 'name only' },
	{ label: 'ask me first' }
];

export function levelById(graph: PronounsGraph, id: string): PreferenceLevel | undefined {
	return graph.schema.levels.find((l) => l.id === id);
}

export function termGroupById(graph: PronounsGraph, id: string): TermGroup | undefined {
	return graph.schema.term_groups.find((g) => g.id === id);
}

/**
 * The colour an entry renders in: its own override, else its level's colour,
 * else a neutral fallback for entries whose level was deleted from the scale.
 */
export function entryColor(graph: PronounsGraph, entry: PronounSet | GenderTerm): string {
	if (entry.color) return entry.color;
	return levelById(graph, entry.level_id)?.color ?? '#998aaa';
}

/**
 * Group entries by level, in scale order. Entries whose `level_id` no longer
 * matches a level in the scale are collected under a trailing `null` level so
 * they stay visible (and editable) instead of silently vanishing — a level
 * can be deleted in the editor while entries still reference it.
 */
export function groupByLevel<T extends { level_id: string }>(
	levels: readonly PreferenceLevel[],
	entries: readonly T[]
): { level: PreferenceLevel | null; entries: T[] }[] {
	const out: { level: PreferenceLevel | null; entries: T[] }[] = [];
	for (const level of levels) {
		const matching = entries.filter((e) => e.level_id === level.id);
		if (matching.length > 0) out.push({ level, entries: matching });
	}
	const knownIds = new Set(levels.map((l) => l.id));
	const orphans = entries.filter((e) => !knownIds.has(e.level_id));
	if (orphans.length > 0) out.push({ level: null, entries: orphans });
	return out;
}
