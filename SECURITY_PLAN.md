# Security & Matrix Implementation Plan

How the shipped code gets from where it is to what `sharing_model.md` and `THREATS.md` already decided. This document is **not** normative: those two are. This one is the audit and the ordered work list, plus the places where implementing the design revealed the design itself needs an amendment.

Status: **draft**, v0. Created 2026-08-14. Audited against `c7d0794`.

## 1. Why this document exists

`THREATS.md` and `sharing_model.md` are mature; the Matrix layer that implements them is 900 lines and covers roughly the first third. The risk in that gap is not that features are missing — it's that **the threat model currently claims mitigations that the code does not provide**. `THREATS.md` cites "default current-only grants" as the primary mitigation for T2, T4 and T5, and cites hard-kick key rotation for T2. Neither exists in the shipped code. A threat model that overstates its own coverage is the specific failure mode §1 of `THREATS.md` sets out to avoid, so closing the gap — or amending the claim — is a correctness issue, not a roadmap nicety.

Three things this plan tries to keep separate:

- **Gaps** (§3) — the code doesn't do what the docs say. Fix the code.
- **Amendments** (§4) — the docs specify something that can't be built as written, usually because of an E2EE property. Fix the docs, then the code.
- **Sequencing** (§5) — what order, and what proves each step.

## 2. Implementation state

Everything the Matrix layer does today, against `sharing_model.md`.

| Area                                              | Spec             | State                                                                                                                                                             |
| ------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One room per graph, E2EE at creation              | §2.1, §2.3       | **Done.** `graphs-matrix.ts` creates a megolm room per graph; `waitForEncryption` prevents the plaintext-first-snapshot bug.                                      |
| Room-metadata hygiene                             | §2.2             | **Done in this change** (S1). Previously leaked the graph title as `m.room.name`.                                                                                 |
| Marker state event for cheap listing              | §2.1             | **Done.**                                                                                                                                                         |
| Snapshot on join                                  | §6.1–§6.2        | **Done.** `client.ts` hooks `RoomState.events` and re-sends on a join transition.                                                                                 |
| Power levels                                      | §9.1             | **Partial, in this change** (S2, and amendment §4.3). Owner-only writes; editor role not implemented.                                                             |
| Login / register / restore / logout               | §16.4            | **Done.**                                                                                                                                                         |
| Cross-signing + key backup at first login         | §16.4 decision 4 | **Done**, mandatory, with the destructive-re-setup guard.                                                                                                         |
| Recovery-key restore on a new device              | §15.1            | **Done** (`restoreFromRecoveryKey`).                                                                                                                              |
| Invite a viewer                                   | §5.1             | **Partial.** Raw Matrix-ID invite only; no contacts, no groups, no grant types.                                                                                   |
| Accept / decline invites                          | §5               | **Done.**                                                                                                                                                         |
| Deletion (tombstone + kick + leave)               | §10.3            | **Done** (Stage 1). Tombstone, then kick every member, then leave — in that order.                                                                                |
| Contacts & groups                                 | §3.2, §4         | **Contacts done** (pulled forward on user request): encrypted account_data with the §4.3 version guard, friend links, share-dialog picker. Groups remain Stage 3. |
| Grant types (view current / history)              | §5.1, §8         | **Done** (Stage 2). Per-grant share rooms + projections; `edit` stays out pending §7 Q3.                                                                          |
| History grants (`m.forwarded_room_key`)           | §8.2             | **Superseded** — §4.2 accepted; history grants are a projection choice, key forwarding kept for a future event-stream model.                                      |
| Soft / hard revocation                            | §10.1, §10.2     | **Done** (Stage 1). Hard revoke = per-member kick in the share UI; soft revocation is the documented absence of sends.                                            |
| Weekly heartbeat snapshot                         | §6.3             | **Done** (Stage 2), and honestly partial: it flattens "did anything change", not per-write timing (see S7).                                                       |
| Detail-level variant rooms                        | §7               | **Not started** (network graphs only, deferred by design).                                                                                                        |
| `subject_ref` consent handshake                   | §12              | **Not started.** `link_status` is typed in `types.ts`; no to-device traffic.                                                                                      |
| Device verification / cross-signing of _contacts_ | §3.2 `verified`  | **Not started.** See S3 — this is the most serious gap.                                                                                                           |
| Encrypted-at-rest for our own data                | `STACK.md` §6    | **Not started.** Access token is plaintext `localStorage`.                                                                                                        |

