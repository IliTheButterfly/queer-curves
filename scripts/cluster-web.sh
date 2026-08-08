#!/usr/bin/env bash
#
# Lifecycle for the frontend running on the cluster — the same verbs as
# scripts/cluster-matrix.sh, for the other half of the deployment.
#
# The cluster serves a static bundle built here, not an image built by CI (see
# the header of deploy/base/web.yaml for why). `deploy` is therefore the only
# thing that changes what is served: it builds locally and streams the result
# into the pod.
#
# The bridge puts it on http://localhost:5174 — the port scripts/*-probe.mjs
# already default to for DEV_URL, so the probes exercise the cluster build with
# no flag and no edit, exactly as they hit the cluster homeserver on
# localhost:8008. `pnpm dev` on 5173 can run alongside it; a dev server on 5174
# cannot, and the bridge will say so rather than fight for the port.
#
# Usage:
#   scripts/cluster-web.sh up               apply, wait for rollout, then deploy
#   scripts/cluster-web.sh deploy           build and ship the bundle (no restart)
#   scripts/cluster-web.sh deploy --no-build ship whatever is already in build/
#   scripts/cluster-web.sh status           deployment, pod, bundle and bridge state
#   scripts/cluster-web.sh bridge           run the self-healing tunnel (foreground)
#   scripts/cluster-web.sh bridge-install   install + start it as a user service
#   scripts/cluster-web.sh bridge-stop      stop and disable that user service
#   scripts/cluster-web.sh rollback         swap back to the previous bundle
#   scripts/cluster-web.sh restart          replace the pod (for nginx config changes)
#   scripts/cluster-web.sh logs             tail nginx logs
#   scripts/cluster-web.sh down             scale to zero, keep the volume
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
DEPLOYMENT=deployment/queer-curves-web
SERVICE=svc/queer-curves-web
LOCAL_PORT=5174
SERVICE_UNIT=queer-curves-web-bridge.service

KUBECTL=(kubectl --namespace "$NAMESPACE")
if [ -n "${KUBE_CONTEXT:-}" ]; then
	KUBECTL=(kubectl --context "$KUBE_CONTEXT" --namespace "$NAMESPACE")
fi

# See the same block in cluster-matrix.sh: inside a container there is no
# per-user systemd manager, so systemctl has to be run on the host, where the
# unit file (in the shared home) is visible anyway.
SYSTEMCTL=(systemctl --user)
JOURNALCTL_HINT="journalctl --user -u $SERVICE_UNIT -f"
if [ -f /run/.containerenv ] && command -v distrobox-host-exec >/dev/null 2>&1; then
	SYSTEMCTL=(distrobox-host-exec systemctl --user)
	JOURNALCTL_HINT="distrobox-host-exec journalctl --user -u $SERVICE_UNIT -f"
fi

cmd_up() {
	echo "queer-curves-web: applying $OVERLAY to namespace $NAMESPACE..."
	"${KUBECTL[@]}" apply -k "$OVERLAY"
	"${KUBECTL[@]}" scale "$DEPLOYMENT" --replicas=1 >/dev/null
	echo
	"${KUBECTL[@]}" rollout status "$DEPLOYMENT" --timeout=3m
	echo
	# A running nginx with an empty volume serves 404s, which looks like a broken
	# deployment. `up` therefore always ends with a deploy — the pod is only
	# useful once it has a bundle.
	cmd_deploy "$@"
	echo
	echo "Now start the bridge:"
	echo "  scripts/cluster-web.sh bridge           (foreground)"
	echo "  scripts/cluster-web.sh bridge-install   (user service, survives reboots)"
	echo
	echo "Then the app is at http://localhost:${LOCAL_PORT}"
}

