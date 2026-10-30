#!/bin/sh
set -eu
WD="${WPDEV_TERMINAL_WORKDIR:-/workspace}"
if [ ! -d "$WD" ]; then WD=/workspace; fi

AUTH="${WPDEV_TERMINAL_AUTH:-}"
if [ -z "$AUTH" ] || [ "$AUTH" = "wpdev:wpdev" ] || [ "$AUTH" = "change-me-user:change-me-password" ]; then
  echo "WPDEV_TERMINAL_AUTH must be set to a non-default user:password (run wp-dev up)." >&2
  exit 1
fi

# G09 FIX: The credential must not appear in any process's argv.
# Architecture:
# 1. Auth proxy (Node) listens on the published port (7681), enforces Basic auth
# 2. ttyd runs on container-internal loopback (127.0.0.1:17681) without -c
# 3. ttyd uses --auth-header to trust the proxy's header after auth succeeds
# 4. WPDEV_TERMINAL_AUTH is stripped from ttyd's environment (env -u)
#
# This approach was chosen because ttyd does not support credential files:
# - Issue #1262: "Support --credential-file" (closed, not planned)
# - PR #700: "Add file credential option" (closed, not merged)
# See: https://github.com/tsl0922/ttyd/issues/1262
#      https://github.com/tsl0922/ttyd/pull/700

# Internal port for ttyd (not published, only accessible within the container)
TTYD_INTERNAL_PORT="${WPDEV_TTYD_INTERNAL_PORT:-17681}"
export WPDEV_TTYD_INTERNAL_PORT="$TTYD_INTERNAL_PORT"

# Sync/terminal runners keep root so they can use the mounted docker.sock for pull/push.
node /workspace/docker/terminal-runner.mjs >>/tmp/terminal-runner.log 2>&1 &
node /workspace/docker/host-runner.mjs >>/tmp/sync-runner.log 2>&1 &

# Start the auth proxy (handles Basic auth, Origin check, forwards to ttyd)
# The proxy reads WPDEV_TERMINAL_AUTH from the environment.
# Run in background and check if it exits - if it does, exit the container so
# the restart policy can re-create it (the proxy is essential).
node /workspace/docker/ttyd-auth-proxy.mjs >>/tmp/ttyd-auth-proxy.log 2>&1 &
PROXY_PID=$!

# Wait a moment for the proxy to start
sleep 0.5

# Check if proxy started successfully
if ! kill -0 "$PROXY_PID" 2>/dev/null; then
  echo "ERROR: Auth proxy failed to start. Check /tmp/ttyd-auth-proxy.log" >&2
  cat /tmp/ttyd-auth-proxy.log >&2 || true
  exit 1
fi

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
# -i 127.0.0.1: bind to container-internal loopback only (not accessible from outside)
# -H X-WPDEV-Auth: trust this header from the auth proxy (reverse-proxy auth mode)
# NO -c flag: credential is NOT on the command line (G09 requirement)
# env -u: strip WPDEV_TERMINAL_AUTH from ttyd's environment so shells don't inherit it.
#
# The auth proxy handles Basic auth and forwards to this internal ttyd instance.
exec runuser -u "$TTY_USER" -- env -u WPDEV_TERMINAL_AUTH ttyd -d 3 -W -i 127.0.0.1 -p "$TTYD_INTERNAL_PORT" -H X-WPDEV-Auth -w "$WD" bash -lc "cd \"$WD\" && exec bash"
