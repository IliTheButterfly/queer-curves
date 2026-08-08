"""Synapse admin operations, executed *inside* the homeserver pod.

Streamed in over `kubectl exec -i -- python -` by scripts/cluster-matrix.sh; it
is not meant to be run on a workstation. Living in the pod is what lets it talk
to http://localhost:8008 as a trusted local client, so no admin credential ever
crosses the bridge, and it works whether or not a bridge is even running.

Deactivation, not deletion: Synapse has no operation that removes a user row.
`POST /_synapse/admin/v1/deactivate/<user>` with erase=true is the supported
thing — it wipes profile data, invalidates every access token and kicks the
account out of its rooms, leaving a tombstone row behind. The tombstone is not
an implementation detail to be worked around: it is what stops the localpart
being re-registered, so a deactivated @alice:localhost is gone for good rather
than recycled to somebody else. Say so at the call site before doing it.

Usage (argv is assembled by cluster-matrix.sh):
    python - list
    python - deactivate <admin-user> <admin-password> [--all | <user> ...]
"""

import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:8008"


def request(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} failed: HTTP {exc.code} {detail}") from exc


def all_users():
    """Every account, active and already-deactivated alike.

    The admin API pages, and defaulting to one page would silently under-report
    on a homeserver that probes have been hammering — which is exactly where
    this gets used.
    """
    users, token = [], None
    while True:
        path = "/_synapse/admin/v2/users?limit=200&deactivated=true"
        if token:
            path += "&from=" + str(token)
        page = request("GET", path, token=ADMIN_TOKEN)
        users.extend(page.get("users", []))
        token = page.get("next_token")
        if not token:
            return users


def login(user, password):
    body = {
        "type": "m.login.password",
        "identifier": {"type": "m.id.user", "user": user},
        "password": password,
    }
    return request("POST", "/_matrix/client/v3/login", body=body)["access_token"]


if __name__ == "__main__":
    action = sys.argv[1]

    if action == "list":
        # Reads the database directly rather than going through the admin API,
        # so listing needs no admin account and no credentials at all.
        import sqlite3

        conn = sqlite3.connect("file:/data/homeserver.db?mode=ro", uri=True)
        rows = conn.execute(
            "select name, admin, deactivated from users order by creation_ts"
        ).fetchall()
        active = [r for r in rows if not r[2]]
        print(f"{len(rows)} users, {len(active)} active")
        for name, is_admin, deactivated in rows:
            flags = []
            if is_admin:
                flags.append("admin")
            flags.append("deactivated" if deactivated else "active")
            print(f"  {name:30} {' '.join(flags)}")
        raise SystemExit(0)

    if action == "deactivate":
        admin_user, admin_password = sys.argv[2], sys.argv[3]
        targets = sys.argv[4:]
        ADMIN_TOKEN = login(admin_user, admin_password)
        admin_id = f"@{admin_user}:localhost"

        if targets == ["--all"]:
            wanted = [u["name"] for u in all_users() if not u["deactivated"]]
        else:
            wanted = [t if t.startswith("@") else f"@{t}:localhost" for t in targets]

        # The admin deactivates itself last: doing it first would invalidate the
        # token this loop is authenticated with, and the remaining accounts would
        # survive with no indication that anything had been skipped.
        wanted = [u for u in wanted if u != admin_id]

        failures = 0
        for user in wanted:
            try:
                request(
                    "POST",
                    "/_synapse/admin/v1/deactivate/" + user,
                    token=ADMIN_TOKEN,
                    body={"erase": True},
                )
                print(f"  deactivated {user}")
            except SystemExit as exc:
                # Keep going. One account that refuses to deactivate should not
                # strand the rest half-processed.
                print(f"  FAILED {user}: {exc}", file=sys.stderr)
                failures += 1

        request(
            "POST",
            "/_synapse/admin/v1/deactivate/" + admin_id,
            token=ADMIN_TOKEN,
            body={"erase": True},
        )
        print(f"  deactivated {admin_id} (the temporary admin)")

        print(f"\n{len(wanted)} account(s) deactivated, {failures} failure(s).")
        raise SystemExit(1 if failures else 0)

    raise SystemExit(f"unknown action: {action}")
