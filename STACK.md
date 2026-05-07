# Stack

Technology choices, dependency hygiene, build & release. Companion to `data_model.md`, `sharing_model.md`, `THREATS.md`.

Status: **draft**, v0. Created 2026-05-07.

## 1. Overview

queer-curves is a single web application — built once, packaged for multiple platforms via thin wrappers. There is **no queer-curves-specific backend service**: every user's data lives on the Matrix homeserver of their choice (or the project-run default), and the app is a specialized Matrix client.

Top-level dependency picture:

```
Web app (TypeScript, SvelteKit)
├── Matrix client (matrix-js-sdk + vodozemac WASM)
├── Charting
│   ├── D3 (2D, in main bundle)
│   ├── Three.js (3D, lazy)
│   └── Cytoscape.js (network, lazy)
├── Storage at rest (IndexedDB + WebCrypto)
└── PWA shell (service worker for offline shell only — NOT for background sync)

Wrappers (added phased)
├── PWA (v1, free)
├── Tauri 2.x (desktop, v1.x)
└── Capacitor (iOS/Android, v2 if PWA insufficient)

Server side (project-operated default homeserver)
└── Matrix homeserver (Synapse / Dendrite — TBD, see §8)
```

**Dependency philosophy**: minimal, conservative, pinned. Every new top-level dependency is a decision recorded in the log, not a casual `pnpm add`.

## 2. Languages and tooling

| | Choice | Notes |
|---|---|---|
| Web language | **TypeScript** (strict) | No JavaScript files at the top level |
| Native language (Tauri) | **Rust** | Only added when Tauri lands; standard Tauri stack |
| Package manager | **pnpm** | Stricter than npm, faster, lockfile clarity |
| Node target | **LTS active** (Node 22.x at time of writing) | Pin in `.nvmrc` |
| Editor config | `.editorconfig` | Tabs / spaces / line-ending consistency |
| Lint | **ESLint** (typescript-eslint) | Strict config, no `any` without justification |
| Format | **Prettier** | One canonical style; no debates |
| Pre-commit | **lefthook** or **husky** + lint-staged | Catch obvious issues before they land |

## 3. Frontend: SvelteKit

Decided in earlier conversation. Recap and specifics:

