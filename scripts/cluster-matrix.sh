#!/usr/bin/env bash
#
# Lifecycle for the cluster Synapse — the same verbs as scripts/dev-matrix.sh,
# pointed at Kubernetes instead of docker compose.
#
# The two are interchangeable on purpose: both answer on http://localhost:8008
# and both call themselves `localhost`, so every probe in scripts/ and the login
# page work against either without a flag. Run one at a time — they want the
# same port, and the bridge refuses to fight for it.
#
# Usage:
#   scripts/cluster-matrix.sh up               apply the manifests and wait for rollout
#   scripts/cluster-matrix.sh status           deployment, pod and bridge state
#   scripts/cluster-matrix.sh bridge           run the self-healing tunnel (foreground)
#   scripts/cluster-matrix.sh bridge-install   install + start it as a user service
#   scripts/cluster-matrix.sh bridge-stop      stop and disable that user service
#   scripts/cluster-matrix.sh user <name>      create a user (password: devpass)
#   scripts/cluster-matrix.sh logs             tail Synapse logs
#   scripts/cluster-matrix.sh down             scale to zero, keep the volume
#   scripts/cluster-matrix.sh reset            wipe all Synapse state (confirms)
#
# Environment:
#   KUBE_CONTEXT    kubectl context to use (default: current)
#   KUBE_NAMESPACE  namespace to deploy into (default: ili)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NAMESPACE="${KUBE_NAMESPACE:-ili}"
OVERLAY="deploy/overlays/aether"
DEPLOYMENT=deployment/queer-curves-synapse
PVC=queer-curves-synapse-data
SERVICE_UNIT=queer-curves-matrix-bridge.service

KUBECTL=(kubectl --namespace "$NAMESPACE")
if [ -n "${KUBE_CONTEXT:-}" ]; then
	KUBECTL=(kubectl --context "$KUBE_CONTEXT" --namespace "$NAMESPACE")
fi

# Inside a container (distrobox/toolbox) the per-user systemd manager is not
# running, so `systemctl --user` here reports the manager offline and refuses to
# enable anything — while the unit file itself lands in the shared home, where
# the *host's* manager can see it perfectly well. Route systemctl to the host in
# that case. Containers share the host network namespace, so a bridge started on
# the host still puts Synapse on this shell's localhost:8008.
SYSTEMCTL=(systemctl --user)
JOURNALCTL_HINT="journalctl --user -u $SERVICE_UNIT -f"
if [ -f /run/.containerenv ] && command -v distrobox-host-exec >/dev/null 2>&1; then
	SYSTEMCTL=(distrobox-host-exec systemctl --user)
	JOURNALCTL_HINT="distrobox-host-exec journalctl --user -u $SERVICE_UNIT -f"
fi

cmd_up() {
	echo "queer-curves-synapse: applying $OVERLAY to namespace $NAMESPACE..."
	# No --prune, ever. This namespace holds unrelated production workloads and
	# prune operates on everything it believes it owns, which is more than ours.
	"${KUBECTL[@]}" apply -k "$OVERLAY"
	# Scale back up in case a previous `down` left it at zero; apply alone will
	# not do it, because the manifest's replicas field is what `down` overrode.
	"${KUBECTL[@]}" scale "$DEPLOYMENT" --replicas=1 >/dev/null
	echo
	echo "Waiting for rollout (first boot runs every SQLite migration)..."
	"${KUBECTL[@]}" rollout status "$DEPLOYMENT" --timeout=5m
	echo
	echo "Synapse is running in the cluster. It is not reachable from here yet —"
	echo "there is no route in by design. Start the bridge:"
	echo "  scripts/cluster-matrix.sh bridge           (foreground)"
	echo "  scripts/cluster-matrix.sh bridge-install   (user service, survives reboots)"
	echo
	echo "Then it answers at http://localhost:8008 like the compose one."
}

cmd_down() {
	echo "Scaling $DEPLOYMENT to zero (the volume and all state are kept)..."
	"${KUBECTL[@]}" scale "$DEPLOYMENT" --replicas=0
}