cmd_deploy() {
	local build=true
	while [ $# -gt 0 ]; do
		case "$1" in
			--no-build) build=false; shift ;;
			*) echo "deploy: unknown argument: $1" >&2; exit 2 ;;
		esac
	done

	if [ "$build" = true ]; then
		echo "Building the static bundle..."
		pnpm build
	fi

	if [ ! -f build/index.html ]; then
		echo "error: build/index.html is missing — nothing to deploy." >&2
		echo "       run 'pnpm build' first, or drop --no-build." >&2
		exit 1
	fi

	echo
	echo "Shipping $(find build -type f | wc -l) files ($(du -sh build | cut -f1)) to the pod..."
	# Streamed as a tar over exec's stdin rather than `kubectl cp`, for two
	# reasons: it extracts into an *inactive* directory so nothing is ever served
	# half-written, and the target is wiped first so files deleted since the last
	# release actually disappear. A `cp` over the live root would leave stale
	# assets behind forever and serve a mix of two builds.
	tar czf - -C build . | "${KUBECTL[@]}" exec -i "$DEPLOYMENT" -- /bin/sh -c '
		set -eu
		cur=$(readlink /srv/www/current 2>/dev/null || echo /srv/www/a)
		case "$cur" in
			*/a) next=/srv/www/b ;;
			*) next=/srv/www/a ;;
		esac
		rm -rf "$next"
		mkdir -p "$next"
		tar xzf - -C "$next"
		# The switch. ln -sfn unlinks and re-creates, so there is a sub-millisecond
		# window where the root does not resolve and a request in flight could 404.
		# The alternative — rename(2) over the old symlink — needs mv -T, which
		# busybox does not reliably have, and getting that wrong moves the release
		# *inside* the live directory instead of replacing it. A microsecond gap on
		# a test deployment is the better failure.
		ln -sfn "$next" /srv/www/current
		echo "  serving $next ($(find "$next" -type f | wc -l) files)"
		echo "  previous release kept at $cur for rollback"
	'
	echo
	echo "Deployed. The bundle is live immediately — nginx resolves the root per"
	echo "request, so there is no restart and no rollout to wait for."
}

cmd_rollback() {
	echo "Swapping back to the previous release..."
	"${KUBECTL[@]}" exec -i "$DEPLOYMENT" -- /bin/sh -c '
		set -eu
		cur=$(readlink /srv/www/current 2>/dev/null || echo /srv/www/a)
		case "$cur" in
			*/a) other=/srv/www/b ;;
			*) other=/srv/www/a ;;
		esac
		if [ ! -f "$other/index.html" ]; then
			echo "  no previous release to roll back to ($other has no index.html)" >&2
			exit 1
		fi
		ln -sfn "$other" /srv/www/current
		echo "  serving $other again"
	'
}

cmd_restart() {
	# For nginx config changes. A mounted ConfigMap updates in place eventually,
	# but nginx only reads its config at startup, so an edit to web.yaml is inert
	# until the pod is replaced. The bundle lives on the volume and is untouched
	# by this.
	echo "Restarting $DEPLOYMENT to pick up config changes..."
	"${KUBECTL[@]}" rollout restart "$DEPLOYMENT"
	"${KUBECTL[@]}" rollout status "$DEPLOYMENT" --timeout=3m
}

cmd_down() {
	echo "Scaling $DEPLOYMENT to zero (the volume and the bundle are kept)..."
	"${KUBECTL[@]}" scale "$DEPLOYMENT" --replicas=0
}

