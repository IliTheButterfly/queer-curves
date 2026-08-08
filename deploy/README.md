# queer-curves on the cluster

Two halves: a single-node **Synapse** homeserver, and the built **frontend**
served by nginx. Both run in Kubernetes, neither is reachable from outside the
cluster, and each is reached through its own self-healing loopback tunnel.

Both are drop-in replacements for their local equivalents rather than a second
environment. The homeserver answers on `http://localhost:8008` and calls itself
`localhost`; the frontend answers on `http://localhost:5174`, the port
`scripts/*-probe.mjs` already default to for `DEV_URL`. So the probe scripts
exercise the cluster with no flag and no edit — the last full check of this
deployment was `share-probe.mjs` passing against the cluster frontend and the
cluster homeserver together, with no local server of either kind running.

## Getting it running

```sh
scripts/cluster-matrix.sh up               # homeserver
scripts/cluster-web.sh up                  # frontend: apply, then build + ship the bundle
scripts/cluster-matrix.sh bridge-install   # tunnel on :8008
scripts/cluster-web.sh bridge-install      # tunnel on :5174
scripts/cluster-matrix.sh user alice       # @alice:localhost, password devpass
```

Then the app is at **http://localhost:5174** and logs in against
**http://localhost:8008**, which is what its login page already pre-fills.

You need both bridges. The frontend is a static bundle running in _your_ browser,
so it talks to the homeserver from your machine, not from inside the cluster —
serving the app without the Matrix bridge gives you a page that loads and then
cannot log in.

| Action                    | Homeserver                         | Frontend                        |
| ------------------------- | ---------------------------------- | ------------------------------- |
| Apply + wait              | `cluster-matrix.sh up`             | `cluster-web.sh up`             |
| Ship a new build          | —                                  | `cluster-web.sh deploy`         |
| Undo the last build       | —                                  | `cluster-web.sh rollback`       |
| Pick up a config change   | re-apply, then delete the pod      | `cluster-web.sh restart`        |
| State of everything       | `cluster-matrix.sh status`         | `cluster-web.sh status`         |
| Tunnel, foreground        | `cluster-matrix.sh bridge`         | `cluster-web.sh bridge`         |
| Tunnel, as a user service | `cluster-matrix.sh bridge-install` | `cluster-web.sh bridge-install` |
| Stop that service         | `cluster-matrix.sh bridge-stop`    | `cluster-web.sh bridge-stop`    |
| Logs                      | `cluster-matrix.sh logs`           | `cluster-web.sh logs`           |
| Scale to zero, keep state | `cluster-matrix.sh down`           | `cluster-web.sh down`           |
| Create a user             | `cluster-matrix.sh user <name>`    | —                               |
| Wipe all state            | `cluster-matrix.sh reset`          | —                               |

`KUBE_CONTEXT` and `KUBE_NAMESPACE` override the context and namespace; the
namespace otherwise comes from `overlays/aether`.

Run one of each at a time: the compose Synapse also wants 8008, and a
`pnpm dev --port 5174` also wants 5174. A dev server on the default 5173 is no
problem and can sit alongside the cluster frontend. Either bridge will tell you
when something already holds its port rather than fighting for it.

## There is no route in, and that is the design

Registration is open on the homeserver and its rate limits are switched off,
because that is what makes it useful to hammer with probe scripts. That is only
defensible while nothing outside the cluster can reach it, so both Services are
`ClusterIP` — no node port, no ingress. The only ways in are the bridges, which
are authenticated `kubectl` connections bound to `127.0.0.1`.

**If a route in from outside is ever added, open registration and the slack rate
limits must be revisited in the same change.** They are in `base/config.yaml`
under `test-instance overrides`, with the same warning.

For the frontend there is a second, sharper reason not to expose it: the app
needs a **secure context** for the WebCrypto and IndexedDB work that end-to-end
encryption depends on, and browsers grant that to `http://localhost` but not to a
bare cluster IP over plain HTTP. Serving through a loopback bridge is therefore
not merely convenient — without TLS it is the only arrangement in which the
crypto works at all. A node port would give you an app that loads and then fails
at encryption, which is a much worse failure than not loading.

Federation is off on the homeserver — no federation listener, an empty domain
whitelist, no trusted key servers. An unreachable host could not federate anyway.

## Why the bridges are a script and not one line of systemd

`kubectl port-forward` on its own is not a durable tunnel. It dies when the pod
restarts, when the API server drops a long-lived stream, and when a laptop
suspends. Those are the easy cases — `Restart=always` would handle them.

The case it does not handle is the one that actually happens: **the forward stays
up while forwarding nothing.** The process is alive, the local socket still
accepts connections, and every request through it hangs. Nothing exited, so a
process supervisor sees a healthy service and does nothing, forever.

So `scripts/cluster-bridge.sh` supervises the tunnel by what it is for rather
than by whether the process lives. It polls a health URL _through_ the forward
and tears the forward down when the answers stop, healthy-looking process or not.
The systemd units then cover only what the script cannot survive on its own — its
own crash, a logout, a reboot.

One script, two units. The supervision logic is subtle enough that a second copy
would drift; the units are separate because the two bridges fail independently,
and restarting one should not disturb the other.

Observed behaviour, measured rather than assumed:

- Tunnel process killed outright: replaced in about a second, both bridges.
- Pod replaced under a live tunnel: recovered in about six seconds, unattended.
- Backend scaled to zero: retries on a doubling backoff, 1s to a 30s cap, and
  comes back within seconds of the pod being available again.
- `kubectl`'s per-connection logging is discarded, because the health poll is
  itself a connection — left alone it writes tens of thousands of lines a day
  into the journal.