## 3. Gap register

Severity is about user harm, not effort. **Critical** = the code contradicts a mitigation the threat model claims. **High** = a designed protection is absent. **Medium** = hardening.

### S1 — Plaintext graph title in room state (Critical) — _fixed in this change_

`createRoom` passed `name: graph.name`, putting the user's graph title in `m.room.name`: unencrypted room state, readable by the user's homeserver and every federated peer of every member.

- **Threats:** T7 (homeserver reconstruction) directly; T5/T8 by consequence — "hrt levels", "who I'm sleeping with", "alcohol" as a plaintext room name is an outing primitive that needs no decryption.
- **Rules violated:** §7 rule 3, verbatim. `sharing_model.md` §2.2 says the same thing in more detail.
- **Fix:** `graphRoomCreateOptions()` sends no name, topic or avatar, and pins those three state events to power level 100 so a viewer cannot add one. `scrubRoomName()` overwrites the name on rooms created before the fix, on next save.
- **Residual:** overwriting is not deletion. A homeserver that logged the old value, or a federated peer that received it, keeps it; `m.room.name` history stays in the room's state graph. **Anyone with pre-existing graphs should assume the titles already leaked.** That is the honest disclosure this needs (§7 rule 13); it is not something the scrub can undo.

### S2 — Any viewer could publish a snapshot (High) — _fixed in this change_

`preset: 'private_chat'` leaves `events_default: 0`. Every invitee could send `app.queercurves.snapshot` into the room, and `findLatestGraph()` takes the newest decryptable snapshot regardless of sender — so a viewer could rewrite the graph as every other viewer sees it, including the owner's own client on a fresh device.

- **Threats:** T10 (hostile client with valid keys) with an integrity dimension the threat model doesn't currently name — T10 is written as an exfiltration threat, not a tampering one.
- **Fix:** `power_level_content_override` with `events_default: 100`, `state_default: 100`, `invite`/`kick`/`ban`/`redact` at 100.
- **Follow-up regardless of power levels:** `findLatestGraph()` should reject snapshots whose sender is not the room creator. Power levels are enforced by the _sender's_ homeserver on a federated send; a defence that lives only in server-side authorisation rules is weaker than one that also lives in the reader. Cheap to add, so add it (Stage 1).

### S3 — Megolm keys are shared with unverified devices (Critical)

No code path establishes device trust: no cross-signing verification of other users, no `requestVerification`, no device-trust check before a send, no `blacklistUnverifiedDevices`. matrix-js-sdk's default is to encrypt to **every device the homeserver claims** for a room member.

So a hostile homeserver (A4) or federated peer (A5) can add a device to a member's account — including to the _owner's_ own account — and the owner's client will encrypt the next snapshot to it. The homeserver then reads graph contents in plaintext.

