# Data Model

This document defines the domain model for queer-curves: what users create, what shape it has, and what the system stores. The Matrix event encoding is sketched at the end, but full schema is out of scope here (see `sharing_model.md` once written).

Status: **draft**, v0. Updated 2026-05-07.

## 1. Overview

A user creates and maintains **Graphs**. Each Graph is a self-contained artifact with:

- a **type** (spectrum or network — extensible to more later),
- a **schema** (type-specific structure: axes, regions, edge types, etc.),
- **data** (type-specific datapoints / current state),
- **customization** (colors, theme, labels),
- a **sharing config** (referenced here, defined in `sharing_model.md`),
- an **owner** and optional **editors**.

The two graph families currently supported are derived from canonical use cases the user provided:

| Family | Purpose | Canonical example |
|---|---|---|
| Spectrum | Identity in an N-dimensional coordinate space, tracked over time | aceflux (1D), genderfluid (2D) |
| Network | Relational data (people and typed connections) | polycule |

These two are sufficient for v1. Adding new graph families later is expected — the model leaves room.

## 2. Common Graph fields

Every Graph, regardless of type, carries:

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable identifier; in Matrix encoding this is the room id |
| `type` | `"spectrum"` \| `"network"` | extensible |
| `name` | string | user-set, e.g. "my gender" |
| `description` | string | user-set, optional |
| `created_at` | timestamp | |
| `modified_at` | timestamp | last schema change |
| `schema_version` | int | for forward-compat (see §7) |
| `owner` | user reference | only the owner can change schema |
| `editors` | list of user references | can append datapoints; cannot change schema |
| `customization` | object | see §5 |

## 3. Spectrum graphs

A spectrum graph plots a position in an N-dimensional labeled coordinate space, optionally tracked over time as a trajectory.

### 3.1 Dimensionality

Supported in v1: **N = 1, 2, 3**.

3D graphs are rendered as a 2D scatter on axes 0/1 with the third axis encoded as **colour via a ramp** built from the graph's palette — not as a 3D scene. This avoids loading Three.js, keeps the visualization within the chosen flag/palette aesthetic, and trades one axis of position for one axis of hue. (3D scatter via Three.js is no longer planned for v1; see §10.)

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
| `position` | `{x, y}` | optional, user-set or layout-computed |

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

## 5. Customization

Common to both families:

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

Customization values can reference theme palette indices (`"@palette[2]"`) or be hard-coded hex — clients should resolve references at render time.

## 6. Edit rights

Two roles per graph:

- **Owner**: full control. Can change schema (axes, regions, edge types, customization), append datapoints, invite/revoke viewers, grant/revoke editors, delete the graph. Exactly one owner.
- **Editor**: can append datapoints (or, for network graphs, mutate node/edge state). Cannot change schema. Cannot manage sharing.

Editors are explicitly granted per graph. Default for any new viewer is **not editor**. Editor grants are independent of view grants — editing implies viewing, but viewing does not imply editing.

This maps cleanly to Matrix power levels in the encoding (§9): editors get elevated power for `*.datapoint` event types within the graph's room; only the owner can send `*.graph_def` schema-update events.

## 7. Graph lifecycle

### 7.1 Creation

A new graph is created by its owner: a Matrix room is created with E2EE enabled, the owner publishes the initial `app.queercurves.graph_def`, and the room id becomes the graph id. Default state: owner is the sole member, no editors, no viewers.

### 7.2 Editing

See §6 — only the owner can change the schema; editors can append datapoints.

### 7.3 Deletion (hard)

Graph deletion is **hard**. When the owner deletes a graph:

1. The owner publishes a final `app.queercurves.tombstone` event with `reason: "deleted"`.
2. The owner's client kicks all viewers/editors from the room and then leaves the room itself.
3. The owner's client wipes the graph from local cache.
4. Compliant viewer clients, on receiving the tombstone or detecting the room kick, MUST wipe all cached datapoints, schema, snapshots, and any local exports of the graph from local storage. The UI briefly surfaces a "this graph has been deleted by its owner" placeholder, then removes the graph entirely from the client's graph list.
5. The Matrix room itself is left to the homeserver's natural cleanup; depending on the homeserver, room state may persist on disk, but its encrypted contents are no longer decryptable since no remaining members hold the Megolm keys.

