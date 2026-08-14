// Example-sentence rendering for pronoun sets (data_model.md §5.4).
//
// A card is much easier to read when it shows the pronouns *in use*, so each
// pronoun set that declares its forms gets a couple of demonstration
// sentences. This is pure string work with no DOM dependency so it can be
// unit-tested directly.
//
// Templates use these placeholders:
//
//   {subject}     she / he / they / ey
//   {object}      her / him / them / em
//   {pd}          possessive determiner — her (book) / his / their / eir
//   {pp}          possessive pronoun — hers / his / theirs / eirs
//   {reflexive}   herself / himself / themself / emself
//   {name}        the card's display name, when set
//   {is} {was} {has} {does}   verb forms agreeing with the subject
//   {verb:go}     an arbitrary regular verb, conjugated for the subject
//
// A template referencing a placeholder the set doesn't supply renders as
// null rather than guessing: inventing "her's" from "her" would put words in
// the user's mouth, which is exactly the thing this graph type exists to
// avoid.

import type { PronounForms } from '$lib/types.js';

export const DEFAULT_EXAMPLE_TEMPLATES: readonly string[] = [
	'{subject} {verb:go} to the parade every year.',
	'I went with {object} — the flag was {pp}.',
	'{subject} made it {reflexive}, {pd} own design.'
];

// Irregular verbs we need for agreement. Everything else goes through the
// regular -s / -es rule.
const IRREGULAR: Record<string, { singular: string; plural: string }> = {
	is: { singular: 'is', plural: 'are' },
	was: { singular: 'was', plural: 'were' },
	has: { singular: 'has', plural: 'have' },
	does: { singular: 'does', plural: 'do' },
	be: { singular: 'is', plural: 'are' },
	have: { singular: 'has', plural: 'have' },
	do: { singular: 'does', plural: 'do' },
	go: { singular: 'goes', plural: 'go' }
};

/**
 * Conjugate a verb's base form for the given subject agreement. `plural`
 * means "takes plural agreement" — true for they/them, false for she/her.
 */
export function conjugate(verb: string, plural: boolean): string {
	const key = verb.toLowerCase();
	const irregular = IRREGULAR[key];
	if (irregular) return plural ? irregular.plural : irregular.singular;
	if (plural) return verb;
	// Regular third-person singular: -es after a sibilant or consonant+o,
	// -ies for consonant+y, -s otherwise.
	if (/(s|sh|ch|x|z|o)$/i.test(verb)) return `${verb}es`;
	if (/[^aeiou]y$/i.test(verb)) return `${verb.slice(0, -1)}ies`;
	return `${verb}s`;
}

function capitalize(s: string): string {
	if (s.length === 0) return s;
	return s[0].toUpperCase() + s.slice(1);
}

/**
 * Fill one template from a set of forms. Returns null when the template
 * needs a form (or a display name) that isn't available, so callers can
 * simply drop unrenderable examples.
 */
export function renderSentence(
	template: string,
	forms: PronounForms,
	displayName?: string
): string | null {
	const plural = forms.plural === true;

	const lookup = (token: string): string | null => {
		const verbMatch = /^verb:(.+)$/.exec(token);
		if (verbMatch) return conjugate(verbMatch[1], plural);
		switch (token) {
			case 'subject':
				return forms.subject || null;
			case 'object':
				return forms.object || null;
			case 'pd':
				return forms.possessive_determiner || null;
			case 'pp':
				return forms.possessive_pronoun || null;
			case 'reflexive':
				return forms.reflexive || null;
			case 'name':
				return displayName || null;
			case 'is':
			case 'was':
			case 'has':
			case 'does':
				return conjugate(token, plural);
			default:
				return null;
		}
	};

	let missing = false;
	const filled = template.replace(/\{([^}]+)\}/g, (_whole, token: string) => {
		const value = lookup(token.trim());
		if (value === null) {
			missing = true;
			return '';
		}
		return value;
	});
	if (missing) return null;

	// Capitalize the opening word and anything starting a new sentence, so
	// "{subject} went" reads "She went" without the template having to carry
	// a pre-capitalized variant per pronoun.
	return filled.replace(
		/(^|[.!?]\s+)([a-z])/g,
		(_m, lead: string, ch: string) => lead + capitalize(ch)
	);
}

/**
 * Render every template that this set of forms can satisfy, in order.
 */
export function renderExamples(
	forms: PronounForms,
	templates: readonly string[] = DEFAULT_EXAMPLE_TEMPLATES,
	displayName?: string
): string[] {
	const out: string[] = [];
	for (const t of templates) {
		const rendered = renderSentence(t, forms, displayName);
		if (rendered !== null) out.push(rendered);
	}
	return out;
}

/**
 * The canonical "she/her/hers/herself" slash string for a set of forms —
 * useful as a fallback label and as a compact secondary line under a
 * user-authored label.
 */
export function formsToSlashString(forms: PronounForms): string {
	return [
		forms.subject,
		forms.object,
		forms.possessive_determiner,
		forms.possessive_pronoun,
		forms.reflexive
	]
		.filter((f): f is string => Boolean(f && f.trim()))
		.join('/');
}
