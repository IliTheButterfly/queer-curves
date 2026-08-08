#!/usr/bin/env bash
#
# A self-healing tunnel from localhost:8008 to the cluster Synapse.
#
# The cluster cannot expose this homeserver — registration is open on it, so it
# gets no node port — and `kubectl port-forward` on its own is not a durable
# substitute. It dies when the pod restarts, when the API server drops a
# long-lived SPDY stream, and when a laptop suspends. Worse, it sometimes stays
# *up* while forwarding nothing: the process is alive, the socket accepts, and
# every request hangs. A `Restart=always` supervisor cannot see that, because
# nothing exited.
#
# So this script supervises the tunnel by what it is for rather than by whether
# the process lives: it polls Synapse's /health *through* the forward, and tears
# the forward down when the answers stop, healthy-looking process or not. That
# is the whole reason this exists instead of a one-line ExecStart.
#
# Usage:
#   scripts/matrix-bridge.sh              run in the foreground until interrupted
#   scripts/matrix-bridge.sh --port 8009  forward to a different local port
#
# Environment:
#   KUBE_CONTEXT    kubectl context to use (default: current)
#   KUBE_NAMESPACE  namespace holding the deployment (default: ili)

set -euo pipefail

LOCAL_PORT=8008
NAMESPACE="${KUBE_NAMESPACE:-ili}"
SERVICE=svc/queer-curves-synapse
REMOTE_PORT=8008

# How long an unhealthy tunnel is tolerated before being replaced. Three misses
# at two seconds is ~6s of grace, which rides out a GC pause without sitting on
# a tunnel that is genuinely dead.
HEALTH_INTERVAL=5
HEALTH_FAILURES_BEFORE_RESTART=3

# How long a newly started forward gets to produce one healthy answer. This is a
# wall-clock deadline rather than a count of attempts on purpose: when kubectl is
# listening but the pod behind it is gone, the health request connects and then
# hangs until curl's own timeout, so each attempt costs seconds rather than being
# instant. Counting attempts made the real window vary by a factor of four
# depending on *how* the backend was broken.
ESTABLISH_TIMEOUT=20
HEALTH_TIMEOUT=3

# Reconnect backoff, doubling to a cap. The cap matters more than the floor: a
# pod that is crash-looping should be retried steadily rather than hammered, and
# an API server that is rate-limiting us should not be argued with.
BACKOFF_MIN=1
BACKOFF_MAX=30

while [ $# -gt 0 ]; do
	case "$1" in
		--port) LOCAL_PORT="${2:?--port needs a value}"; shift 2 ;;
		--namespace) NAMESPACE="${2:?--namespace needs a value}"; shift 2 ;;
		-h|--help) sed -n '2,25p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
		*) echo "matrix-bridge: unknown argument: $1" >&2; exit 2 ;;
	esac
done

KUBECTL=(kubectl --namespace "$NAMESPACE")
if [ -n "${KUBE_CONTEXT:-}" ]; then
	KUBECTL=(kubectl --context "$KUBE_CONTEXT" --namespace "$NAMESPACE")
fi

HEALTH_URL="http://127.0.0.1:${LOCAL_PORT}/health"
FORWARD_PID=""

log() { printf '%s matrix-bridge: %s\n' "$(date +%H:%M:%S)" "$*"; }

stop_forward() {
	if [ -n "$FORWARD_PID" ] && kill -0 "$FORWARD_PID" 2>/dev/null; then
		kill "$FORWARD_PID" 2>/dev/null || true
		# Reap it, and escalate if it ignores the TERM. A port-forward that
		# survives here would hold the local port and every subsequent attempt
		# would fail to bind — the failure mode this whole function prevents.
		for _ in 1 2 3 4 5 6 7 8 9 10; do
			kill -0 "$FORWARD_PID" 2>/dev/null || break
			sleep 0.2
		done
		if kill -0 "$FORWARD_PID" 2>/dev/null; then
			log "forward $FORWARD_PID ignored SIGTERM; sending SIGKILL"
			kill -9 "$FORWARD_PID" 2>/dev/null || true
		fi
		wait "$FORWARD_PID" 2>/dev/null || true
	fi
	FORWARD_PID=""
}

