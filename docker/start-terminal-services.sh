#!/bin/sh
set -eu
WD="${WPDEV_TERMINAL_WORKDIR:-/workspace}"
if [ ! -d "$WD" ]; then WD=/workspace; fi

AUTH="${WPDEV_TERMINAL_AUTH:-}"
if [ -z "$AUTH" ] || [ "$AUTH" = "wpdev:wpdev" ] || [ "$AUTH" = "change-me-user:change-me-password" ]; then
  echo "WPDEV_TERMINAL_AUTH must be set to a non-default user:password (run wp-dev up)." >&2
  exit 1
fi

# KNOWN LIMITATION (G09): ttyd 1.7.7's -c/--credential flag requires passing credentials
# on the command line as "user:pass". ttyd does not support reading credentials from a file.
# On multi-user systems this exposes the credential to `ps aux`. Mitigations:
# 1. Terminal ports bind to 127.0.0.1 only (not exposed to network)
# 2. The credential is auto-generated per-stack (unique per project)
# 3. env -u strips WPDEV_TERMINAL_AUTH from the ttyd environment
# See: https://github.com/tsl0922/ttyd/issues/1190 for upstream feature request

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
# -c: basic auth credential (username:password format required by ttyd).
# env -u: strip WPDEV_TERMINAL_AUTH from ttyd's environment so shells don't inherit it.
exec runuser -u "$TTY_USER" -- env -u WPDEV_TERMINAL_AUTH ttyd -d 3 -W -O -p 7681 -c "$AUTH" -w "$WD" bash -lc "cd \"$WD\" && exec bash"
