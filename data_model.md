# Data Model

This document defines the domain model for queer-curves: what users create, what shape it has, and what the system stores. The Matrix event encoding is sketched at the end, but full schema is out of scope here (see `sharing_model.md` once written).

Status: **draft**, v0. Updated 2026-08-14.

## 1. Overview

A user creates and maintains **Graphs**. Each Graph is a self-contained artifact with:

- a **type** (spectrum, network, or pronouns — extensible to more later),
- a **schema** (type-specific structure: axes, regions, edge types, etc.),
- **data** (type-specific datapoints / current state),
- **customization** (colors, theme, labels),
- a **sharing config** (referenced here, defined in `sharing_model.md`),
- an **owner** and optional **editors**.

The graph families currently supported are derived from canonical use cases the user provided:

| Family | Purpose | Canonical example |
|---|---|---|
| Spectrum | Identity in an N-dimensional coordinate space, tracked over time | aceflux (1D), genderfluid (2D) |
| Network | Relational data (people and typed connections) | polycule |
| Occurrence | Discrete events counted over time, with optional per-period targets | alcohol units, cigarettes, doses |
| Pronouns | Categorical preferences over pronouns and identity/address words | pronoun card |

Spectrum and network were sufficient for v1; the pronoun card arrived in `schema_version = 2` (§5) and occurrence graphs in `schema_version = 3` (§4A). Adding further families is expected — the model leaves room.

## 2. Common Graph fields

Every Graph, regardless of type, carries:

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable identifier; in Matrix encoding this is the room id |
| `type` | `"spectrum"` \| `"network"` \| `"occurrence"` \| `"pronouns"` | extensible |
| `name` | string | user-set, e.g. "my gender" |
| `description` | string | user-set, optional |
| `created_at` | timestamp | |
| `modified_at` | timestamp | last schema change |
| `schema_version` | int | for forward-compat (see §9) |
| `owner` | user reference | only the owner can change schema |
| `editors` | list of user references | can append datapoints; cannot change schema |
| `customization` | object | see §6 |

## 3. Spectrum graphs

A spectrum graph plots a position in an N-dimensional labeled coordinate space, optionally tracked over time as a trajectory.

### 3.1 Dimensionality

Supported in v1: **N = 1, 2, 3**.

3D graphs are rendered as a 2D scatter on axes 0/1 with the third axis encoded as **colour via a ramp** built from the graph's palette — not as a 3D scene. This avoids loading Three.js, keeps the visualization within the chosen flag/palette aesthetic, and trades one axis of position for one axis of hue. (3D scatter via Three.js is no longer planned for v1; see §11.)

### 3.2 Axes

The graph defines `N` axes. Each axis has:

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. "attraction", "gender (1)" |
| `min_label` | string | the "left/bottom" endpoint, e.g. "ace", "agender" |
| `max_label` | string | the "right/top" endpoint, e.g. "demi", "non-binary" |
| `range` | `[number, number]` | numeric bounds, default `[0, 1]` |
| `waypoints` | list of `{position, label, color?}` | intermediate labeled positions along this axis (e.g. "gray" between ace and demi; "girl" between agender and women) |
| `zero_label` | string | optional textual name for the zero crossing — meaningful only when the range straddles zero (e.g. `range=[-1, 1]`). Names the neutral midpoint the same way `min_label`/`max_label` name the poles. |

Per-axis waypoints render as tick labels or guide lines. They name a position along a single axis (e.g. "gray" between ace and demi).

For labeled points *in N-D space* (e.g. "gendervoid" at (0.2, 0.3)), see §3.3 below — those live on the schema, not on an axis.

### 3.3 Point waypoints (N-D landmarks)

A point waypoint is a labeled landmark at a specific position in the coordinate space — distinct from per-axis waypoints, which only mark a position along one axis. Stored as `schema.point_waypoints`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable |
| `label` | string | user-set, e.g. "gendervoid" |
| `coordinates` | `number[]` | length must equal graph dimensionality |
| `color` | string | optional |

Rendered in v1 on 2D and 3D graphs as a small cross-style marker with its label. 1D graphs typically use per-axis waypoints instead. On 3D scatters the cross tints to the colour the ramp would produce at `coordinates[2]` when no explicit `color` is set, so the landmark visually belongs to the same colour-axis space as the datapoints.

### 3.4 Regions

Regions are labeled sub-areas of the N-D space, used to annotate state-of-mind bands ("sex attractive within this range").

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable identifier |
| `label` | string | user-set |
| `shape` | one of: `range` (1D), `box` (N-D), `polygon` (2D only in v1) | |
| `color` | string | hex / theme reference |
| `opacity` | number | default ~0.2 — regions render under datapoints |

**Shape encodings:**
- `range`: `{min: number, max: number}` along the single axis (1D only).
- `box`: `{min: number[], max: number[]}` — axis-aligned, N-dimensional.
- `polygon`: `{vertices: [number, number][]}` — closed polyline (2D only). 3D regions deferred.

### 3.5 Datapoints

