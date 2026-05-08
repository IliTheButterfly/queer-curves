// Continuous color ramp built from a graph's palette. Used by 3D spectrum
// rendering: the third axis is encoded as color on a 2D scatter, with the
// ramp interpolating evenly across the palette stops over the axis range.
//
// Sticking with the user's chosen palette keeps the visualization on-brand
// (a pride flag's stripes become a smooth gradient) instead of imposing a
// generic perceptually-uniform ramp.

import * as d3 from 'd3';

export interface ColorRamp {
	(value: number): string;
	domain: [number, number];
	stops: { offset: number; color: string }[];
}

const FALLBACK_COLORS = ['#1a1424', '#c98aff'];

export function buildColorRamp(palette: string[], domain: [number, number]): ColorRamp {
	const stops = palette && palette.length >= 2 ? palette : FALLBACK_COLORS;
	const [min, max] = domain;
	const span = max - min || 1;
	// Evenly-spaced domain stops across the palette so each color sits at
	// its proportional position along the axis range.
	const domainStops = stops.map((_, i) => min + (span * i) / (stops.length - 1));
	const scale = d3
		.scaleLinear<string>()
		.domain(domainStops)
		.range(stops)
		.interpolate(d3.interpolateRgb)
		.clamp(true);

	const ramp = ((value: number) => scale(value)) as ColorRamp;
	ramp.domain = [min, max];
	// Pre-compute SVG gradient stops at fine resolution so legends and
	// pickers can render a continuous bar without re-sampling each render.
	const gradientStops: { offset: number; color: string }[] = [];
	const N = 32;
	for (let i = 0; i <= N; i++) {
		const t = i / N;
		const v = min + span * t;
		gradientStops.push({ offset: t, color: scale(v) });
	}
	ramp.stops = gradientStops;
	return ramp;
}
