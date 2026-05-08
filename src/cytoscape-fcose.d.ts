// Minimal ambient declaration for cytoscape-fcose, which ships no types.
// Just enough for `cytoscape.use(fcoseDefault)` and `name: 'fcose'` layouts.
declare module 'cytoscape-fcose' {
	import type cytoscape from 'cytoscape';
	const ext: cytoscape.Ext;
	export default ext;
}
