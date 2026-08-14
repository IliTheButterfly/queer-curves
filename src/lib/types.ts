// Domain types for queer-curves graphs.
//
// Mirrors the spec in data_model.md §1–§9. Schema changes here MUST bump
// SCHEMA_VERSION (and update data_model.md §8) so older clients fail safe
// rather than misrender unfamiliar shapes.

export const SCHEMA_VERSION = 1;

// A Matrix user reference, in canonical "@user:server" form.
export type UserRef = string;

// ISO 8601 UTC timestamp string. All timestamps are stored in UTC; clients
// render in local zone (data_model.md §3.4).
export type Timestamp = string;

export type GraphType = 'spectrum' | 'network';

// ─── Customization ──────────────────────────────────────────────────────────

export interface ThemeCustomization {
	// Ordered palette; per-element colors can reference indices via "@palette[i]".
	palette: string[];
	background?: string;
	font?: string;
}

export interface TitleCustomization {
	show: boolean;
	text: string;
}

export interface BaseCustomization {
	theme: ThemeCustomization;
	title: TitleCustomization;
	subtitle?: string;
}

export interface SpectrumCustomization extends BaseCustomization {
	axis_style?: {
		line_color?: string;
		label_color?: string;
	};
	region_style?: {
		default_opacity?: number;
	};
	// Optional saved views over the same datapoints. When unset, clients
	// derive a sensible set of presets based on dimensionality (see §3.6).
	views?: SpectrumView[];
}

// A reference to one of the graph's axes by index (0..N-1) or to the
// implicit time axis (datapoint timestamps). Used by SpectrumView to map
// axes onto visual channels.
export type AxisRef = number | 'time';

export type SpectrumViewLayout = 'cartesian' | 'radial' | 'polar';

// A SpectrumView is a saved configuration for visualising the graph's
// datapoints. The same data can be projected through multiple views — the
// classic 2D scatter, a polar plot, a radial-overlay over cartesian, or a
// time-vs-axis side view — without duplicating the underlying data.
export interface SpectrumView {
	id: string;
	name: string;
	// 'cartesian' = (x, y) plot.
	// 'radial' = cartesian positions, with a polar overlay drawn on top:
	//   concentric "length" ellipses centred at (axis-x = 0, axis-y = 0)
	//   and angle spokes through the same origin. Points and the picker
	//   stay in cartesian axis space; only the gridlines change so users
	//   can read the polar coordinates of any cartesian point off the
	//   chart.
	// 'polar' = polar conversion: x and y are read as cartesian axes, then
	//   converted to length = sqrt(x² + y²) and angle = atan2(y, x), and
	//   each datapoint is REPLOTTED at the polar pixel position. The
	//   picker reverses the conversion on input. Coords remain stored in
	//   cartesian axis space, but the visual position of points differs
	//   from the cartesian view.
	layout: SpectrumViewLayout;
	x: AxisRef;
	y: AxisRef;
	// When set, datapoints are coloured via a ramp built from the palette
	// over the referenced axis's range. 'time' uses the datapoints' time
	// extent. When unset, clients fall back to per-datapoint colour
	// overrides or palette cycling by time-order.
	color?: AxisRef;
	// Optional display-name overrides for the visual channels. For radial
	// views these become the "length" and "angle" labels (e.g. "genderness"
	// and "gender") so the view's perspective doesn't have to share names
	// with its underlying axes.
	x_label?: string;
	y_label?: string;
	// Shape of the radial overlay (only meaningful when layout = 'radial').
	// 'circle' draws full concentric ellipses + 360° of spokes. 'pie'
	// restricts the overlay to the angular range actually reachable given
	// the axis ranges — e.g. axes (`[-1, 1]`, `[0, 1.1]`) only cover the
	// upper semicircle, so the overlay becomes a half-pie.
	shape?: 'circle' | 'pie';
}

export type LegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'hidden';

export interface NetworkCustomization extends BaseCustomization {
	node_style?: {
		default_color?: string;
		shape?: 'circle' | 'square';
	};
	edge_style?: {
		default_width?: number;
	};
	legend?: {
		position: LegendPosition;
	};
}

// ─── Common Graph fields ────────────────────────────────────────────────────