A spectrum datapoint is the user's recorded position in the N-D space at a moment in time.

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable; lets us correct/redact a single point |
| `coordinates` | `number[]` | length must equal graph dimensionality |
| `timestamp` | timestamp | when the datapoint applies (may differ from event posting time, e.g. retroactive entry) |
| `notes` | string | optional, user-set |
| `tags` | string[] | optional, user-set (e.g. "post-therapy", "pms-week") |
| `color` | string | optional, user-set; when unset, clients render the point using a palette cycle indexed by time-order (so consecutive points progress through the flag's colors by default) |

The **current point** is, by default, the most recent datapoint by `timestamp`. (Clients may offer "snap to most recent N hours" averaging later; the data model itself just records points.)

**Time zones.** All `timestamp` values are stored in UTC. Display time zone is the client's local zone.

**Correction and deletion.** A datapoint can be corrected (the owner publishes a fresh datapoint event superseding the prior one) or deleted (Matrix `m.room.redaction` event referencing the datapoint). Compliant clients MUST honor redactions and remove the datapoint from local cache (IndexedDB), not just hide it from rendering. Caveat: a non-compliant client with valid keys at the time the data was decrypted could retain the data — the protocol cannot enforce ephemerality once data has been decrypted on a viewer's device.

### 3.6 History rendering modes

How a spectrum graph's history is visualized depends on dimensionality:

| Dimension | Rendering of trajectory |
|---|---|
| 1D | line plot, x = time, y = value |
| 2D | scatter cloud over the 2D space; optional density/heatmap; optional time-colored trail |
| 3D | 2D scatter on axes 0/1, with axis 2 encoded as colour via a ramp interpolated over the graph's palette. A colour-bar legend labels the ramp's `min_label`, `max_label`, and `zero_label` (when applicable). |

A spectrum graph supports **multiple views** over the same underlying datapoints — each view picks a layout (`cartesian`, `radial`, or `polar`) and assigns the graph's axes (or the implicit time axis) to the visual channels (x, y, optionally colour). Clients always start from a default set of presets per dimensionality, and any views saved on `customization.views` are appended to that preset list (so adding one custom view doesn't strip access to the standard projections). The presets are:

- 1D — `Default` (time × value).
- 2D — `Cartesian`, `Side` (time × axis 2), `Top` (time × axis 1), `Radial` (overlay), `Polar` (warped).
- 3D — three cartesian axis-permutations with the remaining axis as colour, a `Side` time projection, and a radial-overlay variant.

The three layouts handle the cartesian-vs-polar distinction differently:

- **`cartesian`** — standard scatter plot. Each datapoint is placed at `(xScale(coords[view.x]), yScale(coords[view.y]))`.
- **`radial`** — by default keeps cartesian positions and overlays a polar grid on top: concentric "length" ellipses centred at `(axis-x = 0, axis-y = 0)` plus angle spokes through the same origin. Lets users read the polar coordinates of any cartesian point off the chart without re-projecting the data. With `shape: "pie"`, the layout becomes the polar-conversion-plus-pie-sector display (see `polar`) so `radial + pie` and `polar + pie` produce the same visualization through different form paths.
- **`polar`** — polar conversion: each datapoint is replotted at `(length = sqrt(x² + y²), angle = atan2(y, x))` in pixel space. So a graph with axes (`enbiness ∈ [-1, 1]`, `girliness ∈ [0, 1.1]`) renders with length = combined magnitude, angle = orientation. The picker reverses the conversion on input. With `shape: "pie"` the outer frame is drawn as a pie sector restricted to the angular range actually reachable from the axis ranges (e.g. those axes only cover the upper semicircle, so `pie` carves the plot into a half-disc).

Views can override channel names via optional `x_label` / `y_label` fields (e.g. `x_label: "genderness"`, `y_label: "gender"` on a polar view backed by `enbiness × girliness`). Views are presentation-only: data is unchanged across views.

These are display choices made by the client, not properties stored on the graph. The graph stores datapoints; the client decides how to draw them.

## 4. Network graphs

A network graph represents relational data — most concretely, polycules.

### 4.1 Nodes

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable |
| `label` | string | user-set, e.g. "Alex" |
| `color` | string | optional |
| `avatar_ref` | string | optional, opaque reference (URL or Matrix mxc) |
| `subject_ref` | user reference | optional — links the node to an actual queer-curves user (subject to consent — see below) |
| `link_status` | `"pending"` \| `"confirmed"` \| `"denied"` | required if `subject_ref` is set; tracks the consent state of the link |
| `is_self` | bool | optional — marks the node as the graph owner. At most one node per graph should set it |
| `position` | `{x, y}` | optional, user-set or layout-computed |

**Name privacy.** A rendered network names real people, and the screen it's rendered on is the easiest leak in the model (`THREATS.md` T3). Clients therefore render every node *except* the viewer's own with **no label at all** by default — not a pseudonym, which would still be a handle a viewer could screenshot and reason about — and reveal real labels only while the viewer actively holds a control down. The viewer's own node is marked "You" so they can find themselves; the rest is shape without names. "Your own" node is the one with `is_self`, or the one whose `subject_ref` matches the signed-in account — `is_self` exists because a graph kept locally has no session to match against. This is a **presentation** rule, not a storage one: the labels are stored in full and shared in full with whoever is in the room. It defends against shoulder-surfing and casual screenshots, not against a viewer who has the data.

**Consent for `subject_ref`.** Linking a node to a real user is sensitive — it publicly names that user as part of your network. Setting `subject_ref` triggers a consent request to the linked user; the link starts as `pending` and only becomes `confirmed` if the named user accepts. Clients SHOULD display non-confirmed links distinctly (e.g. dashed outline) and SHOULD NOT publish them in any view shared beyond the owner. The named user can withdraw consent at any time (transitions the link to `denied`), at which point the owner's client must remove or anonymize the link in published views. The protocol-level mechanism (Matrix to-device messaging for the consent handshake) is specified in `sharing_model.md`.

### 4.2 Edges

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable |
| `source` | node id | |
| `target` | node id | |
| `type_id` | edge-type id | references `edge_types` legend |
| `label_override` | string | optional — overrides legend label for this edge |
| `directed` | bool | default false |

### 4.3 Edge types (legend)

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable |
| `label` | string | shown in legend |
| `color` | string | |
| `description` | string | optional, expanded explanation |

