// Queer flag color palettes for use as graph customization.theme.palette.
//
// Hex values are the most-cited canonical colors for each flag. Where flags
// have multiple variants, we use the most contemporary widely-recognized
// version. If you spot an inaccuracy, fix it — these matter.

export interface Palette {
	id: string;
	name: string;
	/** Optional human-readable note about which flag / which variant. */
	flag?: string;
	/** Ordered list of hex colors. Stripes top-to-bottom on the source flag. */
	colors: string[];
	/** Soft description of what the palette is for / who it represents. */
	description?: string;
}

export const palettes: Palette[] = [
	{
		id: 'pride',
		name: 'Pride',
		flag: 'Rainbow Pride (6-stripe)',
		colors: ['#E40303', '#FF8C00', '#FFED00', '#008026', '#004CFF', '#732982'],
		description: 'The classic 6-stripe rainbow.'
	},
	{
		id: 'progress',
		name: 'Progress Pride',
		flag: "Daniel Quasar's 2018 redesign",
		colors: [
			'#E40303',
			'#FF8C00',
			'#FFED00',
			'#008026',
			'#004CFF',
			'#732982',
			'#FFFFFF',
			'#F5A9B8',
			'#5BCEFA',
			'#613915',
			'#000000'
		],
		description:
			'Adds the trans flag colors plus brown and black to honour queer people of colour and those lost to AIDS.'
	},
	{
		id: 'intersex-progress',
		name: 'Intersex-Inclusive Progress',
		flag: "Valentino Vecchietti's 2021 update",
		colors: [
			'#E40303',
			'#FF8C00',
			'#FFED00',
			'#008026',
			'#004CFF',
			'#732982',
			'#FFFFFF',
			'#F5A9B8',
			'#5BCEFA',
			'#613915',
			'#000000',
			'#FFD800',
			'#7902AA'
		],
		description: 'Progress flag with the intersex circle colours added.'
	},
	{
		id: 'trans',
		name: 'Trans',
		flag: "Monica Helms's 1999 design",
		colors: ['#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA']
	},
	{
		id: 'bi',
		name: 'Bisexual',
		flag: "Michael Page's 1998 design",
		colors: ['#D60270', '#9B4F96', '#0038A8']
	},
	{
		id: 'lesbian',
		name: 'Lesbian',
		flag: 'Sunset / Orange-Pink (7-stripe, 2018)',
		colors: ['#D52D00', '#EF7627', '#FF9A56', '#FFFFFF', '#D162A4', '#B55590', '#A30262']
	},
	{
		id: 'pan',
		name: 'Pansexual',
		colors: ['#FF218C', '#FFD800', '#21B1FF']
	},
	{
		id: 'ace',
		name: 'Asexual',
		colors: ['#000000', '#A4A4A4', '#FFFFFF', '#810081']
	},
	{
		id: 'aceflux',
		name: 'Aceflux',
		flag: 'Asexual-spectrum fluidity',
		colors: ['#202060', '#3F4188', '#7F7F7F', '#FFFFFF', '#A0AAE0', '#5050A0']
	},
	{
		id: 'aro',
		name: 'Aromantic',
		colors: ['#3DA542', '#A7D379', '#FFFFFF', '#A9A9A9', '#000000']
	},
	{
		id: 'demi',
		name: 'Demisexual',
		colors: ['#000000', '#FFFFFF', '#810081', '#A4A4A4']
	},
	{
		id: 'nb',
		name: 'Non-binary',
		flag: "Kye Rowan's 2014 design",
		colors: ['#FCF434', '#FFFFFF', '#9C59D1', '#2C2C2C']
	},
	{
		id: 'genderfluid',
		name: 'Genderfluid',
		flag: "JJ Poole's 2012 design",
		colors: ['#FF75A2', '#FFFFFF', '#BE18D6', '#000000', '#333EBD']
	},
	{
		id: 'genderqueer',
		name: 'Genderqueer',
		flag: "Marilyn Roxie's 2011 design",
		colors: ['#B57EDC', '#FFFFFF', '#4A8123']
	},
	{
		id: 'agender',
		name: 'Agender',
		flag: "Salem X's 2014 design",
		colors: ['#000000', '#BABABA', '#FFFFFF', '#B8F483', '#FFFFFF', '#BABABA', '#000000']
	},
	{
		id: 'polysexual',
		name: 'Polysexual',
		colors: ['#F61CB9', '#07D569', '#1C92F6']
	},
	{
		id: 'polyam',
		name: 'Polyamory',
		flag: 'Red Howell / Molly Reid 2022 redesign',
		colors: ['#0091EA', '#E40303', '#000000', '#FFCB05']
	},
	{
		id: 'queer',
		name: 'Queer',
		flag: 'Lavender + green pride (2015)',
		colors: ['#B57FDD', '#FFFFFF', '#5BCEFA', '#FFFFFF', '#7BBE7E']
	}
];

export const palettesById = new Map(palettes.map((p) => [p.id, p]));

export function findPalette(id: string): Palette | undefined {
	return palettesById.get(id);
}
