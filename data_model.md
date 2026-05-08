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

Supported in v1: **N = 1, 2**. **N = 3** is a stretch goal (covered by the Three.js dependency in `STACK.md`); not required for MVP.

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

Rendered in v1 on 2D graphs as a small marker (e.g. cross/plus) with its label. 1D graphs typically use per-axis waypoints instead. 3D rendering of point waypoints is deferred along with the rest of 3D rendering.

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
| 3D | 3D scatter (lazy-loaded Three.js) |

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

## 10. Out of scope for v1

Explicitly deferred (acknowledged but not implemented in MVP):

- **Multiple computed representations of the same underlying data.** E.g. a single canonical gender state projected onto two different axis systems. v1 treats each graph as independent storage; if you want two views, you maintain two graphs by hand.
- **3D regions.** 3D scatter datapoints are reachable in v1; labeled 3D regions (boxes, volumes) are not.
- **Network graph history.** Network state is point-in-time in v1.
- **Per-viewer legend redaction at the crypto level** (single room with selective decryption). Handled instead via redundant rooms — see `sharing_model.md`.
- **3D point waypoints.** Point waypoints in 2D are supported (§3.3); 3D rendering is deferred along with the rest of 3D rendering.
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