- `StartLimitIntervalSec=0` lives in `[Unit]`, where systemd actually reads it.
  Under `[Service]` it is ignored with a log line, leaving the default limit in
  force — which parks a struggling bridge in `failed` after five restarts in ten
  seconds, the exact opposite of self-healing, at the exact moment you need it.

Note that a user service stops when your last session ends unless lingering is
enabled — `loginctl enable-linger $USER` if you want the bridges up while logged
out.

**From inside a distrobox or toolbox**, `bridge-install` installs to the _host's_
systemd rather than the container's, because a container has no running per-user
systemd manager — `systemctl --user` there reports the manager offline and
refuses to enable anything, while the unit file lands in the shared home where
the host's manager can see it. Both scripts detect this and route `systemctl`
through `distrobox-host-exec`, so `status`, `bridge-install` and `bridge-stop`
work from either side, and each prints the right `systemctl`/`journalctl`
invocation for wherever you ran it. Containers share the host network namespace,
so a bridge running on the host still serves the container's `localhost`.

## How the frontend gets there

There is no image build, on purpose. The app is a static bundle from
`adapter-static`, and this repo has no CI that publishes container images, so
baking one would mean inventing a registry, credentials and a publishing pipeline
in order to ship 65 files. Instead `cluster-web.sh deploy` builds locally and
streams a tar into the pod over `kubectl exec`.

The trade is explicit: **the cluster cannot rebuild the frontend by itself**, and
`deploy` is the only thing that changes what is served. When CI starts publishing
images, this becomes a Deployment with an image tag and the volume goes away.

Two details in `deploy` that are not incidental:

- It extracts into an **inactive** directory and swaps a symlink, so nothing is
  ever served half-written. Two release directories alternate, which also gives
  `rollback` something to swap back to.
- It **wipes** the target first. Copying over the live root would leave assets
  deleted since the last build in place forever, quietly serving a mixture of two
  builds.

The bundle is live the moment the symlink moves — nginx resolves its root per
request, so there is no restart and no rollout to wait for.

## Shape of the deployment

```
deploy/
├── base/
│   ├── pvc.yaml          2 Gi RWO — Synapse database, signing key, secrets, media
│   ├── config.yaml       homeserver config template + its bootstrap script
│   ├── synapse.yaml      Deployment (1 replica, Recreate) + ClusterIP Service
│   ├── web.yaml          nginx + 1 Gi RWO for the bundle + ClusterIP Service
│   └── kustomization.yaml
├── overlays/aether/      pins the namespace
└── systemd/              the two bridge units (templates; installed by the scripts)
```

Decisions in there that are load-bearing:

**One replica, `strategy: Recreate`, for both.** Synapse on SQLite is
single-writer: two replicas on one database file is corruption rather than
contention, and it does not announce itself. Both volumes are ReadWriteOnce, so a
`RollingUpdate` would also deadlock attaching the volume to a second pod. For the
frontend it additionally keeps `deploy` honest — one pod holds the bundle, so a
deploy cannot land on some replicas only.

**Homeserver configuration is a ConfigMap; only identity lives on the volume.**
`synapse generate` writes secrets and settings into one file on the volume, where
nothing tracks it and changing a setting means exec'ing into a pod. Here the
config is a tracked, reviewable template, and only the four things that must never
change — the signing key and three secrets — are minted on the volume, each
guarded so an existing instance keeps the identity its user ids and access tokens
were issued under.

**`server_name: localhost`.** The choice that makes the homeserver a drop-in
replacement. The server name is baked into every user id and room id, and the
probes construct `@bob:localhost` literally — anything else would fork the test
corpus and break them silently.

**nginx's MIME table must not be replaced.** The WASM type is pinned with
`default_type` inside a `location ~* \.wasm$`, deliberately _not_ a `types { }`
block: a `types` block in a server does not add one entry, it replaces the whole
inherited table, and then everything else — `index.html` included — is served as
`application/octet-stream` and the browser downloads the app instead of running
it. The WASM type matters because matrix-sdk-crypto's 5 MiB sidecar is loaded
with `instantiateStreaming()`, which rejects a response that is not
`application/wasm`, and it fails exactly when encryption initialises — so a wrong
header presents as "encryption is broken" rather than as a MIME problem.

**`index.html` is never cached, hashed assets are cached forever.** A cached
shell pins the browser to bundles a redeploy has already deleted, and the app then
dies on a 404 for a chunk, which looks like a broken deployment rather than a
stale page.

## When it breaks

- **A bridge exits saying something already answers on its port** — that is the
  local equivalent (the compose Synapse on 8008, a dev server on 5174) or a
  second bridge. Stop it, or pass `--port`.
- **The app loads but cannot log in** — the Matrix bridge is down. The browser
  talks to the homeserver from your machine, so the app being served says nothing
  about the homeserver being reachable. `scripts/cluster-matrix.sh status`.
- **The app 404s everything** — the volume has no bundle:
  `scripts/cluster-web.sh status` says `EMPTY` in that case. Run `deploy`.
- **The browser downloads a file instead of showing the app** — the MIME table
  has been replaced rather than extended; see the note above.
- **Encryption fails but everything else works** — check the WASM response is
  `application/wasm`: `curl -sI localhost:5174/_app/immutable/assets/*.wasm`.
- **An nginx config edit seems to do nothing** — a mounted ConfigMap updates in
  place but nginx only reads config at startup: `scripts/cluster-web.sh restart`.
- **`cluster-matrix.sh up` times out waiting for rollout** — check the init
  container too: `kubectl logs deployment/queer-curves-synapse -c bootstrap`.
- **Login fails for a user that used to work, after a `reset`** — expected. The
  reset destroys the signing key, so every user id and token from the old instance
  is invalid. Re-create the users.