cmd_status() {
	echo "=== deployment ==="
	"${KUBECTL[@]}" get "$DEPLOYMENT" -o wide 2>&1 || true
	echo
	echo "=== pod ==="
	"${KUBECTL[@]}" get pods -l app.kubernetes.io/component=synapse -o wide 2>&1 || true
	echo
	echo "=== volume ==="
	"${KUBECTL[@]}" get "pvc/$PVC" 2>&1 || true
	echo
	echo "=== bridge ==="
	if "${SYSTEMCTL[@]}" is-active --quiet "$SERVICE_UNIT" 2>/dev/null; then
		echo "user service $SERVICE_UNIT: active"
	elif [ -f "$HOME/.config/systemd/user/$SERVICE_UNIT" ]; then
		echo "user service $SERVICE_UNIT: installed, not active"
	else
		echo "user service $SERVICE_UNIT: not installed"
	fi
	if curl --silent --fail --max-time 3 http://127.0.0.1:8008/health >/dev/null 2>&1; then
		echo "http://localhost:8008/health: OK"
	else
		echo "http://localhost:8008/health: no answer (bridge down, or Synapse is)"
	fi
}

cmd_logs() {
	"${KUBECTL[@]}" logs -f "$DEPLOYMENT" --tail=100
}

cmd_user() {
	local username="${1:-}"
	if [ -z "$username" ]; then
		echo "usage: $0 user <username>" >&2
		exit 1
	fi
	echo "Creating user @${username}:localhost (password: devpass)..."
	# Run inside the pod against its own loopback, so this works whether or not
	# the bridge is up — and so the registration shared secret never leaves the
	# cluster.
	"${KUBECTL[@]}" exec -i "$DEPLOYMENT" -- \
		register_new_matrix_user \
		-u "$username" \
		-p devpass \
		--no-admin \
		-c /data/homeserver.yaml \
		http://localhost:8008
}

cmd_bridge() {
	exec "$SCRIPT_DIR/matrix-bridge.sh" "$@"
}

cmd_bridge_install() {
	local unit_dir="$HOME/.config/systemd/user"
	local src="$REPO_ROOT/deploy/systemd/$SERVICE_UNIT"
	if [ ! -f "$src" ]; then
		echo "error: $src is missing." >&2
		exit 1
	fi
	mkdir -p "$unit_dir"
	# Rendered rather than symlinked: the unit needs this checkout's absolute
	# path, and a template with a placeholder that is substituted once is easier
	# to reason about than a unit that depends on where it was invoked from.
	sed -e "s|@@REPO_ROOT@@|$REPO_ROOT|g" "$src" > "$unit_dir/$SERVICE_UNIT"
	"${SYSTEMCTL[@]}" daemon-reload
	"${SYSTEMCTL[@]}" enable --now "$SERVICE_UNIT"
	echo "Installed and started $SERVICE_UNIT."
	echo "  status: ${SYSTEMCTL[*]} status $SERVICE_UNIT"
	echo "  logs:   $JOURNALCTL_HINT"
	echo
	echo "Note: without 'loginctl enable-linger $USER' a user service stops when"
	echo "your last session ends. Enable lingering if you want the bridge up"
	echo "while you are logged out."
}

cmd_bridge_stop() {
	"${SYSTEMCTL[@]}" disable --now "$SERVICE_UNIT" 2>/dev/null || true
	echo "Stopped and disabled $SERVICE_UNIT."
}

cmd_reset() {
	printf "Wipe ALL cluster Synapse state (database, signing key, media) in %s/%s? [y/N] " "$NAMESPACE" "$PVC"
	read -r ans
	if [ "$ans" != 'y' ] && [ "$ans" != 'Y' ]; then
		echo "Aborted."
		return
	fi
	# Scale down first: deleting a bound PVC out from under a running pod leaves
	# the claim Terminating until the pod goes anyway.
	"${KUBECTL[@]}" scale "$DEPLOYMENT" --replicas=0
	"${KUBECTL[@]}" rollout status "$DEPLOYMENT" --timeout=2m >/dev/null 2>&1 || true
	# Named resource, never a selector or --all. The namespace is shared.
	"${KUBECTL[@]}" delete "pvc/$PVC" --wait=true
	echo
	echo "Wiped. Run '$0 up' to recreate the volume and bootstrap a fresh server."
	echo "Every user id and access token from the old instance is now invalid:"
	echo "the signing key is gone, so re-create your test users."
}

case "${1:-status}" in
	up) cmd_up ;;
	down) cmd_down ;;
	status) cmd_status ;;
	logs) cmd_logs ;;
	user) shift; cmd_user "$@" ;;
	bridge) shift; cmd_bridge "$@" ;;
	bridge-install) cmd_bridge_install ;;
	bridge-stop) cmd_bridge_stop ;;
	reset) cmd_reset ;;
	-h|--help|help) sed -n '2,25p' "$0" | sed 's|^# \{0,1\}||' ;;
	*)
		echo "usage: $0 {up|down|status|logs|user <name>|bridge|bridge-install|bridge-stop|reset}" >&2
		exit 1
		;;
esac
