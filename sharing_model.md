# Sharing Model

How graphs are shared, who can see what, and how it maps onto Matrix. This document is the protocol-level companion to `data_model.md` — read that first.

Status: **draft**, v0. Created 2026-05-07.

## 1. Overview

Sharing in queer-curves is built directly on Matrix rooms with E2EE. There is no separate ACL system, no separate sharing service, no proprietary access protocol. Everything reduces to: *who is invited to which room*, *with what power level*, *holding which Megolm keys*.

The five primitives the design rests on:

1. **One Matrix room per (graph × detail-level audience).** A graph shared identically with everyone gets one room. A graph with multiple legend-redaction variants gets one room per variant.
2. **Membership = view access.** Being in a room with valid Megolm keys is exactly what "can see this graph" means.
3. **Power level = edit access.** Matrix's existing per-event-type power levels gate who can post `*.datapoint` events; only the owner can post `*.graph_def`.
4. **Pull on app-open, no continuous sync.** Viewers' clients only sync when the app is open. There is no daemon, no background subscription, no push channel that the owner can use to track who's looking.
5. **Audiences ("polycule," "friends") are a client-side abstraction.** They don't exist on the homeserver. The client maintains them and translates "share with my polycule" into "invite these N people to the graph's room."

Everything below is an elaboration of these five points.

## 2. Room layout

### 2.1 The (graph × audience) room

For each graph the owner maintains:

- **At minimum, one room.** The graph's primary room. Created at graph creation time. Owner is the sole member. E2EE enabled at room creation; never disabled.
- **Optionally, one extra room per legend-redaction variant** of the graph (relevant only for network graphs in v1; see §7).

Each such room contains:

- The encrypted timeline of `app.queercurves.graph_def`, `app.queercurves.datapoint`, `app.queercurves.snapshot`, and `app.queercurves.tombstone` events.
- Membership = the audience for this (graph, detail-level) pair.
- Power levels = the role assignments (owner, editor, viewer).

### 2.2 Room metadata hygiene

Matrix room *state* events (room name, topic, avatar) are **not** encrypted by default in E2EE rooms — the homeserver sees them. To avoid leaking sensitive labels:

- Room **name** is a stable opaque identifier (e.g. `qc-{random}`) or empty. Never the user's graph title.
- Room **topic** is empty.
- Room **avatar** is unset.
- The user-facing graph title lives inside encrypted `app.queercurves.graph_def` events, not in room state.

Clients display the user's title from the decrypted graph_def, never from `m.room.name`.

### 2.3 Encryption settings

- Algorithm: `m.megolm.v1.aes-sha2` (the only sensible default).
- Rotation period: default Matrix values (e.g. rotate every 100 messages or 1 week). See §10 for revocation-driven rotation.
- `shared_history` flag: **false** (default). New members do not receive historical Megolm sessions automatically. History grants are explicit (§8).

## 3. Identities and contacts

### 3.1 Hiding Matrix syntax

Matrix user IDs (`@alice:server.example`) are unfriendly. The client UI shows:

- A user-set display name from the user's contact entry (e.g. "Alice"), OR
- The user's chosen handle (e.g. `alice` on `friend.server`), OR
- Falls back to the raw Matrix ID only if no other label exists.

The `@` and `:` syntax never appears in primary UI. They appear in advanced settings and copy-paste exports.

### 3.2 Contacts

A **Contact** is a local record on the owner's device representing someone they share with. Contacts are stored as encrypted Matrix account_data (so they sync across the owner's own devices). Fields:

| Field | Type | Notes |
|---|---|---|
| `id` | string | local UUID |
| `matrix_id` | string | the canonical `@user:server` |
| `display_name` | string | what this user is called in *this owner's* UI |
| `note` | string | optional, owner-only annotation |
| `verified` | bool | has the owner verified this contact's device keys via Matrix's standard cross-signing flow? |
| `created_at` | timestamp | |

Contacts are owner-private. They do not appear in any shared room. They are never sent to the homeserver in plaintext.

### 3.3 Adding a contact

Three flows:

1. **By share link.** A short URL that bundles a Matrix ID and an optional initial room invite. **Format (decided 2026-08-14): a `https://matrix.to/#/@user:server` URL** — QR-friendly, copy-pastable, and understood by the wider Matrix ecosystem. The receiving client accepts it pasted into the add-friend field (and, later, scanned as a QR code).
2. **By Matrix ID.** Power-user fallback: paste `@user:server`.
3. **By scanning a QR code** that another queer-curves user displays. (Same payload as share link.)

3PID lookup (email → Matrix ID via identity server) is **out of scope for v1** — identity servers are a separate trust dependency and we don't want to require one.

## 4. Audiences

### 4.1 Group definitions

A **Group** is a named bag of contacts. Owner-private, stored alongside contacts in encrypted Matrix account_data:

| Field | Type | Notes |
|---|---|---|
| `id` | string | local UUID |
| `name` | string | "polycule," "close friends," "online friends" |
| `members` | list of Contact ids | |
| `created_at` | timestamp | |

Groups are **owner-scoped**: they exist only in the owner's data. They are never named on the homeserver. Two users can each have a "polycule" group — they are independent objects with no relationship.

### 4.2 Group membership semantics

When the owner says "share graph X with group Y at detail level D," the client:

1. Looks up the contacts in group Y.
2. Finds (or creates) the room corresponding to (graph X, detail level D).
3. Invites those contacts to that room (sending Matrix `m.room.member` invite events).
4. Optionally posts a snapshot (§6).

Adding a contact to a group later does not retroactively add them to graphs already shared with that group — the client must re-invoke "share with group" to materialize the membership change. This avoids surprise re-sharing when groups change.

Removing a contact from a group similarly doesn't auto-revoke their access — explicit revocation (§10) is required.

(Both behaviors are conscious design choices: making group membership the *source of truth* would make accidents propagate. Making the share action explicit means each grant is auditable.)

### 4.3 Multi-device conflict handling

Contacts and groups live in encrypted Matrix account_data, which Matrix syncs across the owner's devices automatically. Concurrent edits across two devices resolve **last-write-wins**.

To prevent silent loss of a group edit, each account_data write carries a monotonic version number. When a client receives a remote update whose version is newer than its last-known version *and* it has unsynced local edits to the same key, it surfaces a warning before completing the write — e.g. "Your `polycule` group was changed on another device — your local changes haven't been synced. Keep mine / use the other version / merge?" — rather than silently clobbering.

Concurrent multi-device editing is expected to be rare; the warning is a safety net, not the primary mechanism. Typical operation is single-device editing where the warning never fires.

## 5. Granting access

### 5.1 The share dialog

Concrete UX (specifies the data flow even if the visual design changes):

1. User opens a graph → "Share" → share dialog.
2. Dialog shows:
   - **Audience selection**: contacts and groups (multi-select).
   - **Grant type**: a row per audience showing checkboxes:
     - `view current` (default ON when audience is added — required for any sharing)
     - `view history` (default OFF — see §8)
     - `edit` (default OFF — see §9)
   - **Detail level selection** (only for graphs that have multiple variants, currently only network graphs with redacted legends): radio per audience.
3. On confirm, the client:
   - Ensures the appropriate (graph × detail-level) room(s) exist.
   - Invites each audience member to the appropriate room.
   - Sets per-user power levels for any `edit` grants.
   - For each newly added member, schedules a snapshot post (§6).
   - For each member granted `view history`, schedules a history backfill (§8).

### 5.2 Per-grant uniqueness

For a given (graph, contact) pair there is at most one active grant. Re-sharing is idempotent: granting `view current` to someone already in the room is a no-op except for re-posting a snapshot. Upgrading from `view current` to `view current + view history` runs the history backfill.

### 5.3 Cross-detail-level conflicts

A given contact can only be in **one** detail-level variant of a network graph at a time. The client enforces this — adding Alice to the redacted variant kicks her from the full variant first (after warning the owner). This avoids the case where an audience-member sees both views and infers the redaction.

## 6. Snapshots on join

### 6.1 Why snapshots exist

Because the `shared_history` flag is `false`, a new room member cannot decrypt anything published before they joined. Without a snapshot, a viewer who joins a slow-changing graph might see literally nothing for days — until the owner happens to post the next datapoint.