Per-viewer legend redaction (the case where some viewers see "sexual" labels and others see only "connected") is **not** handled at the data-model level. It's handled at the sharing-mechanism level by publishing redacted variants of the graph to separate rooms — see `sharing_model.md`. From the data model's perspective, each room contains exactly one consistent view.

### 4.4 Network history

For v1, network graphs store a **current state only** — list of nodes, edges, edge types. Historical replay (a timeline of "Alex joined the polycule on date X, Bob's edge to Carol changed to type Y on date Z") is deferred to v2; the protocol leaves room (every mutation could be its own event) but the v1 client will treat the network as point-in-time.

## 4A. Occurrence graphs

An occurrence graph counts discrete events over time: alcohol units, cigarettes, doses, panic attacks, gym sessions, misgenderings, migraines. Where a spectrum graph answers *where am I*, an occurrence graph answers *how much, how often, and when did I last*.

(Numbered `4A` rather than `5` because the pronoun family (§5) claimed the next integer while this section was being written on a parallel branch. Renumbering it now would shift §5–§13 and invalidate cross-references in the code and the other design docs, which is a worse trade than a lettered section.)

The design is taken from what dedicated counting apps converged on: one-tap entry above all else, per-unit presets so the tap records a real quantity, roll-ups into days/weeks/months rather than a continuous line, and an optional target that reports rather than nags.

### 4A.1 Counters

A graph defines one or more **counters** — the distinct things being counted. Counters are the occurrence-graph analogue of axes.

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable |
| `label` | string | user-set, e.g. "alcohol", "coffee" |
| `unit` | string | free-form; names what `amount` measures ("units", "cigarettes", "mg", "£", "cups") |
| `color` | string | optional; clients fall back to a palette cycle by counter index |
| `step` | number | amount recorded by a bare one-tap add; defaults to `1` |
| `presets` | list of `{id, label, amount}` | optional one-tap quantities, e.g. `pint` = 2.3 units |
| `target` | `{amount, period, direction}` | optional; see §4A.4 |
| `interval` | `"day"` \| `"week"` \| `"month"` \| `"year"` \| `"lifetime"` | period the headline number covers; default `day` (§4A.6) |

**Units are never converted.** The model stores whatever the user thinks in; two counters with different units are never summed together (clients must subtotal per counter, not across them).

**A counter with logged occurrences cannot be deleted.** Removing it would orphan those entries — they would vanish from every total while still occupying space in the snapshot. Clients must block the deletion until the entries are gone.

### 4A.2 Occurrences

An occurrence is one logged event.

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable; lets us correct/redact a single entry |
| `counter_id` | string | must reference a counter in the same graph's schema |
| `timestamp` | timestamp | when it happened — backdatable, since people log the drink *after* the drink. UTC (§3.5) |
| `amount` | number | in the counter's unit. Always explicit, `1` for pure "did it happen" counters |
| `notes` | string | optional |
| `tags` | string[] | optional, e.g. "party", "stressed", "post-therapy" |

Correction and deletion follow §3.5 exactly: a fresh event supersedes, a redaction removes, and compliant clients wipe rather than hide.

### 4A.3 Buckets and the day boundary

Occurrences roll up into **buckets** for charting and target comparison: `hour`, `day`, `week` (Monday-start), `month`, or `year`. `schema.default_bucket` sets which the chart opens on (default `day`).

**`schema.day_start_hour`** (0–23, default 0) shifts the local day boundary. With `day_start_hour = 4`, a 2am drink counts toward the night before. This exists because it is the single most-requested behaviour in drink trackers, and because a calendar-midnight boundary splits one evening into two days and makes both the daily totals and any streak wrong.

Bucketing is **local-time**, always, even though timestamps are stored UTC — people count in their own days. Weeks and months inherit the same hour shift (a week starts Monday at `day_start_hour`; a month starts the 1st at `day_start_hour`).

Bucket series are **dense**: every bucket between the first occurrence and now exists, including the empty ones. A gap in a drinks chart is information and must be drawn, not skipped.

Charts show a **trailing window** over that dense series (default 45 days / 26 weeks / 12 months), because a year of daily bars is unreadable. Statistics still run over the whole series. When the trailing window happens to be entirely empty — a graph nobody has logged to in months — it slides back to end at the last bucket with data, and the chart **must say so** ("nothing logged since …"). An x axis that stops in May while today is August, with no such label, reads as "up to now" and is a lie.

### 4A.4 Targets

A counter may carry one target:

| Field | Type | Notes |
|---|---|---|
| `amount` | number | in the counter's unit |
| `period` | `"day"` \| `"week"` \| `"month"` | the bucket the target is measured over |
| `direction` | `"at_most"` \| `"at_least"` | a limit (drinks per week) vs. a goal (gym sessions per week) |

Targets are **advisory**. The app never blocks or warns off an entry; it reports the current period's total against the target and leaves the judgement to the user. This is a deliberate stance: the tool is for people tracking things about themselves, and a counter that scolds gets abandoned or lied to, which destroys the data it exists to collect.

**Streaks count completed periods only.** The period you are still living in has not yet kept its limit, so including it would reset every streak at midnight and then un-reset it. Clients report the current period's running total separately from the streak.

**A target line is only drawn when its `period` matches the chart's bucket.** A weekly limit drawn across daily bars reads as a daily limit, which misleads in the most harmful direction available.

### 4A.5 Occurrence history rendering

Bars, not lines: occurrences are discrete counts inside a period, and a line between two buckets implies in-between values that never existed. Multiple counters stack within a bucket by default, or sit side by side (`bar_style.mode`). An optional rolling mean over N buckets (`bar_style.rolling_window`) gives the trend, which is what distinguishes a bad week from a bad direction.

