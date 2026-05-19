# queer-curves

Privacy-respecting graphs for tracking and sharing identity over time. Built on Matrix for federation and end-to-end encryption.

## Status

**Pre-development on the protocol side; usable locally.** The SvelteKit app runs end-to-end against `localStorage` — you can create graphs, drop datapoints, configure schemas, apply queer-flag palettes, and export/import JSON. Matrix integration (the actual sharing/federation layer the docs describe) hasn't started yet.

Design docs:

- [Data model](data_model.md) — what a graph is, schema, customization, views.
- [Sharing model](sharing_model.md) — how access works, on top of Matrix rooms.
- [Threat model](THREATS.md) — what we defend against and what we don't.
- [Stack](STACK.md) — technology choices and dependency hygiene.

## Running locally

### Prerequisites

- **Node 22 LTS** — `.nvmrc` pins the major version. The build will run on 20.19+ in practice but CI uses 22.
- **pnpm 11+** — the lockfile is pnpm 11; older versions may resolve different transitive deps.

If you don't have those yet, two paths that don't need sudo:

```sh
# via mise (recommended — handles Node + pnpm together)
curl https://mise.run | sh
mise install node@22 pnpm@latest

# or via nvm / fnm + corepack
nvm install 22
corepack enable
corepack prepare pnpm@latest --activate
```

System package managers (`pacman`, `apt`, `brew`) also work; use whatever Node 22 LTS source you trust.

### First-time setup

```sh
git clone <this-repo> queer-curves
cd queer-curves
pnpm install
```

`pnpm install` may prompt to approve `esbuild`'s postinstall script (it unpacks the platform-specific native binary). `pnpm-workspace.yaml` already lists it in `allowBuilds`, so the prompt should auto-approve; if it doesn't, run:

```sh
pnpm approve-builds --all
```

### Day-to-day

| Task                               | Command                                  |
| ---------------------------------- | ---------------------------------------- |
| Dev server with HMR                | `pnpm dev` (opens http://localhost:5173) |
| Production build                   | `pnpm build` (output in `build/`)        |
| Preview the built bundle           | `pnpm preview`                           |
| Typecheck Svelte + TS              | `pnpm check`                             |
| Watch-mode typecheck               | `pnpm check:watch`                       |
| Format with Prettier               | `pnpm format`                            |
| Lint (prettier `--check` + eslint) | `pnpm lint`                              |
| Run unit tests once                | `pnpm test`                              |
| Re-run on file changes             | `pnpm test:watch`                        |
| Vitest UI in the browser           | `pnpm test:ui`                           |

Before pushing, the same gauntlet CI runs locally is:

```sh
pnpm lint && pnpm check && pnpm test && pnpm build
```

### Local Matrix server

Matrix integration is in early scaffolding. For development you'll need a homeserver to test against — the project ships a Docker Compose setup for a single-node Synapse bound to `127.0.0.1`.

| Action                        | Command                            |
| ----------------------------- | ---------------------------------- |
| First-time setup + start      | `scripts/dev-matrix.sh up`         |
| Create a dev user             | `scripts/dev-matrix.sh user alice` |
| Tail logs                     | `scripts/dev-matrix.sh logs`       |
| Stop the container            | `scripts/dev-matrix.sh down`       |
| Wipe Synapse state (confirms) | `scripts/dev-matrix.sh reset`      |

The first `up` generates a fresh `homeserver.yaml` in `data/synapse/` and patches in dev-only overrides — open registration on the loopback interface and slack rate limits so we don't trip them during exploratory testing. Created users get the password `devpass` (e.g. `scripts/dev-matrix.sh user alice` makes `@alice:localhost`).

Synapse listens at `http://localhost:8008`. Federation is off, registration is open on the loopback interface — **do not expose this server to the network**. The `data/` directory holds all running state (signing keys, SQLite DB, media uploads) and is gitignored.

Requires Docker, or a compatible runtime (`podman compose` and `podman-compose` are auto-detected).

### Project layout

```
data_model.md, sharing_model.md, THREATS.md, STACK.md   # canonical design docs
src/
├── lib/
│   ├── graphs/spectrum/        # SpectrumHistoryChart + view presets
│   ├── graphs/network/         # NetworkChart (cytoscape, lazy-loaded)
│   ├── presets/palettes.ts     # 18 queer-flag colour palettes
│   ├── store/                  # localStorage + JSON import/export
│   ├── ui/                     # forms, pickers, lists
│   ├── fixtures.ts             # canonical test cases from data_model.md §11
│   └── types.ts                # domain types
├── routes/
│   ├── +page.svelte            # landing — your graphs, fixtures, palettes
│   ├── graphs/[id]/            # detail (with edit/delete/export)
│   ├── graphs/[id]/edit/       # schema editor
│   ├── graphs/new/             # create
│   └── palettes/               # gallery + per-palette preview
└── app.css, app.html           # global styles + shell
.github/workflows/ci.yml        # lint, check, test, build on push/PR
```

The single seam to swap for Matrix later is [src/lib/store/graphs.ts](src/lib/store/graphs.ts) — every read and write goes through that module today.

### Storage

User-created graphs live in `localStorage` under the key `queer-curves:user-graphs`. To wipe in dev: open DevTools console and run `localStorage.removeItem('queer-curves:user-graphs')`. Fixtures (aceflux, genderfluid, polycule, polycule-redacted) are bundled into the build and are read-only — they live in `src/lib/fixtures.ts`.

JSON export/import works against this same store, so you can hand-edit a graph file and re-import it.

### Troubleshooting

- **`pnpm install` fails with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild`** — run `pnpm approve-builds --all` once. The approval is recorded in `pnpm-workspace.yaml`.
- **`pnpm build` fails with `Cannot find package '@sveltejs/vite-plugin-svelte'`** — the lockfile resolves vite-plugin-svelte to a version compatible with our Vite 5; if you've upgraded Vite, pin a matching plugin major.
- **Tests fail with `Package subpath './module-runner' is not defined`** — Vitest 4 needs Vite 6+. We're on Vite 5, so stay on the Vitest 2 line pinned in `package.json`.
- **`which node` returns `/usr/bin/node` with an ancient version** — your user-local Node install isn't winning the PATH race. Prepend its `bin/` (e.g. `~/.local/share/mise/installs/node/22/bin`) in your shell rc.

## Contributing

Open work is loosely tracked in commit history and the design docs. Pre-development means the API surface, data model, and routing are still in motion — don't be precious about anything that isn't a documented decision in [data_model.md](data_model.md), [sharing_model.md](sharing_model.md), [THREATS.md](THREATS.md), or [STACK.md](STACK.md).

[THREATS.md §7](THREATS.md) lists the design rules new features get evaluated against. Read it before adding sharing/protocol surface.

## License

[AGPL-3.0-or-later](LICENSE). Source files should carry an `SPDX-License-Identifier: AGPL-3.0-or-later` header once source code stabilises.
