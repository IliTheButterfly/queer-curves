import { describe, expect, it } from 'vitest';
import type { PronounForms } from '$lib/types.js';
import {
	conjugate,
	DEFAULT_EXAMPLE_TEMPLATES,
	formsToSlashString,
	renderExamples,
	renderSentence
} from './sentences.js';

const she: PronounForms = {
	subject: 'she',
	object: 'her',
	possessive_determiner: 'her',
	possessive_pronoun: 'hers',
	reflexive: 'herself'
};

const they: PronounForms = {
	subject: 'they',
	object: 'them',
	possessive_determiner: 'their',
	possessive_pronoun: 'theirs',
	reflexive: 'themself',
	plural: true
};

describe('conjugate', () => {
	it('agrees with singular and plural subjects', () => {
		expect(conjugate('is', false)).toBe('is');
		expect(conjugate('is', true)).toBe('are');
		expect(conjugate('was', true)).toBe('were');
		expect(conjugate('has', true)).toBe('have');
		expect(conjugate('does', true)).toBe('do');
	});

	it('applies the regular third-person-singular rules', () => {
		expect(conjugate('walk', false)).toBe('walks');
		expect(conjugate('walk', true)).toBe('walk');
		expect(conjugate('watch', false)).toBe('watches');
		expect(conjugate('fix', false)).toBe('fixes');
		expect(conjugate('carry', false)).toBe('carries');
		// go/goes is irregular under the -o rule's spelling but lands right.
		expect(conjugate('go', false)).toBe('goes');
	});
});

describe('renderSentence', () => {
	it('fills forms and capitalizes the opening word', () => {
		expect(renderSentence('{subject} brought {pd} own lunch.', she)).toBe(
			'She brought her own lunch.'
		);
	});

	it('conjugates verbs for the subject', () => {
		expect(renderSentence('{subject} {verb:go} home.', she)).toBe('She goes home.');
		expect(renderSentence('{subject} {verb:go} home.', they)).toBe('They go home.');
		expect(renderSentence('{subject} {is} here.', they)).toBe('They are here.');
	});

	it('capitalizes each sentence in a multi-sentence template', () => {
		expect(renderSentence('{subject} waved. {subject} left.', she)).toBe('She waved. She left.');
	});

	it('substitutes the display name when one is supplied', () => {
		expect(renderSentence('{name} said {subject} would come.', she, 'Ada')).toBe(
			'Ada said she would come.'
		);
	});

	it('returns null rather than inventing a missing form', () => {
		const partial: PronounForms = { subject: 'she', object: 'her' };
		expect(renderSentence('That book is {pp}.', partial)).toBeNull();
		expect(renderSentence('{subject} did it {reflexive}.', partial)).toBeNull();
		// The forms it does have still render.
		expect(renderSentence('I saw {object}.', partial)).toBe('I saw her.');
	});

	it('returns null when a template wants a name and none is set', () => {
		expect(renderSentence('{name} waved.', she)).toBeNull();
	});
});

describe('renderExamples', () => {
	it('renders every default template for a complete set', () => {
		const out = renderExamples(they);
		expect(out).toHaveLength(DEFAULT_EXAMPLE_TEMPLATES.length);
		expect(out[0]).toBe('They go to the parade every year.');
		expect(out[1]).toBe('I went with them — the flag was theirs.');
		expect(out[2]).toBe('They made it themself, their own design.');
	});

	it('drops only the templates a partial set cannot satisfy', () => {
		const out = renderExamples({ subject: 'she', object: 'her' });
		expect(out).toEqual(['She goes to the parade every year.']);
	});
});

describe('formsToSlashString', () => {
	it('joins the forms that are present', () => {
		expect(formsToSlashString(she)).toBe('she/her/her/hers/herself');
		expect(formsToSlashString({ subject: 'she', object: 'her' })).toBe('she/her');
	});
});