- **Threats:** this is the load-bearing failure. T7 currently reads "even though it cannot decrypt graph contents"; as shipped, a homeserver **can**, at the cost of one injected device. T8 (legal compulsion) inherits it: the compellable party is the homeserver, and the compelled act is a device injection, not a decryption. E2EE against A4/A5 is the project's central claim; the `verified` field in `sharing_model.md` §3.2 is the only place the design mentions the mechanism, and it's unimplemented.
- **Rules:** no §7 rule covers device trust. **§7 needs a fourteenth rule** (§4.4).
- **Fix, in order:**
  1. Verify the user's _own_ other devices — cross-signing already bootstraps, so this is surfacing the existing signal (`getDeviceVerificationStatus`) and an interactive-verification flow.
  2. Show verification state per member in the share UI, and require an explicit confirmation to invite an unverified contact.
  3. Emit-side policy: a per-graph "only send to verified devices" toggle, defaulting **on** for graphs whose sharing was ever revoked, and a global default to be decided (§7 open question — blacklisting unverified devices is the safe default and the one that breaks sharing for anyone who hasn't verified).
- **Interim disclosure:** until (1)–(3) land, onboarding must not claim the homeserver cannot read graph contents. It can say contents are encrypted and that device verification is not yet implemented.

### S4 — "Current-only" is not current-only (Critical, design-level)

`THREATS.md` names default current-only grants as the primary mitigation for T2, T4 and T5, and `sharing_model.md` §8.1 defines it as "cannot decrypt past datapoints". But the v1 protocol resends **the whole `Graph`** on every change, and the graph object contains every datapoint, occurrence and card entry ever recorded. A viewer invited today receives one fresh snapshot — containing the complete history.

`shared_history: false`, `history_visibility: joined` and megolm's forward-only property all work exactly as documented, and all of them are irrelevant: they gate access to _old events_, and the history is in the _new_ event.

- **Threats:** T2, T4, T5 lose their stated mitigation entirely. For occurrence graphs this is at its sharpest — `THREATS.md` §11 warns that a viewer with history can reconstruct binges and dose schedules; every viewer has history.
- **Rules:** §7 rule 1 (default to least sharing) and rule 2 (history grants are special — the ceremony exists, and grants history without being invoked).
- **Fix (Stage 2, the largest piece of work in this plan):** a snapshot must be a _projection_ of the graph for a given grant, not the graph. Concretely, a `currentView(graph)` function per family — the schema, customization, and only what "current" means for that family (latest datapoint per axis; counter totals without the per-entry timestamps; the card as it stands) — with the full graph sent only to grants that carry `view history`. This is a store-layer change, not a Matrix one: `saveMatrixGraph` needs to know which room it is writing for and at which grant, which is also exactly what §7 detail-level variant rooms need. Doing S4 and §7 variants with one mechanism is the right call.
- **Until it lands:** the share UI must say that sharing a graph shares its whole history. That sentence is currently false in the docs and absent from the UI.
- **Status:** _fixed in Stage 2_ — see §5.

### S5 — No revocation of any kind (High)

There is no kick path, so §10.1 soft, §10.2 hard and the kick half of §10.3 deletion are all unavailable. `deleteMatrixGraph` publishes a tombstone and has the _owner_ leave — which leaves every viewer joined, holding keys, in a room the owner can no longer moderate. Compliant clients suppress the graph on the tombstone; a non-compliant one keeps rendering it, and no key rotation ever happens.

- **Threats:** T2's stated mitigation ("hard kick rotates Megolm keys") does not exist. T5's ("hard graph deletion wipes... and signals viewer caches") is half-built.
- **Rules:** §7 rule 4 (distinct verbs) — there are currently zero verbs.
- **Fix (Stage 1):** `revokeMatrixGraphAccess(graphId, userId)` → `client.kick`, which rotates the session on next send; a member list with a per-member revoke in `ShareSection.svelte`; deletion kicks all members _before_ leaving, in that order. Distinct UI copy per verb, and the honest caveat on each (a kick does not retract what they have).

### S6 — Access token in plaintext `localStorage` (High)

`session.ts` stores `accessToken` unencrypted, with a comment acknowledging `STACK.md` §6. Any script that runs in the origin reads it, and it is a full-account bearer credential: read every room, impersonate the user, inject a device (see S3).

- **Threats:** T11 (device compromise), T13 (supply chain — a compromised dependency exfiltrates the token with one line), T8 (a seized device gives up the token from a browser profile without any auth).
- **Rules:** §7 rule 10 (encrypt at rest, no exceptions).
- **The circularity to design around:** `STACK.md` §6 derives the at-rest key from the Matrix recovery key, which only exists _after_ login. So the token cannot be protected by it on the login path. Options, to decide (§7):
  - **(a)** Non-extractable WebCrypto key in IndexedDB, wrapping the token. Stops exfiltration by script that can read but not call into crypto, and stops offline reads of the profile directory. Does not stop script that calls the unwrap. Cheap, no UX cost.
  - **(b)** Session-scoped: token in memory only, re-login each app open. Strongest, and unusable.
  - **(c)** Passphrase-derived (Argon2/PBKDF2) wrapping key, prompted on app open. Strong, real UX cost, and a second secret to lose.
  - Recommendation: **(a) now**, as it is strictly better than today and costs nothing; **(c) as an opt-in "lock this device" mode** for users in A3 (coercive household) situations, which is the population that actually needs it.
- **Also missing and cheap:** a CSP. `svelte.config.js` sets none, and an SPA with no CDN assets (`STACK.md` §15) can run a strict one. This is the highest-leverage mitigation for the class of attack that reads the token.

### S7 — No weekly heartbeat snapshot (Medium, sharpened by occurrence graphs)

§6.3's unconditional weekly snapshot is the _only_ stated mitigation for T17, and it isn't implemented. Every write is event-driven, so the homeserver reads activity timing directly off the timeline — for an occurrence graph, that's the log times of the thing being counted.

- **Fix:** a heartbeat is easy (a timer that re-sends on open if the newest snapshot is older than the cadence). Note that a heartbeat _adds_ noise but does not _remove_ the real writes, so it flattens "did anything change" and not "when did they log a drink". Genuine mitigation for the occurrence case is write batching / coarse timestamps, which `THREATS.md` §9 already lists as scoped v1.x. Do the heartbeat in Stage 2 and treat it as partial.

### S8 — Invite surface is unfiltered (Medium)

`listPendingMatrixInvites()` lists _every_ pending Matrix invite, and `acceptMatrixInvite` joins whatever room id it is given. The comment explains why honestly (invitees only get stripped state, so our marker isn't visible before join). But the consequence is that an unrelated invite — spam, abuse, a room designed to look like a graph — appears in the graph list UI, and accepting joins it.

- **Threats:** T15 (UX-induced error). Low severity, real annoyance surface, and an abuse vector once the app has users.
- **Fix (Stage 1):** ask the homeserver for stripped state and only show invites whose stripped state is consistent with a graph room (encrypted, no name/topic, join rule invite); on join, if no marker materialises, leave again and tell the user. Also: no invite may be auto-accepted, ever.

### S9 — Homeserver URL is unconstrained (Medium)

`login()` posts the user's password to whatever `baseUrl` was typed, with no scheme check and no `.well-known` discovery. On a non-HTTPS origin this is a plaintext credential over the wire.

- **Fix (Stage 1):** require `https:` unless the host is a loopback address (the dev Synapse is `http://localhost:8008`, which must keep working); implement `.well-known/matrix/client` discovery so users type `example.org` rather than a base URL, per `sharing_model.md` §11.2's use of the server-side equivalent.

### S10 — No `subject_ref` consent handshake (Medium)

`sharing_model.md` §12 specifies the to-device protocol and `types.ts` has `link_status`, but nothing sends or handles `app.queercurves.link_request`. So T6's stated mitigation ("a `subject_ref` link is `pending` by default and not published to non-owner viewers until the named user accepts") is unimplemented in both directions: nothing asks, and nothing filters pending links out of a shared view.

- **Fix (Stage 3):** the filtering half is cheap and should not wait for the messaging half — a viewer-side render filter on `link_status !== 'confirmed'` gets most of the protection with none of the protocol. Do the filter in Stage 1, the handshake in Stage 3.

## 4. Amendments the design docs need

Implementing the model surfaced four places where the spec can't be built as written. Per `CLAUDE.md` ("code that contradicts them is a bug in one or the other — reconcile explicitly"), these are proposed amendments for the user to accept, not decisions taken.

### 4.1 `sharing_model.md` §8.1 / `THREATS.md` T2, T4, T5 — restate what current-only means

See S4. Either the snapshot becomes a projection (preferred) or the docs stop claiming current-only as a mitigation. There is no third option in which the current code matches the current docs.

### 4.2 `sharing_model.md` §8.2 — history grants may not need key forwarding at all

§8.2 specifies granting history by forwarding past megolm sessions via `m.forwarded_room_key`. Under the whole-snapshot protocol that mechanism is unnecessary: history lives in the newest event, so a history grant is just "send this viewer the full-graph projection instead of the current-view projection". That is dramatically simpler, has no to-device traffic, and no dependency on the SDK's key-forwarding behaviour. The cost is that it is not _retroactive_ — the viewer gets history as of the grant, not the ability to read the room's old ciphertext, which for our purposes is the same thing.

Recommend: keep §8.2's key-forwarding design documented as the model for a future event-stream protocol, and note that under v1's whole-snapshot design history grants are implemented by projection choice.

### 4.3 `sharing_model.md` §9.1 — the per-event-type power-level table cannot work under E2EE

§9.1 gates `graph_def` at 100, `datapoint` at 50, and so on. In an encrypted room the homeserver only ever sees the outer `m.room.encrypted` type, so it cannot apply a per-inner-type rule. The enforceable knobs are `events_default` (all timeline writes) and `state_default` (all state writes).

Consequence for the editor role (§9.3): "editors can append datapoints but cannot change the schema" is not server-enforceable. Under E2EE it can only be a client-side convention — which, per T10, means it is not a security boundary at all against a hostile client, only a guardrail against a compliant one. Options: accept it as a UX-level role and say so plainly; or split the trust boundary into rooms (an editor-writable room the owner reads and merges), which is real work and probably not v1.

Recommend: amend §9.1 to describe `events_default`/`state_default` as the actual mechanism, keep the per-type entries as defence-in-depth for any non-encrypted send path, and mark the editor asymmetry explicitly as convention-not-enforcement.

### 4.4 `THREATS.md` §7 — add a rule 14 on device trust

Nothing in the 13 rules requires that keys go only to trusted devices, which is why S3 could exist without violating any rule. Proposed:

> **14. Keys go to verified devices.** Any new send path must state which devices it encrypts to and how they came to be trusted. Sharing with an unverified device is a decision the user makes explicitly, never a default the code takes silently.

## 5. Staged plan

Each stage is independently shippable and ends with something that can be demonstrated against the dev Synapse. Probes (`scripts/*.mjs`) are the acceptance test for anything touching crypto, sync or multiple users, per `CLAUDE.md`.

### Stage 0 — metadata hygiene and write authorisation _(landed in this branch)_

S1, S2. Pure-function `graphRoomCreateOptions()`, plaintext-name scrub, unit tests asserting the rule-3 and §9.1 properties. No UI change, no migration prompt.

**Proves:** a newly created graph room carries no plaintext label, and no member but the owner can write to it.
**Probe:** extend `share-probe.mjs` to assert the invitee's client sees no `m.room.name` and gets a 403 on a snapshot send.

### Stage 1 — the verbs that are missing (S5, S8, S9, S2 follow-up, S10 filter) _(landed 2026-08-14)_

Revocation (soft/hard, distinct copy, per-member revoke), deletion that kicks before leaving, sender check in `findLatestGraph`, invite filtering, homeserver-URL constraints, pending-link render filter.

**Proves:** an owner can actually take access away, and the three revocation verbs are distinguishable in the UI.
**Probes:** new `revoke-probe.mjs` (two users: share → verify read → kick → verify the next snapshot is unreadable to the kicked user, plus the delete path's kick-then-leave order — folded in here rather than extending `delete-probe.mjs`, since the order check needs a second user anyway).

What landed, per gap:

- **S5:** `revokeMatrixGraphAccess` (kick; megolm rotates on next send), per-member Remove in `ShareSection.svelte` with the can't-take-back caveat, and `deleteMatrixGraph` now kicks every member after the tombstone and before leaving. Soft revocation deliberately has no code path — it is "stop updating", i.e. the absence of sends, and the share UI says so.
- **S2 follow-up:** `findLatestGraph` takes the room creator and ignores snapshots _and tombstones_ from anyone else (a viewer must not be able to vanish the graph for everyone either). When the create event hasn't synced, the check is skipped rather than blanking the UI — server-side power levels still hold.
- **S8:** invites are filtered on stripped state (`isPlausibleGraphInvite`: unnamed + encrypted + invite-only), the invite UI shows the inviter rather than a spoofable room name, and `acceptMatrixInvite` leaves again and reports if no marker materialises within 15s of joining.
- **S9:** `matrix/homeserver.ts` — https required except loopback, bare hostnames assume https, `.well-known/matrix/client` delegation honoured, and a well-known that delegates to plain http is a hard error (it must not be able to downgrade).
- **S10 (filter half):** `redactPendingLinks` in `graphs/network/privacy.ts` strips unconfirmed `subject_ref`s from the graph object non-owner viewers render/export. The handshake, and keeping the ref out of the published snapshot, remain Stage 3 / Stage 2.
- **S4 interim disclosure:** the share form now states that inviting shares the graph's full history.

### Stage 2 — grants that mean something (S4, S7, and §7 variants) _(landed 2026-08-14)_

The projection mechanism: `currentView()` per graph family, grant records per (graph, contact), a share dialog with `view current` / `view history` / `edit` per §5.1, and the weekly heartbeat. This is where the detail-level variant rooms (§7) become nearly free, and where the share-dialog honest-disclosure copy (`THREATS.md` §9 open items, including the pronoun-card and occurrence-timing lines) lands.

**Proves:** a viewer with `view current` cannot reconstruct history; upgrading to `view history` gives it to them.
**Probes:** `grant-probe.mjs` — assert on the _decrypted event content_ the viewer received, not on what the UI renders. The bug class here is a projection that leaks a field, and only content assertions catch it.

What landed:

- **Projections (S4):** `store/projection.ts`, pure and negatively tested. Per family: spectrum keeps only the newest datapoint; occurrence collapses each counter to one synthetic entry carrying its interval total, stamped at the window boundary (no real log time, note, tag, or entry id survives); network and pronouns are their current state. Both grants strip unconfirmed `subject_ref`s — the S10 "publish half" lands here. Current-only payloads carry `projection: { grant: 'current' }` so the viewer's UI can disclose it (additive optional field, no schema bump).
- **Share rooms:** grants are enforced by room membership — `{ v: 1, variant, parent }` markers, one room per (graph × grant), created on first use. The owner's primary room is owner-only for all new shares and is the only room carrying pending consent links. Accepted residual, documented in `graphs-matrix.ts`: the plaintext `parent` pointer tells the homeserver two rooms belong together (it could already infer this from membership and write timing). Saves fan out projections to share rooms; the on-join re-send re-projects from the primary; grant changes move the member between rooms (kick + invite). Pre-Stage-2 members of primary rooms are shown honestly as "full history (older share)".
- **Share dialog:** grant radio, least-sharing default (`current`), per-grant disclosure copy; `edit` deliberately absent pending §7 Q3.
- **Heartbeat (S7):** weekly unconditional re-send per owned room on app open (`sendHeartbeats`), treated as the partial mitigation it is — it flattens "did anything change", not per-write timing (batching/coarse timestamps stay v1.x).
- **Docs:** `sharing_model.md` §8 amended per §4.1/§4.2 (decisions log entry 7).

Deferred from this stage: grant records per (graph, contact) as a _data structure_ — the room family IS the grant record in v1; a separate record becomes necessary with contacts/groups (Stage 3). §7 detail-level variant rooms share the mechanism but the network detail-level projection itself is still to be specified.

### Stage 3 — trust and identity (S3, S6, S10 handshake, contacts/groups)

Device verification UI and emit-side policy; encrypted-at-rest for the session token plus a CSP; the `subject_ref` to-device handshake; contacts and groups in encrypted account_data with §4.3's version-conflict warning.

**Proves:** the homeserver cannot obtain graph plaintext by injecting a device.
**Probes:** extend `multi-device-probe.mjs` with a verification flow; a new probe that adds a second device and asserts keys are _withheld_ until it's verified.

S3 is the most serious gap in this plan and sits in the last stage — deliberately, because it is the one whose correct implementation depends on decisions not yet made (what the global unverified-device default is, and how much sharing breakage is acceptable), and because its interim mitigation is a documentation change that costs nothing. If the priority ordering should be severity-first instead, S3 moves to Stage 1 and the default becomes "blacklist unverified, sharing requires verification" — a defensible v1 posture, and a stricter one than most Matrix clients ship.

## 6. Verification strategy

- **Unit tests** cover the pure parts: room-creation options, snapshot selection, projection functions (Stage 2 makes these the highest-value tests in the repo, because a projection bug is a silent data leak).
- **Probes** cover everything else, and must assert on **decrypted event content received by the other party**, not on rendered UI. The distinction matters: masked labels (`privacy.ts`) mean the UI can look correct while the payload is over-shared.
- **A negative probe per protection.** For each of S1–S10, the probe asserts the thing is _absent_ — no plaintext name, no readable snapshot after a kick, no history in a current-only projection, no keys to an unverified device. Positive-path probes wouldn't catch any of these regressing.

## 7. Open questions for the user

1. **S3 priority.** Ship device verification in Stage 1 with a strict default (sharing requires verification), or Stage 3 with an interim documentation caveat? Strict-default is the honest posture and will frustrate first-time sharing.
2. **S6 approach.** Non-extractable WebCrypto wrapping now (option a), plus an opt-in passphrase lock later (option c)? Or straight to passphrase?
3. **§4.3 editor role.** Accept "editor" as a client-side convention with no enforcement, or drop the editor grant from v1 rather than ship a role whose asymmetry the protocol doesn't back?
4. **Pre-existing title leak (S1 residual).** Should the app tell existing users that graph titles created before the fix were visible to their homeserver? A one-time notice is the §7-rule-13 answer; it also tells every user something alarming about data that, on the dev homeserver, only they ever saw.

## 8. Decisions log

**2026-08-14 (evening)** — contacts pulled forward from Stage 3 on user request (share-dialog review: "add friends… using a QR code or a link… select from your friend's list instead of a text-entered user"). `matrix/contacts.ts`: owner-private friends list in account_data, AES-256-GCM under an HKDF key derived from the key-backup private key (every provisioned device already holds it; ciphertext is all the homeserver sees), with §4.3's version guard against cross-device clobbering. Friend links are matrix.to URLs (§3.3's "format TBD" resolved — QR-friendly; an in-app QR render awaits a dependency decision per STACK.md §15). The share dialog now picks from friends by display name (§3.1), with the raw-id field folded away as the power-user fallback. Groups, and the `verified` flag's meaning, remain Stage 3.

**2026-08-14 (later still)** — Stage 2 landed: S4 (per-grant projections + share rooms), S7 (weekly heartbeat), the S10 publish-half (unconfirmed links stripped from every projection), and the §4.1/§4.2 amendments accepted and written into `sharing_model.md` §8. T2/T4/T5's "default current-only grants" mitigation is now real for all new shares; members added before Stage 2 hold full history and are labelled as such. `edit` grants remain unshipped pending §7 Q3.

**2026-08-14 (later)** — Stage 1 landed: S5, S8, S9, the S2 reader-side sender check, the S10 render filter, and the S4 interim share-UI disclosure. Details in §5 Stage 1. The §7 open questions remain open; nothing in Stage 1 pre-empted them.

**2026-08-14** — document created. Stage 0 (S1, S2) landed with it. Ten gaps registered, four doc amendments proposed (§4), four questions open (§7). The three flagged **Critical** are S1 (fixed), S3 (unverified devices) and S4 (current-only is not current-only); S3 and S4 are both cases where `THREATS.md` claims a mitigation the code does not implement, which is the class of gap this document exists to prevent.
