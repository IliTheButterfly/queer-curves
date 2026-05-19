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
# Everything that touches ./data runs as the host UID/GID (exported as
# MATRIX_UID/MATRIX_GID for compose to pick up) so the developer always owns
# the generated files — otherwise the container's internal user writes them
# and the host shell can't append the dev-overrides block.
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

# Host UID/GID. compose.yaml reads ${MATRIX_UID}/${MATRIX_GID} via variable
# substitution for its `user:` field; the `docker run` for generate also
# needs --user so the generated config is host-owned from the start.
export MATRIX_UID="$(id -u)"
export MATRIX_GID="$(id -g)"

# Detect podman compose as a fallback so contributors on Arch / Fedora-likes
# without rootless Docker can still run this.
if ! docker compose version >/dev/null 2>&1; then
	if command -v podman-compose >/dev/null 2>&1; then
		COMPOSE=(podman-compose)
	elif podman compose --help >/dev/null 2>&1; then
		COMPOSE=(podman compose)
	fi
fi

check_ownership() {
	# If the data dir exists but isn't owned by the host user, we'll fail to
	# write the overrides block. Tell the user to reset rather than throwing
	# the raw permission-denied error from cat >>.
	if [ -d "$DATA_DIR" ] && [ ! -w "$DATA_DIR" ]; then
		echo "error: $DATA_DIR exists but isn't writable by $(id -un)." >&2
		echo "       This usually means an earlier run generated files as the" >&2
		echo "       container's internal UID. Run '$0 reset' to wipe and try again." >&2
		exit 1
	fi
}

generate_config() {
	echo "queer-curves-synapse: generating Synapse config in $DATA_DIR..."
	mkdir -p "$DATA_DIR"
	docker run --rm \
		--user "$MATRIX_UID:$MATRIX_GID" \
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
	check_ownership
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
	if [ "$ans" != 'y' ] && [ "$ans" != 'Y' ]; then
		echo "Aborted."
		return
	fi
	"${COMPOSE[@]}" down 2>/dev/null || true
	# Try a normal rm first. If that fails — typically because an earlier
	# (pre-fix) run created files as the container's internal UID and the
	# host user can't unlink them — fall back to wiping via a privileged
	# container, which always has the perms.
	if ! rm -rf "$DATA_DIR" 2>/dev/null; then
		echo "Host rm couldn't remove all files; wiping via docker..."
		docker run --rm \
			--entrypoint sh \
			-v "$REPO_ROOT/data":/data \
			"$IMAGE" -c 'rm -rf /data/synapse'
	fi
	if [ -d "$DATA_DIR" ]; then
		echo "warning: $DATA_DIR still exists; remove it manually." >&2
		return 1
	fi
	echo "Wiped. Run '$0 up' to regenerate."
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
