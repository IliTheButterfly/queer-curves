// Domain types for queer-curves graphs.
//
// Mirrors the spec in data_model.md §1–§10. Schema changes here MUST bump
// SCHEMA_VERSION (and update data_model.md §9) so older clients fail safe
// rather than misrender unfamiliar shapes.

// v2 adds the `pronouns` graph family (data_model.md §5) and v3 the
// `occurrence` family (§4A). Graphs of the older families are shape-identical
// to v1, but the version gate is deliberately conservative: a client must
// refuse a newer export rather than guess at a `type` it has never heard of.
// Two families landing independently is exactly why the bump is per-release
// and not per-family — a v2 client knows `pronouns` and would otherwise
// accept an `occurrence` graph it cannot render.
export const SCHEMA_VERSION = 3;

// A Matrix user reference, in canonical "@user:server" form.
export type UserRef = string;

// ISO 8601 UTC timestamp string. All timestamps are stored in UTC; clients
// render in local zone (data_model.md §3.5).
export type Timestamp = string;

export type GraphType = 'spectrum' | 'network' | 'occurrence' | 'pronouns';

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

// ─── Occurrence customization ───────────────────────────────────────────────

export interface OccurrenceCustomization extends BaseCustomization {
	bar_style?: {
		// Bars are stacked per counter by default; 'grouped' puts one bar per
		// counter side by side inside each bucket.
		mode?: 'stacked' | 'grouped';
		// Rolling mean drawn as a line over the bars, in buckets. 0 / unset
		// hides it.
		rolling_window?: number;
	};
	legend?: {
		position: LegendPosition;
	};
	// Draw each counter's target as a dashed reference line on the chart.
	show_targets?: boolean;
}

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
	// Present only on a snapshot sent to a current-only share room
	// (store/projection.ts): tells the viewer's client this is the present
	// state, not the record, so the UI can say so honestly (THREATS.md §7
	// rule 13). Never set on the owner's own copy. Additive and optional —
	// no schema bump (data_model.md §9).
	projection?: { grant: 'current' };
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

// A region's geometric shape. 3D regions deferred (data_model.md §11).
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
	// against. Additive and optional — no schema bump (data_model.md §9).
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

// ─── Occurrence graphs ──────────────────────────────────────────────────────
//
// Counting, not positioning: an occurrence graph records *that a thing
// happened*, how much of it, and when. Drinks, cigarettes, doses, panic
// attacks, gym sessions, misgenderings. See data_model.md §4A.

// The period occurrences roll up into for charting and target comparison.
export type OccurrenceBucket = 'hour' | 'day' | 'week' | 'month' | 'year';

// The period a counter's headline number covers — "23 this week". Modelled on
// BetterCounter's per-counter "interval to display": the right period is a
// property of the thing being counted (cigarettes read daily, therapy
// sessions monthly), not a view setting shared by every counter in the graph.
// 'lifetime' means every entry ever, with no period boundary.
export type CounterInterval = 'day' | 'week' | 'month' | 'year' | 'lifetime';

// What a target asks of you. 'at_most' is a limit (drinks per week);
// 'at_least' is a goal (gym sessions per week). Both are advisory — the app
// never blocks an entry, it only reports.
export type TargetDirection = 'at_most' | 'at_least';

export interface CounterTarget {
	amount: number;
	period: OccurrenceBucket;
	direction: TargetDirection;
}

// A one-tap entry. Counting apps live and die on these: "+1 pint" is the
// only interaction most users ever perform, so the amounts they'd otherwise
// type are stored on the counter itself.
export interface CounterPreset {
	id: string;
	label: string;
	// In the counter's unit — a pint is 2.3 UK units, a single is 1.
	amount: number;
}

export interface Counter {
	id: string;
	label: string;
	// Names what `amount` measures: "units", "cigarettes", "mg", "£". Kept
	// free-form deliberately — the model does no unit conversion.
	unit: string;
	color?: string;
	// Amount used by a bare "+1" tap when no preset is chosen. Defaults to 1.
	step?: number;
	presets?: CounterPreset[];
	target?: CounterTarget;
	// Period the counter's headline number covers. Defaults to 'day'.
	interval?: CounterInterval;
}

export interface Occurrence {
	id: string;
	counter_id: string;
	// When it happened — backdatable, since you log the drink after the
	// drink. UTC, like every other timestamp (§3.4).
	timestamp: Timestamp;
	// In the counter's unit. Always explicit, even for pure "did it happen"
	// counters, where it is 1.
	amount: number;
	notes?: string;
	tags?: string[];
}

