#!/usr/bin/env bash
#
# Bootstrap and lifecycle for the local Synapse used by queer-curves dev.
#
# First-time `up` generates a Synapse config in ./data/synapse, patches in
# dev-only overrides (open registration, slack rate limits), then starts the
# server via docker compose. Subsequent `up` runs just start the existing
# container. State (signing keys, SQLite DB, media) lives in ./data/synapse
# and is gitignored.
#
# Usage:
#   scripts/dev-matrix.sh up               start (or first-time setup + start)
#   scripts/dev-matrix.sh down             stop the container, keep data
#   scripts/dev-matrix.sh logs             tail Synapse logs
#   scripts/dev-matrix.sh user <name>      create a user via register API
#   scripts/dev-matrix.sh reset            wipe ./data/synapse (after confirm)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DATA_DIR="$REPO_ROOT/data/synapse"
CONFIG="$DATA_DIR/homeserver.yaml"
IMAGE="matrixdotorg/synapse:v1.122.0"
COMPOSE=(docker compose)

# Detect podman compose as a fallback so contributors on Arch / Fedora-likes
# without rootless Docker can still run this.
if ! docker compose version >/dev/null 2>&1; then
	if command -v podman-compose >/dev/null 2>&1; then
		COMPOSE=(podman-compose)
	elif podman compose --help >/dev/null 2>&1; then
		COMPOSE=(podman compose)
	fi
fi

generate_config() {
	echo "queer-curves-synapse: generating Synapse config in $DATA_DIR..."
	mkdir -p "$DATA_DIR"
	docker run --rm \
		-v "$DATA_DIR":/data \
		-e SYNAPSE_SERVER_NAME=localhost \
		-e SYNAPSE_REPORT_STATS=no \
		"$IMAGE" generate >/dev/null

	if ! grep -q 'queer-curves dev overrides' "$CONFIG" 2>/dev/null; then
		cat <<-'YAML' >>"$CONFIG"

			# --- queer-curves dev overrides (managed by scripts/dev-matrix.sh) ---
			# DO NOT use this config for any internet-reachable instance.
			enable_registration: true
			enable_registration_without_verification: true
			# Loosen rate limits — federation is off, so this is loopback-only.
			rc_message:
			  per_second: 1000
			  burst_count: 1000
			rc_registration:
			  per_second: 1000
			  burst_count: 1000
			rc_login:
			  address:
			    per_second: 1000
			    burst_count: 1000
			  account:
			    per_second: 1000
			    burst_count: 1000
			  failed_attempts:
			    per_second: 1000
			    burst_count: 1000
			suppress_key_server_warning: true
		YAML
	fi
}

cmd_up() {
	if [ ! -f "$CONFIG" ]; then
		generate_config
	fi
	"${COMPOSE[@]}" up -d synapse
	echo
	echo "Synapse is starting at http://localhost:8008"
	echo "  health check: curl -fsS http://localhost:8008/health && echo OK"
	echo "  create user:  scripts/dev-matrix.sh user <name>"
	echo "  tail logs:    scripts/dev-matrix.sh logs"
}

cmd_down() {
	"${COMPOSE[@]}" down
}

cmd_logs() {
	"${COMPOSE[@]}" logs -f synapse
}

cmd_user() {
	local username="${1:-}"
	if [ -z "$username" ]; then
		echo "usage: $0 user <username>" >&2
		exit 1
	fi
	echo "Creating user @${username}:localhost (password: devpass)..."
	docker exec -i queer-curves-synapse \
		register_new_matrix_user \
		-u "$username" \
		-p devpass \
		--no-admin \
		-c /data/homeserver.yaml \
		http://localhost:8008
}

cmd_reset() {
	printf "Wipe all Synapse data in %s? [y/N] " "$DATA_DIR"
	read -r ans
	if [ "$ans" = 'y' ] || [ "$ans" = 'Y' ]; then
		"${COMPOSE[@]}" down 2>/dev/null || true
		rm -rf "$DATA_DIR"
		echo "Wiped. Run '$0 up' to regenerate."
	else
		echo "Aborted."
	fi
}

case "${1:-up}" in
	up) cmd_up ;;
	down) cmd_down ;;
	logs) cmd_logs ;;
	user) shift; cmd_user "$@" ;;
	reset) cmd_reset ;;
	*)
		echo "usage: $0 {up|down|logs|user <name>|reset}" >&2
		exit 1
		;;
esac
