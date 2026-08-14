---
name: run-queer-curves
description: Build, run, and drive queer-curves. Use when asked to start the app or its dev server, run its tests or build, take a screenshot of a graph or page, log into Matrix, create/share a graph, or otherwise interact with the running app.
---

queer-curves is a SvelteKit SPA (`ssr = false`, static adapter) whose only backend
is a Matrix homeserver. Drive it headlessly with
`.claude/skills/run-queer-curves/driver.mjs` — a stdin-driven Playwright REPL that
speaks one command per line and answers `ok …` / `err …`. Matrix-backed work also
needs a local Synapse.

All paths below are relative to the repo root.

## Prerequisites

Node 22 + pnpm 11 are already required by the repo (`.nvmrc`, `engines`). The
driver needs a real Chromium — `playwright-core` is a devDependency but ships no
browser:

```bash
pnpm exec playwright-core install chromium   # → ~/.cache/ms-playwright/chromium-*/
```

Note the binary is `playwright-core`, not `playwright` — the full `playwright`
package isn't a dependency here, and `pnpm exec playwright …` fails with
`Command "playwright" not found`. On Arch it prints
`BEWARE: your OS is not officially supported … downloading fallback build for
ubuntu24.04-x64` and works fine.

The driver auto-discovers that cache (newest `chromium-*` first), then falls back
to `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`.
Override with `CHROMIUM=/path/to/chrome`.

Matrix flows additionally need Docker (or podman) for Synapse. Nothing else — no
xvfb, no display.

## Setup

```bash
pnpm install
```

## Run (agent path)

### 1. Dev server on 5174 (the driver's default `DEV_URL`)

```bash
pnpm dev --port 5174 --strictPort
```

### 2. Synapse, if you need Matrix (login, sharing, encryption)

```bash
scripts/dev-matrix.sh up          # first run generates data/synapse/homeserver.yaml
curl -s http://localhost:8008/_matrix/client/versions | head -c 60
```

Inside a distrobox there is no `docker` binary, so `dev-matrix.sh` can't run. Once
`data/synapse/` has been generated, start the existing container via the host:

```bash
distrobox-host-exec sg docker -c \
  'MATRIX_UID=$(id -u) MATRIX_GID=$(id -g) docker compose up -d synapse'
```

Registration is open on loopback, so the driver's `register` command makes its own
accounts — you do not need `scripts/dev-matrix.sh user <name>`.

### 3. Drive it

```bash
node .claude/skills/run-queer-curves/driver.mjs <<'EOF'
goto /
ss landing
goto /graphs/fixture-polycule
sleep 3000
ss polycule
text h1
quit
EOF
```

Screenshots → `/tmp/qc-shots/<name>.png` (override with `SHOT_DIR`). Progress and
browser-console output go to **stderr**; the `ok`/`err` result lines go to
**stdout**, so `… | grep -E '^(ok|err) '` gives a clean transcript and the process
exits non-zero if any command failed.

`--profile DIR` uses a persistent browser profile. This matters: the Matrix session
lives in `localStorage` and the E2EE crypto store in IndexedDB, so re-running against
the same profile resumes the same logged-in **device** — same device id, same megolm
keys, encrypted graphs still readable. A fresh profile is a brand-new device.