The fix: on adding a viewer, the owner's client posts a fresh `app.queercurves.snapshot` event whose Megolm session the new viewer can decrypt. The viewer sees this on first sync.

### 6.2 Snapshot semantics

A snapshot is a complete current view of the graph: schema, current point/state, customization. It is **not** a list of historical datapoints — it's the view someone with `view current` access should have.

For `view history` viewers, the snapshot is followed by a history backfill (§8).

### 6.3 Snapshot timing

- On viewer join (room invite accepted).
- **Weekly heartbeat snapshot, unconditional.** The owner's client posts a fresh snapshot at a stable cadence (one event per graph per week) regardless of whether anything has actually changed. The unconditional cadence is deliberate: it eliminates the timing-leak signal "this user updated their graph today." The homeserver sees a steady weekly drumbeat, not a pattern that correlates with the user's life.
- After schema changes.

### 6.4 Snapshot replacement

Snapshots supersede earlier snapshots. Compliant clients render the most recent snapshot they can decrypt. Older snapshots can be redacted by the owner once the next one is in place to reduce cache footprint.

## 7. Detail-level redaction (multi-room pattern)

For graphs that need different detail levels for different audiences (the polycule example: full edge labels for insiders, "connected" only for outsiders), the owner maintains **separate rooms** with **separate event streams**.

### 7.1 Room set per graph

A network graph with two detail levels = two rooms:

| Room | Audience | Schema | Event stream |
|---|---|---|---|
| `qc-graphX-full` | polycule | `edge_types: [romantic, sexual, qpr]` | full edges |
| `qc-graphX-redacted` | other friends | `edge_types: [connected]` | redacted edges |

The owner's client owns the mapping between audiences and rooms. Each `app.queercurves.datapoint` (or for networks, mutation event) is published to **all** relevant rooms in their respective detail levels.

### 7.2 Trade-offs

- **+** Cryptographically clean — no novel selective-decryption trickery. Each room is a normal Matrix E2EE room.
- **+** Revocation, history, edit grants all work per-detail-level naturally.
- **−** Storage redundancy — same underlying data published to N rooms.
- **−** Consistency burden — owner's client must keep all variants in sync; a bug means the redacted view drifts from the full view.
- **−** Audience-disjointness (§5.3) is enforced manually.

For v1, the storage cost is acceptable (these are small text events, not media). The consistency burden is the real risk; it's worth shipping with explicit "drift detection" assertions in the owner's client.

### 7.3 Spectrum graphs and detail levels

In v1, **spectrum graphs have a single detail level**. Detail-level redaction is a network-graph feature only. If we later want partial-axis-label redaction for spectrum graphs, the same pattern (one room per variant) extends.

### 7.4 Pronoun cards and detail levels

Pronoun cards (`data_model.md` §5) also have a **single detail level** in v1, but they are the family most likely to want more than one, and the pattern extends cleanly: a card variant is just the same card with some entries dropped and the scale trimmed.

The natural variants, when this lands:

| Variant | Contents |
|---|---|
| full | every level, notes included |
| public | the welcome levels only (e.g. "favourite", "okay"), notes stripped |

The public variant is not merely a subset for convenience — **the refusals are the sensitive half**. "he/him: never" states something about a person that "they/them: favourite" does not, and the same is true of `notes` like "fine with friends, not at work", which names a boundary and the people it applies to. A wide-audience card should carry what to use, not what to avoid.

Until variants exist, the owner's only tool is graph-level scoping: keep the honest card narrow, and if a wide-audience version is wanted, maintain it as a second card. Note that this is manual and unlinked — the two cards will drift, with the same consistency burden described in §7.2 and none of the drift detection.

## 8. History grants

> **Amended 2026-08-14** (SECURITY_PLAN.md §4.1–§4.2). Under the v1 whole-snapshot protocol, §8.1's original mechanism was insufficient and §8.2's unnecessary: history lives in the *newest* event, so gating access to *old* events (`shared_history`, `history_visibility`, megolm's forward-only property) never gated history at all. As amended: a grant level is enforced by **which room a viewer is in and what is sent into it**. Each grant gets its own share room (§2.1's "one room per (graph × audience)"); the owner's client sends each room a **projection** of the graph for that room's grant (`store/projection.ts`), never the graph itself. §8.2's key-forwarding design is retained below as the model for a future event-stream protocol.

