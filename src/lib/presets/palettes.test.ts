import { describe, expect, it } from 'vitest';
import { dedupColors, findPalette, palettes } from './palettes.js';

describe('dedupColors', () => {
	it('returns an empty array for empty input', () => {
		expect(dedupColors([])).toEqual([]);
	});

	it('preserves order of first occurrence', () => {
		expect(dedupColors(['#aaa', '#bbb', '#ccc'])).toEqual(['#aaa', '#bbb', '#ccc']);
	});

	it('drops duplicates while keeping first-occurrence order', () => {
		// Trans flag colours: light-blue / pink / white / pink / light-blue
		expect(dedupColors(['#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA'])).toEqual([
			'#5BCEFA',
			'#F5A9B8',
			'#FFFFFF'
		]);
	});

	it('treats hex values as case-insensitive', () => {
		expect(dedupColors(['#FFFFFF', '#ffffff', '#FfFfFf'])).toEqual(['#FFFFFF']);
	});

	it('preserves the original casing of the first occurrence', () => {
		expect(dedupColors(['#AbCdEf', '#abcdef'])).toEqual(['#AbCdEf']);
	});
});

describe('findPalette', () => {
	it('returns the matching palette by id', () => {
		const p = findPalette('pride');
		expect(p?.id).toBe('pride');
		expect(p?.colors.length).toBeGreaterThan(0);
	});

	it('returns undefined for an unknown id', () => {
		expect(findPalette('does-not-exist')).toBeUndefined();
	});
});

describe('palette catalogue', () => {
	it('every palette has a unique id', () => {
		const ids = palettes.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('every palette has at least two colours', () => {
		for (const p of palettes) {
			expect(p.colors.length).toBeGreaterThanOrEqual(2);
		}
	});

	it('every colour is a valid 3 or 6-digit hex code', () => {
		const hex = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
		for (const p of palettes) {
			for (const c of p.colors) {
				expect(c, `${p.id} colour ${c}`).toMatch(hex);
			}
		}
	});
});
