# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node 22 + pnpm 11 (`.nvmrc`, lockfile). Full pre-push gauntlet, same as CI:

```sh
pnpm lint && pnpm check && pnpm test && pnpm build
```

| Task                | Command                                             |
| ------------------- | --------------------------------------------------- |
| Dev server          | `pnpm dev` (http://localhost:5173)                  |
| Single test file    | `pnpm vitest run src/lib/store/graphs.test.ts`      |
| Single test by name | `pnpm vitest run -t 'partial test name'`            |
| Typecheck           | `pnpm check` (runs `svelte-kit sync` first)         |
| Format              | `pnpm format` — `pnpm lint` runs `prettier --check` |

Vitest is scoped to `src/**/*.test.{js,ts}` in a `node` environment (see `vite.config.ts`). Tests are co-located with source; there is no browser/DOM test setup, so unit tests cover pure logic and inject fake Matrix clients rather than mounting components.

### Local Matrix homeserver

Matrix-backed work needs a homeserver. `scripts/dev-matrix.sh up | down | logs | reset` manages a loopback-only Synapse on `http://localhost:8008` via docker/podman compose; `scripts/dev-matrix.sh user alice` creates `@alice:localhost` with password `devpass`. All state lands in gitignored `data/synapse/`.

### Headless probes (`scripts/*.mjs`)

Not CI tests — manual playwright-core harnesses that drive a real browser against `pnpm dev` + dev Synapse to exercise flows unit tests can't (crypto, sync, multi-user). Each covers one path: `smoke-test` (login → keys → create → reload), `share-probe` (two-user invite/accept), `multi-device-probe`, `delete-probe`, `network-probe`, `migration-probe`, `restore-error-probe`, `datapoint-probe`, `refresh-probe`. They expect `DEV_URL` (default `http://localhost:5174`) and `HOMESERVER`. Add a probe when a change touches an E2EE or multi-party path; run the relevant one before claiming such a change works.

## Architecture

Pure SPA (`ssr = false`, `prerender = false` in `src/routes/+layout.ts`) built with `adapter-static`. There is no queer-curves backend — a Matrix homeserver is the only server, and the Matrix Client-Server API is the API.

### Storage dispatch is the spine

`src/lib/store/graphs.ts` is the single CRUD seam every route and component uses. It dispatches **per graph id**, not per session:

- ids starting with `!` are Matrix room ids → `graphs-matrix.ts`
- `g_…` ids (from `generateGraphId()`) → `localStorage` key `queer-curves:user-graphs`

Matrix is used only when a session exists _and_ `cryptoStatus.ready`. Every function first `await ensureHydrated()` — `+layout.svelte`'s `onMount` restores the session asynchronously, and acting before `matrixStore.hydrated` flips would silently drop a graph into localStorage. Keep new store functions on that pattern. A save of a `g_…` graph while Matrix is live migrates it into a room and deletes the local copy.

Everything in the store API is async, including the localStorage path, so call sites never branch on backend.

### Matrix layer

- `matrix/client.ts` — the whole SDK wrapper: dynamic `import('matrix-js-sdk')` (~1MB + crypto WASM, loaded only on login), Rust crypto init with IndexedDB persistence, login/register/restore/logout, cross-signing + key-backup setup (`setupCrypto`), and recovery-key restore (`restoreFromRecoveryKey`). Dense with load-bearing workarounds — read the comments before touching: a custom sync `Filter` (the SDK default makes Synapse drop joined rooms from initial sync), crypto-store wipe on "account in the store doesn't match", and `waitForEncryption` before the first snapshot send (sending too early publishes it in _plaintext_, permanently).
- `matrix/store.svelte.ts` — Svelte 5 runes state: `session`, `hydrated`, `cryptoStatus`, `needsKeyRestore`, and `roomsEpoch`. `roomsEpoch` is the UI's reactivity signal: it's bumped on `Room`, `Room.timeline`, `Room.myMembership`, and `Event.decrypted`, so views re-fetch as a catch-up sync trickles in and as late megolm keys make older snapshots readable. Views that list or show graphs must read `roomsEpoch` in a `$derived`/effect or they will show stale data.
- `matrix/session.ts` — access token in plain localStorage (`queer-curves:matrix-session`). Known gap; STACK.md §6 wants WebCrypto-at-rest.

### Matrix protocol (v1, deliberately simpler than the docs)

One room per graph, E2EE from creation. Three custom event types in the `app.queercurves.*` namespace (`graphs-matrix.ts`):

- `app.queercurves.marker` — state event identifying a room as ours, so listing can filter without decrypting timelines
- `app.queercurves.snapshot` — **the whole `Graph` object**, resent on every change. Reads walk the timeline backwards via `findLatestGraph()` and take the newest decryptable snapshot
- `app.queercurves.tombstone` — deletion; a tombstone newer than any snapshot suppresses the room

This whole-snapshot design intentionally trades the event-stream/history granularity described in `sharing_model.md` for something verifiable against a real homeserver. Consequence to remember: megolm only shares forward from a join, so `client.ts` hooks `RoomState.events` and **re-sends the latest snapshot when someone joins** — without it an invitee lands in a room they cannot decrypt.

Read-only mode for non-owners comes from `isOwnGraph()` (room creator vs. current user).

### Combining graphs

`store/compose.ts` is the one place several graphs become one, and both features that do it share it (`data_model.md` §9a):

- **Merge** (`store/merge.ts`, `/graphs/merge`) composes and _saves_ the result as a new, ordinary graph. Non-destructive — sources are never touched, so the undo is deleting the result.
- **Collections** (`store/collections.ts`, `/collections`) save a list of graph ids and compose them _live_ on every open, then hand the throwaway result to the normal `SpectrumHistoryChart`/`NetworkChart`. Nothing composed is persisted.

`composeGraphs` is pure — id and timestamp are parameters, not `Date.now()` — so it is directly testable. Call `checkComposable` first and surface every issue it returns; the errors block composition and the warnings (axis mismatch, foreign ownership) are what makes the operation honest rather than quietly lossy. Two rules there are load-bearing rather than cosmetic: axis ranges union instead of rescaling coordinates, and network `link_status` takes the _most restrictive_ value so a merge can't manufacture consent.

A collection renders in one of two modes, and they have different compatibility rules:

- **Combined** — `compose.ts` lays members onto _shared_ axes (axis 0 is axis 0 for everyone), so it needs matching dimensionality.
- **Custom axes** — `crossplot.ts` binds each visual channel to one `(member, axis)` pair, so it reads _named_ axes and doesn't care about dimensionality. This is what makes "my stress vs their stress" and "stress vs libido" expressible.

That split is why there are two checks. `checkComposable` is strict (merges, and combined mode); `checkCollectionMembers` downgrades `dimension-mismatch` to a warning because custom axes handles it. Issues carry a machine-readable `code` — match on that, never on the prose. When both channels are axes, points are paired by **last-observation-carried-forward**, which is an approximation and must keep its caveat text on screen (THREATS.md §10).

`collections.ts` mirrors `graphs.ts` exactly (per-id dispatch, `ensureHydrated()` first, `c_…` migrates to a room on next save), and `collections-matrix.ts` mirrors `graphs-matrix.ts` with its own `app.queercurves.collection.*` event types — distinct types are what keep collections out of `listMatrixGraphs()` and vice versa. Collection rooms deliberately have **no `m.room.name`** (THREATS.md §7 rule 3).

### Domain model

`src/lib/types.ts` is the code-side mirror of `data_model.md` §1–§9. `Graph` is a discriminated union on `type`: `SpectrumGraph` (N-D axes, regions, waypoints, timestamped datapoints, saved `SpectrumView`s that reproject the same points cartesian/radial/polar) and `NetworkGraph` (nodes, typed edges, `subject_ref` links that require a consent handshake). Any schema change must bump `SCHEMA_VERSION` and update `data_model.md` §8 — `store/io.ts` refuses to import graphs from a future version, which is the fail-safe old clients rely on.

`src/lib/fixtures.ts` holds the canonical test cases from `data_model.md` §11 (aceflux, genderfluid, polycule, polycule-redacted); they are bundled and read-only.

### Rendering

`graphs/spectrum/SpectrumHistoryChart.svelte` (d3) and `graphs/network/NetworkChart.svelte` (cytoscape + fcose, lazy-loaded). `presets/palettes.ts` holds queer-flag palettes; a graph's `customization.theme.palette` drives element colors, and elements can reference entries as `@palette[i]`. App chrome is purple/lavender CSS custom properties in `src/app.css` (`--color-bg: #1a1424`, `--color-accent: #c98aff`).

## Working in this repo

- **The design docs are normative.** `data_model.md`, `sharing_model.md`, `THREATS.md`, `STACK.md` are decisions, not notes; each ends with a decisions log. Code that contradicts them is a bug in one or the other — reconcile explicitly rather than drifting.
- **Read `THREATS.md` §7 before adding any sharing or protocol surface.** The 13 design rules are the evaluation checklist: default to least sharing, no sensitive labels in plaintext room state (`m.room.name`/topic/avatar), distinct verbs for soft/hard/deletion revocation, encrypt at rest, schema-version fail-safe, honest disclosure in the UI. Violating one needs an explicit override decision, and features get written up per §8 (threats touched, adversaries, rules, residual risk).
- **STACK.md §15 is a deliberate exclusion list** — no SSR, no CDN assets, no telemetry, no OAuth, no UI framework or CSS library, no state library beyond Svelte 5 runes, no API of our own. Don't casually add any of them.
- Svelte 5 runes throughout (`$state`, `$derived`, `$props`). Two eslint rules are off on purpose (`svelte/no-navigation-without-resolve`, `svelte/prefer-svelte-reactivity`) — see the reasoning in `eslint.config.js` before working around them.
- PRs target `dev`, not `main`.
- AGPL-3.0-or-later; source files get `SPDX-License-Identifier` headers once the code stabilises.
