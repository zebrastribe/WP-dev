#!/bin/sh
set -eu
WD="${WPDEV_TERMINAL_WORKDIR:-/workspace}"
if [ ! -d "$WD" ]; then WD=/workspace; fi

AUTH="${WPDEV_TERMINAL_AUTH:-}"
if [ -z "$AUTH" ] || [ "$AUTH" = "wpdev:wpdev" ] || [ "$AUTH" = "change-me-user:change-me-password" ]; then
  echo "WPDEV_TERMINAL_AUTH must be set to a non-default user:password (run wp-dev up)." >&2
  exit 1
fi

# Security: write credential to a temp file readable only by root, then pass via --credential.
# This prevents the credential from appearing in `ps` output on shared hosts.
# The file is created with 0600 permissions before writing the credential.
CRED_FILE="/tmp/.ttyd-credential-$$"
rm -f "$CRED_FILE"
touch "$CRED_FILE"
chmod 600 "$CRED_FILE"
printf '%s' "$AUTH" > "$CRED_FILE"

# Clean up the credential file on exit
cleanup() {
  rm -f "$CRED_FILE"
}
trap cleanup EXIT INT TERM

# Sync/terminal runners keep root so they can use the mounted docker.sock for pull/push.
node /workspace/docker/terminal-runner.mjs >>/tmp/terminal-runner.log 2>&1 &
node /workspace/docker/host-runner.mjs >>/tmp/sync-runner.log 2>&1 &

# Interactive ttyd: host developer uid (workspace writes) but NOT root; docker CLI is root-only.
HOST_UID="${WPDEV_HOST_UID:-}"
HOST_GID="${WPDEV_HOST_GID:-}"
TTY_USER=wpdev-tty
if [ -n "$HOST_UID" ] && [ "$HOST_UID" -gt 0 ] && getent passwd "$HOST_UID" >/dev/null 2>&1; then
  # node images already have uid 1000 (user "node") — reuse it instead of failing usermod.
  TTY_USER=$(getent passwd "$HOST_UID" | cut -d: -f1)
elif [ -n "$HOST_UID" ] && [ -n "$HOST_GID" ] && [ "$HOST_UID" -gt 0 ] && [ "$HOST_GID" -gt 0 ]; then
  groupmod -g "$HOST_GID" wpdev-tty 2>/dev/null || groupadd -g "$HOST_GID" wpdev-tty 2>/dev/null || true
  usermod -u "$HOST_UID" -g "$HOST_GID" wpdev-tty 2>/dev/null || true
fi
# Root-only docker CLI: interactive ttyd user must not be able to talk to docker.sock.
chown root:root /usr/local/bin/docker /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null || true
chmod 700 /usr/local/bin/docker /usr/bin/docker /usr/bin/docker-compose 2>/dev/null || true
chmod 700 /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null || true

# -d 3: quieter than default (7); suppresses ttyd's startup banner.
# -O: check Origin header matches the terminal URL (defense-in-depth against CSRF).
# --credential: read auth from file (ttyd 1.7.4+), avoids exposing credential in ps output.
# env -u: strip WPDEV_TERMINAL_AUTH from ttyd's environment so shells don't inherit it.
exec runuser -u "$TTY_USER" -- env -u WPDEV_TERMINAL_AUTH ttyd -d 3 -W -O -p 7681 --credential "$CRED_FILE" -w "$WD" bash -lc "cd \"$WD\" && exec bash"
