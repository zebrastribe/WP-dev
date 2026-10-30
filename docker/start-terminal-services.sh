#!/bin/sh
set -eu
WD="${WPDEV_TERMINAL_WORKDIR:-/workspace}"
if [ ! -d "$WD" ]; then WD=/workspace; fi

AUTH="${WPDEV_TERMINAL_AUTH:-}"
if [ -z "$AUTH" ] || [ "$AUTH" = "wpdev:wpdev" ] || [ "$AUTH" = "change-me-user:change-me-password" ]; then
  echo "WPDEV_TERMINAL_AUTH must be set to a non-default user:password (run wp-dev up)." >&2
  exit 1
fi

# Security notes on WPDEV_TERMINAL_AUTH:
# - Credential is visible in `ps` output; this is acceptable for a local dev tool bound to 127.0.0.1
# - ttyd only accepts credentials via -c flag (no file/stdin option)
# - ttyd -d 3 suppresses the base64 banner that would reveal the credential at startup
# - WPDEV_TERMINAL_AUTH is stripped from ttyd's environment via `env -u` so shells don't inherit it
# - The service is bound to 127.0.0.1 (via docker-compose ports) so only localhost can connect
# - The UI masks the input field (type="password")
# - The admin API never logs credential values

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

# -d 3: quieter than default (7); suppresses ttyd's startup banner that prints Basic-auth as base64.
# Use env -u to strip WPDEV_TERMINAL_AUTH from ttyd's environment so shells don't inherit it.
exec runuser -u "$TTY_USER" -- env -u WPDEV_TERMINAL_AUTH ttyd -d 3 -W -p 7681 -c "$AUTH" -w "$WD" bash -lc "cd \"$WD\" && exec bash"
