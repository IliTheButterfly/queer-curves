# The cluster Matrix homeserver

A single-node Synapse running in Kubernetes, for testing queer-curves against a
homeserver that is not on your laptop — one that keeps its state when you close
it, and that two machines can share.

It is a **drop-in replacement for the docker-compose one**, not a second
environment. Both answer on `http://localhost:8008` and both call themselves
`localhost`, so every probe in `scripts/`, `scripts/smoke-test.mjs` and the
pre-filled URL on the login page work against either with no flag and no edit.
Run one at a time — they want the same port.

## Getting it running

```sh
scripts/cluster-matrix.sh up               # apply the manifests, wait for rollout
scripts/cluster-matrix.sh bridge-install   # tunnel as a user service (survives reboots)
scripts/cluster-matrix.sh user alice       # @alice:localhost, password devpass
```

Then `curl -fsS http://localhost:8008/health` answers `OK`, and the app can log
in at `http://localhost:8008` exactly as it does against compose.

If you would rather not install a service, `scripts/cluster-matrix.sh bridge`
runs the same tunnel in the foreground until you interrupt it.

| Action                          | Command                                    |
| ------------------------------- | ------------------------------------------ |
| Apply manifests + wait          | `scripts/cluster-matrix.sh up`             |
| Deployment, pod, volume, bridge | `scripts/cluster-matrix.sh status`         |
| Tunnel in the foreground        | `scripts/cluster-matrix.sh bridge`         |
| Tunnel as a user service        | `scripts/cluster-matrix.sh bridge-install` |
| Stop that service               | `scripts/cluster-matrix.sh bridge-stop`    |
| Create a user                   | `scripts/cluster-matrix.sh user <name>`    |
| Tail Synapse logs               | `scripts/cluster-matrix.sh logs`           |
| Scale to zero, keep state       | `scripts/cluster-matrix.sh down`           |
| Wipe all state (confirms)       | `scripts/cluster-matrix.sh reset`          |

`KUBE_CONTEXT` and `KUBE_NAMESPACE` override the context and namespace;
the namespace defaults to the one pinned in `overlays/aether`.

## There is no route in, and that is the design

Registration is open on this homeserver and the rate limits are switched off,
because that is what makes it useful to hammer with probe scripts. That is only
defensible while nothing outside the cluster can reach it, so the Service is a
`ClusterIP` — no node port, no ingress. The only way in is
`scripts/matrix-bridge.sh`, which is an authenticated `kubectl` connection bound
to `127.0.0.1`.

**If a route in from outside is ever added, open registration and the slack rate
limits must be revisited in the same change.** They are in
`base/config.yaml` under `test-instance overrides`, with the same warning.

Federation is off — no federation listener, an empty domain whitelist, no
trusted key servers. An unreachable host could not federate anyway, and leaving
it nominally on only produces log noise.

## Why the bridge is a script and not one line of systemd

`kubectl port-forward` on its own is not a durable tunnel. It dies when the pod
restarts, when the API server drops a long-lived stream, and when a laptop
suspends. Those are the easy cases — `Restart=always` would handle them.

The case it does not handle is the one that actually happens: **the forward stays
up while forwarding nothing.** The process is alive, the local socket still
accepts connections, and every request through it hangs. Nothing exited, so a
process supervisor sees a healthy service and does nothing, forever.

So `scripts/matrix-bridge.sh` supervises the tunnel by what it is for rather
than by whether the process lives. It polls Synapse's `/health` _through_ the
forward and tears the forward down when the answers stop, healthy-looking
process or not. The systemd unit then covers only what the script cannot survive
on its own — its own crash, a logout, a reboot.

Observed behaviour, measured rather than assumed:

- Tunnel process killed outright: replaced in about a second.
- Backend scaled to zero: retries on a doubling backoff, 1s up to a 30s cap,
  and comes back within a few seconds of the pod being available again.
- Deliberately noisy `kubectl` per-connection logging is discarded, because the
  health poll is itself a connection — left alone it writes tens of thousands of
  lines a day into the journal.

The unit sets no `StartLimit`: rate-limiting a bridge into a permanent `failed`
state is the opposite of self-healing. A cluster that is down for an hour should
find the bridge still trying when it comes back.

Note that a user service stops when your last session ends unless lingering is
enabled — `loginctl enable-linger $USER` if you want the bridge up while logged
out.

**From inside a distrobox or toolbox**, `bridge-install` installs the unit to the
_host's_ systemd rather than the container's, because a container has no running
per-user systemd manager — `systemctl --user` there reports the manager offline
and refuses to enable anything, while the unit file lands in the shared home
where the host's manager can see it. `cluster-matrix.sh` detects this and routes
`systemctl` through `distrobox-host-exec`, so `status`, `bridge-install` and
`bridge-stop` all work from either side. Containers share the host network
namespace, so a bridge running on the host still puts Synapse on the container's
`localhost:8008`. The host needs `kubectl` for this, which is where its
credentials live anyway. The `status` and `bridge-install` output prints the
right `systemctl`/`journalctl` invocation for wherever you are.

## Shape of the deployment

```
deploy/
├── base/
│   ├── pvc.yaml          2 Gi RWO — database, signing key, secrets, media
│   ├── config.yaml       homeserver config template + the bootstrap script
│   ├── synapse.yaml      Deployment (1 replica, Recreate) + ClusterIP Service
│   └── kustomization.yaml
├── overlays/aether/      pins the namespace
└── systemd/              the bridge user unit (a template; installed by the script)
```

Three decisions in there are load-bearing:

**One replica, `strategy: Recreate`.** Synapse on SQLite is single-writer. Two
replicas on one database file is corruption rather than contention, and it does
not announce itself. `Recreate` also avoids a `RollingUpdate` deadlocking on
attaching a ReadWriteOnce volume to a second pod.

**Configuration is a ConfigMap; only identity lives on the volume.** `synapse
generate` writes secrets and settings into one file on the volume, where nothing
tracks it and changing a setting means exec'ing into a pod. Here the config is a
tracked, reviewable template, and only the four things that must never change —
the signing key and three secrets — are minted on the volume, each guarded so an
existing instance keeps the identity its user ids and access tokens were issued
under. Change a setting by editing `base/config.yaml` and restarting.

**`server_name: localhost`.** The single choice that makes this a drop-in
replacement. The server name is baked into every user id and room id, and the
probe scripts construct `@bob:localhost` literally — anything else would fork the
test corpus and break them silently. Clients reach this server through the bridge
on `localhost:8008`, so the name is honest from the client's side too.

## When it breaks

- **`bridge` exits saying something already answers on port 8008** — that is
  either another bridge or the compose Synapse. `scripts/dev-matrix.sh down`, or
  use `--port` to pick another port.
- **`up` times out waiting for rollout** — `scripts/cluster-matrix.sh logs`. The
  init container runs first, so also check it:
  `kubectl logs deployment/queer-curves-synapse -c bootstrap`.
- **Login fails for a user that used to work, after a `reset`** — expected. The
  reset destroys the signing key, so every user id and access token from the old
  instance is invalid. Re-create the users.
- **`user <name>` fails with a rate limit** — it should not; the limits are
  slack. If it does, the ConfigMap and the running config have diverged, which
  means the pod has not restarted since the ConfigMap was edited.