| command                                | what it does                                                        |
| -------------------------------------- | ------------------------------------------------------------------- |
| `goto <path>`                          | navigate and wait for hydration (see Gotchas)                       |
| `ss [name]`                            | full-page screenshot → `/tmp/qc-shots/<name>.png`                   |
| `text [selector]`                      | `innerText` of first match (default `body`), whitespace-collapsed   |
| `click <selector>`                     | click first match                                                   |
| `role <role> <name…>`                  | click by ARIA role + accessible name                                |
| `fill <selector> <value…>`             | fill first match                                                    |
| `wait <selector> [ms]`                 | `waitForSelector`                                                   |
| `sleep <ms>`                           | fixed pause                                                         |
| `eval <js…>`                           | `page.evaluate`, result JSON-stringified                            |
| `url`                                  | current URL                                                         |
| `errors`                               | every console error + every ≥400 / failed request so far            |
| `register <user> [pass]`               | register **and** run first-time key setup; returns the recovery key |
| `login <user> [pass]`                  | log into an existing account; returns the landing path              |
| `restore <recovery key…>`              | paste a recovery key on `/restore-keys` to unlock history           |
| `newgraph <spectrum\|network> <name…>` | create a graph; returns its id                                      |
| `datapoint <x> [y] [z]`                | fill the coordinate inputs and commit                               |
| `invite <@user:server>`                | invite someone to the open graph                                    |
| `accept`                               | accept the first pending invite on the landing page                 |
| `graphs`                               | list graphs from the landing page as `id :: label`                  |
| `quit`                                 | close and exit                                                      |

Default password is `devpass1234`. Args are whitespace-split, so pass single-token
selectors where possible; `wait` rejoins its args (so `wait .a, .b 15000` works) and
`eval` rejoins everything.

### Verified end-to-end Matrix run

```bash
node .claude/skills/run-queer-curves/driver.mjs --profile /tmp/qc-alice <<'EOF'
register alice1234
newgraph spectrum e2e smoke
datapoint 0.42
sleep 2000
ss alice-graph
graphs
quit
EOF
```

`newgraph` returns a Matrix room id (`!ZSAauexmccMUmexleG:localhost`) rather than a
local `g_…` id — that is how you confirm the graph really went to Matrix and not to
`localStorage`.

### Two users (sharing)

The inviter's client **must stay connected while the invitee joins** — see Gotchas.
Sequential driver runs won't do it; keep the inviter alive on a FIFO:

```bash
# Bob first, on his own profile — he must exist before Alice can invite him.
node .claude/skills/run-queer-curves/driver.mjs --profile /tmp/qc-bob <<'EOF'
register bob1234
quit
EOF

mkfifo /tmp/qc-alice.fifo
node .claude/skills/run-queer-curves/driver.mjs --profile /tmp/qc-alice \
  < /tmp/qc-alice.fifo > /tmp/qc-alice.out 2>&1 &
exec 3> /tmp/qc-alice.fifo

echo 'goto /graphs/!ROOMID:localhost' >&3
sleep 6
echo 'invite @bob1234:localhost' >&3
sleep 8

# Bob joins while Alice is still up.
node .claude/skills/run-queer-curves/driver.mjs --profile /tmp/qc-bob <<'EOF'
accept
goto /graphs/!ROOMID:localhost
sleep 5000
text body
ss bob-shared
quit
EOF

echo quit >&3; exec 3>&-; wait
```

