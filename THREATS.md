# Threat Model

The canonical reference for what queer-curves protects against, what it doesn't, and what design rules fall out. Read alongside `data_model.md` and `sharing_model.md`.

Status: **draft**, v0. Created 2026-05-07.

## 1. Purpose

This document exists so that future feature decisions can be evaluated against a fixed reference rather than re-litigated from scratch each time. When someone proposes a new feature ("add link previews", "show last-seen", "let viewers comment on graphs"), the test is: which threats does it expose, and is the trade-off acceptable?

This is **not** a marketing document. It does not say "queer-curves keeps you safe." It says what we defend against, what we don't, and where the lines are. Users who need a different threat model than ours should know that before they trust us with their data.

## 2. Whom we're protecting

The primary user population, in rough priority order for design decisions:

- **Trans, non-binary, gender-questioning** users tracking their own identity over time, including those who are stealth in some contexts and out in others.
- **Asexual / aceflux / aromantic spectrum** users tracking attraction patterns.
- **Polyamorous / non-monogamous** users sharing relationship structure within a polycule that isn't public.
- **Queer users in hostile environments** — jurisdictions where their identity is criminalized, family contexts where it isn't safe, employment situations where disclosure has cost.
- **Users exploring identity who don't have settled answers yet** — the questioning phase is one of the most data-sensitive periods, and the data may turn out to embarrass a future settled self.

