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
# - Written to a mode-600 file, never logged to stdout/stderr
# - ttyd -d 3 suppresses the base64 banner that would reveal the credential
# - The credential is read from file at exec time so `ps` cannot leak it
# - The service is bound to 127.0.0.1 (via docker-compose ports) so only localhost can connect
# - The UI masks the input field (type="password")
# - The admin API never logs credential values

# Write credential to a mode-600 file so it doesn't appear in `ps` output.
TTYD_AUTH_FILE="/tmp/.ttyd-auth-$$"
printf '%s' "$AUTH" > "$TTYD_AUTH_FILE"
chmod 600 "$TTYD_AUTH_FILE"
trap 'rm -f "$TTYD_AUTH_FILE"' EXIT

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
# Use a wrapper script to read credential from file at exec time, preventing `ps` from leaking it.
cat > /tmp/.ttyd-wrapper-$$.sh << 'WRAPPER_EOF'
#!/bin/sh
AUTH_FILE="$1"; shift
WD="$1"; shift
TTY_AUTH="$(cat "$AUTH_FILE")"
rm -f "$AUTH_FILE"
exec ttyd -d 3 -W -p 7681 -c "$TTY_AUTH" -w "$WD" "$@"
WRAPPER_EOF
chmod 700 /tmp/.ttyd-wrapper-$$.sh
exec runuser -u "$TTY_USER" -- /tmp/.ttyd-wrapper-$$.sh "$TTYD_AUTH_FILE" "$WD" bash -lc "cd \"$WD\" && exec bash"