Bob's page then reads `Shared with you — read-only. Only the original creator can
change this graph.` with Alice's datapoint present.

### The repo's own probes

`scripts/*.mjs` are single-purpose Playwright probes that predate this driver
(`smoke-test`, `share-probe`, `multi-device-probe`, `delete-probe`, `network-probe`,
`migration-probe`, `restore-error-probe`, `datapoint-probe`, `refresh-probe`). They
expect a dev server on 5174 and a live Synapse. Their chromium paths are wrong on a
fresh machine — pass one explicitly:

```bash
CHROMIUM=$(echo ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome) \
  node scripts/smoke-test.mjs
```

## Run (human path)

```bash
pnpm dev            # → http://localhost:5173, Ctrl-C to stop
pnpm build && pnpm preview --port 4173   # serve the static build instead
```

Both are useless headless — use the driver.

## Test

```bash
pnpm lint && pnpm check && pnpm test     # 5 files / 62 tests, all passing
pnpm build                               # adapter-static → build/, ~7s
```

`pnpm test` prints two `stderr |` blocks with stack traces (from
`graphs.test.ts`'s deliberate failure-path tests). Those are expected — read the
final `Tests 62 passed` line, not the noise.

**`pnpm lint` covers `.claude/`.** Prettier and ESLint both lint `driver.mjs`, so
run `pnpm prettier --write .claude/skills/run-queer-curves/driver.mjs` after
editing it or CI fails on formatting.

## Gotchas

- **A screenshot taken right after navigation is a blank white page.** `ssr = false`
  means the served HTML is an empty shell; DOMContentLoaded fires before Svelte
  hydrates. The driver's `goto` waits for `document.body.innerText` to be non-empty —
  if you drive Playwright yourself, do the same.
- **The inviter must stay online while the invitee joins.** Megolm only shares
  forward from a join, so `matrix/client.ts` hooks `RoomState.events` and re-sends
  the snapshot when someone joins. If the inviter's browser is closed, that hook
  never fires: verified by experiment, the invitee joins successfully and then sits
  on **`Loading graph…` forever**, with no error shown.
- **`Loading graph…` is also what an unknown graph id renders.** `/graphs/anything`
  never 404s — the route waits indefinitely. Same screen means "wrong id", "still
  syncing", or "can't decrypt"; distinguish them with `errors` and `graphs`.
- **A fresh browser profile is a new device.** Logging in on one redirects to
  `/restore-keys` and every existing graph shows `Loading graph…` until you
  `restore <recovery key>`. Save the key `register` returns — it is the only copy.
- **Graphs silently land in `localStorage` unless crypto is ready.** `store/graphs.ts`
  only uses Matrix when a session exists _and_ cross-signing + key backup are set up.
  A login without key setup produces `g_…` ids, not `!room:server` ids. `register`
  does the key setup; bare `login` on an unprovisioned account does not.
- **`waitForURL(/\/graphs\/[^/]+$/)` after clicking "Create graph" resolves
  instantly** — it matches `/graphs/new`, the page you're already on. Exclude `new`
  explicitly.
- **`GraphConfigForm.svelte` has no `id` attributes and reuses the label "Name" for
  every axis.** Anchor on `label.field` filtered by text and take `.first()`.
- **Room ids contain `!` and `:`** and land in URLs unescaped
  (`/graphs/!ZSAauexmccMUmexleG:localhost`). They work as-is, but quote them in shell
  commands.
- **`scripts/dev-matrix.sh` needs a `docker` binary in _this_ shell.** Inside a
  distrobox there usually isn't one; reach the host daemon instead:
  `distrobox-host-exec sg docker -c 'docker compose -f compose.yaml up -d synapse'`.
- **windo-lab's remote builder runs Node 20**, and `pnpm build` needs 22
  (`node:sqlite` / corepack). Use `-p user --local`; `bench` is pinned remote and
  refuses `--local`.

### Console noise that is not a problem

- `404 GET /favicon.ico` — `src/app.html` declares no icon.
- `404 …/_matrix/client/v3/room_keys/version` — normal before key backup exists.
- `MatrixRTCSessionManager Got room state event for unknown room !…` — matrix-js-sdk
  chatter about our graph rooms.
- `/sync error … ConnectionError: fetch failed` / `net::ERR_ABORTED` on `/sync` —
  the long-poll being cancelled at page navigation or browser close.
- `Caught /sync error Error: null pointer passed to rust` — seen once during
  registration, from `matrix-sdk-crypto-wasm`; the flow completed normally.

## Troubleshooting

- **`No chromium found`** — run `pnpm exec playwright install chromium`, or set
  `CHROMIUM=`. `which chromium` returning nothing is expected on Arch/distrobox.
- **`err <cmd>: locator… Timeout 30000ms exceeded`** — usually the wrong page, not a
  broken selector. Add `text body` before the failing command to see what's rendered.
- **Driver hangs after the last command** — it reads stdin until EOF. End every
  script with `quit`, or close the FIFO.
- **`connect: no such file or directory` on `/var/run/docker.sock`** — the host
  daemon is stopped: `distrobox-host-exec sudo -n systemctl start docker`, then wait
  for `curl http://localhost:8008/_matrix/client/versions` to answer.
- **`prettier --check` fails on `driver.mjs` in CI** — see the Test section; format it.