### 8.1 Default: current-only

A new viewer is invited into a **current-only share room**, whose snapshots are projections containing only the graph's present state: the newest spectrum datapoint, per-counter interval totals with the per-entry log (and its timestamps) collapsed away, the network or card as it stands. The viewer cannot reconstruct history because the history is never sent to their room. The room is additionally configured with `history_visibility: joined` and unshared megolm history, as defence in depth.

### 8.2 Granting history

A `view history` grant is implemented as a **projection choice**: the viewer is invited into the full-history share room, whose snapshots carry the whole record. Changing someone's grant means moving them between rooms — there is no key forwarding, no to-device traffic, and no dependency on SDK history-sharing behaviour. The grant is not *retroactive* over the room's old ciphertext; the viewer receives history as of the grant, which under a whole-snapshot protocol is the same thing.

For a future event-stream protocol (where history would live in old events rather than the newest one), the original design applies: forward past Megolm session keys via `m.forwarded_room_key` to-device messages, suppressed by default via `shared_history: false`.

### 8.3 What "history" means

History is bounded by the room's existence. There is no shared history for events that predate the graph's room (because they don't exist on Matrix). Datapoints with timestamps backdated to before room creation are still recent Matrix events; they receive normal Megolm keys.

### 8.4 Revoking history

Revoking `view history` later does **not** retroactively forget the keys the viewer's device already received. The viewer keeps everything they were granted. This is fundamental to E2EE — once decrypted, retention is the viewer's choice, modulo compliant-client wipe.

To prevent further data accumulation, the owner downgrades the viewer (no future key forwards) and optionally rotates the Megolm session for the room (so subsequent events use a key the viewer never received). Future events become opaque to that viewer; past events they already had keys for remain readable.

This is one of the cases where the user's threat model should be respected: **history grants are sticky in practice**. UI must communicate this honestly.

## 9. Edit grants

### 9.1 Power levels

Matrix room power levels gate per-event-type sending. The graph's room is configured:

| Event type | Required power level |
|---|---|
| `app.queercurves.graph_def` | 100 (owner only) |
| `app.queercurves.tombstone` | 100 (owner only) |
| `app.queercurves.snapshot` | 100 (owner only) |
| `app.queercurves.datapoint` | 50 (owner + editors) |
| `m.room.member` (invite/kick) | 100 (owner only) |

Default user power level on join: 0 (viewer). Granting "edit" promotes the user to 50 for that room only.

### 9.2 Editing implies viewing

You cannot grant edit without view. The share dialog enforces this — checking `edit` auto-checks `view current`.

### 9.3 Editor power asymmetry

Editors can append datapoints but cannot:

- Change the schema (axes, regions, edge types) — owner only.
- Invite/kick members — owner only.
- Grant or revoke other roles — owner only.
- Delete the graph — owner only.

This keeps trust asymmetric: editors can record their perspective on the data, but cannot reshape what the data means or who sees it.

## 10. Revocation

Three distinct mechanisms with different semantics. The right one depends on intent.

### 10.1 Soft revocation (stop publishing)

Owner stops sending `app.queercurves.*` events to the room. Viewers retain everything they have. On next app-open, viewers see stale data — same as before. No keys are rotated, no kicks happen.

Used when: temporarily pausing, planning to resume, no urgency to forget.

Reversibility: trivial — resume publishing.

### 10.2 Hard revocation (kick + rotate)

Owner kicks the viewer (Matrix `m.room.member` with `membership: leave`). Matrix automatically rotates the room's Megolm session so the kicked member cannot decrypt subsequent events. Viewer's client, on next sync, sees they were kicked and removes the graph from active view.

Used when: revoking access to future data going forward.

Caveat: viewer keeps everything they already decrypted (cached datapoints, snapshots). Compliant clients SHOULD clear the cache on detecting kick from a queer-curves room, but this is a UX courtesy, not enforceable.

Reversibility: re-invite is possible but re-establishes from current point only (no history backfill unless explicitly granted again).

### 10.3 Deletion (hard)

Defined in `data_model.md` §8.3. Summary: owner publishes tombstone, kicks all members, leaves the room, signals all clients to wipe cache. Strongest revocation, applies to all viewers at once.

### 10.4 Choosing between them

| Intent | Mechanism |
|---|---|
| "I'm taking a break" | soft (§10.1) |
| "Alex shouldn't see my updates anymore" | hard kick (§10.2) |
| "This graph should not exist anywhere" | deletion (§10.3) |

The UI should make these distinct actions, not one "stop sharing" button — the consequences differ enough that the user should choose deliberately.

## 11. Cross-homeserver federation

Matrix federation gives queer-curves cross-homeserver sharing essentially for free.

### 11.1 What works automatically

- Inviting `@alice:server-a` from `@owner:server-b` — federation routes the invite.
- Encrypted events traverse federated servers as ciphertext; neither homeserver can decrypt.
- Power levels, room state, and Megolm keys all federate.

### 11.2 Caveats

- Both homeservers must allow federation with each other. Some self-hosted setups restrict federation (allowlist mode).
- Federation introduces latency and partial-failure modes the local-only case doesn't have.
- A homeserver going offline doesn't lose data permanently — Matrix is eventually consistent — but viewers on that server see stale data until reconnected.
- Server discovery uses Matrix's standard `.well-known/matrix/server` mechanism. No queer-curves-specific discovery.

### 11.3 Audience-of-strangers problem

If the owner is on server-A and shares with `@alex:server-b`, the owner's homeserver (A) does not learn anything new from server-B beyond what Matrix federation already exposes (Alex's Matrix ID, room membership, event timing). Server-B sees the owner's Matrix ID, room membership, and (for events received via federation) the encrypted event payloads.