export interface BaseGraph {
	id: string;
	type: GraphType;
	name: string;
	description?: string;
	created_at: Timestamp;
	modified_at: Timestamp;
	schema_version: number;
	owner: UserRef;
	editors: UserRef[];
}

// ─── Spectrum graphs ────────────────────────────────────────────────────────

export type SpectrumDimensions = 1 | 2 | 3;

// A labeled position along a single axis. Per-axis — see PointWaypoint for
// labeled points in N-D space.
export interface AxisWaypoint {
	position: number;
	label: string;
	color?: string;
}

// A labeled point in the N-D coordinate space (e.g. "gendervoid" at (0.2,
// 0.3)). Stored on SpectrumSchema, not on an axis. v1 renders these on 2D
// graphs; 1D could use AxisWaypoint instead, and 3D rendering is deferred.
export interface PointWaypoint {
	id: string;
	label: string;
	coordinates: number[];
	color?: string;
}

export interface Axis {
	name: string;
	min_label: string;
	max_label: string;
	range: [number, number];
	waypoints?: AxisWaypoint[];
	// Optional textual label for the zero crossing — meaningful when the
	// axis range straddles zero (e.g. range=[-1, 1]) and the user wants to
	// name the neutral midpoint, the same way min_label/max_label name the
	// poles.
	zero_label?: string;
}

// A region's geometric shape. 3D regions deferred (data_model.md §10).
export type RegionShape =
	| { type: 'range'; min: number; max: number }
	| { type: 'box'; min: number[]; max: number[] }
	| { type: 'polygon'; vertices: [number, number][] };

export interface Region {
	id: string;
	label: string;
	shape: RegionShape;
	color: string;
	opacity?: number;
}

export interface SpectrumDatapoint {
	id: string;
	coordinates: number[];
	timestamp: Timestamp;
	notes?: string;
	tags?: string[];
	// Optional per-point color override. When unset, clients render the point
	// using a palette cycle indexed by time-order (so consecutive points
	// progress through the flag's colors by default).
	color?: string;
}

export interface SpectrumSchema {
	dimensions: SpectrumDimensions;
	axes: Axis[];
	regions: Region[];
	point_waypoints?: PointWaypoint[];
}

export interface SpectrumGraph extends BaseGraph {
	type: 'spectrum';
	schema: SpectrumSchema;
	customization: SpectrumCustomization;
	datapoints: SpectrumDatapoint[];
}

// ─── Network graphs ─────────────────────────────────────────────────────────

export type LinkStatus = 'pending' | 'confirmed' | 'denied';

export interface NetworkNode {
	id: string;
	label: string;
	color?: string;
	avatar_ref?: string;
	// If subject_ref is set, this node names a real queer-curves user.
	// Sharing such links requires consent — see sharing_model.md §12.
	subject_ref?: UserRef;
	// Required when subject_ref is set; tracks the consent handshake state.
	link_status?: LinkStatus;
	// Marks the node as the graph owner. Name privacy (graphs/network/privacy.ts)
	// masks every *other* node's label by default, so the client needs to know
	// which one is you when there's no Matrix session to match subject_ref
	// against. Additive and optional — no schema bump (data_model.md §8).
	is_self?: boolean;
	position?: { x: number; y: number };
}

export interface NetworkEdge {
	id: string;
	source: string;
	target: string;
	type_id: string;
	label_override?: string;
	directed?: boolean;
}

export interface EdgeType {
	id: string;
	label: string;
	color: string;
	description?: string;
}

export interface NetworkSchema {
	edge_types: EdgeType[];
}

export interface NetworkGraph extends BaseGraph {
	type: 'network';
	schema: NetworkSchema;
	customization: NetworkCustomization;
	nodes: NetworkNode[];
	edges: NetworkEdge[];
}

// ─── Discriminated union ────────────────────────────────────────────────────

export type Graph = SpectrumGraph | NetworkGraph;

// ─── Type guards ────────────────────────────────────────────────────────────

export function isSpectrum(graph: Graph): graph is SpectrumGraph {
	return graph.type === 'spectrum';
}

export function isNetwork(graph: Graph): graph is NetworkGraph {
	return graph.type === 'network';
}