We are **not** primarily protecting:
- Public figures with adversarial nation-state attention.
- Journalistic sources whose lives depend on absolute anonymity.
- Anyone who needs deniable communication (we don't offer plausible deniability, just confidentiality).

If you are in those categories, queer-curves is not the right tool.

## 3. Asset model

What's worth protecting, in roughly decreasing sensitivity:

| Asset | Why it matters | Where it lives |
|---|---|---|
| Datapoint values | The specific identity/orientation/relationship state at moments in time | Encrypted Matrix events |
| Schema labels | "Ace" vs "Demi" vs "Gray" — sensitive vocabulary | Encrypted Matrix events (graph_def, snapshot) |
| Graph titles & descriptions | Even "my gender" is identifying | Encrypted Matrix events; **never** in `m.room.name` |
| Long-form histories | Aggregated over time, far more revealing than any single point | Encrypted timeline; access gated by history grant |
| Network structure (polycule shape) | Reveals who-loves-whom, who-sleeps-with-whom | Encrypted Matrix events in network-graph rooms |
| Sharing graph (who-shares-what-with-whom) | Reveals social structure even without contents | **Visible to homeservers** as room membership |
| Group definitions ("polycule," "close friends") | Names + composition of trust circles | Encrypted Matrix account_data |
| Contact list | Who the user knows in queer-curves | Encrypted Matrix account_data |
| Update cadence | Activity timing leaks life patterns | **Visible to homeservers** as event timing — partly mitigated by weekly heartbeat |
| Matrix identity & homeserver | Pseudonymous but stable across sessions | Public to all interaction partners |

## 4. Adversary model

We don't try to defend equally against all attackers. Loosely ordered by how realistic / load-bearing they are for our user population:

| Code | Adversary | Capabilities |
|---|---|---|
| **A1** | Trusted recipient who later becomes hostile (ex, former friend, kicked-out polycule member) | Has whatever decrypted data they accumulated during access; can make new accounts, run modified clients |
| **A2** | Community peer not granted access | No keys, but may receive screenshots / receipts from others; social-engineering pressure |
| **A3** | Coercive actor in user's life (controlling partner, parent, employer) | Physical access to user's device; can demand passwords; can demand history grants |
| **A4** | Hostile homeserver operator (user's own homeserver) | Sees all room metadata, membership, timing, federation patterns; cannot decrypt content |
| **A5** | Federated peer homeserver operator | Same as A4 but for rooms that include their users |
| **A6** | State / legal actor | Can compel disclosure from any party; can subpoena devices, homeservers, identity providers |
| **A7** | Mass-scrape adversary (data brokers, aggregators) | Crawls public surfaces; correlates leaked data across services |
| **A8** | Hostile client author (rogue build that targets queer-curves users) | A user installs malicious client → attacker has all that user's keys |
| **A9** | Device-compromise adversary | Malware, theft, lost device |
| **A10** | Supply-chain attacker | Compromises a build dependency; ships malicious code to all clients |
| **A11** | Sophisticated cryptographic attacker | Exploits an Olm/Megolm implementation flaw; future quantum capability |

**Out of scope as primary targets:** A11 (we inherit Matrix's defenses, not exceed them) and any nation-state actor with targeted attention on a specific user.

## 5. Threats

Each threat is keyed for cross-reference. Format: short description, primary adversary, mitigation in queer-curves, residual risk.

### T1. Coerced disclosure within relationships

**Description:** A controlling partner, parent, employer, or roommate pressures the user to grant them access to a graph or to upgrade an existing grant ("if you've got nothing to hide, give me history access").

**Primary adversary:** A3.

**Mitigations:**
- Friction at the worst grants: history is a separate toggle from current view (`sharing_model.md` §8). The default is the safest grant.
- Three named revocation modes — soft, hard, deletion — so the user can later disengage at the right severity (`sharing_model.md` §10).
- Honest UX language: history grants are sticky in practice; users see this clearly before granting.

**Residual risk:** The protocol cannot prevent a user from granting access under coercion. We make harmful grants more deliberate, not impossible.

### T2. Time-shifted misuse by past recipients

**Description:** Someone who legitimately had access at time T misuses the data at time T+N. Most common form: ex-partner retention. A polycule member who had `view history` for two years keeps two years of data; revocation only stops *future* data.

**Primary adversary:** A1.

**Mitigations:**
- Default current-only grants (`sharing_model.md` §5) bound the data anyone can accumulate.
- Hard kick rotates Megolm keys, preventing future-data access (`sharing_model.md` §10.2).
- Compliant viewer clients clear cache on kick or deletion — UX courtesy, not enforceable.

**Residual risk:** Cached decrypted data on a former recipient's device cannot be retroactively retracted. **Acknowledged as fundamental, not solvable.**

### T3. Receipts / weaponizing screenshots within communities

**Description:** A community peer receives screenshots from someone with access and uses them in callouts, drama, or reputation attacks. The most common harm in practice in queer/poly online spaces.

**Primary adversaries:** A1 (the leak source), A2 (the recipient of the screenshot).

**Mitigations:**
- Reducing total decrypted-data exposure (current-only defaults, no auto-history) reduces what's on screenshot-able surfaces.
- Honest UX framing: ephemerality is a UX commitment, not a guarantee.

**Residual risk:** No software can stop a screenshot. Anyone with view access can capture content. **Acknowledged.**

### T4. Pattern inference by long-term viewers

**Description:** Even within a granted-history audience, viewers can infer correlations the user never disclosed: "intensity dropped every time X visited"; "gender shifts correlate with menstrual cycle"; "orientation noise spikes on family-visit weekends." Each datapoint is innocuous; the pattern isn't.

**Primary adversary:** A1.

**Mitigations:**
- Default current-only grants prevent most viewers from having enough longitudinal data to infer patterns.
- (No technical mitigation against inference itself — viewers with valid history grants will see what they see.)

**Residual risk:** Substantial. Long-term granted history can be turned into inferences the data subject never consented to. The design lever is the **friction on history grants** (see T1, T2).

### T5. Identity-history exposure (trans timelines, exploration phases)

**Description:** A trans user currently stealth has past data showing transition. A user exploring identity has noisy early periods they don't want defining them. The timeline itself is the outing vector — even if the *current* state is benign, the *change* tells a story.

**Primary adversaries:** A1, A2 (post-leak), A3, A6.

**Mitigations:**
- Default current-only — viewers don't see transition history unless explicitly granted it.
- Hard graph deletion (`data_model.md` §7.3) wipes the data from the owner's storage and signals viewer caches to wipe too.
- Datapoint redaction (`data_model.md` §3.4) for finer-grained correction without deletion.

**Residual risk:** Once any view of history has been granted, copies may persist on viewer devices indefinitely (see T2).

### T6. Non-consensual naming via `subject_ref`

**Description:** An owner names someone as part of their network (polycule, friend group) — pulling that person into a queer-coded social graph without their consent.

**Primary adversary:** A1 (the network owner).

**Mitigations:**
- The consent handshake (`sharing_model.md` §12). A `subject_ref` link is `pending` by default and not published to non-owner viewers until the named user accepts. Withdrawable at any time.
- Compliant clients omit pending links from rendering.

**Residual risk:** A non-compliant client could publish pending links. The named user's homeserver can see the request payload only as encrypted to-device traffic; metadata leak is limited to "owner's homeserver sent a to-device message to named-user's homeserver."

### T7. Homeserver social-graph reconstruction

**Description:** The user's chosen homeserver — even though it cannot decrypt graph contents — can see room membership lists, room creation timestamps, federation patterns, and event timing. From this it can reconstruct: who shares with whom, how many graphs each person maintains, when relationships start/end (via room create/leave events), and approximate update cadence.

**Primary adversaries:** A4, A5.

**Mitigations:**
- Hygiene on room metadata (`sharing_model.md` §2.2): no sensitive labels in room name/topic.
- Weekly unconditional snapshot heartbeat (`sharing_model.md` §6.3) flattens the timing-of-update signal.
- Self-hosting eliminates this for *your own* server (but not for federated peers).

**Residual risk:** **Significant and structural.** This is a fundamental Matrix property, inherited by anything built on it. Honest disclosure in onboarding required. Users with threat models that demand metadata privacy from their own homeserver should run their own.

### T8. State / legal compulsion

**Description:** Subpoena, custody dispute, immigration interview, asylum claim, criminal investigation. Courts can compel disclosure from the user, the homeserver operator, individual recipients, or device manufacturers.

**Primary adversary:** A6.

**Mitigations:**
- E2EE means the homeserver cannot be compelled to produce plaintext content (only ciphertext + metadata).
- Default current-only grants reduce what's compellable from each recipient device.
- Hard deletion + cache-wipe protocol gives the user a "purge" option before a foreseeable compulsion event.
- Self-hosting in user-favorable jurisdictions is possible.

**Residual risk:** Substantial. Anyone with a key can be compelled to reveal what they have. The metadata leak in T7 is itself often compellable. Historical data on viewer devices is reachable. **In jurisdictions where queer/poly identity is criminalized, queer-curves cannot fully protect users from state action.** Users in those jurisdictions need to weigh whether maintaining structured data about their identity is wise at all — and our docs should say so.

### T9. Mass scraping / data brokers

**Description:** Crawlers, aggregators, identity-resolution companies vacuum public data. Anything a queer-curves user posts publicly — on their profile, on a public Matrix room, in cross-account references — gets harvested.

**Primary adversary:** A7.

**Mitigations:**
- Nothing is published to public surfaces by default. Graphs are E2EE in private rooms.
- Matrix profile data (display name, avatar) is the only crawler-reachable surface. Users can choose how identifying these are.

**Residual risk:** Limited unless the user opts into public sharing (which we don't currently support, see `sharing_model.md` §14). Future "public graph" features would dramatically increase exposure here — flag for that decision.

### T10. Hostile / modified clients with valid keys

**Description:** A recipient runs a modified queer-curves build (or a generic Matrix client that's been adapted) which keeps everything decrypted forever, exfiltrates data to third parties, or ignores redactions.

**Primary adversary:** A8.

**Mitigations:**
- (None at the protocol level. Cryptography cannot distinguish a compliant from a non-compliant client given the same keys.)
- Reproducible builds + signed releases of the official client reduce risk that the *source* binary is modified.
- Out-of-band trust: users tend to share with people they have real-world relationships with; rogue-client risk is concentrated in adversarial relationships.

**Residual risk:** **Acknowledged as unavoidable.** Compliance is honor-system once keys are issued. UX should not promise more than this.

### T11. Compromised user device or account

**Description:** Malware on the user's machine, credential theft, lost-and-found device, shoulder-surfed password.

**Primary adversary:** A9.

**Mitigations:**
- Encrypted-at-rest local storage (sharing_model.md §13 / STACK.md): a thief who steals an unlocked device gets data, but a powered-off device gives up nothing without auth.
- Mandatory key backup at first login enables recovery on a clean device.
- Cross-signing + device verification (Matrix-native): users see when a new device joins their account.

**Residual risk:** A user who runs malware while logged in is exposed. Standard "secure your endpoint" advice applies; queer-curves does not solve endpoint security.

### T12. Lost device + key backup loss

**Description:** User loses all devices, also loses key backup. All graphs (their own and ones shared with them) become permanently unreadable.

**Primary adversary:** None — this is a user-error / accident risk, but it's an availability threat worth naming.

**Mitigations:**
- Mandatory key backup setup at first login (`sharing_model.md` §16.4). Skipping is not offered.
- Onboarding walks the user through securing the recovery key.

**Residual risk:** **The recovery UX is deferred** (`sharing_model.md` §15.1). Until that design is settled, this risk is real. Note for honest user communication: queer-curves is unrecoverable by us — by design — so losing keys is permanent.

### T13. Supply-chain compromise

**Description:** An NPM dependency, a build pipeline, or a CDN delivers malicious code to all clients. Single point of failure with broad blast radius.

**Primary adversary:** A10.

**Mitigations:**
- Pinned dependencies, lockfiles audited at release time.
- Reproducible builds where feasible (Tauri, web build outputs).
- Subresource integrity for any CDN-loaded assets (or just don't load from CDNs).
- Signed releases.

**Residual risk:** Real. The web ecosystem cannot fully be hardened against this. Defense-in-depth: the smaller our dependency surface, the easier this is. Keep dependency choices conservative.

### T14. Cryptographic implementation flaw

**Description:** Bug in libolm, vodozemac, matrix-js-sdk's crypto store, or our own crypto-adjacent code (encrypted-at-rest cache).

**Primary adversary:** A11.

**Mitigations:**
- We use Matrix's standard libraries, not roll our own primitives.
- Matrix's crypto has been audited multiple times; we benefit from that.
- Keep our own crypto surface minimal — encrypted-at-rest cache uses WebCrypto with conservative parameters; no novel constructions.

**Residual risk:** Bugs happen. We commit to following Matrix security disclosures and shipping fixes promptly.

### T15. UX-induced unintended sharing or wrong revocation

**Description:** User clicks "share with polycule" thinking it's "share with friends." User picks "soft revocation" thinking it deletes. User accepts a default they didn't read.

**Primary adversary:** None (user-error, but design fault).

**Mitigations:**
- Distinct named revocation modes (`sharing_model.md` §10.4) — don't collapse them into a single "stop sharing."
- Confirmation step on grants that include `view history` or `edit`.
- Confirmation with the audience name spelled out before invites are sent.
- Visual distinction between trust levels in the share dialog.

**Residual risk:** Some user errors will happen regardless of UI care. Frequency is the metric to optimize.

### T16. Future-self regret about persistence

**Description:** The user's own past data follows them into a future they didn't anticipate. 22-year-old you doesn't speak for 35-year-old you. Long-form history can foreclose what the future self gets to be.

**Primary adversary:** None (the user is both subject and adversary across time).

**Mitigations:**
- Datapoint deletion (Matrix redaction → cache wipe; `data_model.md` §3.4).
- Hard graph deletion (`data_model.md` §7.3).
- Easy bulk-deletion UX should be built (deferred — flag for v1.x).
- Honest UX framing: data has half-life implications. Make this visible.

**Residual risk:** Compliance dependent. Past viewers may keep what they had (T2).

### T17. Update-cadence inference

**Description:** The frequency and timing of `app.queercurves.*` events leaks user activity patterns to homeservers and federated peers ("user opens app daily at 11pm," "user updates graph during certain weeks more than others").

**Primary adversaries:** A4, A5.

**Mitigations:**
- Weekly unconditional snapshot heartbeat (`sharing_model.md` §6.3) — same cadence regardless of whether anything changed, removing the activity-correlation signal from the snapshot stream.
- (Datapoint events still leak when added — not flattened. Future work could batch them.)

**Residual risk:** Snapshot timing leak is largely closed; datapoint timing is not. For users with strong timing-privacy needs, advise batching their updates ("write a week's worth on Sundays" rather than as-they-happen).

## 6. What we explicitly do NOT defend against

Calibration matters: a security doc that overpromises is worse than one that underpromises. We do not defend against any of these. Users should know.

- **Decrypted-data retention by recipients.** Once granted, gone if they keep it. (T2, T4.)
- **Screenshots, photos of the screen, screen recordings.** No software can prevent these. (T3.)
- **Hostile clients with valid keys.** Indistinguishable from compliant clients to the protocol. (T10.)
- **Coerced cooperation by the user.** A user who is forced or persuaded to grant access does so. (T1, T8.)
- **Pure metadata visibility to homeservers.** Who-shares-with-whom, when, how often. Inherited from Matrix. (T7, T17.)
- **Endpoint compromise.** Malware, sideloaded modified clients, password reuse, shoulder surfing. (T11.)
- **Loss of all keys + backups.** Permanent data loss is the cost of E2EE without a recovery backdoor. (T12.)
- **Quantum-capable adversaries with patient access to ciphertext.** "Harvest now, decrypt later" attacks against stored Megolm-encrypted events are not defended against; Matrix has not yet shipped post-quantum primitives.
- **Targeted nation-state attention.** Different threat model. Use a different tool.
- **Plausible deniability.** We provide confidentiality, not deniability. Recipients can prove they received what they received.

## 7. Design rules that fall out

Heuristics for evaluating any new feature against this threat model. If a proposed feature violates one of these, it needs an explicit override decision.

1. **Default to least sharing.** New features that share data should default to off / minimum scope. Friction is consent.
2. **History grants are special.** Anything that gates a history-equivalent flow goes through the history-grant ceremony, with the same friction as the original.
3. **No labels in plaintext-visible Matrix state.** Anything user-facing-and-sensitive lives in encrypted event content, never in `m.room.name`/`topic`/`avatar`.
4. **Distinct verbs for distinct revocations.** Don't collapse soft / hard / deletion into one "stop." UX must reflect the protocol's actual options.
5. **Ephemerality is a UX commitment, not a guarantee.** Any feature that suggests "temporary" must include the honest-physics caveat (decrypted data on recipient devices is not under our control).
6. **Heartbeats over event-driven leaks.** Where a feature's natural timing leaks user activity, prefer a stable cadence.
7. **No 3PID dependency.** Don't require email/phone-number identity servers.
8. **Federation is the cross-server story.** Don't invent a parallel sharing channel that bypasses Matrix federation.
9. **Reproducible / signed builds for distributed binaries.** Anything we ship as an installable artifact.
10. **Encrypt at rest, no exceptions.** Local cache, account_data, recovery hints.
11. **No silent telemetry.** Any analytics is opt-in, scoped narrowly, and named in onboarding.
12. **Schema versioning.** Old clients should fail safe on unknown event types, not misrender.
13. **The honest disclosure is part of the UX.** Onboarding, share dialogs, and revocation flows surface what's true (especially T2, T7, T10, T16).

## 8. How to use this document

When proposing a feature:

1. List which threats (T1–T17) it touches.
2. State which adversaries (A1–A11) gain or lose capability.
3. Map the feature against §7 design rules; flag any violations.
4. State residual risk explicitly, in language a user would understand.
5. If the feature requires a new entry in §6 (something we explicitly *won't* defend against), say so out loud.

When closing a feature decision, append the outcome to a "feature-vs-threats" log so future contributors can see the reasoning.

## 9. Open items

- **§6 quantum entry**: revisit when Matrix ships post-quantum primitives. Currently a flagged future risk, not an active mitigation.
- **§T16 bulk-deletion UX**: needed for "future-self protection" — deferred to v1.x.
- **§T8 jurisdictional guidance**: the docs and onboarding should include honest guidance for users in hostile jurisdictions. Drafting deferred but flagged.
- **§T17 datapoint-timing flattening**: weekly batching of datapoint events as a future privacy mode. Not v1.

## 10. Decisions log

(This is v0. Future decisions affecting the threat model should be appended here with date and rationale.)

### 2026-08-14 — merging graphs and collections (multi-graph views)

Feature: `data_model.md` §9a. Merge combines N graphs into one new graph; a collection saves a list of graph ids and renders them on one chart without copying anything.

**Threats touched.**

- **T6 (non-consensual naming via `subject_ref`)** — the sharp edge. Merging two network graphs could otherwise upgrade a `pending` or absent consent state into `confirmed` just by unifying two nodes for the same person. Mitigated: consent states combine to the *most restrictive* value, and any `denied` wins outright (§7 rule 1). A merge can only ever narrow a link, never widen one.
- **T4 (pattern inference by long-term viewers)** and **T5 (identity-history exposure)** — a merged graph concentrates data that was previously spread across several graphs with several separate share lists. One later share decision now exposes everything the merge pulled in. Mitigated by disclosure rather than prohibition: merging graphs owned by someone else raises an explicit, uncollapsed warning that the result is owned by *you* and re-sharing it re-shares their data under your name.
- **T15 (UX-induced unintended sharing or wrong revocation)** — "merge" conventionally consumes its inputs. If users assumed that here, they'd expect the sources' share lists to be gone. Mitigated: the operation is non-destructive and both the merge page and the collection page say so in plain language.
- **T7 (homeserver social-graph reconstruction)** — collections add one room per collection, and its membership is the owner alone. Marginal: the homeserver learns that an account has N+1 private rooms rather than N. No new correlation between *accounts* is created, because collections are not shareable.
- **T1 (coerced disclosure)** and **T16 (future-self regret)** — unchanged in kind. A collection is one more artifact that can be opened under duress, but it holds no data of its own; deleting it destroys nothing.

**Adversary capability.** No adversary gains a new capability. A homeserver operator sees additional room-creation events with an opaque `app.queercurves.collection.*` type and no readable content. Nothing new is published to anyone who wasn't already a member of the underlying graph rooms — neither feature invites, shares, or transmits to any new party.

**Against §7 design rules.**

- Rule 1 (least sharing): honoured. Collections are personal, non-shareable in v1; merging shares nothing by itself; cross-owner composition warns.
- Rule 3 (no plaintext labels): honoured, and slightly *improved* on the existing baseline — collection rooms are created with no `m.room.name`, so the name lives only in the encrypted snapshot. Graph rooms still set a plaintext name; that is pre-existing and tracked in §9, not something this feature widens.
- Rule 4 (distinct revocation verbs): honoured. Deleting a collection is explicitly labelled as removing only the list; deleting a merged graph is an ordinary graph deletion and does not touch the sources.
- Rule 10 (encrypt at rest): honoured on the Matrix path. Collections written by a logged-out session land in plain `localStorage`, exactly like graphs do today, and migrate into an encrypted room on the next save once crypto is ready. Same known gap as graphs, no wider (`STACK.md` §6).
- Rule 12 (schema versioning): honoured. Neither feature changes an existing shape, so `SCHEMA_VERSION` stays put; a client that doesn't know `app.queercurves.collection.*` simply doesn't see collections, which is the correct fail-safe.
- Rule 13 (honest disclosure): honoured. Compatibility problems, foreign ownership, and unloadable members are all shown in full and never collapsed behind a details toggle.

**Residual risk, in user terms.** Merging someone else's graph into yours makes a copy that they cannot revoke. If they later withdraw the original from you, your merged copy still has their data in it, and the warning at merge time is the only thing standing between that and an accidental re-share. This is the same honest-physics limit as T2 — once data has been decrypted on your device, it is out of the sender's control — and merging simply makes it easy to act on. No new §6 entry is required: this is T2 as already documented, not a new class of thing we decline to defend against.

### 2026-08-14 — cross-graph axis plotting

Feature: `data_model.md` §9a.3. A collection view can bind each visual channel to one specific `(member, axis)` pair, so any axis of any member plots against any other — including one person's axis against another's, paired over time.

**Threats touched.**

- **T4 (pattern inference by long-term viewers)** — this is the one the feature genuinely sharpens. Correlating two graphs is *precisely* an inference tool: "your libido tracks your stress", "your mood follows your partner's". Someone with read access to two of your graphs could already have eyeballed this; the feature makes it one dropdown. Two things bound it. First, it reads only graphs already in the viewer's collection, so it grants **no new access** — it surfaces inferences from data the viewer could already see. Second, collections are personal and non-shareable, so a correlation cannot be published as an artifact in its own right. The honest position is that this lowers the effort of an inference that was always available, and that is a real change even though the access boundary is unmoved.
- **T5 (identity-history exposure)** — unchanged in reach. No new data is read, transmitted, or stored; the plot is composed in memory on each open and thrown away.
- **T15 (UX-induced misreading)** — new, and specific to the time join. Pairing two independently-recorded graphs by carrying the last value forward produces a chart that *looks* like simultaneous measurement. Presented uncaveated it would invite conclusions the data doesn't support. Mitigated by a permanent note above the chart whenever the join is in play, saying in plain words that each point pairs a reading with the other graph's most recent value and that this is an approximation.

**Adversary capability.** None gains anything. No new events, no new rooms, no new network traffic — a `CollectionView` is a few integers inside the collection snapshot that was already encrypted. An adversary who can read the collection could already read the member graphs it names.

**Against §7 design rules.**

- Rule 1 (least sharing): honoured — nothing is shared; the mode reads graphs the viewer already has.
- Rule 12 (schema versioning): honoured — `CollectionView` is additive and optional; a client that doesn't understand it falls back to the combined mode.
- Rule 13 (honest disclosure): this is the rule doing the work. The join caveat is not collapsible and not a tooltip, and the mode's own description says what it does before the user builds anything. The feature also *reads* values only — no rescaling or derived coordinates — so a plot never restates what the user recorded.

**Residual risk, in user terms.** Putting someone else's graph in a collection alongside yours makes correlations between your lives easy to produce and easy to screenshot. That is the point of the feature and also its hazard: a chart claiming "their mood drives mine" is persuasive, shareable as an image, and built on a carry-forward approximation rather than paired measurements. The caveat text is the only thing travelling with the chart, and it does not survive a screenshot — the same limitation as T3, and no new §6 entry is needed for it.