We will not invent a federation-bypass mechanism. Federation is the v1 cross-server story.

## 12. Consent handshake for `subject_ref`

For network graphs where a node has `subject_ref` pointing to a real user (`data_model.md` §4.1), the consent flow runs over Matrix to-device messages — encrypted point-to-point, never persisted on a homeserver.

### 12.1 Message types

- `app.queercurves.link_request` (to-device, owner → linked user)
  ```
  {
    "graph_id": "<owner's room id>",
    "node_id": "<node id within the graph>",
    "owner_display_name": "<as the linked user might recognize them>",
    "preview": { "label": "<the node label the owner gave>" }
  }
  ```
- `app.queercurves.link_response` (to-device, linked user → owner)
  ```
  {
    "graph_id": "<echoed>",
    "node_id": "<echoed>",
    "decision": "confirmed" | "denied"
  }
  ```

### 12.2 Lifecycle

1. Owner creates a node with `subject_ref: @alex:server`. Node `link_status` = `pending`.
2. Owner's client sends `link_request` to-device to all of Alex's known devices.
3. Alex's client receives the request, surfaces it as a notification ("X has named you in their network — accept / decline").
4. Alex decides; their client sends `link_response`.
5. Owner's client updates the node's `link_status` and re-publishes the relevant graph_def to the graph's room(s).
6. While `pending`, the link is **not** included in views shared with anyone other than the owner. Compliant clients omit pending links from rendering for non-owner viewers.
7. While `denied`, the link is removed (or anonymized — node stays without a subject_ref).
8. Alex can withdraw consent at any time (sends a fresh `link_response` with `denied`).

### 12.3 Federation of consent

If owner and Alex are on different homeservers, the to-device messages traverse federation. Same caveats as §11. If Alex is offline, the request queues until next sync.

### 12.4 Limits

- Alex's client must run queer-curves to handle these messages. Generic Matrix clients will see them as unknown to-device events and ignore them. (Alex therefore must have a queer-curves account and have logged in at least once on a device.)
- Alex's homeserver cannot read the request payloads, but does see that owner's homeserver sent a to-device message to Alex's homeserver — metadata leak.

## 13. What the homeserver can and cannot see

Brief privacy footnote; full treatment lives in `THREATS.md`.

**The homeserver(s) can see:**
- Room membership lists (who is in which queer-curves room).
- Room creation timestamps.
- Event timing and volume (when datapoints are published, how often).
- Federation patterns (which other servers are involved).
- Matrix device identifiers and login events.

**The homeserver(s) cannot see:**
- Graph titles, axis labels, region labels, datapoint values, edge types — all live inside encrypted event content.
- Contact and group definitions — encrypted account_data.
- Consent request payloads — encrypted to-device messages.