- **Mode: SPA, not SSR.** E2EE makes server-side rendering of content useless (the server can't decrypt). We use SvelteKit's `adapter-static` so the build is a static bundle, deployable from any static host or as PWA assets.
- **Reactivity: Svelte 5 runes.** No additional state-management library (Pinia/Redux/Zustand etc.). The data model is small enough that runes + Svelte stores cover it.
- **Routing: SvelteKit's file-based router.**
- **Styling: TBD.** Likely vanilla CSS with custom properties for theming (no Tailwind in v1 — keep dependency surface small). Final decision deferred.
- **Build: Vite** (bundled with SvelteKit). No customization in v1 beyond what SvelteKit provides.

## 4. Matrix client

- **`matrix-js-sdk`** — the canonical TypeScript SDK. We use it directly, not the higher-level matrix-react-sdk (which carries Element's UX baggage we don't want).
- **Cryptography: `@matrix-org/matrix-sdk-crypto-wasm`** (vodozemac) — the modern Rust-based crypto layer that replaces the legacy libolm. Required for forward-compat; libolm is deprecated.
- **Sync mode: pull-on-app-open** (per `sharing_model.md` §1, project_sharing_model memory). Implementation: configure the SDK with manual sync control rather than a long-running sync loop. On app open, run one initial sync, decrypt, render. On app close, stop the sync.
- **Crypto store: IndexedDB** (the SDK's default; we layer encryption-at-rest on top — see §6).
- **Verification: cross-signing required** (per `sharing_model.md` §16.4). Mandatory key backup at first login.

## 5. Charting and rendering

| Library | Use | Loading |
|---|---|---|
| **D3** | Spectrum graphs (1D/2D), axes, regions, waypoints, scatter clouds | Main bundle |
| **Three.js** | 3D spectrum graphs (when 3D becomes a v1.x feature) | Lazy on first 3D-graph render |
| **Cytoscape.js** | Network graphs (polycules) | Lazy on first network-graph render |

Each library is wrapped in a Svelte component (`<SpectrumChart>`, `<NetworkChart>`, `<Spectrum3DChart>`) that owns the imperative DOM/canvas, with reactive props piped in. Components handle their own dependency lazy-loading via dynamic import.

**Rationale recap**: no single library covers the customization range (axis-with-named-waypoints, labeled regions, history-as-cloud, polycule networks, eventual 3D). D3 has the highest ceiling; Three.js / Cytoscape are best-of-breed for their niches.

## 6. Storage at rest

- **IndexedDB** holds: matrix-js-sdk's crypto store (Megolm/Olm sessions), event cache, account_data, and our own graph cache.
- **All custom (non-SDK) data is encrypted before write** using WebCrypto with AES-GCM-256.
- **Cache encryption key** is derived from the user's Matrix recovery key (passed through HKDF-SHA-256 with a queer-curves-specific salt). This gives us:
  - Zero plaintext at rest from our app.
  - Recovery semantics tied to Matrix's recovery key — losing one means losing both.
  - Cross-device key sharing handled by Matrix's existing key-backup mechanism.
- **What the SDK encrypts itself** (crypto store contents) we leave alone — the SDK manages it.

## 7. Multi-platform wrappers

Phased rollout:

### 7.1 v1: PWA only

Web app served as a Progressive Web App. Installable on Android, desktop browsers, and (with caveats) iOS.

- `manifest.json` with full icon set + theme.
- Service worker scope: **offline shell only.** No background sync. No push subscription. (Both would compromise pull-on-open semantics — see `sharing_model.md` §1.)
- HTTPS required (which it always is for PWAs).

### 7.2 v1.x: Tauri 2.x for desktop

When PWA hits a desktop ceiling (window management, tray, file integrations), wrap with Tauri 2.x.

- Tauri produces ~3MB binaries vs Electron's ~80MB. Footprint discipline is a project value.
- The Rust side gives us room for native crypto if we ever want it (we don't currently — see THREATS T14 / §14).
- Reproducible builds via Tauri's stable build system.

### 7.3 v2: Capacitor for iOS/Android

Only added if the PWA hits a real wall on mobile — iOS limitations on PWAs, or Android background-task aggressiveness if the threat model loosens to allow background sync. Not in v1 scope.

**Explicitly rejected:**
- **Electron**: too heavy for the project's footprint goals. Tauri covers desktop.
- **React Native / Flutter / native**: would require rebuilding the UI from scratch. Out of scope for the foreseeable future.
- **matrix-react-sdk / Element-fork**: inherits UX we don't want; we use matrix-js-sdk directly.

## 8. Homeserver

### 8.1 The default homeserver (project-operated)

A queer-curves-operated homeserver will exist for users who don't want to self-host. Operational specifics deferred — user will provide further info before launch. Decisions still open:

- **Implementation: Synapse** (decided 2026-05-07). Most stable and battle-tested of the homeserver implementations; Python, heavy, but operationally well-understood. Revisit if footprint or operational cost becomes a problem at scale.
- **Federation policy**: open federation to start, with allowlist tightening if abuse emerges.
- **Registration**: invite-based to control onboarding pace at launch; openable later.
- **Terms of service / data retention / abuse policy**: deferred.
- **Hosting / domain**: TBD — depends on user's plans.

### 8.2 Self-hosting

Any Matrix-spec-compliant homeserver works. We commit to:

- A documented self-host quickstart (Docker compose for Synapse, with the specific config flags queer-curves expects).
- No server-side dependencies on queer-curves-specific features. Vanilla Matrix is enough.
- Allowing users to choose their homeserver freely at first login.

## 9. Build, release, dependency hygiene

Direct consequences of `THREATS.md` §7 design rules:

| Rule | Implementation |
|---|---|
| Pinned dependencies | `pnpm-lock.yaml` committed; CI fails on drift |
| Vulnerability check | `pnpm audit` on CI; weekly Dependabot/Renovate |
| Signed releases | Sigstore signing for tagged releases |
| Reproducible builds where feasible | Tauri build is reproducible; web bundle reproducibility checked at release |
| Subresource integrity / no CDN | Zero third-party-CDN-loaded assets at runtime; everything ships from our origin |
| No telemetry | No analytics, no error reporting, no "phone home" by default. Future opt-in error reporting if added is named in onboarding (see THREATS §7 rule 11) |
| No remote runtime config | The shipped client behavior is determined entirely by the shipped binary; no fetched configs that could change behavior |

CI: **GitHub Actions** initially (the project lives on GitHub for v1; planned migration to self-hosted Forgejo later — see §17). Workflows are written portably so the Forgejo Actions move is smooth: Forgejo Actions implements the same workflow syntax, so most steps port directly, but keep use of GitHub-specific actions (`actions/cache`, `actions/upload-artifact`, anything tagged `github/`) minimal and well-documented. Steps: install, lint, typecheck, test, build, audit. No deploy step in v1 — releases are manual.

## 10. Testing

- **Unit tests**: **vitest**. Co-located with source.
- **Integration tests**: **vitest** with a real matrix-js-sdk instance against an in-process Synapse for crypto-relevant flows.
- **End-to-end tests**: **Playwright** running the built app against a local dockerized Synapse.
- **Property-based testing**: for the encrypted-at-rest cache layer (round-trip properties, key isolation), use **fast-check**.
- **Manual review for crypto-adjacent changes**: any PR touching the cache encryption, key derivation, or crypto-store config requires explicit reviewer sign-off. Codified as a CODEOWNERS rule once the repo exists.

We do **not** ship without test coverage of:
- Datapoint encryption round-trip.
- Cache encryption round-trip.
- Snapshot-on-join flow.
- Three revocation modes (soft, hard kick, deletion).
- Consent handshake for `subject_ref`.

## 11. Repo structure

Single repo for v1 (not a monorepo). Layout:

```
queer-curves/
├── data_model.md          # design docs at root for v0; move to docs/ when they multiply
├── sharing_model.md
├── THREATS.md
├── STACK.md
├── README.md              # to be written
├── LICENSE                # to be written (see §12)
├── CODE_OF_CONDUCT.md     # to be written (see §14)
├── CONTRIBUTING.md        # to be written
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── svelte.config.js
├── vite.config.ts
├── src/
│   ├── lib/               # SvelteKit convention for shared code
│   │   ├── matrix/        # matrix-js-sdk wrapping & sync control
│   │   ├── crypto/        # WebCrypto cache layer
│   │   ├── graphs/        # graph domain types & renderers
│   │   │   ├── spectrum/
│   │   │   └── network/
│   │   └── ui/            # shared Svelte components
│   ├── routes/            # SvelteKit pages
│   └── app.html
├── e2e/                   # Playwright tests
├── scripts/               # build & release helpers
└── .github/               # workflows; mirror to .forgejo/ on Forgejo migration
```

When design docs proliferate beyond ~6, move them under `docs/`. Until then, root keeps them visible.

## 12. Licensing

**Decision: AGPLv3-or-later** (2026-05-07).

Reasoning:

- queer-curves is federated/self-hostable software where forks running as services should remain open. AGPL closes the SaaS loophole that GPL leaves.
- AGPL is the de facto norm in the queer/community self-hosted software ecosystem (Pleroma, Akkoma, Forgejo, etc.). Familiar territory for contributors and users.
- The "or-later" clause keeps the door open if FSF ships an AGPLv4.

Full canonical license text lives in `LICENSE` (fetched from gnu.org). Source files should carry SPDX headers (`SPDX-License-Identifier: AGPL-3.0-or-later`) once source code exists.

## 13. Domain and event namespace

- **Domain: deferred for v1** (decided 2026-05-07). The project will not register a domain in the v1 timeframe. Public homeserver hosting, when it lands, will use whatever domain emerges later.
- **Matrix custom event namespace**: `app.queercurves.*` for v1. If/when a domain is registered, the namespace will rebase to reverse-DNS via a versioned migration; schema versioning (`data_model.md` §8) makes this safe — clients can support both old and new namespaces during the transition.

## 14. Code of conduct and community norms

Adopt **Contributor Covenant 2.1** as the baseline CoC. Communities formed around queer-curves users should reasonably expect explicit, enforced anti-harassment norms.

Active moderation policy and reporting channel deferred until the project has a public surface to moderate. Flag for revisit before public launch.

**Final decision: user.**

## 15. What's deliberately NOT in the v1 stack

To prevent scope creep, naming things we don't include and won't add casually:

- No queer-curves backend service. Matrix homeserver is the only server.
- No analytics / telemetry / error reporting (until named in §9).
- No identity server / 3PID dependency (`sharing_model.md` §3.3 / §14).
- No SSR (E2EE makes it pointless).
- No third-party authentication (OAuth, social login). Matrix login is the auth.
- No remote feature flags / runtime config.
- No CDN-loaded runtime assets.
- No Electron, no React Native, no Flutter.
- No Tailwind/Bootstrap/UI-library frameworks in v1.
- No state-management library beyond Svelte 5 runes.
- No GraphQL/tRPC/REST API of our own — the Matrix Client-Server API is the API.

## 16. Open questions

*All v0 stack questions resolved — see §17. New questions append here as they emerge.*

## 17. Decisions log

**2026-05-07** — initial open questions resolved:

1. **License: AGPLv3-or-later** (§12). Full license text in `LICENSE`.
2. **Default homeserver: Synapse** (§8.1). Most stable / best-understood operationally.
3. **Domain: deferred for v1** (§13). Event namespace stays `app.queercurves.*` until a domain is chosen, with a versioned-migration plan for the eventual rebase.
4. **Styling: vanilla CSS with custom properties** (§3). No CSS framework / utility library in v1.
5. **Code of Conduct: Contributor Covenant 2.1** (§14). Lands as `CODE_OF_CONDUCT.md` once the repo is initialized.
6. **Forge: GitHub for v1, planned migration to self-hosted Forgejo later** (§9, §11). CI workflows written portably so the migration is mostly drop-in.