on_exit() {
	trap - EXIT INT TERM
	log "shutting down"
	stop_forward
	exit 0
}
trap on_exit EXIT INT TERM

healthy() {
	curl --silent --show-error --fail --max-time "$HEALTH_TIMEOUT" "$HEALTH_URL" >/dev/null 2>&1
}

port_is_taken() {
	# A plain TCP connect rather than an HTTP request: whatever holds the port
	# will make port-forward's bind fail, and it does not have to be something
	# that answers HTTP for that to be true. Usually it is a second bridge or
	# the docker-compose Synapse — both fine things to be running, but silently
	# competing with them for the port is not.
	(exec 3<>"/dev/tcp/127.0.0.1/${LOCAL_PORT}") 2>/dev/null
}

if port_is_taken; then
	log "something is already answering on port ${LOCAL_PORT}."
	log "that is either another bridge or the docker-compose Synapse"
	log "(scripts/dev-matrix.sh down), so this one would fight it for the port."
	log "use --port to pick another, or stop the other one first."
	exit 1
fi

log "bridging ${HEALTH_URL} -> ${NAMESPACE}/${SERVICE}:${REMOTE_PORT}"

backoff=$BACKOFF_MIN
while true; do
	# Start the forward detached from this shell's stdin so it cannot consume
	# terminal input. stdout is discarded because port-forward logs a line per
	# connection, and the health poll is a connection — left alone it writes
	# tens of thousands of "Handling connection for 8008" lines a day into the
	# journal, which is how a useful log becomes an unreadable one. stderr is
	# kept: a bind failure or an RBAC denial goes there and is worth reading.
	"${KUBECTL[@]}" port-forward --address 127.0.0.1 \
		"$SERVICE" "${LOCAL_PORT}:${REMOTE_PORT}" </dev/null >/dev/null &
	FORWARD_PID=$!

	# Wait for the tunnel to come up before judging it. Until the first healthy
	# answer there is nothing to distinguish "still connecting" from "broken",
	# so a failure here is patience, not a restart.
	established=false
	deadline=$((SECONDS + ESTABLISH_TIMEOUT))
	while [ "$SECONDS" -lt "$deadline" ]; do
		if ! kill -0 "$FORWARD_PID" 2>/dev/null; then
			break
		fi
		if healthy; then
			established=true
			break
		fi
		sleep 1
	done

	if [ "$established" = true ]; then
		log "tunnel up (pid $FORWARD_PID) — Synapse is at http://localhost:${LOCAL_PORT}"
		backoff=$BACKOFF_MIN

		# Watch. Two independent failure modes to catch: the process exiting,
		# and the process living on while the tunnel carries nothing.
		misses=0
		while kill -0 "$FORWARD_PID" 2>/dev/null; do
			sleep "$HEALTH_INTERVAL"
			if healthy; then
				if [ "$misses" -gt 0 ]; then
					log "health recovered after $misses missed check(s)"
				fi
				misses=0
				continue
			fi
			misses=$((misses + 1))
			if [ "$misses" -ge "$HEALTH_FAILURES_BEFORE_RESTART" ]; then
				log "health check failed ${misses}x through a live tunnel; replacing it"
				break
			fi
		done

		if kill -0 "$FORWARD_PID" 2>/dev/null; then
			stop_forward
		else
			log "forward exited"
			FORWARD_PID=""
		fi
	else
		log "tunnel did not come up; retrying in ${backoff}s"
		stop_forward
		sleep "$backoff"
		backoff=$((backoff * 2))
		[ "$backoff" -gt "$BACKOFF_MAX" ] && backoff=$BACKOFF_MAX
	fi
done
