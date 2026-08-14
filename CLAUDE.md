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

Not CI tests — manual playwright-core harnesses that drive a real browser against `pnpm dev` + dev Synapse to exercise flows unit tests can't (crypto, sync, multi-user). Each covers one path: `smoke-test` (login → keys → create → reload), `share-probe` (two-user invite/accept), `multi-device-probe`, `delete-probe`, `network-probe`, `migration-probe`, `restore-error-probe`, `datapoint-probe`, `refresh-probe`, `name-privacy-probe` (the only one needing no homeserver — it drives the polycule fixture). They expect `DEV_URL` (default `http://localhost:5174`) and `HOMESERVER`. Add a probe when a change touches an E2EE or multi-party path; run the relevant one before claiming such a change works.

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

### Network name privacy

`graphs/network/privacy.ts` is the single source of truth for what a node is _called_ on screen. Everyone but you renders with no label at all by default (a "Person N" pseudonym was tried and rejected — a stable handle is still screenshot-able); your own node reads "You". Real names appear only while the hold-to-reveal button is held (`ui/HoldToReveal.svelte`), and PNG export goes through a per-person consent dialog (`ui/NetworkExportDialog.svelte`) before `NetworkChart.exportPng()` will produce an image. "You" is `node.is_self`, or a `subject_ref` matching the signed-in account. This is presentation-only — storage and sharing are unchanged — and the reasoning is logged in `THREATS.md` §10 and `data_model.md` §12. If you touch label rendering, derive labels from `privacy.ts` rather than reading `node.label`, or the masked view and the export will disagree.

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