The usual caveat applies: a non-compliant client with valid keys at the time of deletion could have retained the data already. The deletion protocol cannot retroactively erase what was already decrypted on a viewer's device.

For "stop sharing without deleting" (graph still exists for the owner, just no longer published to viewers), see soft revocation in `sharing_model.md`.

## 8. Schema versioning

Every persisted event carries a `schema_version` integer. Clients reading older `schema_version` data must apply migration shims; clients reading *newer* `schema_version` data than they understand should display a "this graph uses a newer format your client doesn't support yet" message rather than misrender.

Initial release: `schema_version = 1`.

Backwards-incompatible changes (renaming required fields, changing semantics) bump the major version. Additive optional fields do not.

## 9. Matrix encoding (sketch only)

Full Matrix protocol mapping lives in `sharing_model.md`. High-level:

- Event-type namespace: `app.queercurves.*` (placeholder — final namespace TBD pending domain choice).
- One Matrix room per (graph × detail-level audience). The room's encrypted timeline carries:
  - `app.queercurves.graph_def` — schema definition (axes/regions/customization/etc.). Latest-wins by event id; only the room owner sends these.
  - `app.queercurves.datapoint` — individual datapoint events (spectrum) or node/edge mutations (network). Owner and editors send these.
  - `app.queercurves.snapshot` — full current state, posted on viewer-join so new members see *something* immediately even though they can't decrypt history.
  - `app.queercurves.tombstone` — soft revocation / graph deletion marker.
- Matrix room state events are **not** used for graph data. Reason: state events in encrypted rooms are not themselves encrypted by default; the homeserver would see graph_def in plaintext, defeating E2EE for sensitive labels.

## 9a. Collections and merging (multi-graph views)

Two distinct answers to "I want to look at these graphs together". They share one implementation (`store/compose.ts`) and differ only in whether the result is persisted.

(Numbered 9a rather than 10 so the existing §10–§12 cross-references in this document, in `CLAUDE.md`, and in code comments stay valid.)

### 9a.1 Merging

**Merge** takes N graphs and produces **one new graph** containing their combined data. It is **non-destructive**: the sources are neither modified nor deleted, so the undo for a merge is deleting the result. The output is an ordinary Graph at the current `schema_version` — no new event types, no new storage, importable by any client that could read the sources.

Merge is only defined for graphs of the same `type`, and for spectrum graphs only when `dimensions` match. Everything else is a warning, not a refusal, because only the user knows whether two similarly-shaped graphs mean the same thing.

Reconciliation rules:

| Aspect | Rule |
|---|---|
| Axis names, labels, theme, customization | Taken from the **first** graph in the user's chosen order. Divergence is surfaced as a warning. |
| Axis `range` | **Union** (`min` of mins, `max` of maxes). Coordinates are never rescaled — rescaling would silently change what a stored position means. |
| Axis waypoints | Union, deduped by (position, label). |
| Datapoints | Union, deduped by (timestamp, coordinates) so re-merging is idempotent rather than doubling. Sorted by timestamp. |
| Element ids (datapoints, regions, waypoints, views, nodes, edges) | Kept as-is; **only collisions** are rewritten (`id~2`). Merging a single graph is therefore an identity operation on its ids. |
| Provenance | Each datapoint gains a `from:<graph name>` tag when there is more than one source. |
| Network nodes | Unified by `subject_ref` when set, otherwise by case- and whitespace-insensitive `label`. First occurrence wins; later ones only fill gaps. |
| Network `link_status` | **Most restrictive wins** — any `denied` ⇒ `denied`; otherwise anything short of unanimous `confirmed` ⇒ `pending`. A merge must never manufacture consent (§4.1). |
| Network edges | Endpoints remapped onto unified nodes, then deduped by (endpoints, type_id) — with endpoints order-normalised for undirected edges. Edges with a missing endpoint are dropped, not left dangling. |
| Edge types | Union by id; first definition of a reused id wins, with a warning. |

### 9a.2 Collections

A **collection** is a saved list of graph ids that should be *rendered* together — a multi-graph view. It stores references, never copies:

| Field | Type | Notes |
|---|---|---|
| `id` | string | `c_…` locally, room id when Matrix-backed |
| `kind` | `"collection"` | discriminates from a Graph in storage and in the snapshot payload |
| `name`, `description` | string | user-set |
| `created_at`, `modified_at`, `schema_version`, `owner` | | as §2 |
| `members` | list of `{ graph_id, color?, label? }` | ordered; `color` is the series colour and doubles as the legend key |
| `view` | `SpectrumView` | optional remembered projection |

Opening a collection loads each member through the ordinary graph store, composes them with the merge rules above (with `colorBySource` on, so each member's points carry its series colour), and hands the throwaway result to the normal renderer. Nothing composed is ever written down. Consequences, all deliberate:

- edits to a member appear the next time the collection is opened;
- members stay independently editable, shareable and revocable;
- deleting a collection deletes only the list;
- a member that can't be loaded — deleted, or shared from an account whose megolm keys haven't arrived — is **named in the UI**, never silently omitted. A view that quietly drops data is a view that lies.

Collections are personal in v1: they are not shareable, and inviting someone to a collection is not a thing you can do. Sharing a *view over other people's graphs* raises the consent questions in `sharing_model.md` §12 without any of the machinery to answer them.

### 9a.3 Custom axes (cross-graph plotting)

The combined mode above lays every member onto **shared** axes: it reads axis 0 as axis 0 for everybody, so it needs the members to agree about dimensionality and about what each axis means. That covers "the same kind of graph, several people" and nothing else.

A collection's second mode, **custom axes**, binds each visual channel to one specific `(member, axis)` pair instead:

| Field | Type | Notes |
|---|---|---|
| `x` | `'time'` \| `{ member, axis }` | horizontal channel |
| `y` | list of `{ member, axis }` | one entry per plotted series |

This makes three shapes expressible that the combined mode cannot represent at all:

- `x: 'time'`, `y: [{m0, stress}, {m1, stress}]` — two people's stress over time, **even when their graphs have different numbers of axes**;
- `x: {m0, stress}`, `y: [{m0, libido}]` — correlation between two axes of one graph;
- `x: {m0, stress}`, `y: [{m1, stress}]` — one person's axis against another's.

Because it reads *named* axes rather than positional ones, dimensionality no longer has to match. A collection therefore accepts members the combined mode refuses; the mismatch is reported as a warning pointing at this mode, not as an error. Mixing a spectrum with a network graph is still fatal — a network has no axes to plot.

**The time join.** When both channels are axes, the two sides were recorded at different moments, and exact timestamp matches are vanishingly rare, so an inner join would produce an empty plot. Points are paired by **last-observation-carried-forward**: at each timestamp either side supplies, the other channel contributes its most recent value at or before that moment. Timestamps before both series have started are dropped. This treats a recorded value as standing until the next one replaces it — which is what these graphs mean — but it *is* an approximation rather than a simultaneous measurement, and the UI says so above the chart.

This is the "computed projections between distinct axis systems" that §10 deferred, **scoped to reading named axes**. It still does not *transform* one axis system into another — no rotation, no derived coordinates, no rescaling. Values are read exactly as stored.

### 9a.4 Matrix encoding

A collection lives in its own E2EE room, same whole-snapshot protocol as graphs, with its own event types so the two kinds never appear in each other's listings:

- `app.queercurves.collection.marker` — state event identifying the room
- `app.queercurves.collection.snapshot` — the whole `GraphCollection`
- `app.queercurves.tombstone` — shared with graphs; deletion

Unlike graph rooms, a collection room is created **without an `m.room.name`**. Room names are unencrypted state and a collection's name ("me and Sam") is exactly the kind of label §7 rule 3 of `THREATS.md` keeps out of plaintext. The name travels in the encrypted snapshot instead.

## 10. Out of scope for v1

Explicitly deferred (acknowledged but not implemented in MVP):

- **Computed projections between distinct axis systems.** Partially addressed: a collection's custom-axes mode (§9a.3) can now *read* any named axis of any member and plot it against any other, including across graphs and across dimensionalities. What remains deferred is *transforming* one axis system into another — e.g. projecting one gender state onto both an "agender↔non-binary × agender↔women" plane and a "genderness × women-to-enby" plane via a computed mapping. Values are read as stored; no rotation or derived coordinates.
- **3D regions.** 3D scatter datapoints are reachable in v1; labeled 3D regions (boxes, volumes) are not.
- **Network graph history.** Network state is point-in-time in v1.
- **Per-viewer legend redaction at the crypto level** (single room with selective decryption). Handled instead via redundant rooms — see `sharing_model.md`.
- **Region rendering in non-default views.** Regions render in their original cartesian coordinates (the natural-default view). When viewing a graph through a radial view or a time projection, regions are not re-projected and aren't drawn. Authoring regions in non-default coordinate systems is deferred.
- **Computed/derived datapoints** (e.g. "averaged over last week"). v1 stores raw points; clients may render rolling averages but don't persist them.
- **Discrete / categorical spectrum axes.** v1 axes are continuous numeric. A categorical axis option is plausibly v1.1.
- **Linked-node graph navigation.** Nodes with confirmed `subject_ref` are *named* but not navigable in v1 — clicking them does not surface that user's other graphs. The richer feature (cross-graph navigation gated on the linked user's separate share grants) is a v2 extension.