Bar width is capped, so a graph with one or two buckets shows a bar rather than a filled half-chart.

### 4A.6 Per-counter intervals

Each counter carries its own `interval` — the period its headline number covers — one of `day`, `week`, `month`, `year`, `lifetime` (default `day`). The right period is a property of the thing counted, not a view setting shared by the whole graph: cigarettes are read daily, alcohol units weekly (every public-health guideline states them per week), therapy sessions monthly. A single graph-wide selector would force one of those to be wrong.

A chart subdivides an interval one step finer, so the headline number and the bars describe the same period: `day` → hourly bars, `week`/`month` → daily, `year` → monthly, `lifetime` → monthly.

`schema.average_mode` selects how the rate figure is computed: `first_to_now` (default) divides the total by the span from the first entry to now, so a counter you abandoned keeps diluting; `first_to_last` divides by first-entry-to-last-entry, reporting the rate while you were actually logging. Neither is right for everyone, which is why it's a setting.

### 4A.7 The counting UI is BetterCounter's

The screen is a **list of counter rows**, deliberately copied from [BetterCounter](https://github.com/albertvaka/bettercounter) (GPL-2.0, `org.kde.bettercounter`), the open-source counter app this family was designed against. One row per counter: a large **−** and **+** flanking it, and between them the counter's name, its total for its own interval, and how long since the last entry.

That layout is worth copying because it puts the three things a counting app is actually used for — add one, how many so far, how long since — on one line with no navigation. Charts and history are secondary and sit below it.

**No BetterCounter code is used, and none may be.** What was taken is the interaction design, read from its layout XML and string resources. Its licence is **GPL-2.0-only**, which is *incompatible* with this project's AGPL-3.0-or-later: there is no version of the GPL both can be relicensed to. Copying a single function from it would make queer-curves undistributable. Read it for ideas; write the code here.

Two departures, both forced by this model rather than chosen:

- **Entries carry an amount**, so the row also offers the counter's quick-add presets. BetterCounter's every tap is +1; ours needs "a pint is 2.3 units".
- **− removes the most recent entry** rather than decrementing a number, because an occurrence graph stores a list of events, not a counter value. It is an undo, and it is disabled when there is nothing to undo.

Two figures under each row also come from BetterCounter: the rate (`avg 2.02/day`, or `avg every 15.8 hours` when the rate is below one per unit) and the goal hit rate (`under 14/week: 100%` — its "Goal reached: %"), computed over completed periods only.

The full entry history is **folded away** behind a disclosure. It exists to correct and delete individual entries, not to be read; BetterCounter keeps it off the main screen entirely, reachable only through the chart and an export. Backdating is folded away for the same reason: opening a counting graph is almost always an intent to add to it *now*, and a full entry form sitting open above the history makes the common case pay for the rare one.

An earlier iteration rendered the history as a 24-hour timeline per day, on the theory that time-of-day position carries information a list can't. It was rejected in review in favour of BetterCounter's shape, and is recorded here only so the idea isn't re-proposed as new.

## 5. Pronoun graphs

A pronoun graph is a **pronoun/gender card**: the pronouns a person uses and the gender, address, and relationship words they want (or don't want) applied to them, each rated on a preference scale the user defines. It was added in `schema_version = 2`, alongside the occurrence family (§4A) which landed in `schema_version = 3`.

It exists as its own family rather than as a spectrum because the data is categorical and per-entry rather than positional: "they/them favourite, she/her okay at home, he/him never" is a set of labeled preferences, not a point in a coordinate space. §11 already lists categorical spectrum axes as out of scope, and forcing a card into numeric axes would lose exactly the part users care about — the words themselves.

### 5.1 The preference scale

The card owns its scale as `schema.levels`, an **ordered** list, most-preferred first:

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable; referenced by every entry |
| `label` | string | user-set, e.g. "favourite", "only if we're close", "never" |
| `color` | string | drives the entry colour on the card |
| `description` | string | optional, e.g. "fine from people I know well" |

Per-graph rather than a fixed enum for two reasons. Scales differ (some people want yes/no, others want six gradations), and — more importantly — the labels themselves are user language about their own identity. A hardcoded enum would put our words in the user's mouth.

Clients MUST NOT drop entries whose `level_id` no longer matches a level (a scale can be edited after entries exist). Such entries render under an "unsorted" heading and remain editable.

### 5.2 Pronoun sets

`pronouns` is an ordered list of entries:

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable |
| `label` | string | display form, e.g. "she/her" |
| `forms` | object | optional — see §5.3 |
| `level_id` | level id | references `schema.levels` |
| `notes` | string | optional, e.g. "fine at work, not with family" |
| `color` | string | optional; overrides the level colour |

`label` is free text rather than derived from `forms`, because real cards carry entries that don't decline at all: "any pronouns", "name only", "ask me first". Those entries omit `forms` entirely.

Order is authored, not alphabetical or scale-derived — a card's ordering is a statement of emphasis.

### 5.3 Forms and generated examples

When an entry declines, `forms` carries the English forms plus verb agreement:

| Field | Type | Notes |
|---|---|---|
| `subject` | string | required — she / he / they / ey |
| `object` | string | required — her / him / them / em |
| `possessive_determiner` | string | optional — her (book) / his / their |
| `possessive_pronoun` | string | optional — hers / his / theirs |
| `reflexive` | string | optional — herself / himself / themself |
| `plural` | bool | optional, default false — true when the subject takes plural agreement ("they are", not "she is") |

Clients render demonstration sentences from these forms, using the templates in `schema.examples` (or built-in defaults when unset). Templates reference forms by placeholder and may request a conjugated verb.

**A template that references a form the entry doesn't supply is skipped, not guessed.** Deriving "her's" from "her", or assuming a reflexive from an object form, would fabricate words the user never wrote — the precise failure this graph family exists to prevent.

### 5.4 Words and groups

`terms` holds the non-pronoun vocabulary, each rated on the same scale:

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable |
| `label` | string | e.g. "nonbinary", "Mx.", "partner" |
| `group_id` | group id | references `schema.term_groups` |
| `level_id` | level id | references `schema.levels` |
| `notes` | string | optional |
| `color` | string | optional; overrides the level colour |

`schema.term_groups` are the card's sections (`{id, label, description?}`) — by default "identity words", "ways to address me", "relationship words", all user-editable. As with levels, terms in a since-deleted group stay visible under "ungrouped".

### 5.5 Display name

`display_name` is an optional name substituted into example sentences ("Ada brought their own lunch"). It is separate from `name`, which titles the graph, and omitting it keeps the card name-free — the safer default, since a card is the graph type most likely to be shared widely (see `THREATS.md` §11).

### 5.6 Pronoun-card history

Like network graphs (§4.4), a card stores **current state only** in v1. Pronouns do change over time, and the Matrix encoding does retain superseded snapshots in the room timeline, so a viewer holding a history grant can observe past versions — but the client does not model or render a card timeline. First-class "my pronouns over time" is deferred to v2, alongside network history.

Consequence worth stating plainly: **a card is not a safe place to record a preference you want no record of.** Editing an entry replaces the current snapshot; it does not retract the older encrypted snapshots already delivered to a room's members.

## 6. Customization

Common to all four families:

| Field | Type | Notes |
|---|---|---|
| `theme.palette` | string[] | ordered colors used for default series/edge coloring |
| `theme.background` | string | |
| `theme.font` | string | optional, free-form CSS-style |
| `title.show` | bool | |
| `title.text` | string | |
| `subtitle` | string | optional |

Spectrum-specific:

| Field | Type | Notes |
|---|---|---|
| `axis_style.line_color` | string | |
| `axis_style.label_color` | string | |
| `region_style.default_opacity` | number | global default |
| `views` | list of `{id, name, layout: "cartesian"\|"radial"\|"polar", x: AxisRef, y: AxisRef, color?: AxisRef, x_label?: string, y_label?: string, shape?: "circle"\|"pie"}` | optional saved views; `AxisRef` is an axis index (0..N-1) or the literal string `"time"`. `radial` defaults to cartesian positions + polar overlay (`shape="circle"`); `polar` re-projects to length/angle pixel coords. `shape="pie"` switches to a polar-conversion-with-pie-sector display in either layout. `x_label`/`y_label` override channel display names. When unset, clients generate dimensionality-based presets — see §3.6. |

Network-specific:

| Field | Type | Notes |
|---|---|---|
| `node_style.default_color` | string | |
| `node_style.shape` | `"circle"` \| `"square"` | |
| `edge_style.default_width` | number | |
| `legend.position` | `"top"` \| `"bottom"` \| `"left"` \| `"right"` \| `"hidden"` | |

Occurrence-specific:

| Field | Type | Notes |
|---|---|---|
| `bar_style.mode` | `"stacked"` \| `"grouped"` | how multiple counters share a bucket; default `stacked` |
| `bar_style.rolling_window` | number | rolling mean over N buckets, drawn as a trend line; 0 / unset hides it |
| `legend.position` | `"top"` \| `"bottom"` \| `"left"` \| `"right"` \| `"hidden"` | |
| `show_targets` | bool | draw counter targets as dashed reference lines; default true (§4A.4) |

Pronoun-card-specific:

| Field | Type | Notes |
|---|---|---|
| `layout` | `"level"` \| `"flat"` | default `"level"` — group entries under their preference level, or list them in authored order with the level shown per entry |
| `show_examples` | bool | default true — render generated example sentences under each set that supplies `forms` (§5.3) |

Customization values can reference theme palette indices (`"@palette[2]"`) or be hard-coded hex — clients should resolve references at render time.

## 7. Edit rights

Two roles per graph:

- **Owner**: full control. Can change schema (axes, regions, edge types, customization), append datapoints, invite/revoke viewers, grant/revoke editors, delete the graph. Exactly one owner.
- **Editor**: can append datapoints (or, for network graphs, mutate node/edge state; for pronoun cards, add and edit pronoun sets and words). Cannot change schema — for a card that means the preference scale and the word groups are the owner's alone. Cannot manage sharing.

Editors are explicitly granted per graph. Default for any new viewer is **not editor**. Editor grants are independent of view grants — editing implies viewing, but viewing does not imply editing.

This maps cleanly to Matrix power levels in the encoding (§10): editors get elevated power for `*.datapoint` event types within the graph's room; only the owner can send `*.graph_def` schema-update events.

## 8. Graph lifecycle

### 8.1 Creation

A new graph is created by its owner: a Matrix room is created with E2EE enabled, the owner publishes the initial `app.queercurves.graph_def`, and the room id becomes the graph id. Default state: owner is the sole member, no editors, no viewers.

### 8.2 Editing

See §7 — only the owner can change the schema; editors can append datapoints.

### 8.3 Deletion (hard)

Graph deletion is **hard**. When the owner deletes a graph:

1. The owner publishes a final `app.queercurves.tombstone` event with `reason: "deleted"`.
2. The owner's client kicks all viewers/editors from the room and then leaves the room itself.
3. The owner's client wipes the graph from local cache.
4. Compliant viewer clients, on receiving the tombstone or detecting the room kick, MUST wipe all cached datapoints, schema, snapshots, and any local exports of the graph from local storage. The UI briefly surfaces a "this graph has been deleted by its owner" placeholder, then removes the graph entirely from the client's graph list.
5. The Matrix room itself is left to the homeserver's natural cleanup; depending on the homeserver, room state may persist on disk, but its encrypted contents are no longer decryptable since no remaining members hold the Megolm keys.

The usual caveat applies: a non-compliant client with valid keys at the time of deletion could have retained the data already. The deletion protocol cannot retroactively erase what was already decrypted on a viewer's device.

For "stop sharing without deleting" (graph still exists for the owner, just no longer published to viewers), see soft revocation in `sharing_model.md`.

## 9. Schema versioning

Every persisted event carries a `schema_version` integer. Clients reading older `schema_version` data must apply migration shims; clients reading *newer* `schema_version` data than they understand should display a "this graph uses a newer format your client doesn't support yet" message rather than misrender.

Initial release: `schema_version = 1`.

Backwards-incompatible changes (renaming required fields, changing semantics) bump the major version. Additive optional fields do not.

**Version log:**

| Version | Change |
|---|---|
| 1 | Initial release: spectrum and network families. |
| 2 | Adds the pronoun-card family (§5). Spectrum and network graphs are shape-identical to v1. |
| 3 | Adds the occurrence family (§4A). Earlier families are shape-identical. |

A new *family* bumps the version even though it adds no field to the existing ones. A v1 client encountering `type: "pronouns"` has no way to render it, and the version gate is the mechanism that turns that into an honest "this graph uses a newer format" message instead of an "invalid type" error or a blank graph. The cost is deliberate and known: a v2 client's spectrum export is refused by a v1 client that could in principle have read it.

**The bump is per release, not per family.** Pronoun cards and occurrence graphs were developed on parallel branches and each landed as "v2" in isolation. Merging them made v3 necessary: a client that knows `pronouns` and calls itself v2 would otherwise accept an `occurrence` graph at face value, fail to render it, and — worse — drop its `occurrences` on the next save. When two families land together, the second one to merge takes the next integer.

## 10. Matrix encoding (sketch only)

Full Matrix protocol mapping lives in `sharing_model.md`. High-level:

- Event-type namespace: `app.queercurves.*` (placeholder — final namespace TBD pending domain choice).
- One Matrix room per (graph × detail-level audience). The room's encrypted timeline carries:
  - `app.queercurves.graph_def` — schema definition (axes/regions/customization/etc.). Latest-wins by event id; only the room owner sends these.
  - `app.queercurves.datapoint` — individual datapoint events (spectrum), node/edge mutations (network), or pronoun-set/word mutations (pronoun card). Owner and editors send these.
  - `app.queercurves.snapshot` — full current state, posted on viewer-join so new members see *something* immediately even though they can't decrypt history.
  - `app.queercurves.tombstone` — soft revocation / graph deletion marker.
- Matrix room state events are **not** used for graph data. Reason: state events in encrypted rooms are not themselves encrypted by default; the homeserver would see graph_def in plaintext, defeating E2EE for sensitive labels.

## 11. Out of scope for v1

Explicitly deferred (acknowledged but not implemented in MVP):

- **Computed projections between distinct axis systems.** Multiple presentation views of the same data are now first-class (§3.6, §6), but transforming the same canonical state into a *different* axis system (e.g. one gender state projected onto both an "agender↔non-binary × agender↔women" plane and a "genderness × women-to-enby" plane with computed mapping) still requires maintaining two graphs by hand.
- **3D regions.** 3D scatter datapoints are reachable in v1; labeled 3D regions (boxes, volumes) are not.
- **Network graph history.** Network state is point-in-time in v1.
- **Pronoun-card history.** A card is point-in-time too (§5.6). "My pronouns over time" is a v2 feature alongside network history.
- **Non-English pronoun grammar.** The `forms` model in §5.3 is English (five forms plus plural agreement). Languages with grammatical gender agreement across adjectives and verbs need a richer model; until then such users can use label-only entries, which carry no declension and are never conjugated.
- **Per-viewer legend redaction at the crypto level** (single room with selective decryption). Handled instead via redundant rooms — see `sharing_model.md`.
- **Region rendering in non-default views.** Regions render in their original cartesian coordinates (the natural-default view). When viewing a graph through a radial view or a time projection, regions are not re-projected and aren't drawn. Authoring regions in non-default coordinate systems is deferred.
- **Computed/derived datapoints** (e.g. "averaged over last week"). v1 stores raw points; clients may render rolling averages but don't persist them.
- **Discrete / categorical spectrum axes.** v1 axes are continuous numeric. A categorical axis option is plausibly v1.1.
- **Linked-node graph navigation.** Nodes with confirmed `subject_ref` are *named* but not navigable in v1 — clicking them does not surface that user's other graphs. The richer feature (cross-graph navigation gated on the linked user's separate share grants) is a v2 extension.

## 12. Canonical test cases

Any change to this document must remain expressible in the model:

### 12.1 Aceflux — 1D spectrum

```yaml
type: spectrum
name: "my attraction"
schema:
  axes:
    - name: "attraction"
      min_label: "ace"
      max_label: "demi"
      range: [0, 1]
      waypoints:
        - { position: 0.5, label: "gray" }
  regions:
    - id: "attractive-band"
      label: "sex feels attractive"
      shape: { type: range, min: 0.65, max: 1.0 }
      color: "#c98aff"
      opacity: 0.25
data:
  datapoints:
    - { id: "...", coordinates: [0.3], timestamp: "2026-05-01T10:00:00Z" }
    - { id: "...", coordinates: [0.45], timestamp: "2026-05-04T22:00:00Z" }
```

History rendering: 2D plot, x = time, y = attraction (with the "attractive" region as a horizontal band, and "gray" as a guide line at y=0.5).

### 12.2 Genderfluid — 2D spectrum

```yaml
type: spectrum
name: "my gender"
schema:
  axes:
    - name: "axis 1"
      min_label: "agender"
      max_label: "non-binary"
      range: [0, 1]
    - name: "axis 2"
      min_label: "agender"
      max_label: "women"
      range: [0, 1]
      waypoints:
        - { position: 0.5, label: "girl" }
  regions: []
data:
  datapoints:
    - { id: "...", coordinates: [0.3, 0.7], timestamp: "2026-05-01T10:00:00Z" }
    - { id: "...", coordinates: [0.4, 0.6], timestamp: "2026-05-04T22:00:00Z" }
```

History rendering: 2D scatter cloud, optionally with a time-colored trail. The "girl" waypoint renders as a horizontal guide on axis 2.

The user mentioned an alternative axes choice (genderness vs women-to-enby) as another representation. In v1 this is a **separate graph the user maintains in parallel**, not a computed projection of the first.

### 12.3 Polycule — network

```yaml
type: network
name: "our polycule"
schema:
  edge_types:
    - { id: "romantic", label: "romantic", color: "#ff6090" }
    - { id: "sexual",   label: "sexual",   color: "#9080ff" }
    - { id: "qpr",      label: "queerplatonic", color: "#80ffb0" }
data:
  nodes:
    - { id: "n1", label: "Alex", subject_ref: "@alex:...", is_self: true }
    - { id: "n2", label: "Bea" }
    - { id: "n3", label: "Cy" }
  edges:
    - { id: "e1", source: "n1", target: "n2", type_id: "romantic" }
    - { id: "e2", source: "n1", target: "n2", type_id: "sexual" }
    - { id: "e3", source: "n2", target: "n3", type_id: "qpr" }
```

For the redacted-legend variant ("outside friends see connections but not types"), the owner publishes a separate graph to a separate room with edge types collapsed:

```yaml
schema:
  edge_types:
    - { id: "any", label: "connected", color: "#999999" }
data:
  edges:
    - { id: "e1", source: "n1", target: "n2", type_id: "any" }
    - { id: "e2", source: "n2", target: "n3", type_id: "any" }
```

Two graphs from the owner's perspective, two rooms in Matrix, two encrypted views.

### 12.4 Pronoun card

A card whose scale is genuinely mixed — two welcome sets, one that needs closeness, one refused — plus words across all three default groups. Exercises the cases most likely to break a naive implementation: an entry with no declension (`name only`), a partially-declined entry (`ey/em`, subject and object only), and a per-entry note that narrows a level.

```yaml
type: pronouns
name: "my pronouns"
display_name: "Ada"
schema:
  levels:
    - { id: "favourite",  label: "favourite",           color: "#c98aff" }
    - { id: "okay",       label: "okay",                color: "#80a8ff" }
    - { id: "close-only", label: "only if we're close", color: "#80ffb0" }
    - { id: "avoid",      label: "avoid",               color: "#ffb080" }
    - { id: "never",      label: "never",               color: "#ff8aa8" }
  term_groups:
    - { id: "identity",     label: "identity words" }
    - { id: "address",      label: "ways to address me" }
    - { id: "relationship", label: "relationship words" }
data:
  pronouns:
    - id: "pn1"
      label: "they/them"
      level_id: "favourite"
      forms: { subject: "they", object: "them", possessive_determiner: "their",
               possessive_pronoun: "theirs", reflexive: "themself", plural: true }
    - id: "pn2"
      label: "she/her"
      level_id: "okay"
      notes: "fine with friends, not at work"
      forms: { subject: "she", object: "her", possessive_determiner: "her",
               possessive_pronoun: "hers", reflexive: "herself" }
    # No forms at all — a real card entry that doesn't decline.
    - { id: "pn3", label: "name only", level_id: "close-only" }
    # Subject + object only: renders, and yields only the examples those
    # two forms can satisfy.
    - id: "pn4"
      label: "ey/em"
      level_id: "close-only"
      forms: { subject: "ey", object: "em" }
    - { id: "pn5", label: "he/him", level_id: "never" }
  terms:
    - { id: "t1", label: "nonbinary",  group_id: "identity",     level_id: "favourite" }
    - { id: "t2", label: "transfem",   group_id: "identity",     level_id: "favourite" }
    - { id: "t3", label: "woman",      group_id: "identity",     level_id: "okay", notes: "sometimes" }
    - { id: "t4", label: "lady",       group_id: "address",      level_id: "avoid" }
    - { id: "t5", label: "Mx.",        group_id: "address",      level_id: "favourite" }
    - { id: "t6", label: "sir",        group_id: "address",      level_id: "never" }
    - { id: "t7", label: "partner",    group_id: "relationship", level_id: "favourite" }
    - { id: "t8", label: "datemate",   group_id: "relationship", level_id: "okay" }
    - { id: "t9", label: "girlfriend", group_id: "relationship", level_id: "close-only" }
```

The example sentences under `pn1` render as "They go to the parade every year." / "I went with them — the flag was theirs." / "They made it themself, their own design." Under `pn4` only the first renders; the other two want forms `ey/em` doesn't supply, and are dropped rather than guessed (§5.3).

### 12.5 Drinks — occurrence

```yaml
type: occurrence
name: "what I drink"
schema:
  counters:
    - id: "alcohol"
      label: "alcohol"
      unit: "units"
      step: 1
      presets:
        - { id: "p-pint", label: "pint", amount: 2.3 }
        - { id: "p-wine", label: "glass of wine", amount: 2.1 }
        - { id: "p-single", label: "single", amount: 1 }
      target: { amount: 14, period: "week", direction: "at_most" }
    - id: "caffeine"
      label: "coffee"
      unit: "cups"
      step: 1
  default_bucket: "day"
  day_start_hour: 4
data:
  occurrences:
    - { id: "oc-1", counter_id: "alcohol", timestamp: "2026-05-01T19:30:00Z", amount: 2.3 }
    - { id: "oc-3", counter_id: "alcohol", timestamp: "2026-05-02T01:15:00Z", amount: 1 }
    - { id: "oc-4", counter_id: "caffeine", timestamp: "2026-05-02T09:00:00Z", amount: 1 }
```

Note `oc-3`: stored as 01:15 UTC on the 2nd, but in a UTC-ish local zone that is a pre-4am hour, so with `day_start_hour: 4` it buckets into the 1st's evening alongside `oc-1`. Which day it lands on depends on the *viewer's* zone — bucketing is local by design (§4A.3), so the same graph read from a different timezone can legitimately group it differently.

## 13. Decisions log

**2026-05-07** — initial open questions resolved:

1. **Spectrum values are continuous in v1.** Discrete / categorical axes deferred (see §11).
2. **Datapoint deletion is hard.** Redaction events propagate; compliant viewer caches must wipe the datapoint from local storage (§3.5).
3. **Timestamps are UTC**, display TZ is client-local (§3.5).
4. **Graph deletion is hard.** Tombstone + kick all members + wipe local caches on compliant clients (§8.3). Soft revocation (just stop publishing) is a separate operation, defined in `sharing_model.md`.
5. **Linking nodes to real users requires consent.** A node's `subject_ref` triggers a consent request; the link is `pending` until accepted, and the named user can withdraw at any time (§4.1). Cross-graph navigation from such nodes is deferred (§11).

**2026-08-14** — pronoun cards added as a third graph family (§5), `schema_version = 2`:

6. **Pronoun/gender cards are their own family, not a categorical spectrum.** The data is per-entry and categorical; forcing it onto numeric axes would discard the words, which are the content. Categorical spectrum axes remain deferred (§11) and are now unlikely to be needed for this use case.
7. **The preference scale is per-graph, user-labeled** (§5.1). A fixed enum would put our vocabulary in the user's mouth on the one graph type that is entirely about which words are theirs.
8. **Missing pronoun forms are never inferred** (§5.3). A template needing a form the user didn't supply is skipped. Fabricating "her's" or a reflexive form is a correctness bug with the same shape as misgendering.
9. **A new graph family bumps `schema_version`** even though existing families gain no fields (§9). The version gate is what makes an old client say "newer format" instead of "invalid type"; the cost is that v1 clients refuse v2 spectrum exports they could have read.
10. **Cards are current-state only in v1** (§5.6), like network graphs. Superseded snapshots do remain in the room timeline, so the UI must not imply that editing a card retracts what viewers already received.

**2026-08-14** — network name privacy:

11. **Other people's names are hidden on screen by default** (§4.1). Hidden means *no label*, not a pseudonym — positional placeholders ("Person 1") were tried and rejected, because a stable handle is still something a viewer can screenshot and talk about. The viewer's own node is marked "You", and reveal is press-and-hold, never a sticky toggle. Presentation-layer only — no change to what is stored or shared.
12. **`is_self` added to nodes** as an additive optional field (§4.1). No `schema_version` bump for that field on its own: per §9 additive optional fields don't bump, and an older client that ignores it simply masks every node including the owner's — which fails towards *more* privacy, not less. (The version did move to 2 in the same release, for the new pronoun-card family — see decision 9.)

**2026-08-14** — occurrence family added (§4A), `schema_version` → 3:

13. **Occurrence is its own graph family, not a spectrum variant.** A 1D spectrum could hold a running count, but the two disagree on everything that matters: a spectrum interpolates between datapoints (a position persists until the next reading), while occurrences are discrete and additive (two drinks are 4.6 units, not "a position of 2.3 twice"). Aggregation, chart form, and entry UX all follow from that difference.
14. **Units are per counter and never converted.** No unit registry, no mg↔ml, no standard-drink table. Users count in whatever they think in; the model refuses to guess. Consequence: totals are per counter, never summed across counters.
15. **Bucketing is local-time with a configurable day boundary.** Timestamps stay UTC (§3.5), but people count in their own days, and a calendar-midnight boundary splits one evening across two days. `day_start_hour` fixes that (§4A.3). A viewer in another timezone may bucket the same graph differently — accepted, because the alternative (freezing the author's zone into the data) makes every reader's "today" wrong instead.
16. **Targets report, never enforce.** No blocking, no warning dialogs, no nagging. A counter that scolds gets abandoned or lied to, and false data is worse than none. Streaks count completed periods only, so they don't reset at midnight (§4A.4).
17. **The counting UI is copied from BetterCounter, not invented** (§4A.7). Counter rows with big ±, per-counter intervals, rate and goal-hit-rate lines. Two iterations of a home-grown design (preset chips; a 24-hour timeline history) were rejected in review before this one; the reference app had already solved the layout.
18. **`−` deletes the most recent entry rather than decrementing.** An occurrence graph stores events, not a counter value, so the only honest meaning of "minus one" is "undo the last one".
19. **Deleting a counter with logged entries is refused.** The alternative — orphaning the entries — makes them invisible to every total while still shipping them in each snapshot, which is the worst of both outcomes.