export interface OccurrenceSchema {
	counters: Counter[];
	// Bucket the chart opens on. Defaults to 'day'.
	default_bucket?: OccurrenceBucket;
	// Average-window policy for the "avg per period" figures: 'first_to_now'
	// divides by the span from the first entry to now (so a counter you
	// abandoned keeps diluting), 'first_to_last' divides by first-to-last
	// entry (so it reports the rate while you were actually logging).
	// Defaults to 'first_to_now'.
	average_mode?: 'first_to_now' | 'first_to_last';
	// Local hour (0–23) at which a new day begins for bucketing purposes.
	// 4 means a 2am drink counts toward the night before — the thing every
	// drink tracker gets asked for. Defaults to 0.
	day_start_hour?: number;
}

export interface OccurrenceGraph extends BaseGraph {
	type: 'occurrence';
	schema: OccurrenceSchema;
	customization: OccurrenceCustomization;
	occurrences: Occurrence[];
}

// ─── Pronoun graphs ─────────────────────────────────────────────────────────

export interface PronounsCustomization extends BaseCustomization {
	// 'level' (default) groups entries under their preference level; 'flat'
	// lists them in authored order with the level shown as a chip.
	layout?: 'level' | 'flat';
	// Whether to render generated example sentences under each pronoun set
	// that declares its forms. Defaults to true.
	show_examples?: boolean;
}

// One step on the graph's preference scale. The scale is per-graph so a card
// can be as coarse as yes/no or as fine as the six-step scale pronoun cards
// conventionally use. Array order is the scale: most-preferred first.
export interface PreferenceLevel {
	id: string;
	// e.g. "favourite", "okay", "only if we're close", "avoid", "never".
	label: string;
	color: string;
	description?: string;
}

// The five English pronoun forms, plus verb agreement. Only subject and
// object are required — a partially-filled set still renders as a chip, it
// just can't produce every example sentence (see graphs/pronouns/sentences).
export interface PronounForms {
	// she / he / they / ey
	subject: string;
	// her / him / them / em
	object: string;
	// her (book) / his / their / eir
	possessive_determiner?: string;
	// hers / his / theirs / eirs
	possessive_pronoun?: string;
	// herself / himself / themself / emself
	reflexive?: string;
	// True when the subject form takes plural verb agreement ("they are"
	// rather than "she is"). Defaults to false.
	plural?: boolean;
}

export interface PronounSet {
	id: string;
	// Display form, e.g. "she/her". Free text rather than derived from
	// `forms`, because real cards carry entries with no declension at all —
	// "any pronouns", "name only", "ask me first".
	label: string;
	// Optional: set only for entries that actually decline.
	forms?: PronounForms;
	level_id: string;
	notes?: string;
	// Optional per-entry colour override. When unset the entry renders in
	// its level's colour.
	color?: string;
}

// A grouping for terms — "identity words", "ways to address me",
// "relationship words". Per-graph so users name their own categories.
export interface TermGroup {
	id: string;
	label: string;
	description?: string;
}

// A gender/identity word or form of address, rated on the same preference
// scale as the pronoun sets (e.g. "nonbinary" favourite, "lady" avoid).
export interface GenderTerm {
	id: string;
	label: string;
	group_id: string;
	level_id: string;
	notes?: string;
	color?: string;
}

export interface PronounsSchema {
	levels: PreferenceLevel[];
	term_groups: TermGroup[];
	// Sentence templates used to demonstrate each pronoun set's forms.
	// Placeholders are documented in graphs/pronouns/sentences.ts. When
	// unset, clients use their built-in defaults.
	examples?: string[];
}

export interface PronounsGraph extends BaseGraph {
	type: 'pronouns';
	schema: PronounsSchema;
	customization: PronounsCustomization;
	pronouns: PronounSet[];
	terms: GenderTerm[];
	// Optional name to substitute into example sentences ("Ada brought their
	// own lunch"). Separate from `name`, which titles the graph.
	display_name?: string;
}

// ─── Discriminated union ────────────────────────────────────────────────────

export type Graph = SpectrumGraph | NetworkGraph | OccurrenceGraph | PronounsGraph;

// ─── Type guards ────────────────────────────────────────────────────────────

export function isSpectrum(graph: Graph): graph is SpectrumGraph {
	return graph.type === 'spectrum';
}

export function isNetwork(graph: Graph): graph is NetworkGraph {
	return graph.type === 'network';
}

export function isOccurrence(graph: Graph): graph is OccurrenceGraph {
	return graph.type === 'occurrence';
}

export function isPronouns(graph: Graph): graph is PronounsGraph {
	return graph.type === 'pronouns';
}