cmd_status() {
	echo "=== deployment ==="
	"${KUBECTL[@]}" get "$DEPLOYMENT" -o wide 2>&1 || true
	echo
	echo "=== pod ==="
	# Both label selectors, always. `component=web` alone also matches
	# almagest-web, which is a co-tenant in this namespace — a status command that
	# reports someone else's pod as ours is how the wrong thing gets restarted.
	"${KUBECTL[@]}" get pods \
		-l app.kubernetes.io/name=queer-curves,app.kubernetes.io/component=web \
		-o wide 2>&1 || true
	echo
	echo "=== bundle ==="
	# nginx being up says nothing about whether anything has been deployed into
	# it, so this is reported separately from pod health.
	"${KUBECTL[@]}" exec "$DEPLOYMENT" -- /bin/sh -c '
		cur=$(readlink /srv/www/current 2>/dev/null || echo "")
		if [ -z "$cur" ]; then
			echo "no current symlink — the pod has not initialised its document root"
		elif [ -f "$cur/index.html" ]; then
			# Counted in the resolved directory, not through the symlink: find does
			# not follow symlinks by default, so counting /srv/www/current reports 0
			# files next to "index.html present" and reads as a broken deployment.
			echo "serving $cur — $(find "$cur" -type f | wc -l) files, index.html present"
		else
			echo "serving $cur — EMPTY, run: scripts/cluster-web.sh deploy"
		fi
	' 2>&1 || echo "(could not reach the pod)"
	echo
	echo "=== bridge ==="
	if "${SYSTEMCTL[@]}" is-active --quiet "$SERVICE_UNIT" 2>/dev/null; then
		echo "user service $SERVICE_UNIT: active"
	elif [ -f "$HOME/.config/systemd/user/$SERVICE_UNIT" ]; then
		echo "user service $SERVICE_UNIT: installed, not active"
	else
		echo "user service $SERVICE_UNIT: not installed"
	fi
	if curl --silent --fail --max-time 3 "http://127.0.0.1:${LOCAL_PORT}/healthz" >/dev/null 2>&1; then
		echo "http://localhost:${LOCAL_PORT}/healthz: OK"
	else
		echo "http://localhost:${LOCAL_PORT}/healthz: no answer (bridge down, or nginx is)"
	fi
}

cmd_logs() {
	"${KUBECTL[@]}" logs -f "$DEPLOYMENT" --tail=100
}

cmd_bridge() {
	exec "$SCRIPT_DIR/cluster-bridge.sh" \
		--service "$SERVICE" \
		--port "$LOCAL_PORT" \
		--remote-port 80 \
		--health-path /healthz \
		--name web \
		--namespace "$NAMESPACE" \
		"$@"
}

cmd_bridge_install() {
	local unit_dir="$HOME/.config/systemd/user"
	local src="$REPO_ROOT/deploy/systemd/$SERVICE_UNIT"
	if [ ! -f "$src" ]; then
		echo "error: $src is missing." >&2
		exit 1
	fi
	mkdir -p "$unit_dir"
	sed -e "s|@@REPO_ROOT@@|$REPO_ROOT|g" "$src" > "$unit_dir/$SERVICE_UNIT"
	"${SYSTEMCTL[@]}" daemon-reload
	"${SYSTEMCTL[@]}" enable --now "$SERVICE_UNIT"
	echo "Installed and started $SERVICE_UNIT."
	echo "  status: ${SYSTEMCTL[*]} status $SERVICE_UNIT"
	echo "  logs:   $JOURNALCTL_HINT"
	echo
	echo "The app is at http://localhost:${LOCAL_PORT} — note that it needs the"
	echo "Matrix bridge too, since the browser talks to the homeserver directly:"
	echo "  scripts/cluster-matrix.sh bridge-install"
}

cmd_bridge_stop() {
	"${SYSTEMCTL[@]}" disable --now "$SERVICE_UNIT" 2>/dev/null || true
	echo "Stopped and disabled $SERVICE_UNIT."
}

case "${1:-status}" in
	up) shift; cmd_up "$@" ;;
	deploy) shift; cmd_deploy "$@" ;;
	rollback) cmd_rollback ;;
	restart) cmd_restart ;;
	down) cmd_down ;;
	status) cmd_status ;;
	logs) cmd_logs ;;
	bridge) shift; cmd_bridge "$@" ;;
	bridge-install) cmd_bridge_install ;;
	bridge-stop) cmd_bridge_stop ;;
	-h|--help|help) sed -n '2,32p' "$0" | sed 's|^# \{0,1\}||' ;;
	*)
		echo "usage: $0 {up|deploy|rollback|restart|status|logs|bridge|bridge-install|bridge-stop|down}" >&2
		exit 1
		;;
esac