## 11. Canonical test cases

Any change to this document must remain expressible in the model:

### 10.1 Aceflux — 1D spectrum

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

### 10.2 Genderfluid — 2D spectrum

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

### 10.3 Polycule — network

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
    - { id: "n1", label: "Alex", subject_ref: "@alex:..." }
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

## 12. Decisions log

**2026-05-07** — initial open questions resolved:

1. **Spectrum values are continuous in v1.** Discrete / categorical axes deferred (see §10).
2. **Datapoint deletion is hard.** Redaction events propagate; compliant viewer caches must wipe the datapoint from local storage (§3.4).
3. **Timestamps are UTC**, display TZ is client-local (§3.4).
4. **Graph deletion is hard.** Tombstone + kick all members + wipe local caches on compliant clients (§7.3). Soft revocation (just stop publishing) is a separate operation, defined in `sharing_model.md`.
5. **Linking nodes to real users requires consent.** A node's `subject_ref` triggers a consent request; the link is `pending` until accepted, and the named user can withdraw at any time (§4.1). Cross-graph navigation from such nodes is deferred (§10).

**2026-08-14** — combining graphs (§9a):

6. **"Show together" and "make into one" are separate features, not one with a flag.** Collections reference; merging copies. Conflating them would force one answer to "what happens when a member changes?" onto both.
7. **Merging is non-destructive.** Sources are never modified or deleted. Most tools consume their inputs when merging; this one doesn't, so the operation is always undoable by deleting the result.
8. **Combining never rescales coordinates.** Divergent axis ranges union; a point keeps the number it was recorded with. Rescaling would silently restate what a user said about themselves.
9. **Combining takes the most restrictive consent state**, and any `denied` wins outright. Merging must not be a laundering path for a `subject_ref` link that was never confirmed.
10. **Collections are not shareable in v1.** Sharing a view over graphs you don't own is a consent question `sharing_model.md` §12 doesn't yet answer.
11. **Neither feature bumps `SCHEMA_VERSION`.** A merged graph is an ordinary v1 Graph, and `GraphCollection` is additive — no existing shape changed, so no old client is put at risk of misrendering (§8).

**2026-08-14** — cross-graph axis plotting (§9a.3):

12. **A visual channel binds to (member, axis), not to an axis index.** Positional axes can only express "these graphs are the same shape"; naming the axis is what makes "my stress vs their stress" and "stress vs libido" possible, and it drops the requirement that members share a dimensionality.
13. **Mismatched dimensionality is a warning for collections, an error for merges.** Custom axes plots such members fine; the combined mode genuinely cannot lay them out. One check per mode, not one shared verdict.
14. **Cross-axis points are paired by last-observation-carried-forward, and the UI says so.** Exact timestamp matches between two independently-kept graphs are vanishingly rare, so an inner join would show an empty chart. Carrying the last value forward matches what these graphs mean, but it is an approximation and must not be presented as a simultaneous reading (THREATS.md §7 rule 13).
15. **Reading axes is not transforming them.** Custom axes reads stored values only — no rescaling, rotation, or derived coordinates — so a plot never restates what the user recorded.