**Practical implications:**
- A hostile homeserver can build a social graph of who shares with whom, even without seeing the graph contents.
- Self-hosting your own homeserver eliminates this for the *owner's* side but not for federated peers.
- This is a fundamental Matrix property, not specific to queer-curves. Worth being honest about in onboarding.

## 14. Out of scope for v1

- **3PID identity server lookup** (email → Matrix ID).
- **Sharing with non-Matrix users** (e.g. SMS-based invites). Recipients must have a queer-curves / Matrix account.
- **Server-side push notifications.** A viewer who closed the app doesn't get notified of updates — they see them on next open. This is a deliberate design choice, see `project_sharing_model.md` in memory.
- **Group-update cascading.** Adding a contact to a group does not retroactively re-share existing graphs (§4.2). Explicit re-share is required.
- **Multi-owner graphs.** Each graph has exactly one owner. Co-owned graphs are out of scope.
- **Audit log.** No log of who viewed when. Matters of design and threat-model, not just implementation.
- **Content moderation / abuse reporting.** Out of scope; Matrix has primitives we'd inherit if needed.

## 15. Deferred questions

Tabled for later discussion, not yet decided.

0. **Amendments proposed by the implementation audit.** `SECURITY_PLAN.md` §4 argues that §8.1's "current-only" does not hold under the v1 whole-snapshot protocol (history travels in the newest event), that §8.2's key-forwarding history grant is unnecessary under that protocol, and that §9.1's per-event-type power-level table cannot be enforced in an E2EE room — with a consequence for §9.3's editor asymmetry. Not yet accepted; read that section alongside this one.
1. **Recovery UX.** If the owner loses all devices and their key backup, all their graphs (and others' shared with them) become permanently unreadable. Account recovery is a substantial UX area touching social-recovery, paper recovery codes, and tradeoffs between security and usability. To revisit explicitly with the user.

## 16. Decisions log

**2026-05-07** — initial open questions resolved:

1. **Group-edit conflicts: last-write-wins with conflict warning.** LWW is the default; each account_data write carries a version number and clients warn the user when a divergence is detected before clobbering (§4.3). Multi-device editing of groups is expected to be rare.
2. **Snapshot heartbeat: weekly, unconditional** (§6.3). One snapshot per graph per week regardless of activity. The unconditional cadence prevents the homeserver from inferring user activity from snapshot timing.
3. **Default homeserver: run one, recommend it** (with self-host always available). A public queer-curves homeserver will be operated by the project for users who don't self-host. Operational specifics (which homeserver implementation, federation policy, registration policy, T&Cs) deferred — user will provide further info later, will land in STACK.md / OPERATIONS.md when known.
4. **Owner key backup is required at first login.** Onboarding flow mandates Matrix cross-signing + key backup setup before the user can create or receive any graphs. Without it, multi-device key sharing breaks and account recovery is impossible (§15.1 covers the recovery UX side, deferred). Skipping key backup setup is not offered as an option — the consequence (total data loss on device loss) is too severe to make optional.

**2026-08-14 (later)** — §8 amended per SECURITY_PLAN.md §4.1–§4.2 (Stage 2):

7. **Grant levels are rooms + projections, not key policy.** Under the v1 whole-snapshot protocol, history lives in the newest event, so `shared_history`/`history_visibility` never enforced current-only. Each grant now gets its own share room and receives a per-grant projection of the graph (`store/projection.ts`); the owner's primary room stays owner-only and is the only room carrying unconfirmed `subject_ref` links (§12). The original §8.2 key-forwarding design is retained as the model for a future event-stream protocol.

**2026-08-14** — pronoun cards (`data_model.md` §5) added:

5. **Cards ride the existing sharing mechanism unchanged.** One room per card, same grant model, same revocation verbs, no new event types. A new graph family should not need new protocol surface; if it did, that would be a sign the family was modeled wrong.
6. **Card detail-level variants are deferred, and the redaction direction is specified now** (§7.4): a wide-audience variant keeps the welcome levels and drops refusals and notes. Recording the direction before implementing it prevents the intuitive-but-wrong "just hide the notes" version.
